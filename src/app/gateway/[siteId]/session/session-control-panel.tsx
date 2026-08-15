"use client";
import { useState } from "react";

export type PanelAction = { key: string; label: string; sublabel?: string; onClick?: () => void; status?: string };

export function SessionControlPanel({ actions }: { actions: PanelAction[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="scp-handle" onClick={() => setOpen((v) => !v)} aria-label="Session controls" title="Session controls">⋮⋮</button>
      {open && (
        <div className="scp" role="group" aria-label="Session controls">
          <div className="scp-head"><span>Control Panel</span><button type="button" className="scp-close" onClick={() => setOpen(false)} aria-label="Close">✕</button></div>
          {actions.map((a) => (
            <button key={a.key} type="button" className="scp-item" disabled={!a.onClick} onClick={a.onClick}>
              <div className="scp-item-label">{a.label}</div>
              {(a.sublabel || a.status) && <div className="scp-item-sub">{a.status ?? a.sublabel}</div>}
            </button>
          ))}
        </div>
      )}
    </>
  );
}
