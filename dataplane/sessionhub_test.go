package main

import (
	"testing"
	"time"
)

func TestHubRegisterListRemove(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "vendor1", "rdp", "10.0.0.5", time.Unix(0, 0), nil)
	if ls == nil || h.Get("s1") == nil {
		t.Fatal("expected session registered")
	}
	list := h.List()
	if len(list) != 1 || list[0].SessionID != "s1" || list[0].Protocol != "rdp" {
		t.Fatalf("unexpected list: %+v", list)
	}
	h.Remove("s1")
	if h.Get("s1") != nil || len(h.List()) != 0 {
		t.Fatal("expected session removed")
	}
}

func TestHubBroadcastToViewers(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), nil)
	_, chA := ls.addViewer()
	_, chB := ls.addViewer()
	ls.broadcast([]byte("4.sync,1.0;"))
	for _, ch := range []chan []byte{chA, chB} {
		select {
		case got := <-ch:
			if string(got) != "4.sync,1.0;" {
				t.Fatalf("bad frame: %q", got)
			}
		case <-time.After(time.Second):
			t.Fatal("viewer did not receive broadcast")
		}
	}
}

func TestHubBroadcastNonBlocking(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), nil)
	id, _ := ls.addViewer() // never drained
	// Flood well past the channel buffer; broadcast must not block.
	done := make(chan struct{})
	go func() {
		for i := 0; i < 100000; i++ {
			ls.broadcast([]byte("1.x;"))
		}
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("broadcast blocked on a full viewer channel")
	}
	ls.removeViewer(id)
}

func TestHubControlGating(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), nil)
	if !ls.vendorInputAllowed() {
		t.Fatal("vendor input should be allowed with no controller")
	}
	if err := h.SetControl("s1", "adminA"); err != nil {
		t.Fatalf("take control: %v", err)
	}
	if ls.vendorInputAllowed() {
		t.Fatal("vendor input must be blocked while admin controls")
	}
	if !ls.viewerInputAllowed("adminA") || ls.viewerInputAllowed("adminB") {
		t.Fatal("only the controller's input is allowed")
	}
	if err := h.SetControl("s1", "adminB"); err == nil {
		t.Fatal("second controller must be rejected")
	}
	h.ReleaseControl("s1", "adminA")
	if !ls.vendorInputAllowed() {
		t.Fatal("vendor input should resume after release")
	}
}

func TestHubWatchStatus(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "vendor1", "rdp", "h", time.Unix(0, 0), nil)
	if w, c := h.WatchStatus("vendor1", "site1"); w || c {
		t.Fatal("no viewers, no control → false/false")
	}
	ls.addViewer()
	_ = h.SetControl("s1", "adminA")
	if w, c := h.WatchStatus("vendor1", "site1"); !w || !c {
		t.Fatal("viewer + control → true/true")
	}
	if w, _ := h.WatchStatus("other", "site1"); w {
		t.Fatal("watch-status must match the vendor's own session")
	}
}
