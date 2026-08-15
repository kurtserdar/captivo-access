# Isolated Recording Size Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut isolated (VIDEO/WebM) recording size ~50% by capping the recording width and lowering the VP8 bitrate, both env-tunable.

**Architecture:** Change only `kasm-browser/control.py`. Extract the ffmpeg argument list into a pure, testable function; add an aspect-preserving downscale filter and a lower target bitrate; read the cap width and bitrate from env with safe defaults.

**Tech Stack:** Python (`kasm-browser/control.py`), ffmpeg (`libvpx`/VP8, `x11grab`, `tee` muxer), plain-assert test (`kasm-browser/control_test.py`).

## Global Constraints

- **Language:** English only — comments, identifiers, commit messages (public repo).
- **No Claude signature** in commits.
- **Keep unchanged:** VP8 codec (`libvpx`), `-framerate 10`, `-deadline realtime`, the `tee` muxer with both sinks (`[f=webm:onfail=ignore]pipe:1` + seekable file), `-map 0:v`, `-an`, and the seekable-finalize behavior. The `-vf` filter is applied **before** `-f tee` so both sinks carry the capped stream.
- **Defaults (verbatim):** `RECORDING_MAX_WIDTH` = `1280` (positive integer; non-integer or `<= 0` → 1280). `RECORDING_VIDEO_BITRATE` = `512k` (passed to ffmpeg verbatim; empty/whitespace → `512k`).
- **Scale filter (verbatim):** `-vf scale='min(<MAXW>,iw)':-2` where `<MAXW>` is the resolved `RECORDING_MAX_WIDTH`.
- **Deploy + release notes are SEPARATE gates** — do NOT run docker builds, connector updates, tags, or `gh release`. Stop when committed + broker test green + byte-compile clean.
- The change ships in the `kasm-browser` image, which runs **connector-side** — it only takes effect after the connector/gateway host is updated.

---

## File Structure

- Modify: `kasm-browser/control.py`
  - Add two module-level env constants near the existing ones (`MAX_SESSIONS`, `FT_MAX_BYTES`).
  - Extract `_ffmpeg_args(display, recfile, w, h)` (pure — returns the arg list); `_ffmpeg_capture` calls `subprocess.Popen(_ffmpeg_args(...), ...)`.
- Test: `kasm-browser/control_test.py`
  - Add assertions for the default filter + bitrate and the env overrides + fallbacks.

---

### Task 1: Cap width + lower bitrate in the broker encode

**Files:**
- Modify: `kasm-browser/control.py:11-14` (env constants) and `kasm-browser/control.py:138-151` (`_ffmpeg_capture`)
- Test: `kasm-browser/control_test.py`

**Interfaces:**
- Produces:
  - Module constants: `RECORDING_MAX_WIDTH: int` (default 1280, safe-parsed), `RECORDING_VIDEO_BITRATE: str` (default `"512k"`).
  - `_ffmpeg_args(display, recfile, w=1280, h=800) -> list[str]` — the full ffmpeg argv including `-vf scale='min(<MAXW>,iw)':-2` and `-b:v <BITRATE>`.
  - `_ffmpeg_capture(display, recfile, w=1280, h=800)` — unchanged signature/behavior; now builds argv via `_ffmpeg_args`.

- [ ] **Step 1: Make the test module reloadable, then write the failing test**

First, the env-override tests call `importlib.reload(control)`, which requires
`control` to be registered in `sys.modules`. The existing loader at the top of
`kasm-browser/control_test.py` does not register it. Update that loader to add
one line right after `module_from_spec`:

```python
import importlib.util, os, sys

spec = importlib.util.spec_from_file_location("control", os.path.join(os.path.dirname(__file__), "control.py"))
control = importlib.util.module_from_spec(spec)
sys.modules["control"] = control  # so importlib.reload(control) works in the env tests
spec.loader.exec_module(control)
```

Then append the new tests (the module is imported as `control` via `importlib`):

```python
def test_ffmpeg_args_defaults():
    args = control._ffmpeg_args(3, "/rec/s.webm", 2560, 1600)
    assert "-vf" in args
    vf = args[args.index("-vf") + 1]
    assert vf == "scale='min(1280,iw)':-2"
    assert "-b:v" in args
    assert args[args.index("-b:v") + 1] == "512k"
    # unchanged essentials
    assert "libvpx" in args
    assert "-framerate" in args and args[args.index("-framerate") + 1] == "10"
    assert "realtime" in args
    # the filter must come before the tee muxer so both sinks are capped
    assert args.index("-vf") < args.index("tee")


def test_ffmpeg_args_env_overrides():
    import importlib, os
    os.environ["RECORDING_MAX_WIDTH"] = "1600"
    os.environ["RECORDING_VIDEO_BITRATE"] = "768k"
    importlib.reload(control)
    try:
        args = control._ffmpeg_args(3, "/rec/s.webm", 2560, 1600)
        assert args[args.index("-vf") + 1] == "scale='min(1600,iw)':-2"
        assert args[args.index("-b:v") + 1] == "768k"
    finally:
        del os.environ["RECORDING_MAX_WIDTH"]
        del os.environ["RECORDING_VIDEO_BITRATE"]
        importlib.reload(control)


def test_ffmpeg_args_env_fallbacks():
    import importlib, os
    os.environ["RECORDING_MAX_WIDTH"] = "bad"
    os.environ["RECORDING_VIDEO_BITRATE"] = "   "
    importlib.reload(control)
    try:
        assert control.RECORDING_MAX_WIDTH == 1280
        assert control.RECORDING_VIDEO_BITRATE == "512k"
    finally:
        del os.environ["RECORDING_MAX_WIDTH"]
        del os.environ["RECORDING_VIDEO_BITRATE"]
        importlib.reload(control)
```

Also add the two new tests to the `if __name__ == "__main__":` runner block at the bottom of the file:

```python
    test_ffmpeg_args_defaults()
    test_ffmpeg_args_env_overrides()
    test_ffmpeg_args_env_fallbacks()
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `cd /opt/captivo-access/kasm-browser && python3 control_test.py`
Expected: FAIL — `AttributeError: module 'control' has no attribute '_ffmpeg_args'`.

- [ ] **Step 3: Add the env constants**

In `kasm-browser/control.py`, right after the `FT_MAX_BYTES = ...` line (~line 14), add:

```python
def _positive_int_env(name, default):
    try:
        v = int(os.environ.get(name, "").strip())
        return v if v > 0 else default
    except (TypeError, ValueError):
        return default

# Recording encode knobs (tunable without rebuilding the connector image).
RECORDING_MAX_WIDTH = _positive_int_env("RECORDING_MAX_WIDTH", 1280)
RECORDING_VIDEO_BITRATE = (os.environ.get("RECORDING_VIDEO_BITRATE", "").strip() or "512k")
```

- [ ] **Step 4: Extract `_ffmpeg_args` + apply the cap and bitrate**

Replace the body of `_ffmpeg_capture` (`kasm-browser/control.py:138-151`) with an `_ffmpeg_args` builder plus a thin `_ffmpeg_capture`:

```python
def _ffmpeg_args(display, recfile, w=1280, h=800):
    # Grab the per-session Xvnc display as WebM (VP8). The tee muxer writes two sinks:
    # the live pipe (stdout, streamed to the data-plane — crash-safe interim recording)
    # and a seekable file (finalized on clean stop for correct duration + seeking).
    # onfail=ignore keeps the file writing even if the pipe reader goes away. x11grab
    # is real-time paced, so an interrupted (SIGINT) capture still has correct
    # timestamps + duration.
    #
    # The -vf scale caps the RECORDING width (aspect-preserving, never upscaling) and a
    # modest -b:v keeps the file small; both are env-tunable. This only shrinks the
    # STORED replay — the vendor's view and the admin's /kasm-view live view are
    # separate full-resolution streams. Applied before -f tee so both sinks are capped.
    return ["ffmpeg", "-loglevel", "error", "-f", "x11grab",
            "-video_size", "%dx%d" % (w, h), "-framerate", "10", "-i", ":%d" % display,
            "-an", "-vf", "scale='min(%d,iw)':-2" % RECORDING_MAX_WIDTH,
            "-c:v", "libvpx", "-b:v", RECORDING_VIDEO_BITRATE, "-deadline", "realtime",
            "-f", "tee", "-map", "0:v",
            "[f=webm:onfail=ignore]pipe:1|[f=webm]" + recfile]


def _ffmpeg_capture(display, recfile, w=1280, h=800):
    return subprocess.Popen(_ffmpeg_args(display, recfile, w, h),
                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `cd /opt/captivo-access/kasm-browser && python3 control_test.py`
Expected: prints `ok` (all tests, including the earlier `_safe_name` ones, pass).

- [ ] **Step 6: Byte-compile the module**

Run: `cd /opt/captivo-access/kasm-browser && python3 -c "import py_compile; py_compile.compile('control.py', doraise=True)" && echo COMPILE_OK`
Expected: `COMPILE_OK`.

- [ ] **Step 7: Commit**

```bash
cd /opt/captivo-access
git add kasm-browser/control.py kasm-browser/control_test.py
git commit -m "feat(isolated): cap recording width + lower VP8 bitrate (env-tunable) to shrink video"
```

---

## Final verification (after the task)

- [ ] `cd /opt/captivo-access/kasm-browser && python3 control_test.py` — prints `ok`.
- [ ] `python3 -c "import py_compile; py_compile.compile('control.py', doraise=True)"` — no error.
- [ ] **Manual (post-deploy, needs connector update — SEPARATE approval):** record the same isolated session before/after; compare stored size (expect ~50% smaller) and confirm the replay text is readable and seeking works; confirm the vendor's live view and admin `/kasm-view` are unaffected (full resolution). If text is soft, bump `RECORDING_VIDEO_BITRATE` (e.g. `768k`) or `RECORDING_MAX_WIDTH` via env — no rebuild.

## Release (SEPARATE GATES — do not auto-run)

After the user approves deploy: bump the version, tag (CI rebuilds the 5 images incl. `kasm-browser`), and update the **connector/gateway host** to the new `kasm-browser` image (this change is connector-side; the central manager/dataplane do not carry it). On tag, add an English user-focused `gh release edit` note. Wait for explicit approval before each step.
