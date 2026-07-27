package tunnel

import (
	"time"

	"github.com/hashicorp/yamux"
)

// SessionConfig returns the shared yamux config used by both ends of the
// connector tunnel (data-plane and connector).
func SessionConfig() *yamux.Config {
	c := yamux.DefaultConfig()
	c.KeepAliveInterval = 15 * time.Second
	c.ConnectionWriteTimeout = 10 * time.Second
	c.EnableKeepAlive = true
	return c
}
