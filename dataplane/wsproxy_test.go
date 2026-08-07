package main

import (
	"net/http"
	"testing"
)

func TestIsWebSocketUpgrade(t *testing.T) {
	cases := []struct {
		up, conn string
		want     bool
	}{
		{"websocket", "Upgrade", true},
		{"WebSocket", "keep-alive, Upgrade", true},
		{"websocket", "upgrade", true},
		{"websocket", "keep-alive", false},
		{"", "Upgrade", false},
		{"h2c", "Upgrade", false},
	}
	for _, c := range cases {
		r, _ := http.NewRequest("GET", "http://x/y", nil)
		if c.up != "" {
			r.Header.Set("Upgrade", c.up)
		}
		r.Header.Set("Connection", c.conn)
		if got := isWebSocketUpgrade(r); got != c.want {
			t.Fatalf("up=%q conn=%q => %v want %v", c.up, c.conn, got, c.want)
		}
	}
}

func TestWsRequestHeadersKeepsHandshakeStripsSession(t *testing.T) {
	r, _ := http.NewRequest("GET", "http://app.example/y", nil)
	r.Header.Set("Upgrade", "websocket")
	r.Header.Set("Connection", "Upgrade")
	r.Header.Set("Sec-WebSocket-Key", "abc")
	r.Header.Set("Sec-WebSocket-Version", "13")
	r.Header.Set("Cookie", "ca_session=SECRET; app_pref=dark")
	r.RemoteAddr = "203.0.113.9:5555"

	h := wsRequestHeaders(r, "app.example")

	if len(h["Upgrade"]) == 0 || h["Upgrade"][0] != "websocket" {
		t.Fatalf("Upgrade dropped: %+v", h)
	}
	if len(h["Connection"]) == 0 {
		t.Fatalf("Connection dropped: %+v", h)
	}
	if len(h["Sec-Websocket-Key"]) == 0 && len(h["Sec-WebSocket-Key"]) == 0 {
		t.Fatalf("Sec-WebSocket-Key dropped: %+v", h)
	}
	if ck := h["Cookie"]; len(ck) == 0 || ck[0] != "app_pref=dark" {
		t.Fatalf("cookie not filtered to app-only: %+v", ck)
	}
	if len(h["X-Forwarded-Host"]) == 0 || h["X-Forwarded-Host"][0] != "app.example" {
		t.Fatalf("XFH missing: %+v", h)
	}
}
