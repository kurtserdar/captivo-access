package main

import (
	"bytes"
	"io"
	"os"
	"strings"
	"time"
)

// guacdLogRing holds the tail of guacd's log (gateway-host connectors only).
// Separate from logRingBuf so the console shows guacd and connector logs apart.
var guacdLogRing = newLogRing(300)

// splitLines splits buf into complete lines (newline-stripped, trailing \r
// trimmed, empty lines dropped) and returns any trailing partial line as the
// remainder to prepend to the next read.
func splitLines(buf []byte) (lines []string, remainder []byte) {
	for {
		i := bytes.IndexByte(buf, '\n')
		if i < 0 {
			return lines, buf
		}
		line := strings.TrimRight(string(buf[:i]), "\r")
		if line != "" {
			lines = append(lines, line)
		}
		buf = buf[i+1:]
	}
}

// tailGuacdLog follows the guacd log file at path, appending new lines to
// guacdLogRing. It handles truncation: `tee` (in the bundled guacd command)
// truncates the file when guacd restarts, so when the file shrinks below the
// read offset the offset is reset to 0. Best-effort — any I/O error just retries
// on the next tick. Runs for the life of the process.
func tailGuacdLog(path string) {
	var offset int64
	var remainder []byte
	for {
		time.Sleep(2 * time.Second)
		fi, err := os.Stat(path)
		if err != nil {
			continue // not present yet
		}
		if fi.Size() < offset {
			offset = 0 // truncated: guacd restarted
			remainder = nil
		}
		if fi.Size() == offset {
			continue // nothing new
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
			guacdLogRing.Write([]byte(line))
		}
	}
}
