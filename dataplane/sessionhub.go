package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net"
	"sync"
	"time"
)

var (
	errControlHeld = errors.New("control already held")
	errNoSession   = errors.New("session not found")
)

const viewerChanBuf = 256

// SessionInfo is the JSON snapshot of one active session for the internal list API.
type SessionInfo struct {
	SessionID    string    `json:"sessionId"`
	SiteID       string    `json:"siteId"`
	UserID       string    `json:"userId"`
	Protocol     string    `json:"protocol"`
	Host         string    `json:"host"`
	StartedAt    time.Time `json:"startedAt"`
	ViewerCount  int       `json:"viewerCount"`
	ControlOwner string    `json:"controlOwner"`
}

// liveSession is one in-progress gateway session. It buffers NOTHING — viewers
// receive instructions only from the moment they attach (the CyberArk
// active-monitor model). `guac` is the guacd write conn, shared with the vendor
// bridge loop; `writeMu` serializes writes so a controlling viewer's input and
// the vendor's input never interleave mid-instruction.
type liveSession struct {
	id, siteID, userID, protocol, host string
	startedAt                          time.Time

	guac    net.Conn
	writeMu sync.Mutex

	mu           sync.Mutex
	viewers      map[int]chan []byte
	nextViewer   int
	controlOwner string // userID holding control, or "" for the vendor
}

func (ls *liveSession) addViewer() (int, chan []byte) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	id := ls.nextViewer
	ls.nextViewer++
	ch := make(chan []byte, viewerChanBuf)
	ls.viewers[id] = ch
	return id, ch
}

func (ls *liveSession) removeViewer(id int) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if ch, ok := ls.viewers[id]; ok {
		close(ch)
		delete(ls.viewers, id)
	}
}

func (ls *liveSession) closeAllViewers() {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	for id, ch := range ls.viewers {
		close(ch)
		delete(ls.viewers, id)
	}
}

// broadcast copies the instruction (the source slice may be reused by the reader)
// and non-blockingly sends it to every viewer. A full channel drops the frame —
// never block the vendor session for a slow viewer.
func (ls *liveSession) broadcast(inst []byte) {
	cp := make([]byte, len(inst))
	copy(cp, inst)
	ls.mu.Lock()
	defer ls.mu.Unlock()
	for _, ch := range ls.viewers {
		select {
		case ch <- cp:
		default:
		}
	}
}

func (ls *liveSession) writeToGuac(data []byte) error {
	ls.writeMu.Lock()
	defer ls.writeMu.Unlock()
	if ls.guac == nil {
		return nil
	}
	_, err := ls.guac.Write(data)
	return err
}

func (ls *liveSession) vendorInputAllowed() bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.controlOwner == ""
}

func (ls *liveSession) viewerInputAllowed(userID string) bool {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return userID != "" && ls.controlOwner == userID
}

func (ls *liveSession) setControl(owner string) error {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if ls.controlOwner != "" && ls.controlOwner != owner {
		return errControlHeld
	}
	ls.controlOwner = owner
	return nil
}

func (ls *liveSession) releaseControl(owner string) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	if ls.controlOwner == owner {
		ls.controlOwner = ""
	}
}

// SessionHub is a thread-safe registry of active gateway sessions.
type SessionHub struct {
	mu sync.RWMutex
	m  map[string]*liveSession
}

func NewSessionHub() *SessionHub { return &SessionHub{m: map[string]*liveSession{}} }

func newSessionID() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return hex.EncodeToString(b[:])
}

func (h *SessionHub) Register(sessionID, siteID, userID, protocol, host string, startedAt time.Time, guac net.Conn) *liveSession {
	ls := &liveSession{
		id: sessionID, siteID: siteID, userID: userID, protocol: protocol, host: host,
		startedAt: startedAt, guac: guac, viewers: map[int]chan []byte{},
	}
	h.mu.Lock()
	h.m[sessionID] = ls
	h.mu.Unlock()
	return ls
}

func (h *SessionHub) Get(id string) *liveSession {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.m[id]
}

func (h *SessionHub) Remove(id string) {
	h.mu.Lock()
	ls := h.m[id]
	delete(h.m, id)
	h.mu.Unlock()
	if ls != nil {
		ls.closeAllViewers()
	}
}

func (h *SessionHub) List() []SessionInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]SessionInfo, 0, len(h.m))
	for _, ls := range h.m {
		ls.mu.Lock()
		out = append(out, SessionInfo{
			SessionID: ls.id, SiteID: ls.siteID, UserID: ls.userID, Protocol: ls.protocol,
			Host: ls.host, StartedAt: ls.startedAt, ViewerCount: len(ls.viewers), ControlOwner: ls.controlOwner,
		})
		ls.mu.Unlock()
	}
	return out
}

func (h *SessionHub) SetControl(id, ownerUserID string) error {
	ls := h.Get(id)
	if ls == nil {
		return errNoSession
	}
	return ls.setControl(ownerUserID)
}

func (h *SessionHub) ReleaseControl(id, ownerUserID string) {
	if ls := h.Get(id); ls != nil {
		ls.releaseControl(ownerUserID)
	}
}

func (h *SessionHub) WatchStatus(userID, siteID string) (bool, bool) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, ls := range h.m {
		if ls.userID == userID && ls.siteID == siteID {
			ls.mu.Lock()
			watching := len(ls.viewers) > 0
			controlHeld := ls.controlOwner != ""
			ls.mu.Unlock()
			return watching, controlHeld
		}
	}
	return false, false
}
