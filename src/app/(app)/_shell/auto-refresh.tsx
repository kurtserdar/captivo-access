"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Periodically re-runs the current server component via router.refresh(), so a
// server-rendered page (console home, /admin/live) stays near-real-time without a
// full reload. Pauses while the tab is hidden; refreshes immediately on refocus.
// Renders nothing. Mirrors the live-pill polling pattern.
export function AutoRefresh({ intervalMs = 10_000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, intervalMs);
    function onVisible() {
      if (document.visibilityState === "visible") router.refresh();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs]);
  return null;
}
