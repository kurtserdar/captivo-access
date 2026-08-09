import { siteAvatar } from "@/lib/site/avatar";

// Badge for a Site: the uploaded logo when one exists, otherwise a deterministic
// initial-letter avatar. Hookless, so it works in both server and client trees.
// Decorative — the Site name beside it is the accessible label.
export function SiteAvatar({ name, siteId, hasLogo }: { name: string; siteId?: string; hasLogo?: boolean }) {
  if (hasLogo && siteId) {
    return (
      <img
        className="site-avatar site-avatar-img"
        src={`/api/sites/${encodeURIComponent(siteId)}/logo`}
        alt=""
        aria-hidden="true"
      />
    );
  }
  const { initials, bg, fg } = siteAvatar(name);
  return (
    <span className="site-avatar" aria-hidden="true" style={{ background: bg, color: fg }}>
      {initials}
    </span>
  );
}
