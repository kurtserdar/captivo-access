package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"log"
	"net/http"
	"time"
)

// kasmRecWriter tees a KasmVNC session's live WebM byte stream to the manager's
// ingest-video endpoint in recFlushBytes / recFlushInterval chunks. It is the video
// analog of guacrecord.go's recWriter and is deliberately self-contained (transport
// B must not depend on the former transport A). Best-effort: a failed POST or a
// reached cap never blocks the session. Single-goroutine (the recording relay loop).
type kasmRecWriter struct {
	managerURL string
	secret     string
	key        string
	siteID     string
	userID     string
	host       string
	capBytes   int

	buf       bytes.Buffer
	seq       int
	total     int
	lastFlush time.Time
	stopped   bool
	client    *http.Client
}

func newKasmRecWriter(managerURL, secret, key, siteID, userID, host string, capBytes int) *kasmRecWriter {
	return &kasmRecWriter{
		managerURL: managerURL, secret: secret, key: key,
		siteID: siteID, userID: userID, host: host, capBytes: capBytes,
		lastFlush: time.Now(), client: &http.Client{Timeout: 10 * time.Second},
	}
}

// Write appends WebM bytes and flushes when the buffer reaches recFlushBytes or
// recFlushInterval has elapsed. Once the cumulative total exceeds capBytes, capture
// stops (logged once) and further writes are dropped.
func (w *kasmRecWriter) Write(b []byte) {
	if w.stopped {
		return
	}
	if w.total >= w.capBytes {
		log.Printf("kasm-recording site=%s key=%s: size cap reached, stopping capture", w.siteID, w.key)
		w.stopped = true
		return
	}
	w.buf.Write(b)
	w.total += len(b)
	if w.buf.Len() >= recFlushBytes || time.Since(w.lastFlush) >= recFlushInterval {
		w.flush()
	}
}

func (w *kasmRecWriter) flush() {
	if w.buf.Len() == 0 {
		return
	}
	payload, err := json.Marshal(map[string]any{
		"recordingKey": w.key,
		"seq":          w.seq,
		"siteId":       w.siteID,
		"userId":       w.userID,
		"host":         w.host,
		"data":         base64.StdEncoding.EncodeToString(w.buf.Bytes()),
	})
	w.seq++
	w.buf.Reset()
	w.lastFlush = time.Now()
	if err != nil {
		log.Printf("kasm-recording key=%s: marshal failed err=%v", w.key, err)
		return
	}
	req, err := http.NewRequest(http.MethodPost, w.managerURL+"/api/internal/recording/ingest-video", bytes.NewReader(payload))
	if err != nil {
		log.Printf("kasm-recording key=%s: build request failed err=%v", w.key, err)
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", w.secret)
	resp, err := w.client.Do(req)
	if err != nil {
		log.Printf("kasm-recording key=%s seq=%d: ingest post failed err=%v", w.key, w.seq-1, err)
		return
	}
	resp.Body.Close()
}

// Close flushes the tail chunk.
func (w *kasmRecWriter) Close() { w.flush() }

// postFinalizeVideo sends one chunk of the finalized (seekable) recording to the
// manager's finalize-video endpoint, which replaces the interim chunks. Best-effort.
func postFinalizeVideo(managerURL, secret, key string, seq int, data []byte) {
	payload, err := json.Marshal(map[string]any{
		"recordingKey": key,
		"seq":          seq,
		"data":         base64.StdEncoding.EncodeToString(data),
	})
	if err != nil {
		return
	}
	req, err := http.NewRequest(http.MethodPost, managerURL+"/api/internal/recording/finalize-video", bytes.NewReader(payload))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-dataplane-secret", secret)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		log.Printf("kasm-recording key=%s: finalize post failed err=%v", key, err)
		return
	}
	resp.Body.Close()
}
