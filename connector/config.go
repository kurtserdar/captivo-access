package main

import (
	"net"
	"strings"
)

// TargetMatcher is the connector's optional egress boundary. When ALLOWED_TARGETS
// is empty the connector is "open" and dials whatever target the Manager sends;
// when set, only targets inside the declared CIDRs / hosts / host:ports are dialed,
// capping the blast radius of a compromised control plane.
type TargetMatcher struct {
	open      bool
	cidrs     []*net.IPNet
	hosts     map[string]bool // bare host, matches any port
	hostPorts map[string]bool // exact host:port
}

// ParseAllowedTargets parses the ALLOWED_TARGETS env ("cidr,host,host:port,...").
// An empty value yields an open matcher (no boundary).
func ParseAllowedTargets(s string) (*TargetMatcher, error) {
	m := &TargetMatcher{hosts: map[string]bool{}, hostPorts: map[string]bool{}}
	if strings.TrimSpace(s) == "" {
		m.open = true
		return m, nil
	}
	for _, e := range strings.Split(s, ",") {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if _, ipnet, err := net.ParseCIDR(e); err == nil {
			m.cidrs = append(m.cidrs, ipnet)
			continue
		}
		if _, _, err := net.SplitHostPort(e); err == nil {
			m.hostPorts[e] = true
		} else {
			m.hosts[e] = true
		}
	}
	return m, nil
}

// Allowed reports whether a target authority ("host" or "host:port") is within
// the boundary. An open matcher allows everything.
func (m *TargetMatcher) Allowed(authority string) bool {
	if m.open {
		return true
	}
	host, port, err := net.SplitHostPort(authority)
	if err != nil {
		host, port = authority, ""
	}
	if m.hosts[host] {
		return true
	}
	if port != "" && m.hostPorts[host+":"+port] {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		for _, c := range m.cidrs {
			if c.Contains(ip) {
				return true
			}
		}
	}
	return false
}
