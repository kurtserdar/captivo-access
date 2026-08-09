package main

import (
	"sync/atomic"

	"github.com/kurtserdar/captivo-access/tunnel"
)

// policyMatcher holds the console-pushed egress narrowing. Initialised to an
// empty (allow-all) matcher so nothing is narrowed until a policy arrives.
var policyMatcher atomic.Pointer[TargetMatcher]

func init() {
	m, _ := ParseAllowedTargets("") // open=true, allows everything
	policyMatcher.Store(m)
}

// applyPolicy parses a pushed policy into the narrowing matcher. On a parse error
// it keeps the previous matcher (fail-safe: never loosen on bad input).
func applyPolicy(p tunnel.Policy) {
	m, err := ParseAllowedTargets(p.EgressAllowedTargets)
	if err != nil {
		return
	}
	policyMatcher.Store(m)
}

func policyAllowed(authority string) bool {
	m := policyMatcher.Load()
	return m == nil || m.Allowed(authority)
}

// egressAllowed is the effective boundary: the local env ceiling AND the console
// policy. Never widens past the env.
func egressAllowed(allow *TargetMatcher, authority string) bool {
	return allow.Allowed(authority) && policyAllowed(authority)
}
