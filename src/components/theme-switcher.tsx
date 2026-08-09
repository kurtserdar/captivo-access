"use client";
import { useEffect, useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "resend" | "system";

// Pure: the concrete theme to apply given the preference and the OS setting.
export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): "light" | "dark" | "resend" {
  if (pref === "light" || pref === "dark" || pref === "resend") return pref;
  return systemPrefersDark ? "dark" : "light";
}

const listeners = new Set<() => void>();
function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot(): ThemePref {
  const v = localStorage.getItem("ca-theme");
  return v === "light" || v === "dark" || v === "resend" ? v : "system";
}
function getServerSnapshot(): ThemePref {
  return "system";
}
function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}
function apply(pref: ThemePref) {
  document.documentElement.dataset.theme = resolveTheme(pref, systemPrefersDark());
}
function setPref(pref: ThemePref) {
  localStorage.setItem("ca-theme", pref);
  apply(pref);
  listeners.forEach((l) => l());
}

const OPTIONS: { pref: ThemePref; label: string }[] = [
  { pref: "light", label: "Light" },
  { pref: "dark", label: "Dark" },
  { pref: "resend", label: "Resend" },
  { pref: "system", label: "System" },
];

export function ThemeSwitcher() {
  const pref = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    apply(pref);
  }, [pref]);

  // While following the OS, react to OS theme changes live.
  useEffect(() => {
    if (pref !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => apply("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [pref]);

  return (
    <div className="theme-switch" role="group" aria-label="Theme">
      {OPTIONS.map((o) => (
        <button
          key={o.pref}
          type="button"
          className={`theme-opt${pref === o.pref ? " on" : ""}`}
          aria-pressed={pref === o.pref}
          aria-label={`${o.label} theme`}
          title={o.label}
          onClick={() => setPref(o.pref)}
        >
          {o.pref === "light" ? <SunIcon /> : o.pref === "dark" ? <MoonIcon /> : o.pref === "resend" ? <ResendIcon /> : <MonitorIcon />}
        </button>
      ))}
    </div>
  );
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M4.5 12h-2M21.5 12h-2M5.6 5.6L4.2 4.2M19.8 19.8l-1.4-1.4M18.4 5.6l1.4-1.4M4.2 19.8l1.4-1.4" />
    </svg>
  );
}
function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}
function ResendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <text x="12" y="17" textAnchor="middle" fontFamily="Georgia, 'Times New Roman', serif" fontSize="16" fontWeight="600" fill="currentColor">R</text>
    </svg>
  );
}
function MonitorIcon() {
  return (
    <svg viewBox="0 0 24 24" stroke="currentColor" fill="none" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="12" rx="1.5" />
      <path d="M9 20.5h6M12 16.5v4" />
    </svg>
  );
}
