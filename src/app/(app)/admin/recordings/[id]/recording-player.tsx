"use client";
import { useEffect, useRef, useState } from "react";
import type { eventWithTime } from "rrweb";

export function RecordingPlayer({ id }: { id: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const playerRef = useRef<{ $destroy?: () => void } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);

  useEffect(() => {
    let disposed = false;
    (async () => {
      try {
        const res = await fetch(`/api/admin/recordings/${id}/events`);
        if (!res.ok) { setError("Couldn't load this recording."); return; }
        const body = await res.json();
        const events: unknown[] = Array.isArray(body.events) ? body.events : [];
        if (events.length < 2) { setEmpty(true); return; }
        if (disposed || !ref.current) return;
        const { default: Player } = await import("rrweb-player");
        await import("rrweb-player/dist/style.css");
        ref.current.innerHTML = "";
        const p = new Player({
          target: ref.current,
          props: { events: events as unknown as eventWithTime[], autoPlay: true, showController: true },
        });
        playerRef.current = p as unknown as { $destroy?: () => void };
      } catch {
        setError("Couldn't play this recording.");
      }
    })();
    return () => {
      disposed = true;
      playerRef.current?.$destroy?.();
      playerRef.current = null;
    };
  }, [id]);

  if (error) return <p className="notice error">{error}</p>;
  if (empty) return <p className="notice">This recording is too short to play.</p>;
  return <div ref={ref} />;
}
