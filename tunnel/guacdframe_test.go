package tunnel

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestGuacdDialRequestRoundTrip(t *testing.T) {
	in := GuacdDialRequest{Kind: "guacd", Target: "guacd:4822"}
	b, err := json.Marshal(in)
	if err != nil {
		t.Fatal(err)
	}
	var buf bytes.Buffer
	if err := WriteFrame(&buf, b); err != nil {
		t.Fatal(err)
	}
	out, err := ReadFrame(&buf)
	if err != nil {
		t.Fatal(err)
	}
	var got GuacdDialRequest
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	if got.Kind != "guacd" || got.Target != "guacd:4822" {
		t.Fatalf("got %+v", got)
	}
}

func TestGuacdDialResponseErrorOmitempty(t *testing.T) {
	b, _ := json.Marshal(GuacdDialResponse{})
	if string(b) != "{}" {
		t.Fatalf("empty response should omit error, got %s", b)
	}
}
