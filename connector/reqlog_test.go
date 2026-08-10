package main

import (
	"testing"
	"time"
)

func TestLogThrottleAllow(t *testing.T) {
	tr := newLogThrottle()
	if !tr.allow("k", time.Minute) {
		t.Fatal("first allow should be true")
	}
	if tr.allow("k", time.Minute) {
		t.Fatal("second within window should be throttled")
	}
	if !tr.allow("other", time.Minute) {
		t.Fatal("a different key should be allowed")
	}
	if !tr.allow("k", 0) {
		t.Fatal("zero window should always allow")
	}
}

func TestHostOf(t *testing.T) {
	if h := hostOf("https://192.168.10.10:8006/path?token=secret"); h != "192.168.10.10:8006" {
		t.Fatalf("host = %q, want 192.168.10.10:8006 (path/query must be dropped)", h)
	}
	if h := hostOf("garbage"); h != "?" {
		t.Fatalf("hostless input should fall back to %q, got %q", "?", h)
	}
}
