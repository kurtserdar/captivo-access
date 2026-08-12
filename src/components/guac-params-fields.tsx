"use client";
import { KEYBOARD_LAYOUTS, type GuacParams } from "@/lib/gateway/guac-params";

// Form-friendly shape: every field is a string ("" = use default). Toggles are a
// 3-way select ("" default / "on" / "off") so an override can also force OFF.
export interface GuacFields {
  serverLayout: string;
  colorDepth: string;
  enableWallpaper: string;
  enableTheming: string;
  enableFontSmoothing: string;
  enableFullWindowDrag: string;
}

export const EMPTY_GUAC_FIELDS: GuacFields = {
  serverLayout: "", colorDepth: "", enableWallpaper: "", enableTheming: "", enableFontSmoothing: "", enableFullWindowDrag: "",
};

const TOGGLES: { key: keyof GuacFields; label: string }[] = [
  { key: "enableWallpaper", label: "Desktop wallpaper" },
  { key: "enableTheming", label: "Window theming" },
  { key: "enableFontSmoothing", label: "Font smoothing" },
  { key: "enableFullWindowDrag", label: "Full-window drag" },
];

export function paramsToGuacFields(p: GuacParams): GuacFields {
  const tri = (b?: boolean) => (b === undefined ? "" : b ? "on" : "off");
  return {
    serverLayout: p.serverLayout ?? "",
    colorDepth: p.colorDepth ? String(p.colorDepth) : "",
    enableWallpaper: tri(p.enableWallpaper),
    enableTheming: tri(p.enableTheming),
    enableFontSmoothing: tri(p.enableFontSmoothing),
    enableFullWindowDrag: tri(p.enableFullWindowDrag),
  };
}

export function guacFieldsToParams(f: GuacFields): GuacParams {
  const p: GuacParams = {};
  if (f.serverLayout) p.serverLayout = f.serverLayout;
  if (f.colorDepth) p.colorDepth = Number(f.colorDepth) as 8 | 16 | 24;
  for (const { key } of TOGGLES) {
    if (f[key] === "on") (p as Record<string, unknown>)[key] = true;
    else if (f[key] === "off") (p as Record<string, unknown>)[key] = false;
  }
  return p;
}

// protocol: undefined = show all (Policy defaults); RDP = all; VNC = colour depth only; SSH = none.
export function GuacParamsFields({ value, onChange, protocol }: { value: GuacFields; onChange: (v: GuacFields) => void; protocol?: "RDP" | "SSH" | "VNC" }) {
  const set = (k: keyof GuacFields, v: string) => onChange({ ...value, [k]: v });
  const showLayout = !protocol || protocol === "RDP";
  const showDepth = !protocol || protocol === "RDP" || protocol === "VNC";
  const showPerf = !protocol || protocol === "RDP";
  if (protocol === "SSH") return <p className="cell-sub">No display parameters for SSH. Clipboard is controlled above.</p>;
  return (
    <div className="guac-fields">
      {showLayout && (
        <label className="field"><span className="field-label">Keyboard layout {protocol ? "" : "(RDP)"}</span>
          <select className="select" value={value.serverLayout} onChange={(e) => set("serverLayout", e.target.value)}>
            {KEYBOARD_LAYOUTS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
          </select>
        </label>
      )}
      {showDepth && (
        <label className="field"><span className="field-label">Colour depth</span>
          <select className="select" value={value.colorDepth} onChange={(e) => set("colorDepth", e.target.value)}>
            <option value="">Default</option>
            <option value="24">24-bit</option>
            <option value="16">16-bit</option>
            <option value="8">8-bit</option>
          </select>
        </label>
      )}
      {showPerf && TOGGLES.map(({ key, label }) => (
        <label className="field" key={key}><span className="field-label">{label} {protocol ? "" : "(RDP)"}</span>
          <select className="select" value={value[key]} onChange={(e) => set(key, e.target.value)}>
            <option value="">Default</option>
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
      ))}
    </div>
  );
}
