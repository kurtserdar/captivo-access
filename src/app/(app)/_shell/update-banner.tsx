"use client";

import { useEffect, useLayoutEffect, useState } from "react";
import { useRouter } from "next/navigation";

// Rendered admin-only from the app shell. It shows only when a newer version is
// passed (the server decides via isUpdateAvailable). Even when nothing is shown,
// it mounts so the background staleness refresh can run.
export function UpdateBanner({
  enabled,
  staleCheck,
  currentVersion,
  latestVersion,
  latestUrl,
}: {
  enabled: boolean;
  staleCheck: boolean;
  currentVersion: string;
  latestVersion: string | null;
  latestUrl: string | null;
}) {
  const router = useRouter();
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);

  // Read dismissed version from localStorage on mount.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissedVersion(localStorage.getItem("ca_update_dismissed"));
  }, []);

  // Non-blocking background refresh if the cache is stale (>24h/never).
  useEffect(() => {
    if (!enabled || !staleCheck) return;
    fetch("/api/admin/updates/check", { method: "POST" })
      .then(() => router.refresh())
      .catch(() => {});
  }, [enabled, staleCheck, router]);

  const dismissed = dismissedVersion === latestVersion;
  if (!latestVersion || dismissed) return null;

  return (
    <div className="update-banner" role="status">
      <span>
        Captivo Access <strong>{latestVersion}</strong> is available — you&apos;re on {currentVersion}.{" "}
        {latestUrl && (
          <a href={latestUrl} target="_blank" rel="noopener noreferrer">
            Release notes ↗
          </a>
        )}
      </span>
      <button
        type="button"
        className="btn sm ghost"
        onClick={() => {
          localStorage.setItem("ca_update_dismissed", latestVersion);
          setDismissedVersion(latestVersion);
        }}
      >
        Dismiss
      </button>
    </div>
  );
}
