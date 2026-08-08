import { record } from "rrweb";

type RRWebEvent = { type?: number };

(() => {
  try {
    const KEY_STORE = "__captivo_rec_key";
    const SEQ_STORE = "__captivo_rec_seq";
    const newId = () => crypto.randomUUID?.() ?? String(Date.now()) + Math.random();

    // Persist key + seq per browser tab so a full navigation (redirect,
    // meta-refresh, SPA hard nav) continues ONE recording instead of starting a
    // fresh, snapshot-orphaned one. sessionStorage is per-tab and cleared when
    // the tab closes — exactly one vendor visit. Falls back to an in-memory key
    // when storage is unavailable (private mode). Note: a duplicated tab
    // inherits a copy of sessionStorage, so both tabs would share this key+seq;
    // that only interleaves chunks (never blanks a replay) and is an accepted
    // consequence of the per-tab design.
    let key: string;
    let seq: number;
    try {
      key = sessionStorage.getItem(KEY_STORE) ?? newId();
      sessionStorage.setItem(KEY_STORE, key);
      seq = Number(sessionStorage.getItem(SEQ_STORE) ?? "0") || 0;
    } catch {
      key = newId();
      seq = 0;
    }
    const persistSeq = (n: number) => {
      try { sessionStorage.setItem(SEQ_STORE, String(n)); } catch { /* ignore */ }
    };

    let buf: RRWebEvent[] = [];

    // In-session send: a plain fetch has NO body-size cap. sendBeacon and
    // keepalive-fetch are both hard-limited to 64 KB by the browser, which
    // silently dropped the (large) FullSnapshot batch — leaving an
    // unreplayable, snapshot-less recording. The page is alive here, so a
    // normal fetch completes.
    const send = (batch: RRWebEvent[], s: number) => {
      const body = JSON.stringify({ recordingKey: key, seq: s, events: batch });
      try {
        // .catch swallows async rejections too (a bare `void fetch` would let a
        // network-blip rejection surface as an unhandledrejection in the app).
        fetch("/__captivo/rec", {
          method: "POST",
          body,
          headers: { "content-type": "application/json" },
        }).catch(() => {});
      } catch { /* recording must never break the app */ }
    };

    // Terminal send (tab hidden / unloading): the page may die before a normal
    // fetch resolves, so use sendBeacon (survives unload) with a keepalive
    // fallback. Both cap at 64 KB, but the snapshot and periodic batches have
    // already gone out via plain fetch; the tail is only recent incrementals.
    const sendFinal = (batch: RRWebEvent[], s: number) => {
      const body = JSON.stringify({ recordingKey: key, seq: s, events: batch });
      try {
        const blob = new Blob([body], { type: "application/json" });
        if (!navigator.sendBeacon("/__captivo/rec", blob)) {
          fetch("/__captivo/rec", {
            method: "POST",
            body,
            headers: { "content-type": "application/json" },
            keepalive: true,
          }).catch(() => {});
        }
      } catch { /* fail silent */ }
    };

    const flush = (terminal = false) => {
      if (buf.length === 0) return;
      const batch = buf;
      buf = [];
      const s = seq++;
      persistSeq(seq);
      if (terminal) sendFinal(batch, s); else send(batch, s);
    };

    record({
      emit: (e: RRWebEvent) => {
        buf.push(e);
        // Flush the FullSnapshot (type 2) immediately via plain fetch so the
        // replay anchor is persisted right away, regardless of batching.
        if (e.type === 2 || buf.length >= 50) flush();
      },
      maskAllInputs: true, // conservative: never capture typed input values
    });
    setInterval(() => flush(), 5000);
    addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush(true);
    });
    addEventListener("pagehide", () => flush(true));
  } catch {
    /* fail silent */
  }
})();
