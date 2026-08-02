package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
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

// openMatcher returns a TargetMatcher with no boundary configured, for tests
// that aren't exercising the ALLOWED_TARGETS boundary itself.
func openMatcher(t *testing.T) *TargetMatcher {
	t.Helper()
	m, err := ParseAllowedTargets("")
	if err != nil {
		t.Fatalf("ParseAllowedTargets: %v", err)
	}
	return m
}

func TestHandleStreamRejectsOutOfBoundaryTarget(t *testing.T) {
	dataplane, connector := pairedSessions(t)
	allow, err := ParseAllowedTargets("wiki.internal:8080") // boundary excludes the requested target
	if err != nil {
		t.Fatalf("ParseAllowedTargets: %v", err)
	}
	go serveStreams(connector, allow)

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	req := tunnel.DialRequest{UpstreamUrl: "http://127.0.0.1:1", Method: "GET", Path: "/"} // never dialed
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	if err := tunnel.WriteBody(st, bytes.NewReader(nil)); err != nil {
		t.Fatalf("WriteBody: %v", err)
	}

	respBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		t.Fatalf("ReadFrame: %v", err)
	}
	var resp tunnel.DialResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		t.Fatalf("Unmarshal: %v", err)
	}
	if resp.Error != "target not allowed" {
		t.Fatalf("expected target not allowed error, got %+v", resp)
	}
	// The connector must never have dialed anything for an out-of-boundary
	// target — the boundary check fails closed before any http.Client.Do
	// happens.
}

func TestHandleStreamProxiesAllowedUpstream(t *testing.T) {
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
	go serveStreams(connector, openMatcher(t))

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	req := tunnel.DialRequest{
		UpstreamUrl: upstream.URL,
		Method:      "GET",
		Path:        "/status",
		Header:      map[string][]string{"X-Test": {"hello"}},
	}
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	if err := tunnel.WriteBody(st, bytes.NewReader(nil)); err != nil {
		t.Fatalf("WriteBody: %v", err)
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

	body, err := io.ReadAll(tunnel.NewBodyReader(st))
	if err != nil {
		t.Fatalf("ReadAll body: %v", err)
	}
	if string(body) != "i am a teapot" {
		t.Fatalf("expected body %q, got %q", "i am a teapot", string(body))
	}
}

// TestHandleStreamForwardsRequestBody proves a request body sent by the
// data-plane after the DialRequest frame is streamed through to the
// upstream (rather than the old behavior of always dialing with a nil
// body), by having the upstream echo back whatever it received.
func TestHandleStreamForwardsRequestBody(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		got, err := io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("upstream failed to read request body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
		w.Write(got)
	}))
	defer upstream.Close()

	dataplane, connector := pairedSessions(t)
	go serveStreams(connector, openMatcher(t))

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	req := tunnel.DialRequest{UpstreamUrl: upstream.URL, Method: "POST", Path: "/"}
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	const sent = "request body streamed through the tunnel"
	if err := tunnel.WriteBody(st, strings.NewReader(sent)); err != nil {
		t.Fatalf("WriteBody: %v", err)
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

	body, err := io.ReadAll(tunnel.NewBodyReader(st))
	if err != nil {
		t.Fatalf("ReadAll body: %v", err)
	}
	if string(body) != sent {
		t.Fatalf("expected echoed body %q, got %q", sent, string(body))
	}
}

// TestHandleStreamHonorsContentLength proves that when the data-plane sends
// a Content-Length header, the connector forwards a fixed-length request to
// the upstream instead of switching to chunked transfer-encoding. This is a
// regression test: the upstream request body is a tunnel.BodyReader (not a
// *bytes.Reader/*strings.Reader), so Go's http.Client can't infer its length
// on its own and, without req.ContentLength set explicitly, silently sends
// the request chunked — which a strict upstream that only reads
// Content-Length sees as an empty body.
func TestHandleStreamHonorsContentLength(t *testing.T) {
	var gotContentLength int64
	var gotTransferEncoding []string
	var gotBody []byte
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotContentLength = r.ContentLength
		gotTransferEncoding = r.TransferEncoding
		var err error
		gotBody, err = io.ReadAll(r.Body)
		if err != nil {
			t.Errorf("upstream failed to read request body: %v", err)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer upstream.Close()

	dataplane, connector := pairedSessions(t)
	go serveStreams(connector, openMatcher(t))

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	const sent = "hello world" // 11 bytes
	req := tunnel.DialRequest{
		UpstreamUrl: upstream.URL,
		Method:      "POST",
		Path:        "/",
		Header:      map[string][]string{"Content-Length": {"11"}},
	}
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	if err := tunnel.WriteBody(st, strings.NewReader(sent)); err != nil {
		t.Fatalf("WriteBody: %v", err)
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

	// Drain the (empty) response body so the stream completes cleanly.
	if _, err := io.ReadAll(tunnel.NewBodyReader(st)); err != nil {
		t.Fatalf("ReadAll body: %v", err)
	}

	if gotContentLength != 11 {
		t.Fatalf("expected upstream to see Content-Length 11, got %d", gotContentLength)
	}
	if len(gotTransferEncoding) != 0 {
		t.Fatalf("expected upstream to see no chunked transfer-encoding, got %+v", gotTransferEncoding)
	}
	if string(gotBody) != sent {
		t.Fatalf("expected upstream to receive body %q, got %q", sent, string(gotBody))
	}
}

func TestHandleStreamUnreachableUpstream(t *testing.T) {
	dataplane, connector := pairedSessions(t)
	go serveStreams(connector, openMatcher(t))

	st, err := dataplane.Open()
	if err != nil {
		t.Fatalf("Open: %v", err)
	}
	defer st.Close()

	// Port 0 on loopback is not listening; dial should fail fast.
	req := tunnel.DialRequest{UpstreamUrl: "http://127.0.0.1:1", Method: "GET", Path: "/"}
	reqBytes, _ := json.Marshal(req)
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		t.Fatalf("WriteFrame: %v", err)
	}
	if err := tunnel.WriteBody(st, bytes.NewReader(nil)); err != nil {
		t.Fatalf("WriteBody: %v", err)
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

// TestHandleStreamRejectsPathHostInjection proves the connector never dials
// a host other than the one in the request's own UpstreamUrl, even when Path
// is crafted to look like it names a different host once combined with the
// base URL. This is a regression test for a HIGH-severity bypass: the old
// code built the upstream request with `base+dr.Path` (plain string
// concatenation) and let http.NewRequest re-parse the result as a URL.
//
//   - "@evilHost/" turns "http://127.0.0.1:PORT" + "@evilHost/" into
//     "http://127.0.0.1:PORT@evilHost/", which Go's URL parser reads as
//     userinfo "127.0.0.1:PORT" on host "evilHost" — the intended host is
//     silently discarded and the connector dials the attacker's host
//     instead. Against the old code this subtest fails outright: the "evil"
//     httptest server's hit counter goes non-zero and the response carries
//     the "evil" server's status instead of an "invalid path" error.
//   - "//evilHost/" is included as a defense-in-depth case: concatenated
//     onto this codebase's absolute `base` it does not itself swap the
//     dialed host (Go's parser keeps "//evilHost/" as a literal path on the
//     intended host), but the old code has no path validation at all, so
//     it silently forwards the malformed path with a 200 instead of
//     rejecting it — this subtest fails against the old code for that
//     reason and guards against any future refactor that would make the
//     scheme-relative form host-swapping too.
//
// Against the fix, every malicious Path is rejected as "invalid path"
// before any http.Client.Do/dial happens, so "evil" is never hit.
func TestHandleStreamRejectsPathHostInjection(t *testing.T) {
	wiki := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer wiki.Close()

	var evilHits atomic.Int32
	evil := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		evilHits.Add(1)
		w.WriteHeader(http.StatusOK)
	}))
	defer evil.Close()

	evilHost := strings.TrimPrefix(evil.URL, "http://")

	maliciousPaths := []string{
		"@" + evilHost + "/",  // userinfo confusion: base+path re-parses with evilHost as Host
		"//" + evilHost + "/", // scheme-relative: parses to an absolute URL naming evilHost
	}

	for _, path := range maliciousPaths {
		t.Run(path, func(t *testing.T) {
			dataplane, connector := pairedSessions(t)
			go serveStreams(connector, openMatcher(t))

			st, err := dataplane.Open()
			if err != nil {
				t.Fatalf("Open: %v", err)
			}
			defer st.Close()

			req := tunnel.DialRequest{UpstreamUrl: wiki.URL, Method: "GET", Path: path}
			reqBytes, _ := json.Marshal(req)
			if err := tunnel.WriteFrame(st, reqBytes); err != nil {
				t.Fatalf("WriteFrame: %v", err)
			}
			if err := tunnel.WriteBody(st, bytes.NewReader(nil)); err != nil {
				t.Fatalf("WriteBody: %v", err)
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
				t.Fatalf("expected invalid-path error for Path %q, got status %d with no error (host boundary bypassed)", path, resp.Status)
			}
		})
	}

	if got := evilHits.Load(); got != 0 {
		t.Fatalf("evil server was hit %d time(s) — connector dialed a host outside the request's own upstream URL, host guard bypassed", got)
	}
}
