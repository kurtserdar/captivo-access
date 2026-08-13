"use client";
import { useState } from "react";
import { Modal } from "@/app/(app)/_shell/modal";
import { RequestAccessForm } from "./request-access-form";

export function RequestAccessButton({ requireJustification = true }: { requireJustification?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        Request access
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Request access" size="md">
        <RequestAccessForm onDone={() => setOpen(false)} requireJustification={requireJustification} />
      </Modal>
    </>
  );
}
