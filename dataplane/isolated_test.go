package main

import (
	"bytes"
	"strings"
	"testing"
)

// rwFrom pairs a canned response (what the broker "replies") with a buffer that
// captures what we wrote, so openBrowserSession can read a real HTTP response.
type rwFrom struct {
	in  *strings.Reader
	out *bytes.Buffer
}

func (r *rwFrom) Read(p []byte) (int, error)  { return r.in.Read(p) }
func (r *rwFrom) Write(p []byte) (int, error) { return r.out.Write(p) }

func TestOpenBrowserSessionOK(t *testing.T) {
	resp := "HTTP/1.0 201 Created\r\nContent-Type: application/json\r\nContent-Length: 27\r\n\r\n{\"id\":\"s1\",\"vncPort\":5902}"
	rw := &rwFrom{in: strings.NewReader(resp), out: &bytes.Buffer{}}
	id, port, status, err := openBrowserSession(rw, "captivo-browser:7900", "https://wiki.internal")
	if err != nil || status != 201 || id != "s1" || port != 5902 {
		t.Fatalf("got id=%q port=%d status=%d err=%v", id, port, status, err)
	}
	if !strings.Contains(rw.out.String(), "POST /session HTTP/1.0\r\n") || !strings.Contains(rw.out.String(), `"url":"https://wiki.internal"`) {
		t.Fatalf("request malformed: %q", rw.out.String())
	}
}

func TestOpenBrowserSessionCapacity(t *testing.T) {
	resp := "HTTP/1.0 503 Service Unavailable\r\nContent-Length: 20\r\n\r\n{\"error\":\"capacity\"}"
	rw := &rwFrom{in: strings.NewReader(resp), out: &bytes.Buffer{}}
	_, _, status, err := openBrowserSession(rw, "h:7900", "https://x")
	if err != nil || status != 503 {
		t.Fatalf("want status 503 no err, got status=%d err=%v", status, err)
	}
}

func TestBuildCloseRequest(t *testing.T) {
	req := buildCloseRequest("captivo-browser:7900", "s1")
	if !strings.HasPrefix(req, "POST /session/s1/close HTTP/1.0\r\n") || !strings.HasSuffix(req, "\r\n\r\n") {
		t.Fatalf("bad close request: %q", req)
	}
}
