package tunnel

import (
	"os"
	"testing"
	"time"
)

func TestWriteTimeoutDefault(t *testing.T) {
	os.Unsetenv("TUNNEL_WRITE_TIMEOUT_SECS")
	if got := SessionConfig().ConnectionWriteTimeout; got != 30*time.Second {
		t.Fatalf("default write timeout = %v, want 30s", got)
	}
}

func TestWriteTimeoutEnvOverride(t *testing.T) {
	os.Setenv("TUNNEL_WRITE_TIMEOUT_SECS", "45")
	defer os.Unsetenv("TUNNEL_WRITE_TIMEOUT_SECS")
	if got := SessionConfig().ConnectionWriteTimeout; got != 45*time.Second {
		t.Fatalf("env override = %v, want 45s", got)
	}
}

func TestWriteTimeoutFloor(t *testing.T) {
	os.Setenv("TUNNEL_WRITE_TIMEOUT_SECS", "2") // below the 5s floor -> default
	defer os.Unsetenv("TUNNEL_WRITE_TIMEOUT_SECS")
	if got := SessionConfig().ConnectionWriteTimeout; got != 30*time.Second {
		t.Fatalf("sub-floor timeout = %v, want default 30s", got)
	}
}

func TestKeepAliveIntervalUnchanged(t *testing.T) {
	if got := SessionConfig().KeepAliveInterval; got != 15*time.Second {
		t.Fatalf("keepalive interval = %v, want 15s", got)
	}
}
