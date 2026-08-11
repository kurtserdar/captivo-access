package main

import (
	"encoding/json"
	"errors"
	"net"

	"github.com/kurtserdar/captivo-access/tunnel"
)

// dialGuacd opens a raw relay stream to guacd through the connector and returns
// it as a net.Conn. The Guacamole protocol runs end-to-end over this — the
// connector is an opaque byte pipe. Mirrors dialLdap.
func dialGuacd(s *Session, target string) (net.Conn, error) {
	if s == nil || s.mux == nil {
		return nil, errors.New("connector offline")
	}
	st, err := s.mux.Open()
	if err != nil {
		return nil, err
	}
	reqBytes, err := json.Marshal(tunnel.GuacdDialRequest{Kind: "guacd", Target: target})
	if err != nil {
		st.Close()
		return nil, err
	}
	if err := tunnel.WriteFrame(st, reqBytes); err != nil {
		st.Close()
		return nil, err
	}
	respBytes, err := tunnel.ReadFrame(st)
	if err != nil {
		st.Close()
		return nil, err
	}
	var resp tunnel.GuacdDialResponse
	if err := json.Unmarshal(respBytes, &resp); err != nil {
		st.Close()
		return nil, err
	}
	if resp.Error != "" {
		st.Close()
		return nil, errors.New(resp.Error)
	}
	return st, nil // yamux.Stream satisfies net.Conn
}
