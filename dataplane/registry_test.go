package main

import (
	"testing"

	"github.com/kurtserdar/captivo-access/tunnel"
)

func TestSessionTelemetryAccessor(t *testing.T) {
	s := &Session{}
	if got, _ := s.Telemetry(); got != nil {
		t.Fatalf("expected nil telemetry initially")
	}
	s.SetTelemetry(&tunnel.Telemetry{ActiveConnections: 4})
	got, at := s.Telemetry()
	if got == nil || got.ActiveConnections != 4 {
		t.Fatalf("bad telemetry: %+v", got)
	}
	if at.IsZero() {
		t.Fatalf("expected a non-zero timestamp")
	}
}
