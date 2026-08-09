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

// connectAndBind reaches the directory through the connector, negotiates TLS
// per the security mode, and binds. On success the caller must close BOTH the
// returned *ldap.Conn and the raw net.Conn. Every failure returns a
// human-readable error (never panics).
func connectAndBind(s *Session, cfg LdapConfig) (*ldap.Conn, net.Conn, error) {
	port := cfg.Port
	if port == 0 {
		port = 389
	}
	raw, err := dialLdap(s, net.JoinHostPort(cfg.Host, fmt.Sprintf("%d", port)))
	if err != nil {
		return nil, nil, err
	}
	tlsCfg := &tls.Config{ServerName: cfg.Host, InsecureSkipVerify: cfg.InsecureSkipVerify}

	var conn *ldap.Conn
	if cfg.Security == "LDAPS" {
		_ = raw.SetDeadline(time.Now().Add(12 * time.Second))
		tconn := tls.Client(raw, tlsCfg)
		if err := tconn.Handshake(); err != nil {
			raw.Close()
			return nil, nil, errors.New("TLS handshake failed: " + err.Error())
		}
		_ = raw.SetDeadline(time.Time{})
		conn = ldap.NewConn(tconn, true)
	} else {
		conn = ldap.NewConn(raw, false)
	}
	conn.Start()
	conn.SetTimeout(12 * time.Second)

	if cfg.Security == "STARTTLS" {
		if err := conn.StartTLS(tlsCfg); err != nil {
			conn.Close()
			raw.Close()
			return nil, nil, errors.New("StartTLS failed: " + err.Error())
		}
	}
	if err := conn.Bind(cfg.BindDN, cfg.BindPassword); err != nil {
		conn.Close()
		raw.Close()
		return nil, nil, errors.New("bind failed: " + err.Error())
	}
	return conn, raw, nil
}

// TestLdap reaches the directory through the connector, binds, and runs a
// bounded base-scope search of baseDN to confirm reachability + credentials.
// It never throws — every failure is a human-readable message in the result.
func TestLdap(s *Session, cfg LdapConfig) LdapTestResult {
	conn, raw, err := connectAndBind(s, cfg)
	if err != nil {
		return LdapTestResult{Error: err.Error()}
	}
	defer conn.Close()
	defer raw.Close()

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

// LdapResolveResult reports a directory lookup by email. A non-empty Error means
// the lookup could not be completed (transport/bind/query) — the caller MUST
// treat that as "unknown" and fail open, never as "user absent".
type LdapResolveResult struct {
	Found       bool     `json:"found"`
	DN          string   `json:"dn,omitempty"`
	MemberOf    []string `json:"memberOf,omitempty"`
	DisplayName string   `json:"displayName,omitempty"`
	Error       string   `json:"error,omitempty"`
}

func entryToResolve(e *ldap.Entry) LdapResolveResult {
	return LdapResolveResult{
		Found:       true,
		DN:          e.DN,
		MemberOf:    e.GetAttributeValues("memberOf"),
		DisplayName: e.GetAttributeValue("displayName"),
	}
}

// ResolveUser binds, then subtree-searches baseDN for (mail=<email>) and returns
// the entry's DN + memberOf group DNs. Zero matches → {Found:false}. Any
// transport/bind/query failure → {Error:...} (caller fails open).
func ResolveUser(s *Session, cfg LdapConfig, email string) LdapResolveResult {
	conn, raw, err := connectAndBind(s, cfg)
	if err != nil {
		return LdapResolveResult{Error: err.Error()}
	}
	defer conn.Close()
	defer raw.Close()

	filter := fmt.Sprintf("(&(objectClass=user)(mail=%s))", ldap.EscapeFilter(email))
	req := ldap.NewSearchRequest(
		cfg.BaseDN, ldap.ScopeWholeSubtree, ldap.NeverDerefAliases, 2, 12, false,
		filter, []string{"memberOf", "displayName", "distinguishedName"}, nil,
	)
	res, err := conn.Search(req)
	if err != nil {
		return LdapResolveResult{Error: "search failed: " + err.Error()}
	}
	if len(res.Entries) == 0 {
		return LdapResolveResult{Found: false}
	}
	return entryToResolve(res.Entries[0])
}
