package tunnel

import (
	"bytes"
	"testing"
)

func TestFrameRoundTrip(t *testing.T) {
	var buf bytes.Buffer
	msg := []byte(`{"upstreamName":"wiki"}`)
	if err := WriteFrame(&buf, msg); err != nil {
		t.Fatal(err)
	}
	got, err := ReadFrame(&buf)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(msg) {
		t.Fatalf("got %q want %q", got, msg)
	}
}

func TestReadFrameRejectsOversize(t *testing.T) {
	// length prefix claims 2 MiB — must be rejected before allocation
	buf := bytes.NewBuffer([]byte{0x00, 0x20, 0x00, 0x00})
	if _, err := ReadFrame(buf); err == nil {
		t.Fatal("expected oversize error")
	}
}
