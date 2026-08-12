package main

import (
	"testing"
	"time"
)

func TestSessionHubTerminate(t *testing.T) {
	h := NewSessionHub()
	h.Register("s1", "site", "user", "rdp", "host", time.Now(), "", "", "")
	ran := 0
	h.SetCloser("s1", func() { ran++ })
	if !h.Terminate("s1") {
		t.Fatal("expected Terminate to find s1")
	}
	if ran != 1 {
		t.Fatalf("closer ran %d times, want 1", ran)
	}
	if h.Terminate("missing") {
		t.Fatal("Terminate of unknown id should return false")
	}
}
