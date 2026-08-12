export interface GuacParams {
  serverLayout?: string;
  colorDepth?: 8 | 16 | 24;
  enableWallpaper?: boolean;
  enableTheming?: boolean;
  enableFontSmoothing?: boolean;
  enableFullWindowDrag?: boolean;
}

export const KEYBOARD_LAYOUTS: { value: string; label: string }[] = [
  { value: "", label: "Default (US English)" },
  { value: "en-us-qwerty", label: "English (US)" },
  { value: "en-gb-qwerty", label: "English (UK)" },
  { value: "tr-tr-qwerty", label: "Turkish-Q" },
  { value: "de-de-qwertz", label: "German" },
  { value: "de-ch-qwertz", label: "German (Swiss)" },
  { value: "fr-fr-azerty", label: "French" },
  { value: "fr-be-azerty", label: "French (Belgian)" },
  { value: "fr-ch-qwertz", label: "French (Swiss)" },
  { value: "es-es-qwerty", label: "Spanish" },
  { value: "es-latam-qwerty", label: "Spanish (Latin American)" },
  { value: "it-it-qwerty", label: "Italian" },
  { value: "ja-jp-qwerty", label: "Japanese" },
  { value: "pt-br-qwerty", label: "Portuguese (Brazilian)" },
  { value: "sv-se-qwerty", label: "Swedish" },
  { value: "no-no-qwerty", label: "Norwegian" },
  { value: "hu-hu-qwertz", label: "Hungarian" },
];

const LAYOUTS = new Set(KEYBOARD_LAYOUTS.map((l) => l.value).filter(Boolean));
const DEPTHS = new Set([8, 16, 24]);
const BOOL_KEYS = ["enableWallpaper", "enableTheming", "enableFontSmoothing", "enableFullWindowDrag"] as const;

// Coerce untrusted JSON into GuacParams, keeping ONLY curated keys with valid values.
export function parseGuacParams(input: unknown): GuacParams {
  const out: GuacParams = {};
  if (!input || typeof input !== "object") return out;
  const o = input as Record<string, unknown>;
  if (typeof o.serverLayout === "string" && LAYOUTS.has(o.serverLayout)) out.serverLayout = o.serverLayout;
  if (typeof o.colorDepth === "number" && DEPTHS.has(o.colorDepth)) out.colorDepth = o.colorDepth as 8 | 16 | 24;
  for (const k of BOOL_KEYS) if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  return out;
}

// Per-field: resource value if present, else policy default. (undefined = guacd default.)
export function resolveGuacParams(resource: GuacParams, policy: GuacParams): GuacParams {
  return {
    serverLayout: resource.serverLayout ?? policy.serverLayout,
    colorDepth: resource.colorDepth ?? policy.colorDepth,
    enableWallpaper: resource.enableWallpaper ?? policy.enableWallpaper,
    enableTheming: resource.enableTheming ?? policy.enableTheming,
    enableFontSmoothing: resource.enableFontSmoothing ?? policy.enableFontSmoothing,
    enableFullWindowDrag: resource.enableFullWindowDrag ?? policy.enableFullWindowDrag,
  };
}

// Map resolved params + clipboardMode → guacd arg-name→value (only set/true fields).
export function toGuacArgs(p: GuacParams, clipboardMode: string): Record<string, string> {
  const a: Record<string, string> = {};
  if (p.serverLayout) a["server-layout"] = p.serverLayout;
  if (p.colorDepth) a["color-depth"] = String(p.colorDepth);
  if (p.enableWallpaper) a["enable-wallpaper"] = "true";
  if (p.enableTheming) a["enable-theming"] = "true";
  if (p.enableFontSmoothing) a["enable-font-smoothing"] = "true";
  if (p.enableFullWindowDrag) a["enable-full-window-drag"] = "true";
  if (clipboardMode === "no_copy" || clipboardMode === "none") a["disable-copy"] = "true";
  if (clipboardMode === "no_paste" || clipboardMode === "none") a["disable-paste"] = "true";
  return a;
}
