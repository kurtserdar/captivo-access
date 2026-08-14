"use client";

// IANA timezone picker. Uses the browser's supported list; falls back to a small
// set if Intl.supportedValuesOf is unavailable. Empty value = "" (inherit/browser).
const FALLBACK = ["UTC", "Europe/Istanbul", "Europe/London", "America/New_York", "America/Los_Angeles", "Asia/Dubai"];

function zones(): string[] {
  try {
    const sv = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    return sv ? sv("timeZone") : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function TimezoneSelect({ value, onChange, inheritLabel }: { value: string; onChange: (v: string) => void; inheritLabel: string }) {
  return (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{inheritLabel}</option>
      {zones().map((z) => (
        <option key={z} value={z}>{z}</option>
      ))}
    </select>
  );
}
