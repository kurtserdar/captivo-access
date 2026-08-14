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
    <button type="button" className="nav-logout" onClick={handleClick} disabled={busy} title="Log out" aria-label="Log out">
      Logout
    </button>
  );
}
