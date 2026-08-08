package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/kurtserdar/captivo-access/tunnel"
)

// sessionCookieName is the browser cookie set by the control plane's login
// flow (src/lib/auth/cookies.ts) after an authenticated user is redirected
// back from /login.
const sessionCookieName = "ca_session"

// reservedAuthCookies are the proxy's own identity cookies (set by the
// control plane: src/lib/auth/session.ts, challenge.ts, recover-token.ts).
// Because the session cookie is shared across *.access.<domain> subdomains
// (COOKIE_DOMAIN), an upstream app must never be allowed to set or overwrite
// one of these via its own Set-Cookie response headers — otherwise a
// compromised/malicious internal app could fixate or hijack the identity
// cookie proxy-wide. copyRespHeaders drops any Set-Cookie whose name matches
// one of these (case-insensitively).
var reservedAuthCookies = map[string]bool{
	"ca_session":   true,
	"ca_challenge": true,
	"ca_recover":   true,
}

// hopByHopHeaders are stripped in both directions across the proxy boundary,
// per RFC 7230 §6.1 — they describe the state of a single hop's connection
// and must never be blindly forwarded across it.
var hopByHopHeaders = map[string]bool{
	"connection":          true,
	"keep-alive":          true,
	"proxy-authenticate":  true,
	"proxy-authorization": true,
	"te":                  true,
	"trailer":             true,
	"transfer-encoding":   true,
	"upgrade":             true,
}

// denyReasonText maps a DecisionReason (control-plane's evaluateAccess) to a
// short, human-readable message shown on the 403 deny page.
var denyReasonText = map[string]string{
	"no_grant":         "You don't have access to this application.",
	"expired":          "Your access has expired.",
	"not_yet":          "Your access hasn't started yet.",
	"revoked":          "Your access was revoked.",
	"pending_approval": "Your access is awaiting approval.",
	"user_disabled":    "Your account is disabled.",
}

// proxyControl is the subset of ControlClient that BrowserProxy depends on.
// Tests inject a fake implementation; *ControlClient satisfies it for
// production use.
type proxyControl interface {
	ResolveSession(token string) (userID string, err error)
	SiteByHost(host string) (siteID, connectorID, upstreamUrl string, insecureSkipVerify bool, recordSessions bool, err error)
	CheckAccess(userID, siteID string) (allow bool, reason string, err error)
	RecorderJS() ([]byte, error)
	SendRecording(userID, siteID, host string, body []byte) error
}

// BrowserProxy is the browser-facing identity-aware reverse proxy: it
// resolves the caller's session, the target site for the request's Host,
// and the access decision, then streams the request/response through the
// resolved connector's tunnel (see spec §3).
type BrowserProxy struct {
	reg        *Registry
	ctrl       proxyControl
	managerURL string
	audit      *AuditQueue
}

func (p *BrowserProxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	host := forwardedHost(r)

	// 1. Session.
	token := readCookie(r, sessionCookieName)
	userID, _ := p.ctrl.ResolveSession(token)
	if userID == "" {
		orig := absoluteURL(r, host)
		http.Redirect(w, r, p.managerURL+"/login?returnTo="+url.QueryEscape(orig), http.StatusFound)
		return
	}

	// 2. Site by host.
	siteID, connectorID, upstream, insecureSkipVerify, recordSessions, err := p.ctrl.SiteByHost(host)
	if err != nil {
		if errors.Is(err, ErrNoSite) {
			http.Error(w, "unknown site", http.StatusNotFound)
		} else {
			http.Error(w, "site lookup failed", http.StatusBadGateway)
		}
		return
	}

	// 3. Access decision.
	allow, reason, err := p.ctrl.CheckAccess(userID, siteID)
	if err != nil {
		http.Error(w, "access check failed", http.StatusBadGateway)
		return
	}
	if !allow {
		p.audit.Enqueue(auditEvent("DENY", reason, userID, siteID, host, r, http.StatusForbidden, 0))
		denyPage(w, reason)
		return
	}

	// Reserved recording endpoints the recorder bundle talks to
	// (src/recorder/record-init.ts): never proxied upstream. Handled here,
	// after session/site/access are resolved, so recording is scoped to an
	// authenticated, allowed user on a recording-enabled site.
	if strings.HasPrefix(r.URL.Path, "/__captivo/") {
		p.serveRecording(w, r, userID, siteID, host, recordSessions)
		return
	}

	// WebSocket upgrades take a dedicated raw-relay path — they must branch
	// here, before sanitizeReqHeaders strips the Upgrade/Connection headers.
	if isWebSocketUpgrade(r) {
		p.serveWebSocket(w, r, connectorID, siteID, userID, host, upstream, insecureSkipVerify)
		return
	}

	// 4. Stream through the connector.
	sess := p.reg.Get(connectorID)
	if sess == nil || sess.mux == nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}
	st, err := sess.mux.Open()
	if err != nil {
		http.Error(w, "connector offline", http.StatusBadGateway)
		return
	}
	defer st.Close() // also unblocks a still-running WriteBody goroutine below

	reqHeaders := sanitizeReqHeaders(r, host)
	if recordSessions {
		// Force uncompressed HTML from the upstream so the response-path
		// injection below (Step 3) can buffer, modify, and recompute
		// Content-Length without also having to decompress it.
		reqHeaders["Accept-Encoding"] = []string{"identity"}
	}
	dr := tunnel.DialRequest{
		UpstreamUrl:        upstream,
		Method:             r.Method,
		Path:               r.URL.RequestURI(),
		Header:             reqHeaders,
		InsecureSkipVerify: insecureSkipVerify,
	}
	reqBytes, err := json.Marshal(dr)
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		http.Error(w, "tunnel error", http.StatusBadGateway)
		return
	}

	// The connector may reply (or error out) before it has read the whole
	// request body — e.g. a handler that redirects or rejects immediately
	// on a large upload. Writing the body to completion before reading the
	// response would deadlock/head-of-line-block on the yamux stream in
	// that case, so the body is streamed in its own goroutine while this
	// goroutine reads the response concurrently. The deferred st.Close()
	// above guarantees this goroutine unblocks (WriteBody returns an error
	// that's safe to ignore) once the handler returns.
	go func() {
		_ = tunnel.WriteBody(st, r.Body)
	}()

	respBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		http.Error(w, "tunnel error", http.StatusBadGateway)
		return
	}
	var resp tunnel.DialResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		http.Error(w, "tunnel error", http.StatusBadGateway)
		return
	}
	if resp.Error != "" {
		http.Error(w, "upstream error", http.StatusBadGateway)
		return
	}

	copyRespHeaders(w.Header(), resp.Header)
	body := tunnel.NewBodyReader(st)
	written := p.writeProxyResponse(w, resp, body, recordSessions)
	accessLog(userID, siteID, host, r.Method, r.URL.Path, resp.Status, written)
	p.audit.Enqueue(auditEvent("ALLOW", "", userID, siteID, host, r, resp.Status, written))
}

// writeProxyResponse writes the upstream response (status, already-copied
// headers, and body) to w, returning the number of body bytes written. For
// recorded Sites whose response Content-Type starts with text/html, it
// buffers the body (capped at maxInjectableBodyBytes), injects the recorder
// script tag, strips the response's CSP headers (which would otherwise
// block the injected script and the recorder's own outbound requests), and
// recomputes Content-Length. Every other response — non-recorded Sites,
// non-HTML content types, and oversized HTML bodies — is streamed exactly
// as it arrives, unmodified.
func (p *BrowserProxy) writeProxyResponse(w http.ResponseWriter, resp tunnel.DialResponse, body io.Reader, recordSessions bool) int64 {
	// isCompressed: an upstream that ignored the Accept-Encoding: identity
	// sent toward it (Step 2) and returned compressed HTML anyway must not
	// have its bytes mangled by injectRecorder, which only understands raw
	// HTML — stream it through unchanged instead, same as the non-HTML path.
	if !recordSessions || !isHTMLContentType(resp.Header) || isCompressed(resp.Header) {
		w.WriteHeader(resp.Status)
		written, _ := io.Copy(w, body)
		return written
	}

	// Read up to maxInjectableBodyBytes+1 bytes: if that many are present,
	// the body exceeds the cap and must be streamed unchanged instead of
	// buffered/injected. buf below holds at most that many bytes read so
	// far either way — for the oversize case it's simply written back out
	// verbatim followed by the rest of the stream, so the response the
	// browser receives is identical to the un-injected path.
	buf, _ := io.ReadAll(io.LimitReader(body, maxInjectableBodyBytes+1))
	if int64(len(buf)) > maxInjectableBodyBytes {
		w.WriteHeader(resp.Status)
		n1, _ := w.Write(buf)
		n2, _ := io.Copy(w, body)
		return int64(n1) + n2
	}

	injected := injectRecorder(buf)
	w.Header().Del("Content-Security-Policy")
	w.Header().Del("Content-Security-Policy-Report-Only")
	w.Header().Set("Content-Length", strconv.Itoa(len(injected)))
	w.WriteHeader(resp.Status)
	n, _ := w.Write(injected)
	return int64(n)
}

// isHTMLContentType reports whether header's Content-Type value(s) start
// with "text/html" (case-insensitively, ignoring leading whitespace — e.g.
// "text/html; charset=utf-8" matches). Header keys are matched
// case-insensitively since they originate from the connector's JSON-encoded
// response, not necessarily Go's canonical form.
func isHTMLContentType(header map[string][]string) bool {
	for k, vs := range header {
		if !strings.EqualFold(k, "Content-Type") {
			continue
		}
		for _, v := range vs {
			if strings.HasPrefix(strings.ToLower(strings.TrimSpace(v)), "text/html") {
				return true
			}
		}
	}
	return false
}

// isCompressed reports whether header carries a non-empty Content-Encoding
// value other than "identity" — i.e. the body is compressed and must not be
// treated as raw HTML by injectRecorder. Matched case-insensitively on both
// the header name and its value, for the same reason as isHTMLContentType.
func isCompressed(header map[string][]string) bool {
	for k, vs := range header {
		if !strings.EqualFold(k, "Content-Encoding") {
			continue
		}
		for _, v := range vs {
			v = strings.TrimSpace(v)
			if v != "" && !strings.EqualFold(v, "identity") {
				return true
			}
		}
	}
	return false
}

// recorderScriptTag is injected into recorded-Site HTML responses. It loads
// the recorder bundle from the reserved /__captivo/rec.js endpoint (served
// by serveRecording, never proxied upstream) with `defer` so it never blocks
// page rendering.
const recorderScriptTag = `<script src="/__captivo/rec.js" defer></script>`

// maxInjectableBodyBytes caps how large a recorded-Site HTML response body
// may be for injectRecorder to run against a fully-buffered copy. Above
// this, the response is streamed unchanged (no injection) rather than
// buffering an unbounded body in memory.
const maxInjectableBodyBytes = 8 << 20 // 8 MiB

// injectRecorder inserts recorderScriptTag into an HTML document: before the
// first case-insensitive `</head>` if present, else before the first
// case-insensitive `</body>` if present, else prepended to the whole body.
// The tag is inserted exactly once. Pure function — no I/O.
//
// The search is done directly over the original bytes with an ASCII-only
// case fold (via indexFold/bytes.EqualFold), never through
// strings.ToLower(string(body)): ToLower can change a multi-byte UTF-8
// rune's byte length (e.g. Turkish İ, U+0130, is 2 bytes but lowercases to
// i̇, 3 bytes), which would desync any byte offset found in the lowered
// copy from the original body — corrupting the splice or, for
// length-growing runes before the match, panicking with a
// slice-bounds-out-of-range on body[:i]/body[i:]. `</head>` and `</body>`
// are themselves pure ASCII, so matching case-insensitively per byte against
// the untouched original is both correct and simpler.
func injectRecorder(body []byte) []byte {
	if i := indexFold(body, []byte("</head>")); i >= 0 {
		return insertAt(body, []byte(recorderScriptTag), i)
	}
	if i := indexFold(body, []byte("</body>")); i >= 0 {
		return insertAt(body, []byte(recorderScriptTag), i)
	}
	out := make([]byte, 0, len(body)+len(recorderScriptTag))
	out = append(out, recorderScriptTag...)
	out = append(out, body...)
	return out
}

// indexFold returns the index of sub's first ASCII-case-insensitive match
// in b, or -1 if none. Byte-for-byte (not rune-aware) by design: sub is
// always a pure-ASCII marker (`</head>`/`</body>`), so this never needs to
// reason about multi-byte runes in b, unlike strings.ToLower on arbitrary
// UTF-8 content.
func indexFold(b, sub []byte) int {
	for i := 0; i+len(sub) <= len(b); i++ {
		if bytes.EqualFold(b[i:i+len(sub)], sub) {
			return i
		}
	}
	return -1
}

// insertAt splices tag into body immediately before byte offset i.
func insertAt(body, tag []byte, i int) []byte {
	out := make([]byte, 0, len(body)+len(tag))
	out = append(out, body[:i]...)
	out = append(out, tag...)
	out = append(out, body[i:]...)
	return out
}

// maxRecordingBatchBytes caps a single POST /__captivo/rec body. The
// recorder flushes the FullSnapshot as its own batch via a plain (uncapped)
// fetch, so a single batch can be large; 8 MiB is a generous backstop
// against a runaway/malicious client. An oversize body is dropped whole
// (below) rather than forwarded truncated, which would poison the chunk
// with corrupt JSON.
const maxRecordingBatchBytes = 8 << 20 // 8 MiB

// serveRecording intercepts the two reserved /__captivo/* paths the
// recorder bundle talks to. It never reaches the upstream app. Recording is
// fail-silent throughout: any error is swallowed rather than surfaced to the
// page (a site not recording-enabled yields 404; an oversized batch is dropped
// with 204), since a recording hiccup must never be visible to the user or
// break the app being proxied.
func (p *BrowserProxy) serveRecording(w http.ResponseWriter, r *http.Request, userID, siteID, host string, recordSessions bool) {
	if !recordSessions {
		http.NotFound(w, r)
		return
	}
	switch {
	case r.Method == http.MethodGet && r.URL.Path == "/__captivo/rec.js":
		js, err := p.ctrl.RecorderJS()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/javascript; charset=utf-8")
		_, _ = w.Write(js)
	case r.Method == http.MethodPost && r.URL.Path == "/__captivo/rec":
		body, err := io.ReadAll(io.LimitReader(r.Body, maxRecordingBatchBytes+1))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		if len(body) > maxRecordingBatchBytes {
			// Oversize: drop cleanly rather than forward a truncated,
			// corrupt body. Fail-silent — recording must never surface to
			// the page.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		_ = p.ctrl.SendRecording(userID, siteID, host, body) // best-effort
		w.WriteHeader(http.StatusNoContent)
	default:
		http.NotFound(w, r)
	}
}

// forwardedHost returns the browser-facing hostname for this request: the
// first hop of X-Forwarded-Host if a front proxy set one, otherwise
// r.Host. The result is always lowercased with any port stripped.
func forwardedHost(r *http.Request) string {
	h := r.Header.Get("X-Forwarded-Host")
	if h == "" {
		h = r.Host
	} else if i := strings.IndexByte(h, ','); i >= 0 {
		h = strings.TrimSpace(h[:i])
	}
	if host, _, err := net.SplitHostPort(h); err == nil {
		h = host
	}
	return strings.ToLower(h)
}

// readCookie returns the named cookie's value, or "" if absent.
func readCookie(r *http.Request, name string) string {
	c, err := r.Cookie(name)
	if err != nil {
		return ""
	}
	return c.Value
}

// absoluteURL reconstructs the full URL the browser requested, using
// X-Forwarded-Proto (set by the front TLS proxy) for the scheme, defaulting
// to https since browser-facing sites are never served plaintext.
func absoluteURL(r *http.Request, host string) string {
	scheme := r.Header.Get("X-Forwarded-Proto")
	if scheme == "" {
		scheme = "https"
	}
	return scheme + "://" + host + r.URL.RequestURI()
}

// sanitizeReqHeaders builds the header set forwarded to the connector: the
// inbound request's headers minus hop-by-hop ones, the session cookie
// stripped out of Cookie (other cookies pass through to the app), and
// X-Forwarded-For/X-Forwarded-Host added toward the app.
func sanitizeReqHeaders(r *http.Request, host string) map[string][]string {
	out := map[string][]string{}
	for k, vs := range r.Header {
		if hopByHopHeaders[strings.ToLower(k)] || strings.EqualFold(k, "Cookie") {
			continue
		}
		cp := make([]string, len(vs))
		copy(cp, vs)
		out[k] = cp
	}
	if ck := filteredCookieHeader(r); ck != "" {
		out["Cookie"] = []string{ck}
	}
	ip := remoteIP(r)
	if ip != "" {
		if existing := r.Header.Get("X-Forwarded-For"); existing != "" {
			ip = existing + ", " + ip
		}
		out["X-Forwarded-For"] = []string{ip}
	}
	out["X-Forwarded-Host"] = []string{host}
	return out
}

// filteredCookieHeader rebuilds a Cookie header value from the request's
// parsed cookies, dropping any of the proxy's own reserved auth cookies
// (ca_session, ca_challenge, ca_recover — case-insensitively) so the app
// never sees them. This mirrors the response-side filtering in
// copyRespHeaders: even if ca_challenge/ca_recover become domain-scoped in
// the future, they must not leak upstream either.
func filteredCookieHeader(r *http.Request) string {
	cookies := r.Cookies()
	parts := make([]string, 0, len(cookies))
	for _, c := range cookies {
		if reservedAuthCookies[strings.ToLower(c.Name)] {
			continue
		}
		parts = append(parts, c.Name+"="+c.Value)
	}
	return strings.Join(parts, "; ")
}

// remoteIP returns the host part of r.RemoteAddr (falling back to the raw
// value if it has no port to split).
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

// copyRespHeaders copies the upstream response headers into dst, stripping
// hop-by-hop ones. Set-Cookie is handled specially: it may appear multiple
// times, and any value naming one of our reserved auth cookies (ca_session,
// ca_challenge, ca_recover) is dropped so an upstream app can never set or
// overwrite the proxy's own identity cookies (session fixation guard). All
// other Set-Cookie values — the app's own cookies — are forwarded unchanged.
func copyRespHeaders(dst http.Header, src map[string][]string) {
	for k, vs := range src {
		if hopByHopHeaders[strings.ToLower(k)] {
			continue
		}
		if strings.EqualFold(k, "Set-Cookie") {
			for _, v := range vs {
				if reservedAuthCookies[strings.ToLower(setCookieName(v))] {
					continue
				}
				dst.Add(k, v)
			}
			continue
		}
		for _, v := range vs {
			dst.Add(k, v)
		}
	}
}

// setCookieName extracts the cookie name from a Set-Cookie header value —
// the substring before the first '=', trimmed of surrounding whitespace.
func setCookieName(setCookie string) string {
	name := setCookie
	if i := strings.IndexByte(setCookie, '='); i >= 0 {
		name = setCookie[:i]
	}
	return strings.TrimSpace(name)
}

// denyPage writes a 403 response with a short, human-readable message for
// the given access-decision reason.
func denyPage(w http.ResponseWriter, reason string) {
	msg, ok := denyReasonText[reason]
	if !ok {
		msg = "You don't have access to this application."
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	_, _ = io.WriteString(w, msg)
}

// auditEvent builds the AuditEvent for one access decision (allow or
// authenticated deny). bytes is the response body size on ALLOW (0 on
// DENY, since the deny page is written after this is constructed).
func auditEvent(decision, reason, userID, siteID, host string, r *http.Request, status int, bytes int64) AuditEvent {
	return AuditEvent{
		Timestamp: time.Now(),
		UserID:    userID,
		SiteID:    siteID,
		Host:      host,
		Method:    r.Method,
		Path:      r.URL.Path,
		Status:    status,
		BytesOut:  bytes,
		Decision:  decision,
		Reason:    reason,
		ClientIP:  firstHop(r.Header.Get("X-Forwarded-For")),
		UserAgent: r.UserAgent(),
	}
}

// firstHop returns the first (left-most, i.e. original client) address in a
// comma-separated X-Forwarded-For header value, trimmed of whitespace.
func firstHop(xff string) string {
	if i := strings.IndexByte(xff, ','); i >= 0 {
		xff = xff[:i]
	}
	return strings.TrimSpace(xff)
}

// accessLog emits one structured line per proxied request. log's default
// flags prefix it with a date/time, giving lines of the shape:
// "2026/01/02 15:04:05 user=<id> site=<id> host=<h> method=<m> path=<p> status=<s> bytes=<n>".
func accessLog(userID, siteID, host, method, path string, status int, bytes int64) {
	log.Printf("user=%s site=%s host=%s method=%s path=%s status=%d bytes=%d",
		userID, siteID, host, method, path, status, bytes)
}
