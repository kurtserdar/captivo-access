/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ClipboardCaps } from "@/lib/gateway/clipboard-caps";

export interface ClipboardBridge {
  syncFromBrowser: () => void;
  pushLocal: (text: string) => void;
  getRemoteText: () => string;
}

// Owns the text clipboard bridge between the browser and a guacd session.
// Installs client.onclipboard (remote → browser) and exposes helpers the
// session component drives: syncFromBrowser() on focus (browser → remote via
// the Clipboard API) and pushLocal() from the manual panel. Direction is gated
// by caps; guacd enforces the same server-side.
export function createClipboardBridge(client: any, Guacamole: any, caps: ClipboardCaps): ClipboardBridge {
  let remoteText = "";
  let lastPushed: string | null = null;

  // remote → browser
  client.onclipboard = (stream: any, mimetype: string) => {
    // Text-only: ignore non-text clipboard (e.g. image/png) rather than corrupt it.
    if (typeof mimetype === "string" && mimetype && !mimetype.startsWith("text/")) return;
    const reader = new Guacamole.StringReader(stream);
    let buf = "";
    reader.ontext = (t: string) => { buf += t; };
    reader.onend = () => {
      remoteText = buf;
      if (caps.allowCopyOut && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(remoteText).catch(() => { /* permission denied — panel is the fallback */ });
      }
    };
  };

  const pushLocal = (text: string) => {
    if (!caps.allowPasteIn || !text || text === lastPushed) return;
    const stream = client.createClipboardStream("text/plain");
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(text);
    writer.sendEnd();
    lastPushed = text;
  };

  const syncFromBrowser = () => {
    if (!caps.allowPasteIn || typeof navigator === "undefined" || !navigator.clipboard?.readText) return;
    navigator.clipboard.readText()
      .then((t) => { if (t) pushLocal(t); })
      .catch(() => { /* denied / unfocused — panel is the fallback */ });
  };

  return { syncFromBrowser, pushLocal, getRemoteText: () => remoteText };
}
