package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestKasmRecWriterFlushesToIngestVideo(t *testing.T) {
	var gotPath, gotSecret, gotData string
	var gotSeq int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotSecret = r.Header.Get("x-dataplane-secret")
		b, _ := io.ReadAll(r.Body)
		var m struct {
			Data string `json:"data"`
			Seq  int    `json:"seq"`
		}
		_ = json.Unmarshal(b, &m)
		gotData, gotSeq = m.Data, m.Seq
		w.WriteHeader(204)
	}))
	defer srv.Close()

	w := newKasmRecWriter(srv.URL, "sekret", "k1", "site1", "user1", "host1", 1<<20)
	// A payload >= recFlushBytes forces an immediate flush.
	w.Write([]byte(strings.Repeat("A", recFlushBytes+16)))
	w.Close()

	if gotPath != "/api/internal/recording/ingest-video" {
		t.Fatalf("path=%q", gotPath)
	}
	if gotSecret != "sekret" {
		t.Fatalf("secret=%q", gotSecret)
	}
	if gotSeq != 0 {
		t.Fatalf("seq=%d want 0", gotSeq)
	}
	dec, _ := base64.StdEncoding.DecodeString(gotData)
	if len(dec) < recFlushBytes {
		t.Fatalf("decoded %d bytes, want >= %d", len(dec), recFlushBytes)
	}
}

func TestKasmRecWriterStopsAtCap(t *testing.T) {
	var posts int
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		posts++
		w.WriteHeader(204)
	}))
	defer srv.Close()
	w := newKasmRecWriter(srv.URL, "s", "k", "si", "u", "h", 10) // 10-byte cap
	w.Write([]byte(strings.Repeat("A", recFlushBytes))) // over cap on the first write
	w.Write([]byte(strings.Repeat("B", recFlushBytes))) // dropped (stopped)
	w.Close()
	if posts > 1 {
		t.Fatalf("posts=%d, expected capture to stop after the cap", posts)
	}
}
