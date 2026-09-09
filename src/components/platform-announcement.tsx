import { multiTenantEnabled } from "@/lib/tenant/enabled";
import { getPlatformConfig, activeAnnouncement } from "@/lib/platform/config";

// Platform-wide banner (Cloud). Renders nothing on self-host or when no
// announcement is active. Server component — one cached config read.
export async function PlatformAnnouncement() {
  if (!multiTenantEnabled()) return null;
  const a = activeAnnouncement(await getPlatformConfig());
  if (!a) return null;
  const bg = a.level === "danger" ? "var(--danger-soft)" : a.level === "warn" ? "var(--warn-soft)" : "var(--accent-soft)";
  const fg = a.level === "danger" ? "var(--danger)" : a.level === "warn" ? "var(--warn)" : "var(--accent)";
  return (
    <div className="update-banner" role="status" style={{ background: bg, color: fg }}>
      <span>{a.text}</span>
    </div>
  );
}
