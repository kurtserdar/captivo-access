package main

import (
	"strings"
	"testing"
)

func TestBuildNavigateRequest(t *testing.T) {
	req := buildNavigateRequest("captivo-browser:7900", "https://wiki.internal/x")
	if !strings.HasPrefix(req, "GET /navigate?url=https%3A%2F%2Fwiki.internal%2Fx ") {
		t.Fatalf("path/encoding wrong: %q", req)
	}
	if !strings.Contains(req, "Host: captivo-browser:7900\r\n") {
		t.Fatalf("missing host: %q", req)
	}
	if !strings.HasSuffix(req, "\r\n\r\n") {
		t.Fatalf("not terminated: %q", req)
	}
}

func TestSingleFlight(t *testing.T) {
	var g isoGuard
	if !g.tryAcquire() {
		t.Fatal("first acquire should succeed")
	}
	if g.tryAcquire() {
		t.Fatal("second acquire should fail")
	}
	g.release()
	if !g.tryAcquire() {
		t.Fatal("acquire after release should succeed")
	}
}
