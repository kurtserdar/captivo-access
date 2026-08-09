package tunnel

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestTelemetryRoundTrip(t *testing.T) {
	in := Telemetry{Version: "1.2.3", UptimeSec: 42, ActiveConnections: 3, TotalConnections: 10, DeniedCount: 2, BytesIn: 1000, BytesOut: 500, RecentLogs: []string{"a", "b"}}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var out Telemetry
	if err := json.Unmarshal(b, &out); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(out, in) {
		t.Fatalf("round-trip mismatch: %+v != %+v", out, in)
	}
}

func TestControlHelloKind(t *testing.T) {
	b, _ := json.Marshal(ControlHello{Kind: "control"})
	var peek struct {
		Kind string `json:"kind"`
	}
	_ = json.Unmarshal(b, &peek)
	if peek.Kind != "control" {
		t.Fatalf("kind mismatch: %q", peek.Kind)
	}
}
