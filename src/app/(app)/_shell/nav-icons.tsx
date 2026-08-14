import type { NavIconKey } from "@/lib/nav/model";

// Inline stroke icons for the header megamenu cards. 16px, currentColor so the
// card's teal ink applies. One entry per NavIconKey; no external icon library.
const PATHS: Record<NavIconKey, React.ReactNode> = {
  connectors: (<><path d="M9 2v6M15 2v6M9 8h6a4 4 0 0 1 4 4 6 6 0 0 1-6 6h-2a6 6 0 0 1-6-6 4 4 0 0 1 4-4Z" /><path d="M12 18v4" /></>),
  resources: (<><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>),
  domain: (<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" /></>),
  directory: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" /></>),
  sso: (<><circle cx="8" cy="15" r="4" /><path d="m10.85 12.15 8-8M18 3l3 3M15 6l3 3" /></>),
  policy: (<><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>),
  email: (<><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>),
  branding: (<><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>),
  updates: (<><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  users: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /></>),
  invites: (<><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M19 8v6M22 11h-6" /></>),
  opsessions: (<><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></>),
};

export function NavIcon({ name }: { name: NavIconKey }) {
  const body = PATHS[name];
  if (!body) return null;
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {body}
    </svg>
  );
}
