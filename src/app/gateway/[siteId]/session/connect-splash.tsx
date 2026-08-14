"use client";
import { useState } from "react";
import { BrandLockup } from "@/components/brand";

// Full-viewport branded overlay shown while a session connects. Shows the deployment's
// custom splash image if one is uploaded (/api/branding/splash), else the default
// Captivo BrandLockup. Fixed dark navy palette + verified-teal accent ring; the
// connecting text + spinner are unchanged.
export function ConnectSplash({ siteName }: { siteName: string }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <div className="connect-splash" role="status" aria-live="polite">
      <div className="connect-splash-ring" aria-hidden="true" />
      <div className="connect-splash-body">
        {imgFailed ? (
          <BrandLockup size={40} className="connect-splash-brand" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src="/api/branding/splash" alt="" className="connect-splash-brand" style={{ maxHeight: 96, maxWidth: 300 }} onError={() => setImgFailed(true)} />
        )}
        <div className="connect-splash-site">{siteName}</div>
        <div className="connect-splash-note">Creating a secure connection…</div>
      </div>
    </div>
  );
}
