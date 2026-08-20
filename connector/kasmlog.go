package main

import (
	"io"
	"os"
	"time"
)

// kasmLogRing holds the tail of the isolated-browser (KasmVNC) broker log
// (gateway-host connectors only). Separate from guacdLogRing / logRingBuf so the
// console shows each source apart.
var kasmLogRing = newLogRing(300)

// tailKasmLog follows the broker log file at path, appending new lines to
// kasmLogRing. Handles truncation the same way as tailGuacdLog: `tee` truncates the
// file when the kasm container restarts, so a shrink resets the offset to 0.
// Best-effort; runs for the life of the process.
func tailKasmLog(path string) {
	var offset int64
	var remainder []byte
	for {
		time.Sleep(2 * time.Second)
		fi, err := os.Stat(path)
		if err != nil {
			continue
		}
		if fi.Size() < offset {
			offset = 0
			remainder = nil
		}
		if fi.Size() == offset {
			continue
		}
		f, err := os.Open(path)
		if err != nil {
			continue
		}
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			f.Close()
			continue
		}
		buf, err := io.ReadAll(f)
		f.Close()
		if err != nil {
			continue
		}
		offset += int64(len(buf))
		var lines []string
		lines, remainder = splitLines(append(remainder, buf...))
		for _, line := range lines {
			kasmLogRing.Write([]byte(line))
		}
	}
}
