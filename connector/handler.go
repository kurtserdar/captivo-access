package main

import (
	"bufio"
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

// resolveUpstreamTarget validates a tunnel upstream URL + path against the
// egress boundary (allow) and the host-confusion rules, returning the resolved
// target URL and the base URL, or a non-empty errMsg. Shared by handleDial and
// handleWS so the connector's core security boundary lives in exactly one place.
func resolveUpstreamTarget(upstreamURL, path string, allow *TargetMatcher) (target, base *url.URL, errMsg string) {
	base, err := url.Parse(upstreamURL)
	if err != nil || (base.Scheme != "http" && base.Scheme != "https") || base.Hostname() == "" {
		return nil, nil, "bad upstream url"
	}
	if !allow.Allowed(base.Host) {
		return nil, nil, "target not allowed" // egress boundary — fail closed
	}
	if !strings.HasPrefix(path, "/") {
		return nil, nil, "invalid path"
	}
	ref, err := url.Parse(path)
	if err != nil || ref.IsAbs() || ref.Host != "" {
		return nil, nil, "invalid path"
	}
	target = base.ResolveReference(ref)
	if target.Scheme != base.Scheme || target.Host != base.Host {
		return nil, nil, "invalid path"
	}
	return target, base, ""
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
	if peek.Kind == "ws" {
		handleWS(st, allow, reqBytes)
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

	target, _, errMsg := resolveUpstreamTarget(dr.UpstreamUrl, dr.Path, allow)
	if errMsg != "" {
		writeErr(st, errMsg)
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

// handleWS services a WebSocket-passthrough stream: it validates the upstream
// against the SAME egress boundary as handleDial, raw-dials it (TLS for https,
// honoring the per-Site InsecureSkipVerify), replays the browser's upgrade
// request, reads the upstream handshake response, and — on a 101 — relays raw
// bytes in both directions between the tunnel stream and the upstream socket.
// The WS body is never HTTP-body-framed; it is a transparent byte pipe, so any
// subprotocol/extension passes through untouched.
func handleWS(st io.ReadWriteCloser, allow *TargetMatcher, reqBytes []byte) {
	var wr tunnel.WsDialRequest
	if json.Unmarshal(reqBytes, &wr) != nil {
		return
	}
	target, base, errMsg := resolveUpstreamTarget(wr.UpstreamUrl, wr.Path, allow)
	if errMsg != "" {
		writeWsErr(st, errMsg)
		return
	}

	// Validate headers for CR/LF injection before dialing. The connector is the
	// security boundary — don't rely on the data-plane to sanitize headers.
	for k, vs := range wr.Header {
		if strings.ContainsAny(k, "\r\n") {
			writeWsErr(st, "invalid header")
			return
		}
		for _, v := range vs {
			if strings.ContainsAny(v, "\r\n") {
				writeWsErr(st, "invalid header")
				return
			}
		}
	}

	hostPort := base.Host
	if base.Port() == "" {
		if base.Scheme == "https" {
			hostPort = net.JoinHostPort(base.Hostname(), "443")
		} else {
			hostPort = net.JoinHostPort(base.Hostname(), "80")
		}
	}
	var upstream net.Conn
	var err error
	if base.Scheme == "https" {
		upstream, err = tls.DialWithDialer(&net.Dialer{Timeout: 10 * time.Second}, "tcp", hostPort,
			&tls.Config{InsecureSkipVerify: wr.InsecureSkipVerify, ServerName: base.Hostname()})
	} else {
		upstream, err = net.DialTimeout("tcp", hostPort, 10*time.Second)
	}
	if err != nil {
		writeWsErr(st, "upstream unreachable")
		return
	}
	defer upstream.Close()

	// Set a read deadline for the handshake phase only. A slow/malicious
	// upstream that accepts then stalls would hang the goroutine forever.
	// The deadline is cleared after the handshake so the long-lived WS relay
	// stays unbounded.
	upstream.SetReadDeadline(time.Now().Add(10 * time.Second))

	// Replay the upgrade request to the upstream. target.RequestURI() carries
	// the validated, host-less path+query.
	var b strings.Builder
	b.WriteString("GET " + target.RequestURI() + " HTTP/1.1\r\n")
	b.WriteString("Host: " + base.Host + "\r\n")
	for k, vs := range wr.Header {
		if strings.EqualFold(k, "Host") {
			continue
		}
		for _, v := range vs {
			b.WriteString(k + ": " + v + "\r\n")
		}
	}
	b.WriteString("\r\n")
	if _, err := io.WriteString(upstream, b.String()); err != nil {
		writeWsErr(st, "upstream write failed")
		return
	}

	// Read the upstream handshake head manually (status line + headers up to a
	// blank line). Manual parsing keeps the relay transparent — no http.Client
	// body-framing semantics on the 101 — and any bytes the upstream already
	// sent past the header terminator stay buffered in br for the relay.
	br := bufio.NewReader(upstream)
	statusLine, err := br.ReadString('\n')
	if err != nil {
		writeWsErr(st, "upstream handshake failed")
		return
	}
	status := 0
	if parts := strings.SplitN(strings.TrimSpace(statusLine), " ", 3); len(parts) >= 2 {
		status, _ = strconv.Atoi(parts[1])
	}
	header := map[string][]string{}
	for {
		line, err := br.ReadString('\n')
		if err != nil {
			writeWsErr(st, "upstream handshake failed")
			return
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		if i := strings.IndexByte(line, ':'); i >= 0 {
			k := strings.TrimSpace(line[:i])
			v := strings.TrimSpace(line[i+1:])
			header[k] = append(header[k], v)
		}
	}

	respMeta, err := json.Marshal(tunnel.WsDialResponse{Status: status, Header: header})
	if err != nil {
		return
	}
	if tunnel.WriteFrame(st, respMeta) != nil {
		return
	}
	if status != 101 {
		return // upstream declined the upgrade; data-plane surfaces the failure
	}

	// Clear the handshake read deadline. The long-lived WS relay must stay
	// unbounded — no timeouts on the bidirectional byte relay.
	upstream.SetReadDeadline(time.Time{})

	// Raw bidirectional relay. Read the upstream side from br (it holds any
	// post-handshake bytes already buffered). When either direction ends, close
	// both conns so the other io.Copy unblocks.
	done := make(chan struct{}, 2)
	go func() { _, _ = io.Copy(st, br); done <- struct{}{} }()       // upstream → tunnel
	go func() { _, _ = io.Copy(upstream, st); done <- struct{}{} }() // tunnel → upstream
	<-done
	_ = upstream.Close()
	_ = st.Close()
	<-done
}

func writeWsErr(st io.Writer, msg string) {
	b, err := json.Marshal(tunnel.WsDialResponse{Status: 0, Error: msg})
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
