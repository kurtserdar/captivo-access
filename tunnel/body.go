package tunnel

import (
	"encoding/binary"
	"errors"
	"io"
)

const chunkSize = 32 << 10
const maxChunk = 1 << 20

// WriteBody streams r as length-prefixed chunks terminated by a zero-length
// chunk.
func WriteBody(w io.Writer, r io.Reader) error {
	buf := make([]byte, chunkSize)
	for {
		n, err := r.Read(buf)
		if n > 0 {
			var hdr [4]byte
			binary.BigEndian.PutUint32(hdr[:], uint32(n))
			if _, e := w.Write(hdr[:]); e != nil {
				return e
			}
			if _, e := w.Write(buf[:n]); e != nil {
				return e
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
	}
	var zero [4]byte // 0-length terminator
	_, err := w.Write(zero[:])
	return err
}

type bodyReader struct {
	r         io.Reader
	remaining uint32
	done      bool
}

// NewBodyReader reads chunks written by WriteBody until the zero terminator.
func NewBodyReader(r io.Reader) io.Reader { return &bodyReader{r: r} }

func (b *bodyReader) Read(p []byte) (int, error) {
	if b.done {
		return 0, io.EOF
	}
	if b.remaining == 0 {
		var hdr [4]byte
		if _, err := io.ReadFull(b.r, hdr[:]); err != nil {
			return 0, err
		}
		n := binary.BigEndian.Uint32(hdr[:])
		if n == 0 {
			b.done = true
			return 0, io.EOF
		}
		if n > maxChunk {
			return 0, errors.New("chunk too large")
		}
		b.remaining = n
	}
	if uint32(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, err := b.r.Read(p)
	b.remaining -= uint32(n)
	return n, err
}
