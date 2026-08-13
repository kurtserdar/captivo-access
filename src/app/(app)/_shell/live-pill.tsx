"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { livePillView } from "@/lib/nav/live-pill";

const POLL_MS = 10_000;

export function LivePill() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    let alive = true;

    async function refresh() {
      try {
        const res = await fetch("/api/admin/live/count", { cache: "no-store" });
        if (!res.ok) return; // keep last known count on a non-OK response
        const data = (await res.json()) as { count?: number };
        if (alive && typeof data.count === "number") setCount(data.count);
      } catch {
        // network error — keep last known count
      }
    }

    refresh(); // immediate first fetch on mount
    const id = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, POLL_MS);

    function onVisible() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      alive = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const view = livePillView(count);
  return (
    <Link
      href="/admin/live"
      className={view.live ? "live-pill on" : "live-pill"}
      aria-label={`Live sessions: ${view.label}`}
      title="Live sessions"
    >
      <span className="live-dot" aria-hidden="true" />
      {view.label}
    </Link>
  );
}
