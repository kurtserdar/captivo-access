package main

import (
	"log"
	"strings"
	"sync/atomic"
)

// Leveled logging. Every connector log line goes through here and is prefixed
// with its severity (INFO/WARN/ERROR/DEBUG), which the console's recent-log
// panel colours. The active threshold is controlled live from the Manager
// (pushed as part of the connector policy over the control stream) so an
// operator can turn DEBUG on/off from the UI without touching the container.
// DEBUG (the disk-heavy per-request detail) is therefore opt-in and off by
// default, so normal operation never bloats the log.

type logLevel int32

const (
	levelDebug logLevel = iota
	levelInfo
	levelWarn
	levelError
)

// currentLevel is the active threshold; lines below it are dropped. Defaults to
// info (set in init, before any logging) so an unset/invalid level never silences
// warnings or floods with debug.
var currentLevel atomic.Int32

func init() { currentLevel.Store(int32(levelInfo)) }

func parseLevel(s string) (logLevel, bool) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "debug":
		return levelDebug, true
	case "info":
		return levelInfo, true
	case "warn", "warning":
		return levelWarn, true
	case "error":
		return levelError, true
	}
	return levelInfo, false
}

// setLogLevel applies s if it names a valid level; an empty/unknown value is a
// no-op, so a policy frame that omits the level (or a bad value) never changes
// the active threshold.
func setLogLevel(s string) {
	if lv, ok := parseLevel(s); ok {
		currentLevel.Store(int32(lv))
	}
}

func levelPrefix(lv logLevel) string {
	switch lv {
	case levelDebug:
		return "DEBUG "
	case levelWarn:
		return "WARN "
	case levelError:
		return "ERROR "
	default:
		return "INFO "
	}
}

func logf(lv logLevel, format string, args ...any) {
	if int32(lv) < currentLevel.Load() {
		return
	}
	log.Printf(levelPrefix(lv)+format, args...)
}

func logDebug(format string, args ...any) { logf(levelDebug, format, args...) }
func logInfo(format string, args ...any)  { logf(levelInfo, format, args...) }
func logWarn(format string, args ...any)  { logf(levelWarn, format, args...) }
func logError(format string, args ...any) { logf(levelError, format, args...) }
