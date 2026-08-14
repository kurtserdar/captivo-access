"use client";
import { BrandLockup } from "@/components/brand";

// Full-viewport branded overlay shown while a session connects. Purely
// presentational: it is visible for as long as it is mounted, and the parent
// (GatewaySession / IsolatedSession) decides when the session is ready and stops
// rendering it. Fixed dark navy palette (the session route lives outside the app
// shell/theme, over a black viewer), verified-teal accent ring.
export function ConnectSplash({ siteName }: { siteName: string }) {
  return (
    <div className="connect-splash" role="status" aria-live="polite">
      <div className="connect-splash-ring" aria-hidden="true" />
      <div className="connect-splash-body">
        <BrandLockup size={40} className="connect-splash-brand" />
        <div className="connect-splash-site">{siteName}</div>
        <div className="connect-splash-note">Creating a secure connection…</div>
      </div>
    </div>
  );
}
