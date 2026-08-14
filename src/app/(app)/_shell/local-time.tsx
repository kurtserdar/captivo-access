"use client";

import { useEffect, useState } from "react";
import { useTimezone } from "./timezone-context";

const DATETIME: Intl.DateTimeFormatOptions = {
  year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
};
const TIME: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };

// Renders an ISO timestamp in the configured display timezone (from context), or the
// viewer's own browser timezone when none is set. The initial (SSR / first-hydration)
// value is deterministic — fixed en-GB + UTC — so it is identical on server and
// client (no hydration mismatch); a client-only effect then re-formats it.
export function LocalTime({ iso, mode = "datetime" }: { iso: string; mode?: "datetime" | "time" }) {
  const tz = useTimezone();
  const fmt = mode === "time" ? TIME : DATETIME;
  const [text, setText] = useState(() => new Date(iso).toLocaleString("en-GB", { ...fmt, timeZone: "UTC" }));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(new Date(iso).toLocaleString(undefined, tz ? { ...fmt, timeZone: tz } : fmt));
  }, [iso, tz, mode, fmt]);
  return (
    <time dateTime={iso} title={iso}>
      {text}
    </time>
  );
}
