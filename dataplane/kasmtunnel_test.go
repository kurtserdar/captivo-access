package main

import (
	"bufio"
	"io"
	"net/http/httptest"
	"strconv"
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

func TestKasmSessionAddr(t *testing.T) {
	if got := kasmSessionAddr("captivo-kasm:6901", 6903); got != "captivo-kasm:6903" {
		t.Fatalf("got %q", got)
	}
	// No port in input: append.
	if got := kasmSessionAddr("captivo-kasm", 6902); got != "captivo-kasm:6902" {
		t.Fatalf("got %q", got)
	}
}

type rwPair struct {
	io.Reader
	io.Writer
}

func TestOpenKasmSessionOK(t *testing.T) {
	body := `{"id":"s1-1","port":6902}`
	resp := "HTTP/1.0 201 Created\r\nContent-Type: application/json\r\nContent-Length: " +
		strconv.Itoa(len(body)) + "\r\n\r\n" + body
	var out strings.Builder
	rw := rwPair{Reader: bufio.NewReader(strings.NewReader(resp)), Writer: &out}
	id, port, status, err := openKasmSession(rw, "captivo-kasm:7900", "https://example.com")
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if id != "s1-1" || port != 6902 || status != 201 {
		t.Fatalf("id=%q port=%d status=%d", id, port, status)
	}
	if !strings.Contains(out.String(), "POST /session HTTP/1.0") {
		t.Fatalf("request not written: %q", out.String())
	}
}

func TestOpenKasmSessionCapacity(t *testing.T) {
	body := `{"error":"capacity"}`
	resp := "HTTP/1.0 503 Service Unavailable\r\nContent-Length: " +
		strconv.Itoa(len(body)) + "\r\n\r\n" + body
	rw := rwPair{Reader: bufio.NewReader(strings.NewReader(resp)), Writer: &strings.Builder{}}
	_, _, status, err := openKasmSession(rw, "captivo-kasm:7900", "https://example.com")
	if err != nil {
		t.Fatalf("capacity should not be a transport error: %v", err)
	}
	if status != 503 {
		t.Fatalf("status=%d want 503", status)
	}
}
