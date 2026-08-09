"use client";
import { useState } from "react";
import { Modal } from "@/app/(app)/_shell/modal";
import { GrantForm } from "./grant-form";
import type { Role } from "@/generated/prisma/enums";

export function AddGrantButton({
  users,
  sites,
}: {
  users: { id: string; name: string; email: string; role: Role }[];
  sites: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn primary" onClick={() => setOpen(true)}>
        New grant
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="New grant" size="lg">
        <GrantForm users={users} sites={sites} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
