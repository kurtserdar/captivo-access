package main

import (
	"net/http/httptest"
	"strings"
	"testing"
)

func TestKasmPathStrip(t *testing.T) {
	for in, want := range map[string]string{
		"/kasm-tunnel/":         "/",
		"/kasm-tunnel/vnc.html": "/vnc.html",
		"/kasm-tunnel":          "/",
	} {
		r := httptest.NewRequest("GET", in, nil)
		p := strings.TrimPrefix(r.URL.Path, "/kasm-tunnel")
		if p == "" {
			p = "/"
		}
		if p != want {
			t.Fatalf("%q -> %q want %q", in, p, want)
		}
	}
}

func TestKasmSingleFlight(t *testing.T) {
	var g isoGuard
	if !g.tryAcquire() {
		t.Fatal("first acquire should succeed")
	}
	if g.tryAcquire() {
		t.Fatal("second concurrent acquire should fail")
	}
	g.release()
	if !g.tryAcquire() {
		t.Fatal("acquire after release should succeed")
	}
}
