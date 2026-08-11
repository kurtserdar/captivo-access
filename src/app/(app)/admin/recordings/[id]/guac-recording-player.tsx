"use client";
import { useEffect, useRef, useState } from "react";

/* eslint-disable @typescript-eslint/no-explicit-any */
export function GuacRecordingPlayer({ recordingId }: { recordingId: string }) {
  const displayRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
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
        const recording = new Guacamole.SessionRecording(blob);
        recRef.current = recording;

        const display = recording.getDisplay();
        displayRef.current.innerHTML = "";
        displayRef.current.appendChild(display.getElement());

        recording.onprogress = (total: number) => setDuration(total);
        recording.onseek = (millis: number) => setPosition(millis);
        recording.onplay = () => setPlaying(true);
        recording.onpause = () => setPlaying(false);

        recording.connect();
      } catch {
        setError("Couldn't play this recording.");
      }
    })();
    return () => {
      disposed = true;
      try { recRef.current?.disconnect?.(); } catch { /* ignore */ }
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
        <button type="button" className="btn sm" onClick={toggle}>{playing ? "Pause" : "Play"}</button>
        <input
          type="range"
          min={0}
          max={duration || 0}
          value={position}
          onChange={onScrub}
          aria-label="Seek"
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
