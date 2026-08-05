package main

import (
	"crypto/tls"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/hashicorp/yamux"
	"github.com/kurtserdar/captivo-access/tunnel"
)

// serveStreams accepts streams opened by the data-plane over mux and handles
// each one independently until the session dies.
func serveStreams(mux *yamux.Session, allow *TargetMatcher) {
	for {
		st, err := mux.Accept()
		if err != nil {
			return
		}
		go handleStream(st, allow)
	}
}

// handleStream reads the first control frame, peeks its kind, and dispatches
// to the dial (proxied HTTP) or probe (TCP reachability) handler.
func handleStream(st io.ReadWriteCloser, allow *TargetMatcher) {
	defer st.Close()
	reqBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		return
	}
	var peek struct {
		Kind string `json:"kind"`
	}
	_ = json.Unmarshal(reqBytes, &peek)
	if peek.Kind == "probe" {
		handleProbe(st, allow, reqBytes)
		return
	}
	handleDial(st, allow, reqBytes)
}

// handleDial services a single proxied HTTP request. The first frame on the
// stream is a tunnel.DialRequest carrying the full upstream URL to dial;
// handleDial validates that URL (scheme must be http/https, host must be
// non-empty) and checks it against the connector's optional egress boundary
// (allow) before ever dialing it. If ALLOWED_TARGETS is unset the boundary
// is open and any well-formed http(s) URL is dialed; if it's set, targets
// outside it are rejected with a DialResponse error and the stream is
// closed — this is the connector's core security boundary.
func handleDial(st io.ReadWriteCloser, allow *TargetMatcher, reqBytes []byte) {
	var dr tunnel.DialRequest
	if json.Unmarshal(reqBytes, &dr) != nil {
		return
	}

	baseURL, err := url.Parse(dr.UpstreamUrl)
	if err != nil || (baseURL.Scheme != "http" && baseURL.Scheme != "https") || baseURL.Hostname() == "" {
		writeErr(st, "bad upstream url")
		return
	}
	if !allow.Allowed(baseURL.Host) {
		writeErr(st, "target not allowed") // egress boundary — fail closed
		return
	}
	// dr.Path comes from the far end of the tunnel and MUST be treated as an
	// untrusted, path-only reference — never as a string to concatenate onto
	// the host. url.NewRequest re-parses a concatenated string as a URL, so a
	// crafted Path like "@evil.com/" or "//evil.com/" would be reinterpreted
	// with evil.com as the host (userinfo/scheme-relative confusion),
	// silently defeating the allowlist below. Requiring a leading "/" and
	// rejecting any parsed Path with a Host or absolute scheme closes that
	// off before ResolveReference ever runs.
	if !strings.HasPrefix(dr.Path, "/") {
		writeErr(st, "invalid path")
		return
	}
	ref, err := url.Parse(dr.Path)
	if err != nil || ref.IsAbs() || ref.Host != "" {
		writeErr(st, "invalid path")
		return
	}
	target := baseURL.ResolveReference(ref)
	// Defense in depth: the resolved target MUST stay on the allowlisted
	// upstream's scheme+host. This should already be guaranteed by the
	// checks above, but re-verifying against the final resolved URL means
	// a future change to the validation logic above can't silently regress
	// the core security boundary.
	if target.Scheme != baseURL.Scheme || target.Host != baseURL.Host {
		writeErr(st, "invalid path")
		return
	}

	client := &http.Client{
		Timeout: 30 * time.Second,
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return http.ErrUseLastResponse
		},
	}
	if dr.InsecureSkipVerify {
		// Per-Site opt-in: the operator has marked this upstream a trusted
		// internal device with a self-signed/unverifiable certificate.
		client.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}
	}
	req, err := http.NewRequest(orGet(dr.Method), target.String(), tunnel.NewBodyReader(st))
	if err != nil {
		writeErr(st, "bad request")
		return
	}
	for k, vs := range dr.Header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
	}
	// http.Client ignores a manually-added Content-Length header on a body
	// of unknown length (our tunnel.BodyReader isn't *bytes.Reader/*strings.Reader,
	// so Go can't infer length itself) and instead sends chunked
	// transfer-encoding. A strict upstream that only understands
	// Content-Length then sees an empty body. Honor an incoming
	// Content-Length by setting req.ContentLength directly so Go emits a
	// fixed-length request instead of chunking it.
	if cl := req.Header.Get("Content-Length"); cl != "" {
		if n, e := strconv.ParseInt(cl, 10, 64); e == nil && n >= 0 {
			req.ContentLength = n
		}
		req.Header.Del("Content-Length") // Go emits Content-Length from req.ContentLength
	}
	resp, err := client.Do(req)
	if err != nil {
		writeErr(st, "upstream unreachable")
		return
	}
	defer resp.Body.Close()

	respMeta, err := json.Marshal(tunnel.DialResponse{Status: resp.StatusCode, Header: resp.Header})
	if err != nil {
		return
	}
	if tunnel.WriteFrame(st, respMeta) != nil {
		return
	}
	_ = tunnel.WriteBody(st, resp.Body)
}

func writeErr(st io.Writer, msg string) {
	b, err := json.Marshal(tunnel.DialResponse{Status: 0, Error: msg})
	if err != nil {
		return
	}
	_ = tunnel.WriteFrame(st, b)
}

func orGet(m string) string {
	if m == "" {
		return "GET"
	}
	return m
}

// handleProbe services a TCP reachability check. The first frame is a
// tunnel.ProbeRequest carrying the upstream URL; handleProbe validates it
// (scheme must be http/https, host must be non-empty) and checks it against
// the connector's optional egress boundary (allow) before ever dialing it —
// the same boundary a proxied dial uses, since a probe reaches the same
// network as a dial and must not be a way to bypass ALLOWED_TARGETS. It then
// TCP-connects to the derived host:port (default 80/443 by scheme) and
// reports success/failure and latency, never making an HTTP request.
func handleProbe(st io.Writer, allow *TargetMatcher, reqBytes []byte) {
	var pr tunnel.ProbeRequest
	if json.Unmarshal(reqBytes, &pr) != nil {
		return
	}
	baseURL, err := url.Parse(pr.UpstreamUrl)
	if err != nil || (baseURL.Scheme != "http" && baseURL.Scheme != "https") || baseURL.Hostname() == "" {
		writeProbe(st, tunnel.ProbeResponse{Ok: false, Error: "bad upstream url"})
		return
	}
	if !allow.Allowed(baseURL.Host) {
		writeProbe(st, tunnel.ProbeResponse{Ok: false, Error: "target not allowed"}) // egress boundary — fail closed
		return
	}
	port := baseURL.Port()
	if port == "" {
		if baseURL.Scheme == "https" {
			port = "443"
		} else {
			port = "80"
		}
	}
	// net.JoinHostPort brackets IPv6 hosts correctly (baseURL.Hostname strips them).
	hostPort := net.JoinHostPort(baseURL.Hostname(), port)
	start := time.Now()
	conn, err := net.DialTimeout("tcp", hostPort, 5*time.Second)
	if err != nil {
		detail := "unreachable"
		if ne, ok := err.(net.Error); ok && ne.Timeout() {
			detail = "timeout"
		} else if strings.Contains(err.Error(), "refused") {
			detail = "connection refused"
		}
		writeProbe(st, tunnel.ProbeResponse{Ok: false, Error: detail})
		return
	}
	conn.Close()
	writeProbe(st, tunnel.ProbeResponse{Ok: true, LatencyMs: int(time.Since(start).Milliseconds())})
}

func writeProbe(st io.Writer, pr tunnel.ProbeResponse) {
	b, err := json.Marshal(pr)
	if err != nil {
		return
	}
	_ = tunnel.WriteFrame(st, b)
}
