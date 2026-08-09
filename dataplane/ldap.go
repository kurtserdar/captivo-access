package main

import (
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/go-ldap/ldap/v3"
	"github.com/kurtserdar/captivo-access/tunnel"
)

// LdapConfig is the directory connection the manager asks the data-plane to
// reach through the connector. bindPassword arrives in cleartext over the
// secret-gated, internal-only channel and is never persisted here.
type LdapConfig struct {
	Host               string `json:"host"`
	Port               int    `json:"port"`
	Security           string `json:"security"` // PLAIN | STARTTLS | LDAPS
	InsecureSkipVerify bool   `json:"insecureSkipVerify"`
	BaseDN             string `json:"baseDN"`
	BindDN             string `json:"bindDN"`
	BindPassword       string `json:"bindPassword"`
}

type LdapTestResult struct {
	Ok          bool   `json:"ok"`
	Error       string `json:"error,omitempty"`
	BaseDnFound bool   `json:"baseDnFound"`
}

// dialLdap opens a raw relay stream to the directory host through the connector
// and returns it as a net.Conn. The LDAP protocol (and any TLS) run end-to-end
// over this — the connector is an opaque byte pipe.
func dialLdap(s *Session, target string) (net.Conn, error) {
	if s == nil || s.mux == nil {
		return nil, errors.New("connector offline")
	}
	st, err := s.mux.Open()
	if err != nil {
		return nil, err
	}
	reqBytes, err := json.Marshal(tunnel.LdapDialRequest{Kind: "ldap", Target: target})
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
	var resp tunnel.LdapDialResponse
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

// TestLdap reaches the directory through the connector, negotiates TLS per the
// security mode, binds, and runs a bounded base-scope search of baseDN to
// confirm reachability + credentials. It never throws — every failure is a
// human-readable message in the result.
func TestLdap(s *Session, cfg LdapConfig) LdapTestResult {
	port := cfg.Port
	if port == 0 {
		port = 389
	}
	raw, err := dialLdap(s, net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", port)))
	if err != nil {
		return LdapTestResult{Error: err.Error()}
	}
	defer raw.Close()

	tlsCfg := &tls.Config{ServerName: cfg.Host, InsecureSkipVerify: cfg.InsecureSkipVerify}

	var conn *ldap.Conn
	if cfg.Security == "LDAPS" {
		_ = raw.SetDeadline(time.Now().Add(12 * time.Second))
		tconn := tls.Client(raw, tlsCfg)
		if err := tconn.Handshake(); err != nil {
			return LdapTestResult{Error: "TLS handshake failed: " + err.Error()}
		}
		_ = raw.SetDeadline(time.Time{}) // go-ldap manages per-request deadlines below
		conn = ldap.NewConn(tconn, true)
	} else {
		conn = ldap.NewConn(raw, false)
	}
	conn.Start()
	defer conn.Close()
	conn.SetTimeout(12 * time.Second)

	if cfg.Security == "STARTTLS" {
		if err := conn.StartTLS(tlsCfg); err != nil {
			return LdapTestResult{Error: "StartTLS failed: " + err.Error()}
		}
	}

	if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
		return LdapTestResult{Error: "bind failed: " + err.Error()}
	}

	req := ldap.NewSearchRequest(
		cfg.BaseDN, ldap.ScopeBaseObject, ldap.NeverDerefAliases, 1, 10, false,
		"(objectClass=*)", []string{"dn"}, nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		return LdapTestResult{Ok: true, Error: "bound OK, but the base DN search failed: " + err.Error()}
	}
	return LdapTestResult{Ok: true, BaseDnFound: len(res.Entries) > 0}
}
