"use client";
import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function GuacRecordingPlayer({ recordingId }: { recordingId: string }) {
  const displayRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/recordings/${recordingId}/guac`);
        if (!res.ok) { setError("Couldn't load this recording."); return; }
        const blob = await res.blob();
        if (blob.size === 0) { setEmpty(true); return; }
        if (disposed || !displayRef.current) return;

        const mod: any = await import("guacamole-common-js");
        const Guacamole: any = mod.default ?? mod;
        // A Blob source auto-parses in the constructor — there is NO connect().
        const recording = new Guacamole.SessionRecording(blob);
        recRef.current = recording;

        const display = recording.getDisplay();
        displayRef.current.innerHTML = "";
        displayRef.current.appendChild(display.getElement());
        const fit = () => {
          const dw = display.getWidth();
          const dh = display.getHeight();
          if (dw > 0 && dh > 0) display.scale(Math.min((displayRef.current?.clientWidth ?? dw) / dw, 1));
        };
        display.onresize = fit;

        recording.onload = () => { setReady(true); setDuration(recording.getDuration()); fit(); };
        recording.onprogress = (dur: number) => setDuration(dur);
        recording.onseek = (millis: number) => setPosition(millis);
        recording.onplay = () => setPlaying(true);
        recording.onpause = () => setPlaying(false);
        recording.onerror = (status: unknown) => {
          console.error("[guac-recording] onerror:", status);
          setError(`Couldn't play this recording. (${typeof status === "string" ? status : JSON.stringify(status)})`);
        };
      } catch (err) {
        console.error("[guac-recording] failed:", err);
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        setError(`Couldn't play this recording. (${msg})`);
      }
    })();
    return () => {
      disposed = true;
      try { recRef.current?.pause?.(); } catch { /* ignore */ }
      recRef.current = null;
    };
  }, [recordingId]);

  function toggle() {
    const r = recRef.current;
    if (!r) return;
    if (playing) r.pause();
    else r.play();
  }
  function onScrub(e: React.ChangeEvent<HTMLInputElement>) {
    const r = recRef.current;
    if (!r) return;
    const millis = Number(e.target.value);
    r.seek(millis, () => setPosition(millis));
  }

  if (error) return <p className="notice error">{error}</p>;
  if (empty) return <p className="notice">This recording is empty.</p>;

  return (
    <div className="guac-recording">
      <div ref={displayRef} className="guac-recording-display" />
      <div className="guac-recording-controls">
        <button type="button" className="btn sm" onClick={toggle} disabled={!ready}>
          {!ready ? "Loading…" : playing ? "Pause" : "Play"}
        </button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={position}
          onChange={onScrub}
          aria-label="Seek"
          disabled={!ready}
          style={{ flex: 1 }}
        />
        <span className="cell-sub">{fmt(position)} / {fmt(duration)}</span>
      </div>
    </div>
  );
}

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}
