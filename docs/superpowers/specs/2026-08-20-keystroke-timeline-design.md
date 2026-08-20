# Session Keystroke Timeline (SSH + RDP) — Design

**Date:** 2026-08-20
**Status:** Approved (design)
**Scope:** GATEWAY (guacd) sessions — RDP + SSH. A searchable, timestamped keystroke
timeline captured alongside the recording, where clicking an entry seeks the
recording player to that moment.

## Problem

Session recordings are watch-the-whole-video. There is no way to jump to "when the
vendor typed `rm -rf …`" or scan what commands ran. For forensics and governance
(the compliance wedge) an operator needs a **searchable activity timeline** linked to
the video — click a command → seek the recording to that instant.

**What's achievable, honestly.** Guacamole 1.6.0 ships exactly this pattern
(searchable key events + a progress-bar heatmap in its recording player) — but that
is the Guacamole **web application** + its history-recording-storage extension, which
we do not run (we use guacamole-common-js + our own recording pipeline + our own
player). Kasm Workspaces' recording is **video-only** — no keystroke/event capture —
so it offers nothing for the isolated case either. The capturable primitive on the
wire is the **keystroke** (a guac `key` instruction); "commands" are a reconstruction
from keystrokes (SSH), and "opened windows / launched exes" are **not on the wire**
(they need a target-side agent) — so those are out of scope here.

## Goal

For RDP + SSH gateway sessions, when keystroke logging is enabled for a Resource:
1. capture the vendor's keystrokes as a **timestamped event stream**, encrypted at rest;
2. reconstruct **command lines** for SSH (printable keys accumulated to Enter) and
   **typed-text bursts** for RDP;
3. show a **searchable timeline** on the recording page; clicking an entry **seeks
   the player** to that moment;
4. keep it **opt-in per Resource** and **mask likely password entry** (privacy).

## The mechanism is already on the wire

`dataplane/guactunnel.go` relays two pumps: **guacd→browser** (the display stream,
which `rec.Write` records) and **browser→guacd** (vendor input — where the guac `key`
instructions flow). The `ftObserver` already taps the input pump
(`ft.observe(dirUpload, data)`) for file-transfer audit. A **`keyObserver`** mirrors
that exact pattern on the same pump — no guacd config change, no separate recording.

### Capture (`dataplane/keyobserver.go`, new — mirrors `guacfiletransfer.go`)

- Parse each input instruction; act only on `key` (`4.key,<keysym>,<pressed>;`).
- On key-down of a printable keysym (0x20–0x7E → its char) accumulate into a line
  buffer; on Enter (`0xFF0D`) emit a line event; handle Backspace (`0xFF08`) by
  trimming the buffer. Non-printable keys (arrows, Ctrl, Tab) are recorded as named
  tokens within the line (e.g. `[Tab]`, `[Ctrl]`), best-effort.
- Each emitted event carries a **wall-clock timestamp** (for the recording offset)
  and the reconstructed text.
- **RDP vs SSH:** SSH emits per **line** (Enter-terminated). RDP has no command
  concept — emit a **burst** when typing pauses (> ~1.5 s idle) or on Enter, so the
  timeline shows "typed text" chunks rather than one entry per key.

### Password masking (privacy — required)

Keystrokes include passwords typed at prompts (sudo/su/login). Two layers:
- **Opt-in per Resource** — keystroke logging is OFF by default; an admin enables it
  per Resource, with a clear notice that typed input (possibly secrets) is captured.
- **Masking heuristic** — when a recent line matched a password-prompt pattern
  (`/password|passphrase|sudo/i`) or the terminal is in no-echo input, replace the
  next line's text with `••••` (store a `masked` flag, never the plaintext). Best-
  effort — documented as a deterrent, not a guarantee; the per-Resource opt-in is the
  real control.

## Storage (`SessionKeyEvent`, new model)

A separate table (not the hash-chained audit — too high-volume) linked to the
recording:

```prisma
model SessionKeyEvent {
  id           String   @id @default(cuid())
  recordingKey String   // ties to SessionRecording.recordingKey
  seq          Int
  atMs         Int      // offset from the recording start, in ms (for player seek)
  kind         String   // "command" (ssh) | "text" (rdp)
  data         Bytes    // AES-256-GCM(text) — encrypted at rest like recordings
  masked       Boolean  @default(false)
  @@index([recordingKey, seq])
}
```

- Events are ingested via an internal endpoint the data-plane posts to (mirror
  `/api/internal/recording/ingest`), encrypted with `encryptBytes` (same as GUAC/
  RRWEB recordings). `atMs` = event wall-clock − recording `startedAt`.
- Retention: deleted with the recording (cascade / same retention cron), so the
  timeline never outlives its video.

## Player linkage (seek)

The recording page already replays the GUAC stream via guacamole-common-js. Add a
**timeline panel**: the decrypted `SessionKeyEvent` list (search box + rows). Clicking
a row calls the player's seek to `atMs`. guacamole-common-js `Guacamole.SessionRecording`
supports position seek; `atMs` is the recording-relative offset. (Calibration note:
the recording plays in real time, so wall-clock offset ≈ playback position; a small
drift from buffering is acceptable for "jump near the moment.")

## UI

On `/admin/recordings/[id]` (replay): a **"Timeline"** panel beside the player —
- a search box (filters rows by text; SQL-backable later),
- rows: `mm:ss · <command or text>` (masked rows show `••••`), newest-relevant first,
- click → seek the player to that `atMs`.

## Non-goals (v1)

- **Progress-bar heatmap** (Guacamole-style) — a nice follow-up, not v1.
- **Isolated browser (KasmVNC) keystrokes** — a different tunnel (RFB) / CDP; separate
  slice. Kasm gives us nothing here (video-only).
- **Opened windows / launched exes (RDP)** — not on the wire; needs a target agent,
  which breaks the agentless model. Out of scope.
- **Full command semantics** (parsing args, exit codes) — v1 is the raw reconstructed
  line, not a parsed command model.

## Testing

- **Data-plane (Go):** `keyObserver` unit tests — a stream of `key` instructions
  reconstructs the expected line on Enter; Backspace trims; non-printable tokens;
  RDP burst-on-idle; the password-prompt heuristic sets `masked`.
- **Manager:** `SessionKeyEvent` ingest (encrypt) + the decrypt-on-read path (reuse
  the recording encryption helpers); `pnpm build`.
- **Manual (post-deploy):** an SSH session typing a few commands → the timeline lists
  them; clicking one seeks the player; a `sudo`/password line shows `••••`; a Resource
  with keystroke logging OFF captures nothing.

## Release

Deploy + release notes are separate gates. Spans data-plane (capture) + manager
(schema, ingest, UI) — central stack; no connector/kasm change. Schema change →
`prisma db push`. On tag, add an English user-focused `gh release edit` note; call out
that keystroke logging is opt-in per Resource and may capture typed secrets.
