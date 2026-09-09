"use client";

import { useEffect, useState } from "react";
import { useTimezone } from "./timezone-context";

// The zone dates are actually shown/entered in: the configured display timezone
// from context, else the viewer's browser zone. The browser zone is only known
// after mount, so this is null during SSR / first paint when nothing is configured.
export function useEffectiveTimezone(): string | null {
  const configured = useTimezone();
  const [browser, setBrowser] = useState<string | null>(null);
  useEffect(() => {
    try {
      setBrowser(Intl.DateTimeFormat().resolvedOptions().timeZone || null);
    } catch {
      /* leave null */
    }
  }, []);
  return configured ?? browser;
}

// Inline hint for date/time inputs so the operator knows which zone the wall
// time they type is interpreted in, e.g. "End (optional) · Europe/Istanbul".
export function TimezoneHint() {
  const tz = useEffectiveTimezone();
  if (!tz) return null;
  return <span className="cell-sub"> · {tz}</span>;
}

// Account-menu line: which zone the console is showing times in.
export function TimezoneLabel({ prefix = "Times in " }: { prefix?: string }) {
  const tz = useEffectiveTimezone();
  return <span>{prefix}{tz ?? "your browser's timezone"}</span>;
}
