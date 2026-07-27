package main

import (
	"encoding/json"
	"io"
	"net/http"
	"time"

	"github.com/hashicorp/yamux"
	"github.com/kurtserdar/captivo-access/tunnel"
)

// serveStreams accepts streams opened by the data-plane over mux and handles
// each one independently until the session dies.
func serveStreams(mux *yamux.Session, upstreams map[string]string) {
	for {
		st, err := mux.Accept()
		if err != nil {
			return
		}
		go handleStream(st, upstreams)
	}
}

// handleStream services a single proxied HTTP request. The first frame on
// the stream is a tunnel.DialRequest naming an upstream by its local alias;
// handleStream resolves that alias against the connector's own allowlist
// (upstreams) and NEVER dials a host supplied by the caller directly. If the
// name isn't in the allowlist, the stream is rejected with a DialResponse
// error and closed — this is the connector's core security boundary.
func handleStream(st io.ReadWriteCloser, upstreams map[string]string) {
	defer st.Close()

	reqBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		return
	}
	var dr tunnel.DialRequest
	if json.Unmarshal(reqBytes, &dr) != nil {
		return
	}

	base, ok := upstreams[dr.UpstreamName]
	if !ok {
		writeErr(st, "unknown upstream") // LOCAL ALLOWLIST enforcement — fail closed
		return
	}

	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest(orGet(dr.Method), base+dr.Path, nil)
	if err != nil {
		writeErr(st, "bad request")
		return
	}
	for k, vs := range dr.Header {
		for _, v := range vs {
			req.Header.Add(k, v)
		}
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
	_, _ = io.Copy(st, resp.Body)
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
