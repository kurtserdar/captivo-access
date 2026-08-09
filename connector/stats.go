package main

import (
	"io"
	"sync/atomic"
	"time"

	"github.com/kurtserdar/captivo-access/tunnel"
)

var startTime = time.Now()

var (
	statActive   int64
	statTotal    int64
	statDenied   int64
	statBytesIn  int64 // upstream -> vendor (written to the tunnel stream)
	statBytesOut int64 // vendor -> upstream (read from the tunnel stream)
)

func connOpen()  { atomic.AddInt64(&statActive, 1); atomic.AddInt64(&statTotal, 1) }
func connClose() { atomic.AddInt64(&statActive, -1) }
func denied()    { atomic.AddInt64(&statDenied, 1) }

func snapshot() tunnel.Telemetry {
	return tunnel.Telemetry{
		Version:           Version,
		UptimeSec:         int64(time.Since(startTime).Seconds()),
		ActiveConnections: int(atomic.LoadInt64(&statActive)),
		TotalConnections:  atomic.LoadInt64(&statTotal),
		DeniedCount:       atomic.LoadInt64(&statDenied),
		BytesIn:           atomic.LoadInt64(&statBytesIn),
		BytesOut:          atomic.LoadInt64(&statBytesOut),
		RecentLogs:        logRingBuf.tail(80),
	}
}

// countingStream wraps a relay stream to tally bytes uniformly across all relay
// kinds. Writes to the stream carry upstream -> vendor data (BytesIn); reads
// carry vendor -> upstream data (BytesOut).
type countingStream struct{ io.ReadWriteCloser }

func (c *countingStream) Read(p []byte) (int, error) {
	n, err := c.ReadWriteCloser.Read(p)
	atomic.AddInt64(&statBytesOut, int64(n))
	return n, err
}
func (c *countingStream) Write(p []byte) (int, error) {
	n, err := c.ReadWriteCloser.Write(p)
	atomic.AddInt64(&statBytesIn, int64(n))
	return n, err
}
