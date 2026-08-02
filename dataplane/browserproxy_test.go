package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/hashicorp/yamux"
	"github.com/kurtserdar/captivo-access/tunnel"
)

// fakeControl is a stub proxyControl for tests: each field controls one of
// the three control-plane calls' return values.
type fakeControl struct {
	userID     string
	resolveErr error

	siteID, connID, upstream string
	siteErr                  error

	allow     bool
	reason    string
	accessErr error
}

func (f *fakeControl) ResolveSession(string) (string, error) { return f.userID, f.resolveErr }

func (f *fakeControl) SiteByHost(string) (string, string, string, error) {
	return f.siteID, f.connID, f.upstream, f.siteErr
}

func (f *fakeControl) CheckAccess(string, string) (bool, string, error) {
	return f.allow, f.reason, f.accessErr
}

// (a) No session cookie -> 302 to the manager's login page with returnTo set
// to the absolute URL the browser originally requested.
func TestBrowserProxyNoSessionRedirectsToLogin(t *testing.T) {
	p := &BrowserProxy{reg: NewRegistry(), ctrl: &fakeControl{}, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/dashboard?x=1", nil)
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)

	if w.Code != http.StatusFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusFound)
	}
	const wantPrefix = "https://manager.example/login?returnTo="
	loc := w.Header().Get("Location")
	if !strings.HasPrefix(loc, wantPrefix) {
		t.Fatalf("Location = %q, want prefix %q", loc, wantPrefix)
	}
	returnTo, err := url.QueryUnescape(strings.TrimPrefix(loc, wantPrefix))
	if err != nil {
		t.Fatal(err)
	}
	if want := "https://app.example.com/dashboard?x=1"; returnTo != want {
		t.Fatalf("returnTo = %q, want %q", returnTo, want)
	}
	if evs := p.audit.drain(10); len(evs) != 0 {
		t.Fatalf("audit events = %+v, want none (no-session must not be audited)", evs)
	}
}

// (b) Session ok + site ok + allow -> the request (including its body) is
// streamed through the connector's tunnel, and the connector's response
// (status/headers/body) is streamed back to the browser.
func TestBrowserProxyStreamsRequestAndResponse(t *testing.T) {
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

	var gotDR tunnel.DialRequest
	var gotBody []byte
	done := make(chan struct{})
	go func() {
		defer close(done)
		st, err := cli.Accept()
		if err != nil {
			return
		}
		defer st.Close()
		reqBytes, err := tunnel.ReadFrame(st)
		if err != nil {
			return
		}
		_ = json.Unmarshal(reqBytes, &gotDR)
		gotBody, _ = io.ReadAll(tunnel.NewBodyReader(st))

		respBytes, _ := json.Marshal(tunnel.DialResponse{
			Status: http.StatusCreated,
			Header: map[string][]string{"X-Echo": {"yes"}},
		})
		if err := tunnel.WriteFrame(st, respBytes); err != nil {
			return
		}
		_ = tunnel.WriteBody(st, bytes.NewReader(gotBody)) // echo the request body back
	}()

	reg := NewRegistry()
	reg.Set("c1", &Session{mux: srv})
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: true, reason: "allow"}
	p := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodPost, "http://app.example.com/api?x=1", strings.NewReader("hello body"))
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	<-done

	if w.Code != http.StatusCreated {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusCreated)
	}
	if w.Body.String() != "hello body" {
		t.Fatalf("response body = %q, want %q", w.Body.String(), "hello body")
	}
	if string(gotBody) != "hello body" {
		t.Fatalf("connector received body = %q, want %q", gotBody, "hello body")
	}
	if gotDR.UpstreamUrl != "http://wiki.internal" || gotDR.Method != http.MethodPost || gotDR.Path != "/api?x=1" {
		t.Fatalf("dial request = %+v", gotDR)
	}
	if w.Header().Get("X-Echo") != "yes" {
		t.Fatal("expected X-Echo response header to be forwarded")
	}

	evs := p.audit.drain(10)
	if len(evs) != 1 {
		t.Fatalf("audit events = %d, want 1", len(evs))
	}
	if evs[0].Decision != "ALLOW" || evs[0].UserID != "u1" || evs[0].SiteID != "s1" || evs[0].Status != http.StatusCreated {
		t.Fatalf("audit event = %+v, want ALLOW/u1/s1/%d", evs[0], http.StatusCreated)
	}
}

// (b2) Security-sensitive header handling, both directions:
//   - request: hop-by-hop headers (Connection/Upgrade) are stripped before
//     forwarding to the connector, the proxy's own reserved auth cookies
//     (ca_session, ca_challenge, ca_recover) are removed from the forwarded
//     Cookie header (other cookies pass through), and
//     X-Forwarded-For/X-Forwarded-Host are added.
//   - response: an upstream trying to set/overwrite the proxy's reserved
//     auth cookies (ca_session, here disguised as a cross-subdomain cookie)
//     via Set-Cookie must be blocked, while the app's own Set-Cookie values
//     still reach the browser (session-fixation guard, see copyRespHeaders).
func TestBrowserProxySanitizesRequestAndResponseHeaders(t *testing.T) {
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

	var gotDR tunnel.DialRequest
	done := make(chan struct{})
	go func() {
		defer close(done)
		st, err := cli.Accept()
		if err != nil {
			return
		}
		defer st.Close()
		reqBytes, err := tunnel.ReadFrame(st)
		if err != nil {
			return
		}
		_ = json.Unmarshal(reqBytes, &gotDR)
		_, _ = io.ReadAll(tunnel.NewBodyReader(st))

		respBytes, _ := json.Marshal(tunnel.DialResponse{
			Status: http.StatusOK,
			Header: map[string][]string{
				"Set-Cookie": {
					"ca_session=evil; Domain=.access.example.com; Path=/",
					"appsess=ok; Path=/",
				},
			},
		})
		if err := tunnel.WriteFrame(st, respBytes); err != nil {
			return
		}
		_ = tunnel.WriteBody(st, strings.NewReader(""))
	}()

	reg := NewRegistry()
	reg.Set("c1", &Session{mux: srv})
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: true, reason: "allow"}
	p := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	req.AddCookie(&http.Cookie{Name: "ca_challenge", Value: "chal"})
	req.AddCookie(&http.Cookie{Name: "app", Value: "1"})
	req.Header.Set("Connection", "close")
	req.Header.Set("Upgrade", "websocket")
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	<-done

	// --- request side ---
	if _, ok := gotDR.Header["Connection"]; ok {
		t.Fatalf("forwarded headers must not include hop-by-hop Connection: %+v", gotDR.Header)
	}
	if _, ok := gotDR.Header["Upgrade"]; ok {
		t.Fatalf("forwarded headers must not include hop-by-hop Upgrade: %+v", gotDR.Header)
	}
	gotCookie := ""
	if vs, ok := gotDR.Header["Cookie"]; ok && len(vs) > 0 {
		gotCookie = vs[0]
	}
	if strings.Contains(gotCookie, "ca_session") {
		t.Fatalf("forwarded Cookie must not include ca_session: %q", gotCookie)
	}
	if strings.Contains(gotCookie, "ca_challenge") {
		t.Fatalf("forwarded Cookie must not include ca_challenge: %q", gotCookie)
	}
	if !strings.Contains(gotCookie, "app=1") {
		t.Fatalf("forwarded Cookie must include app=1: %q", gotCookie)
	}
	if vs, ok := gotDR.Header["X-Forwarded-For"]; !ok || len(vs) == 0 || vs[0] == "" {
		t.Fatalf("forwarded headers must include X-Forwarded-For: %+v", gotDR.Header)
	}
	if vs, ok := gotDR.Header["X-Forwarded-Host"]; !ok || len(vs) == 0 || vs[0] != "app.example.com" {
		t.Fatalf("forwarded headers must include X-Forwarded-Host=app.example.com: %+v", gotDR.Header)
	}

	// --- response side ---
	setCookies := w.Header()["Set-Cookie"]
	for _, sc := range setCookies {
		if strings.HasPrefix(sc, "ca_session=") {
			t.Fatalf("browser response must not include upstream ca_session Set-Cookie, got: %v", setCookies)
		}
	}
	found := false
	for _, sc := range setCookies {
		if strings.HasPrefix(sc, "appsess=ok") {
			found = true
		}
	}
	if !found {
		t.Fatalf("browser response must still include the app's own Set-Cookie, got: %v", setCookies)
	}
}

// (c) allow=false -> 403 with the message mapped from the deny reason.
func TestBrowserProxyDeniedShowsReason(t *testing.T) {
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: false, reason: "expired"}
	p := &BrowserProxy{reg: NewRegistry(), ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)

	if w.Code != http.StatusForbidden {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusForbidden)
	}
	if want := "Your access has expired."; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("body = %q, want to contain %q", w.Body.String(), want)
	}

	evs := p.audit.drain(10)
	if len(evs) != 1 {
		t.Fatalf("audit events = %d, want 1", len(evs))
	}
	if evs[0].Decision != "DENY" || evs[0].Reason != "expired" || evs[0].UserID != "u1" || evs[0].SiteID != "s1" {
		t.Fatalf("audit event = %+v, want DENY/expired/u1/s1", evs[0])
	}
}

// (d) SiteByHost returns ErrNoSite -> 404.
func TestBrowserProxyUnknownSite(t *testing.T) {
	ctrl := &fakeControl{userID: "u1", siteErr: ErrNoSite}
	p := &BrowserProxy{reg: NewRegistry(), ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://unknown.example.com/", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)

	if w.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNotFound)
	}
	if evs := p.audit.drain(10); len(evs) != 0 {
		t.Fatalf("audit events = %+v, want none (no-site must not be audited)", evs)
	}
}

// (e) The resolved connector has no live session in the registry -> 502.
func TestBrowserProxyConnectorOffline(t *testing.T) {
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c-missing", upstream: "http://wiki.internal", allow: true, reason: "allow"}
	p := &BrowserProxy{reg: NewRegistry(), ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)} // empty registry

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)

	if w.Code != http.StatusBadGateway {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusBadGateway)
	}
}

// TestBrowserProxyRespondsBeforeBodyDrained proves the concurrency fix: the
// connector may reply before consuming the whole request body (e.g. an
// early rejection on a large upload). If ServeHTTP wrote the request body
// to completion before reading the response, this would deadlock once the
// body exceeds yamux's default 256 KiB stream window, since nothing is
// draining it. Writing the body in a goroutine while concurrently reading
// the response lets the early reply come through regardless.
func TestBrowserProxyRespondsBeforeBodyDrained(t *testing.T) {
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

	go func() {
		st, err := cli.Accept()
		if err != nil {
			return
		}
		defer st.Close()
		// Read only the DialRequest control frame and reply immediately —
		// deliberately never drain the request body.
		if _, err := tunnel.ReadFrame(st); err != nil {
			return
		}
		respBytes, _ := json.Marshal(tunnel.DialResponse{Status: http.StatusRequestEntityTooLarge})
		if err := tunnel.WriteFrame(st, respBytes); err != nil {
			return
		}
		_ = tunnel.WriteBody(st, strings.NewReader("too large"))
	}()

	reg := NewRegistry()
	reg.Set("c1", &Session{mux: srv})
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: true, reason: "allow"}
	p := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	// Bigger than yamux's default 256 KiB stream window, so a sequential
	// write-then-read implementation would block forever here.
	bigBody := bytes.Repeat([]byte("x"), 512<<10)
	req := httptest.NewRequest(http.MethodPost, "http://app.example.com/upload", bytes.NewReader(bigBody))
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()

	done := make(chan struct{})
	go func() {
		p.ServeHTTP(w, req)
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("ServeHTTP did not return — likely deadlocked writing the request body before reading the response")
	}

	if w.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusRequestEntityTooLarge)
	}
	if w.Body.String() != "too large" {
		t.Fatalf("body = %q, want %q", w.Body.String(), "too large")
	}
}
