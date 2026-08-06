"use client";

import { useEffect, useState } from "react";
import { COMMON_TIMEZONES, type Schedule } from "@/lib/access/schedule";

const DAYS = [
  { i: 1, l: "Mon" }, { i: 2, l: "Tue" }, { i: 3, l: "Wed" }, { i: 4, l: "Thu" },
  { i: 5, l: "Fri" }, { i: 6, l: "Sat" }, { i: 0, l: "Sun" },
];

type State = { enabled: boolean; days: number[]; start: string; end: string; tz: string };

export function ScheduleBuilder({ onChange }: { onChange: (s: Schedule | null) => void }) {
  const [s, setS] = useState<State>({ enabled: false, days: [1, 2, 3, 4, 5], start: "09:00", end: "18:00", tz: "UTC" });

  // Default the timezone to the operator's browser zone (set after mount to
  // avoid an SSR/client hydration mismatch). They can still pick any zone.
  useEffect(() => {
    try {
      const b = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (b) setS((prev) => ({ ...prev, tz: b }));
    } catch {
      /* keep UTC */
    }
  }, []);

  function update(patch: Partial<State>) {
    const next = { ...s, ...patch };
    setS(next);
    onChange(next.enabled ? { timezone: next.tz, days: next.days, start: next.start, end: next.end } : null);
  }

  function toggleDay(i: number) {
    update({ days: s.days.includes(i) ? s.days.filter((d) => d !== i) : [...s.days, i] });
  }

  return (
    <div className="field">
      <label className="field-label">
        <input type="checkbox" checked={s.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Recurring hours
      </label>
      {s.enabled && (
        <div className="schedule-builder">
          <p className="cell-sub">Only allow access on these days and times.</p>
          <div className="day-toggles">
            {DAYS.map((d) => (
              <button
                type="button"
                key={d.i}
                className={`btn sm ${s.days.includes(d.i) ? "primary" : "ghost"}`}
                onClick={() => toggleDay(d.i)}
              >
                {d.l}
              </button>
            ))}
          </div>
          <div className="row-actions">
            <label className="field-label">From <input className="input" type="time" value={s.start} onChange={(e) => update({ start: e.target.value })} /></label>
            <label className="field-label">Until <input className="input" type="time" value={s.end} onChange={(e) => update({ end: e.target.value })} /></label>
          </div>
          <label className="field-label">Time zone
            <select className="select" value={s.tz} onChange={(e) => update({ tz: e.target.value })}>
              {(COMMON_TIMEZONES.includes(s.tz) ? COMMON_TIMEZONES : [s.tz, ...COMMON_TIMEZONES]).map((z) => (
                <option key={z} value={z}>{z}</option>
              ))}
            </select>
          </label>
        </div>
      )}
    </div>
  );
}
