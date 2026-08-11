package main

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

func TestRecWriterFlushesOnByteThreshold(t *testing.T) {
	var mu sync.Mutex
	var bodies []string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		mu.Lock()
		bodies = append(bodies, string(b))
		mu.Unlock()
		w.WriteHeader(204)
	}))
	defer srv.Close()

	w := newRecWriter(srv.URL, "sekret", "key1", "site1", "user1", "host1", "rdp", 10*1024*1024)
	// One instruction over the 256 KiB flush threshold forces a flush.
	big := []byte(strings.Repeat("A", 300*1024))
	w.Write(big)
	w.Close()

	mu.Lock()
	defer mu.Unlock()
	if len(bodies) == 0 {
		t.Fatalf("expected at least one ingest POST, got 0")
	}
	if !strings.Contains(bodies[0], `"recordingKey":"key1"`) || !strings.Contains(bodies[0], `"protocol":"rdp"`) {
		n := len(bodies[0])
		if n > 200 {
			n = 200
		}
		t.Fatalf("first body missing expected fields: %s", bodies[0][:n])
	}
}

func TestRecWriterStopsAtSizeCap(t *testing.T) {
	var mu sync.Mutex
	count := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		count++
		mu.Unlock()
		w.WriteHeader(204)
	}))
	defer srv.Close()

	// Cap of 256 KiB: the first 300 KiB write flushes once, then total > cap stops capture.
	w := newRecWriter(srv.URL, "sekret", "key2", "s", "u", "h", "ssh", 256*1024)
	w.Write([]byte(strings.Repeat("B", 300*1024))) // flush #1, total now 300 KiB > cap
	w.Write([]byte(strings.Repeat("C", 300*1024))) // dropped (capped)
	w.Close()

	mu.Lock()
	defer mu.Unlock()
	if count != 1 {
		t.Fatalf("expected exactly 1 POST before cap, got %d", count)
	}
}
