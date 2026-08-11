package main

import (
	"testing"
	"time"
)

func TestHubRegisterListRemove(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "vendor1", "rdp", "10.0.0.5", time.Unix(0, 0), "$conn1", "connA", "cap-guacd:4822")
	if ls == nil || h.Get("s1") == nil {
		t.Fatal("expected session registered")
	}
	cid, connector, addr := ls.shareInfo()
	if cid != "$conn1" || connector != "connA" || addr != "cap-guacd:4822" {
		t.Fatalf("shareInfo = %q %q %q", cid, connector, addr)
	}
	list := h.List()
	if len(list) != 1 || list[0].SessionID != "s1" || list[0].ViewerCount != 0 {
		t.Fatalf("unexpected list: %+v", list)
	}
	h.Remove("s1")
	if h.Get("s1") != nil || len(h.List()) != 0 {
		t.Fatal("expected session removed")
	}
}

func TestHubViewerCount(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), "$c", "conn", "g:4822")
	ls.addViewer()
	ls.addViewer()
	if h.List()[0].ViewerCount != 2 {
		t.Fatalf("viewer count = %d", h.List()[0].ViewerCount)
	}
	ls.removeViewer()
	if h.List()[0].ViewerCount != 1 {
		t.Fatalf("viewer count after remove = %d", h.List()[0].ViewerCount)
	}
}

func TestHubControlGating(t *testing.T) {
	h := NewSessionHub()
	ls := h.Register("s1", "site1", "v1", "rdp", "h", time.Unix(0, 0), "$c", "conn", "g:4822")
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
	ls := h.Register("s1", "site1", "vendor1", "rdp", "h", time.Unix(0, 0), "$c", "conn", "g:4822")
	if w, c := h.WatchStatus("vendor1", "site1"); w || c {
		t.Fatal("no viewers, no control -> false/false")
	}
	ls.addViewer()
	_ = h.SetControl("s1", "adminA")
	if w, c := h.WatchStatus("vendor1", "site1"); !w || !c {
		t.Fatal("viewer + control -> true/true")
	}
	if w, _ := h.WatchStatus("other", "site1"); w {
		t.Fatal("watch-status must match the vendor's own session")
	}
}
