package tunnel

import (
	"bytes"
	"encoding/json"
	"testing"
)

func TestWsDialRequestRoundTrip(t *testing.T) {
	in := WsDialRequest{
		Kind: "ws", UpstreamUrl: "https://10.0.0.5:8006", Path: "/api2/json/nodes/pve/qemu/100/vncwebsocket?port=5900",
		Header: map[string][]string{"Upgrade": {"websocket"}, "Connection": {"Upgrade"}}, InsecureSkipVerify: true,
	}
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
	var got WsDialRequest
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatal(err)
	}
	if got.Kind != "ws" || got.UpstreamUrl != in.UpstreamUrl || got.Path != in.Path || !got.InsecureSkipVerify {
		t.Fatalf("round-trip mismatch: %+v", got)
	}
	if got.Header["Upgrade"][0] != "websocket" {
		t.Fatalf("header lost: %+v", got.Header)
	}
}

func TestWsDialResponseRoundTrip(t *testing.T) {
	in := WsDialResponse{Status: 101, Header: map[string][]string{"Sec-Websocket-Accept": {"abc="}}}
	b, _ := json.Marshal(in)
	var got WsDialResponse
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatal(err)
	}
	if got.Status != 101 || got.Header["Sec-Websocket-Accept"][0] != "abc=" {
		t.Fatalf("mismatch: %+v", got)
	}
}
