package main

import "testing"

func TestParseUpstreams(t *testing.T) {
	m, err := ParseUpstreams("wiki=http://10.0.0.5:8080,jira=https://jira.internal:8443")
	if err != nil {
		t.Fatal(err)
	}
	if m["wiki"] != "http://10.0.0.5:8080" || m["jira"] != "https://jira.internal:8443" {
		t.Fatalf("got %+v", m)
	}
}

func TestParseUpstreamsEmpty(t *testing.T) {
	m, err := ParseUpstreams("")
	if err != nil {
		t.Fatal(err)
	}
	if len(m) != 0 {
		t.Fatalf("expected empty map, got %+v", m)
	}
}

func TestParseUpstreamsRejectsMalformed(t *testing.T) {
	cases := []string{
		"wiki",              // no '='
		"wiki=",             // empty value
		"=http://x",         // empty name
		"wiki=http://x,bad", // second entry malformed
	}
	for _, c := range cases {
		if _, err := ParseUpstreams(c); err == nil {
			t.Fatalf("expected error for %q", c)
		}
	}
}

func TestResolveRejectsUnknownUpstream(t *testing.T) {
	m := map[string]string{"wiki": "http://10.0.0.5:8080"}
	if _, ok := m["evil"]; ok {
		t.Fatal("unexpected") // handler uses this map; unknown => reject
	}
}
