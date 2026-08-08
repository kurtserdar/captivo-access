package main

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
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
	insecureSkipVerify       bool
	recordSessions           bool
	siteErr                  error

	allow     bool
	reason    string
	accessErr error

	recorderJS  []byte
	recorderErr error

	sentUserID, sentSiteID, sentHost string
	sentBody                         []byte
	sendRecordingErr                 error
}

func (f *fakeControl) ResolveSession(string) (string, error) { return f.userID, f.resolveErr }

func (f *fakeControl) SiteByHost(string) (string, string, string, bool, bool, error) {
	return f.siteID, f.connID, f.upstream, f.insecureSkipVerify, f.recordSessions, f.siteErr
}

func (f *fakeControl) CheckAccess(string, string) (bool, string, error) {
	return f.allow, f.reason, f.accessErr
}

func (f *fakeControl) RecorderJS() ([]byte, error) { return f.recorderJS, f.recorderErr }

func (f *fakeControl) SendRecording(userID, siteID, host string, body []byte) error {
	f.sentUserID, f.sentSiteID, f.sentHost, f.sentBody = userID, siteID, host, body
	return f.sendRecordingErr
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
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html prefix", ct)
	}
	if want := "No application here"; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("body = %q, want to contain %q", w.Body.String(), want)
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
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("Content-Type = %q, want text/html prefix", ct)
	}
	if want := "connector for this application is offline"; !strings.Contains(w.Body.String(), want) {
		t.Fatalf("body = %q, want to contain %q", w.Body.String(), want)
	}
}

// (f) A recording-enabled Site's GET /__captivo/rec.js is intercepted
// before it ever reaches the connector/upstream, and returns the cached
// recorder bundle as text/javascript.
func TestBrowserProxyServesRecorderBundle(t *testing.T) {
	ctrl := &fakeControl{
		userID: "u1", siteID: "s1", connID: "c-missing", upstream: "http://wiki.internal",
		allow: true, reason: "allow", recordSessions: true,
		recorderJS: []byte("console.log('rec')"),
	}
	// Registry is empty / connector missing on purpose: if the request were
	// forwarded upstream instead of intercepted, this would 502, not 200.
	p := &BrowserProxy{reg: NewRegistry(), ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/__captivo/rec.js", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if ct := w.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/javascript") {
		t.Fatalf("Content-Type = %q, want text/javascript prefix", ct)
	}
	if w.Body.String() != "console.log('rec')" {
		t.Fatalf("body = %q, want the recorder bundle", w.Body.String())
	}
}

// (g) A recording-enabled Site's POST /__captivo/rec is intercepted, forwards
// the batch (merged with userId/siteId/host) to SendRecording, and replies
// 204 regardless of upstream/connector state.
func TestBrowserProxyIngestsRecordingBatch(t *testing.T) {
	ctrl := &fakeControl{
		userID: "u1", siteID: "s1", connID: "c-missing", upstream: "http://wiki.internal",
		allow: true, reason: "allow", recordSessions: true,
	}
	p := &BrowserProxy{reg: NewRegistry(), ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	batch := `{"recordingKey":"k1","seq":0,"events":[{"type":1}]}`
	req := httptest.NewRequest(http.MethodPost, "http://app.example.com/__captivo/rec", strings.NewReader(batch))
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)

	if w.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusNoContent)
	}
	if ctrl.sentUserID != "u1" || ctrl.sentSiteID != "s1" || ctrl.sentHost != "app.example.com" {
		t.Fatalf("SendRecording called with userID=%q siteID=%q host=%q, want u1/s1/app.example.com",
			ctrl.sentUserID, ctrl.sentSiteID, ctrl.sentHost)
	}
	if string(ctrl.sentBody) != batch {
		t.Fatalf("SendRecording body = %q, want %q", ctrl.sentBody, batch)
	}
}

// (h) A non-recording Site's /__captivo/* paths 404, both for the recorder
// bundle and the ingest endpoint — recording must be opt-in per site.
func TestBrowserProxyRecordingDisabledIs404(t *testing.T) {
	ctrl := &fakeControl{
		userID: "u1", siteID: "s1", connID: "c-missing", upstream: "http://wiki.internal",
		allow: true, reason: "allow", recordSessions: false,
		recorderJS: []byte("console.log('rec')"),
	}
	p := &BrowserProxy{reg: NewRegistry(), ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	for _, req := range []*http.Request{
		httptest.NewRequest(http.MethodGet, "http://app.example.com/__captivo/rec.js", nil),
		httptest.NewRequest(http.MethodPost, "http://app.example.com/__captivo/rec", strings.NewReader("{}")),
	} {
		req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
		w := httptest.NewRecorder()
		p.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound {
			t.Fatalf("%s %s: status = %d, want %d", req.Method, req.URL.Path, w.Code, http.StatusNotFound)
		}
	}
	if ctrl.sentBody != nil {
		t.Fatalf("SendRecording must not be called when recording is disabled, got body %q", ctrl.sentBody)
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

// TestInjectRecorder proves the pure injectRecorder helper's placement
// rules: before </head> when present, else before </body>, else prepended
// to the whole body — case-insensitively, and inserted exactly once.
func TestInjectRecorder(t *testing.T) {
	tag := `<script src="/__captivo/rec.js" defer></script>`
	// before </head>
	got := string(injectRecorder([]byte("<html><head><title>x</title></head><body>y</body></html>")))
	if !strings.Contains(got, tag+"</head>") {
		t.Fatalf("not before </head>: %s", got)
	}
	// fallback before </body> when no </head>
	got = string(injectRecorder([]byte("<body>y</body>")))
	if !strings.Contains(got, tag+"</body>") {
		t.Fatalf("not before </body>: %s", got)
	}
	// fallback prepend when neither
	got = string(injectRecorder([]byte("plain")))
	if !strings.HasPrefix(got, tag) {
		t.Fatalf("not prepended: %s", got)
	}
}

// TestInjectRecorderNonASCIIHead guards against a regression where
// injectRecorder located the `</head>`/`</body>` offset in a
// strings.ToLower(string(body)) copy and then sliced the ORIGINAL body at
// that index. ToLower can change a multi-byte UTF-8 rune's byte length
// (Turkish İ, U+0130, is 2 bytes but lowercases to i̇, 3 bytes), which
// desyncs the offset from the original body — corrupting the splice, or
// panicking on body[:i]/body[i:] for a length-growing rune before the
// match. The title here ("İşlem", Turkish for "Transaction") contains such
// a rune before </head>, so a byte-length-changing lowercase pass would
// place the tag inside the markup (or panic) instead of immediately before
// </head>.
func TestInjectRecorderNonASCIIHead(t *testing.T) {
	tag := `<script src="/__captivo/rec.js" defer></script>`
	in := "<html><head><title>İşlem</title></head><body>x</body></html>"

	got := string(injectRecorder([]byte(in)))

	if !strings.Contains(got, tag+"</head>") {
		t.Fatalf("tag not immediately before </head>: %s", got)
	}
	if !strings.Contains(got, "<title>İşlem</title>") {
		t.Fatalf("title content corrupted (rune misalignment): %s", got)
	}
	// Removing the tag once must reproduce the original input exactly —
	// proves nothing else in the body was shifted, dropped, or duplicated.
	if withoutTag := strings.Replace(got, tag, "", 1); withoutTag != in {
		t.Fatalf("body corrupted beyond the injected tag:\n got  %q\n want %q", withoutTag, in)
	}
}

// (g2) A POST /__captivo/rec batch larger than maxRecordingBatchBytes is
// dropped whole rather than forwarded truncated (which would poison the
// chunk with corrupt JSON): 204 is still returned (fail-silent), but
// SendRecording is never called.
func TestServeRecording_DropsOversizeBatch(t *testing.T) {
	ctrl := &fakeControl{}
	p := &BrowserProxy{ctrl: ctrl}

	big := bytes.Repeat([]byte("x"), maxRecordingBatchBytes+1)
	req := httptest.NewRequest(http.MethodPost, "/__captivo/rec", bytes.NewReader(big))
	rec := httptest.NewRecorder()
	p.serveRecording(rec, req, "u1", "s1", "host", true)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if ctrl.sentBody != nil {
		t.Fatalf("oversize batch must not be forwarded, got SendRecording body %q", ctrl.sentBody)
	}
}

// (g3) A batch at or under the cap still forwards normally.
func TestServeRecording_ForwardsNormalBatch(t *testing.T) {
	ctrl := &fakeControl{}
	p := &BrowserProxy{ctrl: ctrl}

	body := []byte(`{"recordingKey":"k","seq":0,"events":[{"type":2}]}`)
	req := httptest.NewRequest(http.MethodPost, "/__captivo/rec", bytes.NewReader(body))
	rec := httptest.NewRecorder()
	p.serveRecording(rec, req, "u1", "s1", "host", true)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", rec.Code, http.StatusNoContent)
	}
	if string(ctrl.sentBody) != string(body) {
		t.Fatalf("SendRecording body = %q, want %q", ctrl.sentBody, body)
	}
}

// newTunnelPair returns a connected pair of yamux sessions — srv is what
// ServeHTTP's connector Registry entry uses to open streams, cli is the
// test's stand-in for the connector, accepting those streams. Both sessions
// are closed automatically at test cleanup.
func newTunnelPair(t *testing.T) (srv, cli *yamux.Session) {
	t.Helper()
	a, b := net.Pipe()
	var err error
	srv, err = yamux.Server(a, tunnel.SessionConfig())
	if err != nil {
		t.Fatal(err)
	}
	cli, err = yamux.Client(b, tunnel.SessionConfig())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = srv.Close()
		_ = cli.Close()
	})
	return srv, cli
}

// (i) A recorded Site's text/html response gets the recorder script tag
// injected before </head>, its CSP headers stripped (so both the injected
// script and the recorder's own outbound requests aren't blocked by the
// upstream app's policy), and Content-Length recomputed for the modified
// body.
func TestBrowserProxyInjectsRecorderIntoRecordedSiteHTML(t *testing.T) {
	srv, cli := newTunnelPair(t)
	const upstreamBody = "<html><head><title>x</title></head><body>hi</body></html>"
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
				"Content-Type":                        {"text/html; charset=utf-8"},
				"Content-Security-Policy":             {"default-src 'self'"},
				"Content-Security-Policy-Report-Only": {"default-src 'self'"},
			},
		})
		if err := tunnel.WriteFrame(st, respBytes); err != nil {
			return
		}
		_ = tunnel.WriteBody(st, strings.NewReader(upstreamBody))
	}()

	reg := NewRegistry()
	reg.Set("c1", &Session{mux: srv})
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: true, reason: "allow", recordSessions: true}
	p := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	<-done

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if vs, ok := gotDR.Header["Accept-Encoding"]; !ok || len(vs) != 1 || vs[0] != "identity" {
		t.Fatalf("forwarded Accept-Encoding = %+v, want [\"identity\"] for a recorded Site", gotDR.Header["Accept-Encoding"])
	}
	body := w.Body.String()
	const wantTag = `<script src="/__captivo/rec.js" defer></script></head>`
	if !strings.Contains(body, wantTag) {
		t.Fatalf("recorder script not injected before </head>: %s", body)
	}
	if w.Header().Get("Content-Security-Policy") != "" {
		t.Fatalf("Content-Security-Policy must be stripped for recorded-Site HTML, got %q", w.Header().Get("Content-Security-Policy"))
	}
	if w.Header().Get("Content-Security-Policy-Report-Only") != "" {
		t.Fatalf("Content-Security-Policy-Report-Only must be stripped for recorded-Site HTML, got %q", w.Header().Get("Content-Security-Policy-Report-Only"))
	}
	if got, want := w.Header().Get("Content-Length"), strconv.Itoa(len(body)); got != want {
		t.Fatalf("Content-Length = %q, want %q (actual written body length)", got, want)
	}

	evs := p.audit.drain(10)
	if len(evs) != 1 || evs[0].BytesOut != int64(len(body)) {
		t.Fatalf("audit event = %+v, want BytesOut=%d", evs, len(body))
	}
}

// (j) A recorded Site's non-HTML response (application/json) is streamed
// unchanged: no script injected, CSP headers left intact.
func TestBrowserProxyRecordedSiteNonHTMLUnchanged(t *testing.T) {
	srv, cli := newTunnelPair(t)
	const upstreamBody = `{"ok":true}`
	done := make(chan struct{})
	go func() {
		defer close(done)
		st, err := cli.Accept()
		if err != nil {
			return
		}
		defer st.Close()
		if _, err := tunnel.ReadFrame(st); err != nil {
			return
		}
		_, _ = io.ReadAll(tunnel.NewBodyReader(st))
		respBytes, _ := json.Marshal(tunnel.DialResponse{
			Status: http.StatusOK,
			Header: map[string][]string{
				"Content-Type":            {"application/json"},
				"Content-Security-Policy": {"default-src 'self'"},
			},
		})
		if err := tunnel.WriteFrame(st, respBytes); err != nil {
			return
		}
		_ = tunnel.WriteBody(st, strings.NewReader(upstreamBody))
	}()

	reg := NewRegistry()
	reg.Set("c1", &Session{mux: srv})
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: true, reason: "allow", recordSessions: true}
	p := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/api", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	<-done

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if w.Body.String() != upstreamBody {
		t.Fatalf("body = %q, want unchanged %q", w.Body.String(), upstreamBody)
	}
	if w.Header().Get("Content-Security-Policy") != "default-src 'self'" {
		t.Fatalf("CSP must be preserved for non-HTML responses, got %q", w.Header().Get("Content-Security-Policy"))
	}
}

// (j2) A recorded Site's text/html response that the upstream compressed
// anyway (ignoring the Accept-Encoding: identity sent toward it) must be
// streamed unchanged: injectRecorder only understands raw HTML, so running
// it against gzip bytes would corrupt the body. CSP is left intact too,
// since injection (and only injection) is what makes stripping it correct.
func TestBrowserProxyRecordedSiteCompressedHTMLUnchanged(t *testing.T) {
	srv, cli := newTunnelPair(t)
	// Not real gzip bytes — the point is that injectRecorder/writeProxyResponse
	// must never attempt to parse this as HTML at all when Content-Encoding
	// says it's compressed, so arbitrary bytes proves the guard fires purely
	// off the header, before any body inspection.
	const upstreamBody = "\x1f\x8b\x00not-really-gzip-but-opaque-bytes<html><head></head></html>"
	done := make(chan struct{})
	go func() {
		defer close(done)
		st, err := cli.Accept()
		if err != nil {
			return
		}
		defer st.Close()
		if _, err := tunnel.ReadFrame(st); err != nil {
			return
		}
		_, _ = io.ReadAll(tunnel.NewBodyReader(st))
		respBytes, _ := json.Marshal(tunnel.DialResponse{
			Status: http.StatusOK,
			Header: map[string][]string{
				"Content-Type":            {"text/html; charset=utf-8"},
				"Content-Encoding":        {"gzip"},
				"Content-Security-Policy": {"default-src 'self'"},
			},
		})
		if err := tunnel.WriteFrame(st, respBytes); err != nil {
			return
		}
		_ = tunnel.WriteBody(st, strings.NewReader(upstreamBody))
	}()

	reg := NewRegistry()
	reg.Set("c1", &Session{mux: srv})
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: true, reason: "allow", recordSessions: true}
	p := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	<-done

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if w.Body.String() != upstreamBody {
		t.Fatalf("body = %q, want unchanged %q", w.Body.String(), upstreamBody)
	}
	if strings.Contains(w.Body.String(), "/__captivo/rec.js") {
		t.Fatalf("recorder script must not be injected into a compressed body: %s", w.Body.String())
	}
	if w.Header().Get("Content-Security-Policy") != "default-src 'self'" {
		t.Fatalf("CSP must be preserved when the response is compressed, got %q", w.Header().Get("Content-Security-Policy"))
	}
}

// (k) A non-recorded Site's text/html response is streamed unchanged: no
// script injected, CSP headers left intact — recording (and therefore
// injection) is strictly opt-in per Site.
func TestBrowserProxyNonRecordedSiteHTMLUnchanged(t *testing.T) {
	srv, cli := newTunnelPair(t)
	const upstreamBody = "<html><head><title>x</title></head><body>hi</body></html>"
	done := make(chan struct{})
	go func() {
		defer close(done)
		st, err := cli.Accept()
		if err != nil {
			return
		}
		defer st.Close()
		if _, err := tunnel.ReadFrame(st); err != nil {
			return
		}
		_, _ = io.ReadAll(tunnel.NewBodyReader(st))
		respBytes, _ := json.Marshal(tunnel.DialResponse{
			Status: http.StatusOK,
			Header: map[string][]string{
				"Content-Type":            {"text/html; charset=utf-8"},
				"Content-Security-Policy": {"default-src 'self'"},
			},
		})
		if err := tunnel.WriteFrame(st, respBytes); err != nil {
			return
		}
		_ = tunnel.WriteBody(st, strings.NewReader(upstreamBody))
	}()

	reg := NewRegistry()
	reg.Set("c1", &Session{mux: srv})
	ctrl := &fakeControl{userID: "u1", siteID: "s1", connID: "c1", upstream: "http://wiki.internal", allow: true, reason: "allow", recordSessions: false}
	p := &BrowserProxy{reg: reg, ctrl: ctrl, managerURL: "https://manager.example", audit: NewAuditQueue(100)}

	req := httptest.NewRequest(http.MethodGet, "http://app.example.com/", nil)
	req.AddCookie(&http.Cookie{Name: "ca_session", Value: "tok"})
	w := httptest.NewRecorder()
	p.ServeHTTP(w, req)
	<-done

	if w.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", w.Code, http.StatusOK)
	}
	if w.Body.String() != upstreamBody {
		t.Fatalf("body = %q, want unchanged %q", w.Body.String(), upstreamBody)
	}
	if strings.Contains(w.Body.String(), "/__captivo/rec.js") {
		t.Fatalf("recorder script must not be injected for a non-recorded Site: %s", w.Body.String())
	}
	if w.Header().Get("Content-Security-Policy") != "default-src 'self'" {
		t.Fatalf("CSP must be preserved for a non-recorded Site, got %q", w.Header().Get("Content-Security-Policy"))
	}
}

func TestErrorPage_RendersHTML(t *testing.T) {
	rec := httptest.NewRecorder()
	errorPage(rec, http.StatusBadGateway, "Application unavailable", "The app didn't respond.", "Try again shortly.")

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("status: want 502, got %d", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
		t.Fatalf("content-type: want text/html, got %q", ct)
	}
	body := rec.Body.String()
	for _, want := range []string{"Application unavailable", "respond", "Try again shortly.", "Captivo Access", "502"} {
		if !strings.Contains(body, want) {
			t.Fatalf("body missing %q; got:\n%s", want, body)
		}
	}
}

func TestErrorPage_EscapesDynamicText(t *testing.T) {
	rec := httptest.NewRecorder()
	errorPage(rec, http.StatusForbidden, "<script>x</script>", "d&d", "h")
	body := rec.Body.String()
	if strings.Contains(body, "<script>x</script>") {
		t.Fatalf("title was not HTML-escaped: %s", body)
	}
	if !strings.Contains(body, "&lt;script&gt;") {
		t.Fatalf("expected escaped title in body: %s", body)
	}
}

func TestDenyPage_ReasonMessages(t *testing.T) {
	cases := map[string]string{
		"expired":                "Your access has expired.",
		"off_schedule":           "available at this time",
		"denied":                 "Your access request was declined.",
		"totally_unknown_reason": "have access to this application.", // default
	}
	for reason, want := range cases {
		rec := httptest.NewRecorder()
		denyPage(rec, reason)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("[%s] status: want 403, got %d", reason, rec.Code)
		}
		if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/html") {
			t.Fatalf("[%s] content-type: want text/html, got %q", reason, ct)
		}
		if !strings.Contains(rec.Body.String(), want) {
			t.Fatalf("[%s] body missing %q", reason, want)
		}
	}
}
