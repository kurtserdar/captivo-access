package main

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hashicorp/yamux"
	"github.com/kurtserdar/captivo-access/tunnel"
)

// pairedSessions wires up a fake data-plane (yamux client) and the
// connector's yamux server over an in-memory net.Pipe, mirroring the real
// WSS-over-yamux topology: the data-plane opens streams, the connector
// accepts and serves them.
func pairedSessions(t *testing.T) (dataplane *yamux.Session, connector *yamux.Session) {
	t.Helper()
	clientConn, serverConn := net.Pipe()

	var err error
	dataplane, err = yamux.Client(clientConn, tunnel.SessionConfig())
	if err != nil {
		t.Fatalf("yamux.Client: %v", err)
	}
	connector, err = yamux.Server(serverConn, tunnel.SessionConfig())
	if err != nil {
		t.Fatalf("yamux.Server: %v", err)
	}
	t.Cleanup(func() {
		dataplane.Close()
		connector.Close()
	})
	return dataplane, connector
}

func TestHandleStreamRejectsUnknownUpstream(t *testing.T) {
	dataplane, connector := pairedSessions(t)
	upstreams := map[string]string{"wiki": "http://127.0.0.1:1"} // never dialed
	go serveStreams(connector, upstreams)

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	req := tunnel.DialRequest{UpstreamName: "evil", Method: "GET", Path: "/"}
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	respBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	var resp tunnel.DialResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if resp.Error != "unknown upstream" {
		t.Fatalf("expected unknown upstream error, got %+v", resp)
	}
	// The connector must never have dialed anything for an unrecognized
	// name — there is no host to assert against because none was ever
	// named, which is exactly the point: the map lookup fails closed
	// before any http.Client.Do happens.
}

func TestHandleStreamProxiesKnownUpstream(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/status" {
			t.Errorf("unexpected path forwarded: %s", r.URL.Path)
		}
		if r.Header.Get("X-Test") != "hello" {
			t.Errorf("header not forwarded, got %q", r.Header.Get("X-Test"))
		}
		w.Header().Set("X-Upstream", "wiki")
		w.WriteHeader(http.StatusTeapot)
		w.Write([]byte("i am a teapot"))
	}))
	defer upstream.Close()

	dataplane, connector := pairedSessions(t)
	upstreams := map[string]string{"wiki": upstream.URL}
	go serveStreams(connector, upstreams)

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	req := tunnel.DialRequest{
		UpstreamName: "wiki",
		Method:       "GET",
		Path:         "/status",
		Header:       map[string][]string{"X-Test": {"hello"}},
	}
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	respBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	var resp tunnel.DialResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if resp.Error != "" {
		t.Fatalf("unexpected error: %s", resp.Error)
	}
	if resp.Status != http.StatusTeapot {
		t.Fatalf("expected 418, got %d", resp.Status)
	}
	if got := resp.Header["X-Upstream"]; len(got) != 1 || got[0] != "wiki" {
		t.Fatalf("expected X-Upstream header, got %+v", resp.Header)
	}

	body, err := io.ReadAll(st)
	if err != nil {
		t.Fatalf("ReadAll body: %v", err)
	}
	if string(body) != "i am a teapot" {
		t.Fatalf("expected body %q, got %q", "i am a teapot", string(body))
	}
}

func TestHandleStreamUnreachableUpstream(t *testing.T) {
	dataplane, connector := pairedSessions(t)
	// Port 0 on loopback is not listening; dial should fail fast.
	upstreams := map[string]string{"dead": "http://127.0.0.1:1"}
	go serveStreams(connector, upstreams)

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	req := tunnel.DialRequest{UpstreamName: "dead", Method: "GET", Path: "/"}
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}

	respBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	var resp tunnel.DialResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if resp.Error == "" {
		t.Fatalf("expected error for unreachable upstream, got %+v", resp)
	}
}
