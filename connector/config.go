package main

import (
	"errors"
	"strings"
)

// ParseUpstreams parses the UPSTREAMS env value ("name=url,name=url") into a
// local allowlist map. This map is the connector's only source of truth for
// which internal hosts it will dial — the data-plane/Manager never send a
// host, only a name, and an unrecognized name must be rejected by the caller.
func ParseUpstreams(s string) (map[string]string, error) {
	m := map[string]string{}
	if strings.TrimSpace(s) == "" {
		return m, nil
	}
	for _, pair := range strings.Split(s, ",") {
		kv := strings.SplitN(strings.TrimSpace(pair), "=", 2)
		if len(kv) != 2 || kv[0] == "" || kv[1] == "" {
			return nil, errors.New("bad upstream entry: " + pair)
		}
		m[kv[0]] = kv[1]
	}
	return m, nil
}
