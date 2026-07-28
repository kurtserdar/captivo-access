package main

import (
	"encoding/json"
	"io"
	"net"
	"strings"
	"testing"

	"github.com/hashicorp/yamux"
	"github.com/kurtserdar/captivo-access/tunnel"
)

func TestProxyRoundTrip(t *testing.T) {
	a, b := net.Pipe()
	srv, err := yamux.Server(a, tunnel.SessionConfig())
	if err != nil {
		t.Fatal(err)
	}
	cli, err := yamux.Client(b, tunnel.SessionConfig())
	if err != nil {
		t.Fatal(err)
	}
	defer srv.Close()
	defer cli.Close()

	// Fake connector: accept one stream, read the DialRequest, reply with a
	// DialResponse followed by the response body.
	go func() {
		st, err := cli.Accept()
		if err != nil {
			return
		}
		_, _ = tunnel.ReadFrame(st)
		_, _ = io.ReadAll(tunnel.NewBodyReader(st)) // drain the request-body terminator
		resp, _ := json.Marshal(tunnel.DialResponse{Status: 200})
		_ = tunnel.WriteFrame(st, resp)
		_ = tunnel.WriteBody(st, strings.NewReader("hello"))
		st.Close()
	}()

	out, err := Proxy(&Session{mux: srv}, tunnel.DialRequest{UpstreamName: "wiki", Method: "GET", Path: "/"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Status != 200 || string(out.Body) != "hello" {
		t.Fatalf("got %+v", out)
	}
}

func TestProxyOfflineConnector(t *testing.T) {
	if _, err := Proxy(nil, tunnel.DialRequest{}); err == nil {
		t.Fatal("expected error for nil session")
	}
	if _, err := Proxy(&Session{}, tunnel.DialRequest{}); err == nil {
		t.Fatal("expected error for nil mux")
	}
}
