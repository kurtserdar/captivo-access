package main

import (
	"strings"
	"sync"
)

// logRing is a thread-safe bounded buffer of recent log lines. It implements
// io.Writer so it can sit behind the standard logger (via io.MultiWriter, keeping
// stderr for `docker logs`), capturing each log line for the console's log tail.
type logRing struct {
	mu    sync.Mutex
	lines []string
	max   int
}

func newLogRing(max int) *logRing { return &logRing{max: max} }

func (r *logRing) Write(p []byte) (int, error) {
	line := strings.TrimRight(string(p), "\n")
	if line != "" {
		r.mu.Lock()
		r.lines = append(r.lines, line)
		if len(r.lines) > r.max {
			r.lines = r.lines[len(r.lines)-r.max:]
		}
		r.mu.Unlock()
	}
	return len(p), nil
}

// tail returns the last n lines (or all, if fewer), as a copy.
func (r *logRing) tail(n int) []string {
	r.mu.Lock()
	defer r.mu.Unlock()
	if n >= len(r.lines) {
		return append([]string(nil), r.lines...)
	}
	return append([]string(nil), r.lines[len(r.lines)-n:]...)
}

var logRingBuf = newLogRing(300)
