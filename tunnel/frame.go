package tunnel

import (
	"encoding/binary"
	"errors"
	"io"
)

const maxFrame = 1 << 20 // 1 MiB control frame cap

// WriteFrame writes payload as a length-prefixed frame (uint32 big-endian
// length header followed by the raw bytes).
func WriteFrame(w io.Writer, payload []byte) error {
	if len(payload) > maxFrame {
		return errors.New("frame too large")
	}
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], uint32(len(payload)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err := w.Write(payload)
	return err
}

// ReadFrame reads one length-prefixed frame written by WriteFrame. It
// rejects frames whose declared length exceeds maxFrame before allocating
// a buffer for the payload.
func ReadFrame(r io.Reader) ([]byte, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n > maxFrame {
		return nil, errors.New("frame too large")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	return buf, nil
}
