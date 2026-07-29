package main

import (
	"encoding/json"
	"errors"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
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
	SiteByHost(host string) (siteID, connectorID, upstreamName string, err error)
	CheckAccess(userID, siteID string) (allow bool, reason string, err error)
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
	siteID, connectorID, upstream, err := p.ctrl.SiteByHost(host)
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

	dr := tunnel.DialRequest{
		UpstreamName: upstream,
		Method:       r.Method,
		Path:         r.URL.RequestURI(),
		Header:       sanitizeReqHeaders(r, host),
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
	w.WriteHeader(resp.Status)
	written, _ := io.Copy(w, tunnel.NewBodyReader(st))
	accessLog(userID, siteID, host, r.Method, r.URL.Path, resp.Status, written)
	p.audit.Enqueue(auditEvent("ALLOW", "", userID, siteID, host, r, resp.Status, written))
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
