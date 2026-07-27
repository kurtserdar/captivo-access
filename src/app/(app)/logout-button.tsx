"use client";

import { useState } from "react";

export function LogoutButton() {
  const [busy, setBusy] = useState(false);

  async function handleClick() {
    setBusy(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      window.location.href = "/login";
    }
  }

  return (
    <button type="button" className="link-button" onClick={handleClick} disabled={busy}>
      {busy ? "Signing out…" : "Log out"}
    </button>
  );
}
