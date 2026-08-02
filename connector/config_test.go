package main

import "testing"

func TestAllowedTargets(t *testing.T) {
	open, _ := ParseAllowedTargets("")
	if !open.Allowed("10.0.0.9:8080") {
		t.Fatal("empty boundary must allow everything")
	}

	m, err := ParseAllowedTargets("10.0.5.0/24, jira.internal, 192.168.1.50:8080")
	if err != nil {
		t.Fatal(err)
	}
	cases := []struct {
		hostport string
		want     bool
	}{
		{"10.0.5.20:8080", true},     // in CIDR (port ignored for CIDR)
		{"10.0.6.20:8080", false},    // outside CIDR
		{"jira.internal", true},      // bare host match
		{"jira.internal:80", true},   // bare-host entry matches any port
		{"wiki.internal", false},     // host not listed
		{"192.168.1.50:8080", true},  // exact host:port
		{"192.168.1.50:9090", false}, // right host, wrong port
	}
	for _, c := range cases {
		if got := m.Allowed(c.hostport); got != c.want {
			t.Errorf("Allowed(%q) = %v, want %v", c.hostport, got, c.want)
		}
	}
}
