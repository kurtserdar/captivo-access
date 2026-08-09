package main

import (
	"sync/atomic"
	"testing"
)

func TestStatsCounters(t *testing.T) {
	atomic.StoreInt64(&statActive, 0)
	atomic.StoreInt64(&statTotal, 0)
	atomic.StoreInt64(&statDenied, 0)
	connOpen()
	connOpen()
	connClose()
	denied()
	s := snapshot()
	if s.ActiveConnections != 1 || s.TotalConnections != 2 || s.DeniedCount != 1 {
		t.Fatalf("bad snapshot: %+v", s)
	}
}

func TestCountingStreamTallies(t *testing.T) {
	atomic.StoreInt64(&statBytesIn, 0)
	atomic.StoreInt64(&statBytesOut, 0)
	rw := &fakeRWC{}
	cs := &countingStream{ReadWriteCloser: rw}
	_, _ = cs.Write([]byte("hello")) // 5 -> BytesIn
	buf := make([]byte, 3)
	rw.readData = []byte("abc")
	_, _ = cs.Read(buf) // 3 -> BytesOut
	if atomic.LoadInt64(&statBytesIn) != 5 || atomic.LoadInt64(&statBytesOut) != 3 {
		t.Fatalf("in=%d out=%d", statBytesIn, statBytesOut)
	}
}

type fakeRWC struct{ readData []byte }

func (f *fakeRWC) Read(p []byte) (int, error)  { n := copy(p, f.readData); return n, nil }
func (f *fakeRWC) Write(p []byte) (int, error) { return len(p), nil }
func (f *fakeRWC) Close() error                { return nil }
