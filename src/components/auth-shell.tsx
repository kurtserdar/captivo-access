import { BrandLockup } from "@/components/brand";

// Shared frame for the pre-login screens (setup / login / recover / invite):
// a centered card on a fixed-dark dotted backdrop, brand lockup above, tagline
// below. Purely presentational — the page's content is the card body.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="authx">
      <BrandLockup size={30} className="authx-lockup" />
      <div className="authx-card">
        <div className="authx-bar" aria-hidden="true">
          <span className="authx-dots"><i /><i /><i /></span>
          <span className="authx-host">access.captivo.io</span>
        </div>
        <div className="authx-body">{children}</div>
      </div>
    </div>
  );
}
