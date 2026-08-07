"use client";

import { useEffect, useState } from "react";

const FMT: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
};

// Renders an ISO timestamp in the viewer's own locale + timezone. The initial
// (SSR / first-hydration) value is deterministic — fixed en-GB + UTC — so it is
// identical on server and client and produces no hydration mismatch; a
// client-only effect then re-formats it to the viewer's locale + timezone.
export function LocalTime({ iso }: { iso: string }) {
  const [text, setText] = useState(() => new Date(iso).toLocaleString("en-GB", { ...FMT, timeZone: "UTC" }));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(new Date(iso).toLocaleString(undefined, FMT));
  }, [iso]);
  return (
    <time dateTime={iso} title={iso}>
      {text}
    </time>
  );
}
