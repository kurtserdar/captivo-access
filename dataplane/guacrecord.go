package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"time"
)

const (
	recFlushBytes      = 256 * 1024
	recFlushInterval   = 2 * time.Second
	recDefaultMaxBytes = 524288000 // 500 MiB
)

// recordingMaxBytes is the per-recording cumulative (pre-gzip) byte cap. Past it,
// capture stops but the live session continues.
func recordingMaxBytes() int {
	if v := os.Getenv("RECORDING_MAX_BYTES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			return n
		}
	}
	return recDefaultMaxBytes
}

// newRecordingKey builds a globally-unique key for one session recording.
func newRecordingKey(siteID, userID string) string {
	var b [4]byte
	_, _ = rand.Read(b[:])
	return fmt.Sprintf("%s-%s-%d-%s", siteID, userID, time.Now().UnixNano(), hex.EncodeToString(b[:]))
}

// recWriter tees a guacd->browser Guacamole instruction stream to the manager's
// ingest-guac endpoint in 256 KiB / 2 s chunks. It is single-goroutine (called
// only from the guacd->browser relay loop) so it needs no locking. Every method
// is best-effort: a failed POST or a reached size cap never blocks the session.
type recWriter struct {
	managerURL string
	secret     string
	key        string
	siteID     string
	userID     string
	host       string
	protocol   string
	capBytes   int

	buf       bytes.Buffer
	seq       int
	total     int
	lastFlush time.Time
	stopped   bool
	client    *http.Client
}

func newRecWriter(managerURL, secret, key, siteID, userID, host, protocol string, capBytes int) *recWriter {
	return &recWriter{
		managerURL: managerURL,
		secret:     secret,
		key:        key,
		siteID:     siteID,
		userID:     userID,
		host:       host,
		protocol:   protocol,
		capBytes:   capBytes,
		lastFlush:  time.Now(),
		client:     &http.Client{Timeout: 10 * time.Second},
	}
}

// Write appends one whole guac instruction and flushes when the buffer reaches
// recFlushBytes or recFlushInterval has elapsed. Once the cumulative byte total
// exceeds capBytes, capture stops (logged once) and further writes are dropped.
func (w *recWriter) Write(inst []byte) {
	if w.stopped {
		return
	}
	if w.total >= w.capBytes {
		log.Printf("recording site=%s key=%s: size cap reached, stopping capture", w.siteID, w.key)
		w.stopped = true
		return
	}
	w.buf.Write(inst)
	w.total += len(inst)
	if w.buf.Len() >= recFlushBytes || time.Since(w.lastFlush) >= recFlushInterval {
		w.flush()
	}
}

// flush POSTs the buffered bytes as one chunk. On any error it logs and drops the
// chunk (advancing seq) — a missing chunk is a small replay gap, never a broken
// session. On success the buffer is reset.
func (w *recWriter) flush() {
	if w.buf.Len() == 0 {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"recordingKey": w.key,
		"seq":          w.seq,
		"siteId":       w.siteID,
		"userId":       w.userID,
		"host":         w.host,
		"protocol":     w.protocol,
		"data":         base64.StdEncoding.EncodeToString(w.buf.Bytes()),
	})
	w.seq++
	w.buf.Reset()
	w.lastFlush = time.Now()
	if err != nil {
		log.Printf("recording key=%s: marshal failed err=%v", w.key, err)
		return
	}
	req, err := http.NewRequest(http.MethodPost, w.managerURL+"/api/internal/recording/ingest-guac", bytes.NewReader(payload))
	if err != nil {
		log.Printf("recording key=%s: build request failed err=%v", w.key, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", w.secret)
	resp, err := w.client.Do(req)
	if err != nil {
		log.Printf("recording key=%s seq=%d: ingest post failed err=%v", w.key, w.seq-1, err)
		return
	}
	resp.Body.Close()
}

// Close flushes the tail chunk.
func (w *recWriter) Close() {
	w.flush()
}
