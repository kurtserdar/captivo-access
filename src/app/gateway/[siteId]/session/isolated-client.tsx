"use client";
import { useEffect, useRef, useState } from "react";
import { ConnectSplash } from "./connect-splash";
import { isolatedDims } from "@/lib/isolated/dims";

// ?site pins the session for the data-plane; it sets a cookie so the KasmVNC
// client's follow-up asset/WS requests (which carry no ?site) inherit it.
// path= keeps the client's RFB WebSocket under /kasm-tunnel/ (its default absolute
// /websockify would route to the manager, not the data-plane). clipboard_* turn ON
// the client's seamless clipboard (OFF by default); per-direction policy is still
// enforced server-side by the broker's DLP config.
// resize=scale (not remote): the isolated desktop stays a fixed 1280x800 and the
// client scales it to fill the viewport. resize=remote grew the desktop past the
// recorder's fixed 1280x800 x11grab region, so recordings only captured the top-left
// corner — scale keeps the desktop size and the recording in lockstep while still
// filling the screen (16:10 matches, no letterbox).
const KASM_PARAMS = "path=kasm-tunnel/websockify&resize=scale&clipboard_seamless=true&clipboard_up=true&clipboard_down=true";

export function IsolatedSession({ siteId, siteName, recorded, fileTransferMode }: { siteId: string; siteName: string; recorded: boolean; fileTransferMode: string }) {
  const canUpload = fileTransferMode === "allow" || fileTransferMode === "no_download";
  const canDownload = fileTransferMode === "allow" || fileTransferMode === "no_upload";
  const [ready, setReady] = useState(false);
  const [watching, setWatching] = useState(false);
  const [controlHeld, setControlHeld] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [isTouch, setIsTouch] = useState(false);
  const [fs, setFs] = useState(false);
  const [downloads, setDownloads] = useState<{ name: string; size: number; mtime: number }[]>([]);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Poll the isolated browser's Downloads folder so files it downloads surface to
  // the vendor. Only when the site allows downloads out.
  useEffect(() => {
    if (!canDownload) return;
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/isolated/files/downloads?site=${siteId}`, { cache: "no-store" });
        if (res.ok && !stop) setDownloads((await res.json()) as { name: string; size: number; mtime: number }[]);
      } catch {
        /* ignore */
      }
    };
    void poll();
    const t = setInterval(poll, 3000);
    return () => { stop = true; clearInterval(t); };
  }, [siteId, canDownload]);

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploadMsg("Uploading…");
    try {
      const res = await fetch(`/api/isolated/files/upload?site=${siteId}&name=${encodeURIComponent(f.name)}`, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "content-length": String(f.size) },
        body: f,
      });
      setUploadMsg(res.ok ? `Uploaded ${f.name}` : res.status === 413 ? "File too large" : "Upload failed");
    } catch {
      setUploadMsg("Upload failed");
    }
    setTimeout(() => setUploadMsg(null), 4000);
  };

  // The KasmVNC/noVNC hidden keyboard input inside the same-origin iframe. Focusing
  // it raises the phone soft keyboard; noVNC then captures typing.
  const kbInput = (): HTMLElement | null => {
    const doc = frameRef.current?.contentDocument;
    return (doc?.getElementById("noVNC_keyboard") as HTMLElement | null)
      ?? (doc?.querySelector("textarea, input[type=text]") as HTMLElement | null);
  };

  const toggleKeyboard = () => {
    const el = kbInput();
    if (!el) return;
    if (frameRef.current?.contentDocument?.activeElement === el) el.blur();
    else el.focus();
  };

  // Send one special key to the remote. Prefer the RFB API if the bundle exposes it;
  // otherwise dispatch a KeyboardEvent on the focused keyboard input.
  const sendKey = (key: string, code: string, keysym: number) => {
    const el = kbInput();
    if (!el) return;
    el.focus();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rfb: any = (frameRef.current?.contentWindow as any)?.rfb;
    const ctrlSym = 0xffe3, ctrlCode = "ControlLeft";
    if (rfb?.sendKey) {
      if (ctrlHeld) rfb.sendKey(ctrlSym, ctrlCode, true);
      rfb.sendKey(keysym, code, true);
      rfb.sendKey(keysym, code, false);
      if (ctrlHeld) rfb.sendKey(ctrlSym, ctrlCode, false);
    } else {
      const opts: KeyboardEventInit = { key, code, bubbles: true, ctrlKey: ctrlHeld };
      el.dispatchEvent(new KeyboardEvent("keydown", opts));
      el.dispatchEvent(new KeyboardEvent("keyup", opts));
    }
    if (ctrlHeld) setCtrlHeld(false);
  };

  // The macOS green button only maximises the browser window — it keeps the tab/URL
  // chrome, so the screen-sized desktop still letterboxes. The Fullscreen API hides
  // ALL chrome, making the viewport equal the screen (= the desktop) for an exact fill.
  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const toggleFs = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  };

  // Size the isolated desktop. On a desktop it matches the vendor's screen (browser-
  // fullscreen fills exactly). On a touch device it matches the phone viewport, so the
  // internal web app renders its mobile/responsive layout at ~1:1 and native touch is
  // usable. The broker keeps this size fixed for the session, so recordings stay correct.
  useEffect(() => {
    const touch = typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
    setIsTouch(touch);
    setDims(isolatedDims(touch, window.screen.width, window.screen.height, window.innerWidth, window.innerHeight));
  }, []);

  // Mirror GatewaySession: poll whether an admin is watching / has taken control so
  // the vendor sees a live-monitoring notice (transparency / KVKK).
  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/gateway/${siteId}/watch-status`, { cache: "no-store" });
        if (res.ok) {
          const s = (await res.json()) as { watching: boolean; controlHeld: boolean };
          if (!stop) { setWatching(s.watching); setControlHeld(s.controlHeld); }
        }
      } catch {
        /* ignore */
      }
    };
    void poll();
    const t = setInterval(poll, 2000);
    return () => { stop = true; clearInterval(t); };
  }, [siteId]);

  useEffect(() => {
    // Keep our branded splash up until the embedded KasmVNC client actually
    // CONNECTS — it adds `noVNC_connected` to its documentElement then. Dismissing
    // on iframe onLoad instead (document ready, but not yet connected) would
    // uncover KasmVNC's own "connecting" splash underneath. The iframe is
    // same-origin (/kasm-tunnel is under the manager host), so we can read its
    // document. A 20 s fallback guarantees we never trap the vendor behind it.
    const isConnected = () => {
      try {
        return !!frameRef.current?.contentDocument?.documentElement.classList.contains("noVNC_connected");
      } catch {
        return false;
      }
    };
    const poll = window.setInterval(() => {
      if (isConnected()) { window.clearInterval(poll); setReady(true); }
    }, 250);
    const fallback = window.setTimeout(() => { window.clearInterval(poll); setReady(true); }, 20000);
    return () => { window.clearInterval(poll); window.clearTimeout(fallback); };
  }, []);

  return (
    <>
      {dims && (
        <iframe
          ref={frameRef}
          title="Isolated browser"
          src={`/kasm-tunnel/?site=${siteId}&w=${dims.w}&h=${dims.h}&${KASM_PARAMS}`}
          style={{ position: "fixed", inset: 0, width: "100vw", height: "100vh", border: 0 }}
          allow="clipboard-read; clipboard-write"
        />
      )}
      {recorded && (
        <div
          style={{
            position: "fixed", top: 12, left: 12, zIndex: 20, pointerEvents: "none",
            display: "flex", alignItems: "center", gap: 6,
            background: "rgba(0,0,0,0.6)", color: "#ff4d4f",
            font: "600 12px/1 sans-serif", letterSpacing: "0.06em",
            padding: "6px 10px", borderRadius: 6,
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ff4d4f", display: "inline-block" }} />
          RECORDED
        </div>
      )}
      {(watching || controlHeld) && (
        <div
          style={{
            position: "fixed", top: 8, left: "50%", transform: "translateX(-50%)", zIndex: 20,
            pointerEvents: "none",
            background: controlHeld ? "rgba(180,0,0,0.92)" : "rgba(0,0,0,0.72)",
            color: "#fff", padding: "6px 14px", borderRadius: 8, fontFamily: "sans-serif", fontSize: "13px", whiteSpace: "nowrap",
          }}
        >
          {controlHeld ? "An administrator has taken control of this session." : "This session is being monitored live."}
        </div>
      )}
      {ready && dims && (
        <button
          type="button"
          onClick={toggleFs}
          title={fs ? "Exit full screen" : "Full screen"}
          style={{
            position: "fixed", bottom: 12, right: 12, zIndex: 30, cursor: "pointer",
            background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)",
            borderRadius: 8, padding: "6px 12px", fontFamily: "sans-serif", fontSize: 12,
          }}
        >
          {fs ? "⤢ Exit full screen" : "⤢ Full screen"}
        </button>
      )}
      {ready && dims && (canUpload || canDownload) && (
        <div style={{ position: "fixed", bottom: 12, left: 12, zIndex: 30, display: "flex", flexDirection: "column", gap: 8, maxWidth: 280 }}>
          {canUpload && (
            <div>
              <input ref={fileRef} type="file" style={{ display: "none" }} onChange={onPick} />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "6px 12px", fontFamily: "sans-serif", fontSize: 12, cursor: "pointer" }}
              >
                ↑ Upload file
              </button>
              {uploadMsg && <span style={{ marginLeft: 8, color: "#fff", fontFamily: "sans-serif", fontSize: 12 }}>{uploadMsg}</span>}
            </div>
          )}
          {canDownload && downloads.length > 0 && (
            <div style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "8px 12px", fontFamily: "sans-serif", fontSize: 12 }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>Downloads ({downloads.length})</div>
              {downloads.map((d) => (
                <a
                  key={d.name}
                  href={`/api/isolated/files/download?site=${siteId}&name=${encodeURIComponent(d.name)}`}
                  download={d.name}
                  style={{ display: "block", color: "#7fd7ff", textDecoration: "none", padding: "2px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  ↓ {d.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
      {isTouch && ready && dims && (
        <div style={{ position: "fixed", bottom: 12, left: "50%", transform: "translateX(-50%)", zIndex: 30, display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "center", maxWidth: "96vw" }}>
          {[
            { label: "⌨", title: "Keyboard", on: toggleKeyboard },
            { label: "Esc", title: "Escape", on: () => sendKey("Escape", "Escape", 0xff1b) },
            { label: "Tab", title: "Tab", on: () => sendKey("Tab", "Tab", 0xff09) },
            { label: "←", title: "Left", on: () => sendKey("ArrowLeft", "ArrowLeft", 0xff51) },
            { label: "↑", title: "Up", on: () => sendKey("ArrowUp", "ArrowUp", 0xff52) },
            { label: "↓", title: "Down", on: () => sendKey("ArrowDown", "ArrowDown", 0xff54) },
            { label: "→", title: "Right", on: () => sendKey("ArrowRight", "ArrowRight", 0xff53) },
          ].map((b) => (
            <button key={b.title} type="button" title={b.title} onClick={b.on}
              style={{ background: "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "8px 12px", fontFamily: "sans-serif", fontSize: 13, cursor: "pointer", minWidth: 40 }}>
              {b.label}
            </button>
          ))}
          <button type="button" title="Ctrl" onClick={() => setCtrlHeld((v) => !v)}
            style={{ background: ctrlHeld ? "rgba(80,160,255,0.85)" : "rgba(0,0,0,0.6)", color: "#fff", border: "1px solid rgba(255,255,255,0.25)", borderRadius: 8, padding: "8px 12px", fontFamily: "sans-serif", fontSize: 13, cursor: "pointer", minWidth: 44 }}>
            Ctrl
          </button>
        </div>
      )}
      {(!ready || !dims) && <ConnectSplash siteName={siteName} />}
    </>
  );
}
