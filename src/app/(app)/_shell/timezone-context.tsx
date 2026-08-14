"use client";
import { createContext, useContext } from "react";

const TimezoneContext = createContext<string | null>(null);

// Provides the resolved display timezone (or null → viewer's browser TZ) to client
// date components. Fed a server-resolved value at each layout root.
export function TimezoneProvider({ tz, children }: { tz: string | null; children: React.ReactNode }) {
  return <TimezoneContext.Provider value={tz}>{children}</TimezoneContext.Provider>;
}

export function useTimezone(): string | null {
  return useContext(TimezoneContext);
}
