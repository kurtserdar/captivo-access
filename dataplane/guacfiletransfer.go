package main

import (
	"bufio"
	"bytes"
	"io"
	"sync"
	"time"
)

// Transfer verbs stored in AuditEvent.Method. These are the single source of
// truth on the Go side; the TS side mirrors them in src/lib/audit/access-format.ts.
const (
	verbDownload        = "DOWNLOAD"
	verbUpload          = "UPLOAD"
	verbDownloadPartial = "DOWNLOAD-PARTIAL"
	verbUploadPartial   = "UPLOAD-PARTIAL"
)

// maxOpenStreams bounds per-session memory: a malicious client that opens
// endless file streams without ever sending `end` cannot exhaust memory. Beyond
// the cap, new stream opens are ignored.
const maxOpenStreams = 256

// maxFilenameLen caps the filename stored in AuditEvent.Path.
const maxFilenameLen = 512

type xferDir int

const (
	dirDownload xferDir = 0
	dirUpload   xferDir = 1
)

type ftKey struct {
	dir xferDir
	idx string
}

type ftStream struct {
	filename string
	mimetype string
	bytes    int64
}

// ftObserver watches guac file-transfer opcodes on both tunnel directions and
// produces AuditEvents. It is safe for the two pump goroutines to call observe
// concurrently (one per direction) plus flush at teardown.
type ftObserver struct {
	mu        sync.Mutex
	userID    string
	siteID    string
	host      string
	clientIP  string
	userAgent string
	streams   map[ftKey]*ftStream
	now       func() time.Time
}

func newFTObserver(userID, siteID, host, clientIP, userAgent string) *ftObserver {
	return &ftObserver{
		userID: userID, siteID: siteID, host: host,
		clientIP: clientIP, userAgent: userAgent,
		streams: make(map[ftKey]*ftStream),
		now:     time.Now,
	}
}

// observe parses a COPY of one WS message / instruction (which may contain
// several concatenated instructions) and returns any AuditEvents finalized by
// an `end`. It never mutates raw. Parse errors are swallowed (best-effort audit).
func (o *ftObserver) observe(dir xferDir, raw []byte) []AuditEvent {
	br := bufio.NewReader(bytes.NewReader(raw))
	var out []AuditEvent
	o.mu.Lock()
	defer o.mu.Unlock()
	for {
		op, args, err := parseInstruction(br)
		if err == io.EOF || err != nil {
			return out
		}
		switch op {
		case "file": // file,<idx>,<mime>,<name>
			if len(args) >= 3 {
				o.open(dir, args[0], args[2], args[1])
			}
		case "put", "body": // put/body,<fsIdx>,<idx>,<mime>,<name>
			if len(args) >= 4 {
				o.open(dir, args[1], args[3], args[2])
			}
		case "blob": // blob,<idx>,<base64>
			if len(args) >= 2 {
				if st := o.streams[ftKey{dir, args[0]}]; st != nil {
					st.bytes += b64DecodedLen(args[1])
				}
			}
		case "end": // end,<idx>
			if len(args) >= 1 {
				k := ftKey{dir, args[0]}
				if st := o.streams[k]; st != nil {
					out = append(out, o.event(dir, st, false))
					delete(o.streams, k)
				}
			}
		}
	}
}

func (o *ftObserver) open(dir xferDir, idx, filename, mimetype string) {
	if len(o.streams) >= maxOpenStreams {
		return
	}
	o.streams[ftKey{dir, idx}] = &ftStream{filename: filename, mimetype: mimetype}
}

// flush finalizes every still-open stream as a partial/aborted transfer and
// clears the map. Called once at session teardown.
func (o *ftObserver) flush() []AuditEvent {
	o.mu.Lock()
	defer o.mu.Unlock()
	var out []AuditEvent
	for k, st := range o.streams {
		out = append(out, o.event(k.dir, st, true))
	}
	o.streams = make(map[ftKey]*ftStream)
	return out
}

func (o *ftObserver) event(dir xferDir, st *ftStream, partial bool) AuditEvent {
	method := verbDownload
	if dir == dirUpload {
		method = verbUpload
	}
	status := 200
	reason := "file:" + st.mimetype
	if partial {
		if dir == dirUpload {
			method = verbUploadPartial
		} else {
			method = verbDownloadPartial
		}
		status = 499
		reason = "file-transfer-aborted"
	}
	name := st.filename
	if len(name) > maxFilenameLen {
		name = name[:maxFilenameLen]
	}
	return AuditEvent{
		Timestamp: o.now(),
		UserID:    o.userID,
		SiteID:    o.siteID,
		Host:      o.host,
		Method:    method,
		Path:      "/" + name,
		Status:    status,
		BytesOut:  st.bytes,
		Decision:  "ALLOW",
		Reason:    reason,
		ClientIP:  o.clientIP,
		UserAgent: o.userAgent,
	}
}

// b64DecodedLen returns the number of bytes a standard base64 string decodes to,
// computed from its length and trailing padding without allocating a decode buffer.
func b64DecodedLen(s string) int64 {
	n := len(s)
	if n == 0 {
		return 0
	}
	pad := 0
	if s[n-1] == '=' {
		pad++
		if n >= 2 && s[n-2] == '=' {
			pad++
		}
	}
	return int64(n/4*3 - pad)
}
