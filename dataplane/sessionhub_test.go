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

func TestRegisterIsolatedKindAndTerminate(t *testing.T) {
	h := NewSessionHub()
	h.RegisterIsolated("s1", "site1", "user1", "https://example.com", time.Now(), "conn1")
	list := h.List()
	if len(list) != 1 || list[0].Kind != "isolated" || list[0].Protocol != "isolated" {
		t.Fatalf("expected one isolated session with kind/protocol=isolated, got %+v", list)
	}
	called := false
	h.SetCloser("s1", func() { called = true })
	if !h.Terminate("s1") || !called {
		t.Fatalf("terminate did not invoke the closer")
	}
}
