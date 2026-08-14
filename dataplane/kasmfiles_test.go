package main

import "testing"

func TestFileTransferAllows(t *testing.T) {
	cases := []struct {
		mode           string
		wantUp, wantDn bool
	}{
		{"allow", true, true},
		{"no_upload", false, true},
		{"no_download", true, false},
		{"none", false, false},
		{"", false, false},
		{"bogus", false, false},
	}
	for _, c := range cases {
		up, dn := fileTransferAllows(c.mode)
		if up != c.wantUp || dn != c.wantDn {
			t.Errorf("mode %q: got (%v,%v) want (%v,%v)", c.mode, up, dn, c.wantUp, c.wantDn)
		}
	}
}
