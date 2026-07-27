package main

import (
	"encoding/json"
	"errors"
	"io"

	"github.com/kurtserdar/captivo-access/tunnel"
)

// maxProxyBody caps how much of the upstream response body we buffer in
// memory for the control plane's /proxy response (64 KiB).
const maxProxyBody = 64 << 10

// ProxyResult is the outcome of round-tripping a DialRequest through a
// connector's yamux session.
type ProxyResult struct {
	Status    int
	Header    map[string][]string
	Body      []byte // up to maxProxyBody bytes
	Truncated bool
}

// Proxy opens a new yamux stream on the connector's session, sends the
// DialRequest control frame, reads back the DialResponse control frame and
// up to maxProxyBody bytes of body.
func Proxy(s *Session, dr tunnel.DialRequest) (*ProxyResult, error) {
	if s == nil || s.mux == nil {
		return nil, errors.New("connector offline")
	}
	st, err := s.mux.Open()
	if err != nil {
		return nil, err
	}
	defer st.Close()

	reqBytes, err := json.Marshal(dr)
	if err != nil {
		return nil, err
	}
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		return nil, err
	}

	respBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		return nil, err
	}
	var resp tunnel.DialResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		return nil, err
	}
	if resp.Error != "" {
		return nil, errors.New(resp.Error)
	}

	body, err := io.ReadAll(io.LimitReader(st, maxProxyBody+1))
	if err != nil {
		return nil, err
	}
	truncated := len(body) > maxProxyBody
	if truncated {
		body = body[:maxProxyBody]
	}

	return &ProxyResult{Status: resp.Status, Header: resp.Header, Body: body, Truncated: truncated}, nil
}
