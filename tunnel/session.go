package tunnel

import (
	"os"
	"strconv"
	"time"

	"github.com/hashicorp/yamux"
)

// writeTimeoutSecs is the yamux ConnectionWriteTimeout in seconds: how long a single
// write (including a keepalive ping) may take before yamux tears the whole tunnel
// down. The old fixed 10s was too aggressive — a brief network stall on the
// connector's outbound uplink killed long-lived RDP/SSH sessions. Default 30s
// tolerates transient blips; env TUNNEL_WRITE_TIMEOUT_SECS overrides. Values below
// the 5s floor (or unset/invalid) fall back to the default to avoid re-introducing
// the fragility.
func writeTimeoutSecs() int {
	if v, err := strconv.Atoi(os.Getenv("TUNNEL_WRITE_TIMEOUT_SECS")); err == nil && v >= 5 {
		return v
	}
	return 30
}

// SessionConfig returns the shared yamux config used by both ends of the
// connector tunnel (data-plane and connector).
func SessionConfig() *yamux.Config {
	c := yamux.DefaultConfig()
	c.KeepAliveInterval = 15 * time.Second
	c.ConnectionWriteTimeout = time.Duration(writeTimeoutSecs()) * time.Second
	c.EnableKeepAlive = true
	return c
}
