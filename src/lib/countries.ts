export type Country = { code: string; name: string; flag: string; dial: string };

export const DEFAULT_COUNTRY = "TR";

// Curated list — TR first, then alphabetical by name. Emoji flags (unicode, no assets).
export const COUNTRIES: Country[] = [
  { code: "TR", name: "Türkiye", flag: "🇹🇷", dial: "+90" },
  { code: "AU", name: "Australia", flag: "🇦🇺", dial: "+61" },
  { code: "AZ", name: "Azerbaijan", flag: "🇦🇿", dial: "+994" },
  { code: "BR", name: "Brazil", flag: "🇧🇷", dial: "+55" },
  { code: "CA", name: "Canada", flag: "🇨🇦", dial: "+1" },
  { code: "CN", name: "China", flag: "🇨🇳", dial: "+86" },
  { code: "FR", name: "France", flag: "🇫🇷", dial: "+33" },
  { code: "GE", name: "Georgia", flag: "🇬🇪", dial: "+995" },
  { code: "DE", name: "Germany", flag: "🇩🇪", dial: "+49" },
  { code: "IN", name: "India", flag: "🇮🇳", dial: "+91" },
  { code: "IT", name: "Italy", flag: "🇮🇹", dial: "+39" },
  { code: "JP", name: "Japan", flag: "🇯🇵", dial: "+81" },
  { code: "NL", name: "Netherlands", flag: "🇳🇱", dial: "+31" },
  { code: "PL", name: "Poland", flag: "🇵🇱", dial: "+48" },
  { code: "RO", name: "Romania", flag: "🇷🇴", dial: "+40" },
  { code: "RU", name: "Russia", flag: "🇷🇺", dial: "+7" },
  { code: "SA", name: "Saudi Arabia", flag: "🇸🇦", dial: "+966" },
  { code: "KR", name: "South Korea", flag: "🇰🇷", dial: "+82" },
  { code: "ES", name: "Spain", flag: "🇪🇸", dial: "+34" },
  { code: "SE", name: "Sweden", flag: "🇸🇪", dial: "+46" },
  { code: "CH", name: "Switzerland", flag: "🇨🇭", dial: "+41" },
  { code: "UA", name: "Ukraine", flag: "🇺🇦", dial: "+380" },
  { code: "AE", name: "United Arab Emirates", flag: "🇦🇪", dial: "+971" },
  { code: "GB", name: "United Kingdom", flag: "🇬🇧", dial: "+44" },
  { code: "US", name: "United States", flag: "🇺🇸", dial: "+1" },
];
