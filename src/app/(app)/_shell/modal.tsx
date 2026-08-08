"use client";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

// A small reusable modal dialog. Reuses the console's overlay styling
// (.cmd-overlay + .cmd-panel) and closes on Esc / click-outside, restoring focus.
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="cmd-overlay" onClick={onClose}>
      <div
        className="cmd-panel modal-panel"
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="card-head"><h2>{title}</h2></div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
