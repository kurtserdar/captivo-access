export function BrandMark({ size = 22, className }: { size?: number; className?: string }) {
  // Shield + aperture "gate": the security-vault silhouette with a keyhole-like
  // opening — the Zero-Trust "controlled gateway" motif, in the signature teal.
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="ca-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2ee6c9" />
          <stop offset="1" stopColor="#0e9488" />
        </linearGradient>
      </defs>
      <path d="M24 3 L42 13 V27 C42 37 34 43 24 46 C14 43 6 37 6 27 V13 Z" fill="url(#ca-mark)" opacity="0.16" />
      <path d="M24 3 L42 13 V27 C42 37 34 43 24 46 C14 43 6 37 6 27 V13 Z" stroke="url(#ca-mark)" strokeWidth="2" />
      <circle cx="24" cy="23" r="6.5" stroke="#2ee6c9" strokeWidth="2.4" />
      <path d="M24 29.5 V37" stroke="#2ee6c9" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
