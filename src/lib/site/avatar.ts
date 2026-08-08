export interface SiteAvatarData {
  initials: string;
  bg: string;
  fg: string;
}

// Deterministic initial-letter avatar for a Site: the same name always yields
// the same initials + color. Pure, dependency-free.
export function siteAvatar(name: string): SiteAvatarData {
  const trimmed = (name ?? "").trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  let initials: string;
  if (words.length === 0) initials = "?";
  else if (words.length === 1) initials = words[0].slice(0, 2).toUpperCase();
  else initials = (words[0][0] + words[1][0]).toUpperCase();

  // Stable string hash -> hue 0..359 (same name -> same color).
  let h = 0;
  for (let i = 0; i < trimmed.length; i++) {
    h = (h * 31 + trimmed.charCodeAt(i)) >>> 0;
  }
  const hue = h % 360;
  return { initials, bg: `hsl(${hue}, 55%, 45%)`, fg: "#fff" };
}
