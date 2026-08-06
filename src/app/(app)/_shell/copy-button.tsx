"use client";
import { useState } from "react";

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setState("ok");
    } catch {
      setState("err");
    }
    setTimeout(() => setState("idle"), 1500);
  }
  return (
    <button type="button" className="btn sm ghost" onClick={copy} aria-label={`${label} ${value}`}>
      {state === "ok" ? "Copied" : state === "err" ? "Copy failed" : label}
    </button>
  );
}
