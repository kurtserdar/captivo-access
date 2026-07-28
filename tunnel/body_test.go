package tunnel

import (
	"bytes"
	"encoding/binary"
	"io"
	"strings"
	"testing"
)

func TestBodyRoundTrip(t *testing.T) {
	for _, in := range []string{"", "hello world", strings.Repeat("x", 70000)} {
		var buf bytes.Buffer
		if err := WriteBody(&buf, strings.NewReader(in)); err != nil {
			t.Fatal(err)
		}
		got, err := io.ReadAll(NewBodyReader(&buf))
		if err != nil {
			t.Fatal(err)
		}
		if string(got) != in {
			t.Fatalf("len(got)=%d want %d", len(got), len(in))
		}
	}
}

// TestBodyReaderRejectsOversizeChunk proves NewBodyReader refuses to trust a
// declared chunk length above maxChunk (1 MiB), which guards against a
// malicious or buggy peer trying to make the reader allocate/read an
// unbounded amount of data from a single chunk header.
func TestBodyReaderRejectsOversizeChunk(t *testing.T) {
	var buf bytes.Buffer
	var hdr [4]byte
	// maxChunk+1 encoded as a big-endian uint32 chunk length header, with no
	// payload following — the reader must reject based on the header alone.
	bad := uint32(maxChunk + 1)
	binary.BigEndian.PutUint32(hdr[:], bad)
	buf.Write(hdr[:])

	_, err := io.ReadAll(NewBodyReader(&buf))
	if err == nil {
		t.Fatal("expected error for oversize chunk header, got nil")
	}
}
