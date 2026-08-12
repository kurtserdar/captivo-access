package main

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"sync"
	"time"
)

var (
	errControlHeld = errors.New("control already held")
	errNoSession   = errors.New("session not found")
)

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

// liveSession is one in-progress gateway session. Viewers join guacd's shared
// connection directly (by connID) rather than being fanned out here, so this
// holds only what viewers need to dial + join, plus control state.
type liveSession struct {
	id, siteID, userID, protocol, host string
	startedAt                          time.Time
	connID, connectorID, guacdAddr     string

	mu           sync.Mutex
	controlOwner string // userID holding control, or "" for the vendor
	viewers      int    // attached live viewers (for the console list)
	closer       func() // closes the underlying tunnel; set by guactunnel after Register
}

func (ls *liveSession) shareInfo() (string, string, string) {
	ls.mu.Lock()
	defer ls.mu.Unlock()
	return ls.connID, ls.connectorID, ls.guacdAddr
}

func (ls *liveSession) addViewer() {
	ls.mu.Lock()
	ls.viewers++
	ls.mu.Unlock()
}

func (ls *liveSession) removeViewer() {
	ls.mu.Lock()
	if ls.viewers > 0 {
		ls.viewers--
	}
	ls.mu.Unlock()
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

func (h *SessionHub) Register(sessionID, siteID, userID, protocol, host string, startedAt time.Time, connID, connectorID, guacdAddr string) *liveSession {
	ls := &liveSession{
		id: sessionID, siteID: siteID, userID: userID, protocol: protocol, host: host,
		startedAt: startedAt, connID: connID, connectorID: connectorID, guacdAddr: guacdAddr,
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
	delete(h.m, id)
	h.mu.Unlock()
}

func (h *SessionHub) List() []SessionInfo {
	h.mu.RLock()
	defer h.mu.RUnlock()
	out := make([]SessionInfo, 0, len(h.m))
	for _, ls := range h.m {
		ls.mu.Lock()
		out = append(out, SessionInfo{
			SessionID: ls.id, SiteID: ls.siteID, UserID: ls.userID, Protocol: ls.protocol,
			Host: ls.host, StartedAt: ls.startedAt, ViewerCount: ls.viewers, ControlOwner: ls.controlOwner,
		})
		ls.mu.Unlock()
	}
	return out
}

// SetCloser records how to force-close this session's tunnel.
func (h *SessionHub) SetCloser(id string, fn func()) {
	if ls := h.Get(id); ls != nil {
		ls.mu.Lock()
		ls.closer = fn
		ls.mu.Unlock()
	}
}

// Terminate force-closes a session's tunnel. Returns false if no such session.
func (h *SessionHub) Terminate(id string) bool {
	ls := h.Get(id)
	if ls == nil {
		return false
	}
	ls.mu.Lock()
	fn := ls.closer
	ls.mu.Unlock()
	if fn != nil {
		fn()
	}
	return true
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
			watching := ls.viewers > 0
			controlHeld := ls.controlOwner != ""
			ls.mu.Unlock()
			return watching, controlHeld
		}
	}
	return false, false
}
