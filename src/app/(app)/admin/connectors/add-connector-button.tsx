"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/app/(app)/_shell/modal";
import { ConnectorForm } from "./connector-form";

export function AddConnectorButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Refresh on close so the newly-paired (PENDING) connector shows in the list.
  function close() {
    setOpen(false);
    router.refresh();
  }
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        Add connector
      </button>
      <Modal open={open} onClose={close} title="Add connector" size="lg">
        <ConnectorForm />
      </Modal>
    </>
  );
}
