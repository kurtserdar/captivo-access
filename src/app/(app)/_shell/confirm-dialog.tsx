"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Pending = { message: string; danger: boolean; confirmLabel: string; resolve: (ok: boolean) => void };

export function useConfirm() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (message: string, opts?: { danger?: boolean; confirmLabel?: string }) =>
      new Promise<boolean>((resolve) => {
        setPending({ message, danger: opts?.danger ?? false, confirmLabel: opts?.confirmLabel ?? "Confirm", resolve });
      }),
    [],
  );

  const close = useCallback((ok: boolean) => {
    setPending((p) => {
      p?.resolve(ok);
      return null;
    });
  }, []);

  const dialog = pending ? <ConfirmDialog pending={pending} onClose={close} /> : null;
  return { confirm, dialog };
}

function ConfirmDialog({ pending, onClose }: { pending: Pending; onClose: (ok: boolean) => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    confirmRef.current?.focus();
  }, []);

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") { e.preventDefault(); onClose(false); }
    else if (e.key === "Enter") { e.preventDefault(); onClose(true); }
    else if (e.key === "Tab") {
      // Focus trap: keep Tab within the dialog's two buttons.
      const focusable = panelRef.current?.querySelectorAll<HTMLElement>("button");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }

  return createPortal(
    <div className="cmd-overlay" onClick={() => onClose(false)} role="dialog" aria-modal="true" aria-label="Confirm">
      <div className="cmd-panel confirm-panel" ref={panelRef} onClick={(e) => e.stopPropagation()} onKeyDown={onKeyDown}>
        <p className="confirm-msg">{pending.message}</p>
        <div className="confirm-actions">
          <button className="btn ghost" onClick={() => onClose(false)}>Cancel</button>
          <button ref={confirmRef} className={`btn ${pending.danger ? "danger" : "primary"}`} onClick={() => onClose(true)}>
            {pending.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
