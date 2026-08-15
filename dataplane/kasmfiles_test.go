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

func TestSafeSeg(t *testing.T) {
	cases := []struct{ in, want string }{
		{"report.pdf", "report.pdf"},
		{"/a/b/report.pdf", "report.pdf"},
		{`c:\x\y.txt`, "y.txt"},
		{"  spaced.txt  ", "spaced.txt"},
		{".", ""},
		{"..", ""},
		{"", ""},
		{"foo\r\nX-Evil: 1", ""}, // CRLF header injection attempt -> rejected
		{"foo\tbar.txt", ""},     // any control char -> rejected
		{"a\x7fb", ""},           // DEL -> rejected
	}
	for _, c := range cases {
		if got := _safeSeg(c.in); got != c.want {
			t.Errorf("_safeSeg(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}
