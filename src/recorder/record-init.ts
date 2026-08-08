import { record } from "rrweb";

type RRWebEvent = unknown;

(() => {
  try {
    const key = (crypto.randomUUID?.() ?? String(Date.now()) + Math.random());
    let buf: RRWebEvent[] = [];
    let seq = 0;
    const flush = () => {
      if (buf.length === 0) return;
      const batch = buf;
      buf = [];
      const body = JSON.stringify({ recordingKey: key, seq: seq++, events: batch });
      // sendBeacon survives unload; fall back to fetch.
      try {
        if (!navigator.sendBeacon("/__captivo/rec", new Blob([body], { type: "application/json" }))) {
          void fetch("/__captivo/rec", { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true });
        }
      } catch {
        /* recording must never break the app */
      }
    };
    record({
      emit: (e: RRWebEvent) => { buf.push(e); if (buf.length >= 50) flush(); },
      maskAllInputs: true, // conservative: never capture typed input values in the first slice
    });
    setInterval(flush, 5000);
    addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") flush(); });
    addEventListener("pagehide", flush);
  } catch {
    /* fail silent */
  }
})();
