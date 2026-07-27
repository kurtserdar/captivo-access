"use client";

import { useState } from "react";

function errorMessage(code: string | undefined): string {
  switch (code) {
    case "invalid_code":
      return "The verification code is incorrect.";
    case "invalid_body":
      return "A verification code is required.";
    case "unauthorized":
      return "Your session has expired, please sign in again.";
    default:
      return "Couldn't set up recovery, please try again.";
  }
}

export function RecoverySetup({ accountName }: { accountName: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleStart() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recovery/start", { method: "POST" });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.secret) {
        setError(errorMessage(result?.error));
        return;
      }
      setSecret(result.secret);
      setOtpauth(result.otpauth);
    } catch {
      setError("Couldn't set up recovery, please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm(e: React.FormEvent) {
    e.preventDefault();
    if (!secret) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/recovery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, secret }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok || !result?.ok) {
        setError(errorMessage(result?.error));
        return;
      }
      window.location.reload();
    } catch {
      setError("Couldn't set up recovery, please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!secret) {
    return (
      <div>
        {error && <p role="alert">{error}</p>}
        <button type="button" onClick={handleStart} disabled={busy}>
          {busy ? "Preparing…" : "Set up recovery"}
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleConfirm}>
      <p>
        Add the key below to your authenticator app manually (for the account{" "}
        {accountName}), then enter the generated 6-digit code.
      </p>
      <code className="secret">{secret}</code>
      {otpauth && <code className="secret">{otpauth}</code>}
      <label>
        Verification code
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          required
          autoComplete="one-time-code"
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <button type="submit" disabled={busy}>
        {busy ? "Verifying…" : "Verify and enable"}
      </button>
    </form>
  );
}
