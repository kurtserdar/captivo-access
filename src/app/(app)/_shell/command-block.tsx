"use client";
import { useState } from "react";

// A macOS-style terminal window for shell commands. Fixed dark palette in every
// theme (a terminal is always dark). Shows `display` (pretty multi-line), copies
// `command` (the runnable one-liner).
export function CommandBlock({
  command,
  display,
  title,
}: {
  command: string;
  display?: string;
  title?: string;
}) {
  const [state, setState] = useState<"idle" | "ok" | "err">("idle");
  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("ok");
    } catch {
      setState("err");
    }
    setTimeout(() => setState("idle"), 1500);
  }

  const lines = (display ?? command).split("\n");
  return (
    <div className="term">
      <div className="term-bar">
        <span className="term-dots" aria-hidden="true">
          <i style={{ background: "#ff5f57" }} />
          <i style={{ background: "#febc2e" }} />
          <i style={{ background: "#28c840" }} />
        </span>
        {title && <span className="term-title">{title}</span>}
        <button type="button" className="term-copy" onClick={copy} aria-label="Copy command">
          {state === "ok" ? "Copied" : state === "err" ? "Copy failed" : "Copy"}
        </button>
      </div>
      <div className="term-body">
        {lines.map((line, idx) => (
          <div key={idx} className="term-line">
            {idx === 0 && <span className="term-prompt">$ </span>}
            <span className={line.trimStart().startsWith("#") ? "term-comment" : undefined}>{line}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
