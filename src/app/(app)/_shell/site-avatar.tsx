import { siteAvatar } from "@/lib/site/avatar";

// Decorative initial-letter badge for a Site. Hookless, so it works in both
// server and client component trees. The Site name beside it is the accessible
// label, so the badge itself is aria-hidden.
export function SiteAvatar({ name }: { name: string }) {
  const { initials, bg, fg } = siteAvatar(name);
  return (
    <span className="site-avatar" aria-hidden="true" style={{ background: bg, color: fg }}>
      {initials}
    </span>
  );
}
