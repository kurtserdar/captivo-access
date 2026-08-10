// Shared frame for the pre-login screens (setup / login / recover / invite):
// a branded accent panel on the left beside the form card on the right. On
// narrow screens the panel hides and only the form shows. Purely presentational
// — the page's heading + form are passed as children, unchanged.
export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-panel">
        <div className="auth-panel-top">
          <span className="auth-panel-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" width="24" height="24" fill="none">
              <path d="M24 3 L42 13 V27 C42 37 34 43 24 46 C14 43 6 37 6 27 V13 Z" fill="#2ee6c9" opacity="0.22" />
              <path d="M24 3 L42 13 V27 C42 37 34 43 24 46 C14 43 6 37 6 27 V13 Z" stroke="#2ee6c9" strokeWidth="2" />
              <circle cx="24" cy="23" r="6.5" stroke="#2ee6c9" strokeWidth="2.4" />
              <path d="M24 29.5 V37" stroke="#2ee6c9" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="auth-panel-word">Captivo Access</span>
        </div>
        <h2 className="auth-panel-title">Secure vendor access, without a VPN.</h2>
        <p className="auth-panel-lede">
          Passkey identity, time-boxed grants, and a tamper-evident audit trail —
          self-hosted, on your own network.
        </p>
        <ul className="auth-panel-list">
          <li>Passwordless passkey sign-in</li>
          <li>Every session audited &amp; KVKK/5651-ready</li>
          <li>Nothing leaves your network</li>
        </ul>
        <div className="auth-panel-foot">Open-source · self-hosted Zero-Trust access</div>
      </aside>
      <div className="auth-main">
        <div className="auth-card">{children}</div>
      </div>
    </div>
  );
}
