package main

import (
	"strconv"
	"testing"
	"time"
)

func fixedObs() *ftObserver {
	o := newFTObserver("u1", "s1", "10.0.0.5", "203.0.113.7", "Mozilla/5.0")
	o.now = func() time.Time { return time.Date(2026, 8, 13, 12, 0, 0, 0, time.UTC) }
	return o
}

func TestObserveDownloadFileComplete(t *testing.T) {
	o := fixedObs()
	// file,<idx>,<mime>,<name>
	if evs := o.observe(dirDownload, encodeInstruction("file", "3", "application/pdf", "report.pdf")); len(evs) != 0 {
		t.Fatalf("file open should not emit, got %d", len(evs))
	}
	// base64("hi") = "aGk=" -> 2 bytes
	o.observe(dirDownload, encodeInstruction("blob", "3", "aGk="))
	evs := o.observe(dirDownload, encodeInstruction("end", "3"))
	if len(evs) != 1 {
		t.Fatalf("end should emit 1 event, got %d", len(evs))
	}
	e := evs[0]
	if e.Method != verbDownload || e.Path != "/report.pdf" || e.BytesOut != 2 ||
		e.Status != 200 || e.Decision != "ALLOW" || e.Reason != "file:application/pdf" ||
		e.UserID != "u1" || e.SiteID != "s1" || e.Host != "10.0.0.5" ||
		e.ClientIP != "203.0.113.7" || e.UserAgent != "Mozilla/5.0" {
		t.Fatalf("unexpected event: %+v", e)
	}
}

func TestObserveUploadPutComplete(t *testing.T) {
	o := fixedObs()
	// put,<fsIdx>,<idx>,<mime>,<name>  (upload into a filesystem)
	o.observe(dirUpload, encodeInstruction("put", "0", "7", "text/plain", "notes.txt"))
	o.observe(dirUpload, encodeInstruction("blob", "7", "YWJj")) // base64("abc") = 3 bytes
	evs := o.observe(dirUpload, encodeInstruction("end", "7"))
	if len(evs) != 1 || evs[0].Method != verbUpload || evs[0].Path != "/notes.txt" || evs[0].BytesOut != 3 {
		t.Fatalf("unexpected upload event: %+v", evs)
	}
}

func TestObserveBodyDownload(t *testing.T) {
	o := fixedObs()
	// body,<fsIdx>,<idx>,<mime>,<name>  (download out of a filesystem)
	o.observe(dirDownload, encodeInstruction("body", "0", "9", "image/png", "logo.png"))
	o.observe(dirDownload, encodeInstruction("blob", "9", "YQ==")) // base64("a") = 1 byte
	evs := o.observe(dirDownload, encodeInstruction("end", "9"))
	if len(evs) != 1 || evs[0].Method != verbDownload || evs[0].Path != "/logo.png" || evs[0].BytesOut != 1 {
		t.Fatalf("unexpected body event: %+v", evs)
	}
}

func TestObservePartialFlush(t *testing.T) {
	o := fixedObs()
	o.observe(dirDownload, encodeInstruction("file", "1", "application/zip", "big.zip"))
	o.observe(dirDownload, encodeInstruction("blob", "1", "YWJj")) // 3 bytes, no end
	evs := o.flush()
	if len(evs) != 1 || evs[0].Method != verbDownloadPartial || evs[0].Status != 499 ||
		evs[0].BytesOut != 3 || evs[0].Reason != "file-transfer-aborted" {
		t.Fatalf("unexpected partial event: %+v", evs)
	}
	// flush is idempotent: streams were consumed
	if evs2 := o.flush(); len(evs2) != 0 {
		t.Fatalf("second flush should be empty, got %d", len(evs2))
	}
}

func TestObserveInterleavedStreams(t *testing.T) {
	o := fixedObs()
	o.observe(dirDownload, encodeInstruction("file", "1", "text/plain", "a.txt"))
	o.observe(dirDownload, encodeInstruction("file", "2", "text/plain", "b.txt"))
	o.observe(dirDownload, encodeInstruction("blob", "1", "YWJj")) // a.txt += 3
	o.observe(dirDownload, encodeInstruction("blob", "2", "YWk=")) // base64("ai") = 2
	e1 := o.observe(dirDownload, encodeInstruction("end", "1"))
	e2 := o.observe(dirDownload, encodeInstruction("end", "2"))
	if len(e1) != 1 || e1[0].Path != "/a.txt" || e1[0].BytesOut != 3 {
		t.Fatalf("stream 1 wrong: %+v", e1)
	}
	if len(e2) != 1 || e2[0].Path != "/b.txt" || e2[0].BytesOut != 2 {
		t.Fatalf("stream 2 wrong: %+v", e2)
	}
}

func TestObserveSameIndexDifferentDirection(t *testing.T) {
	o := fixedObs()
	// same stream index 5 on both directions must be independent
	o.observe(dirDownload, encodeInstruction("file", "5", "text/plain", "down.txt"))
	o.observe(dirUpload, encodeInstruction("file", "5", "text/plain", "up.txt"))
	d := o.observe(dirDownload, encodeInstruction("end", "5"))
	u := o.observe(dirUpload, encodeInstruction("end", "5"))
	if len(d) != 1 || d[0].Method != verbDownload || d[0].Path != "/down.txt" {
		t.Fatalf("download side wrong: %+v", d)
	}
	if len(u) != 1 || u[0].Method != verbUpload || u[0].Path != "/up.txt" {
		t.Fatalf("upload side wrong: %+v", u)
	}
}

func TestObserveIgnoresNonTransferOpcodes(t *testing.T) {
	o := fixedObs()
	if evs := o.observe(dirUpload, encodeInstruction("mouse", "640", "480", "1")); len(evs) != 0 {
		t.Fatalf("mouse should emit nothing, got %d", len(evs))
	}
	if evs := o.observe(dirDownload, encodeInstruction("sync", "12345")); len(evs) != 0 {
		t.Fatalf("sync should emit nothing, got %d", len(evs))
	}
	// unknown/duplicate end for an untracked stream is a no-op
	if evs := o.observe(dirDownload, encodeInstruction("end", "99")); len(evs) != 0 {
		t.Fatalf("unknown end should emit nothing, got %d", len(evs))
	}
}

func TestObserveMultipleInstructionsInOneMessage(t *testing.T) {
	o := fixedObs()
	// browser->guacd frames can concatenate instructions in one WS message
	msg := append(encodeInstruction("file", "4", "text/plain", "c.txt"), encodeInstruction("blob", "4", "YWJj")...)
	msg = append(msg, encodeInstruction("end", "4")...)
	evs := o.observe(dirUpload, msg)
	if len(evs) != 1 || evs[0].Path != "/c.txt" || evs[0].BytesOut != 3 {
		t.Fatalf("concatenated message wrong: %+v", evs)
	}
}

func TestObserveStreamCap(t *testing.T) {
	o := fixedObs()
	for i := 0; i < maxOpenStreams+50; i++ {
		o.observe(dirDownload, encodeInstruction("file", itoa(i), "text/plain", "f.txt"))
	}
	if got := len(o.streams); got != maxOpenStreams {
		t.Fatalf("expected cap %d open streams, got %d", maxOpenStreams, got)
	}
}

func TestB64DecodedLen(t *testing.T) {
	cases := map[string]int64{"": 0, "YWJj": 3, "aGk=": 2, "YQ==": 1, "YWk=": 2}
	for in, want := range cases {
		if got := b64DecodedLen(in); got != want {
			t.Fatalf("b64DecodedLen(%q) = %d, want %d", in, got, want)
		}
	}
}

func itoa(i int) string { return strconv.Itoa(i) }
