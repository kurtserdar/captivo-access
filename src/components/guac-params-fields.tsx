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
  fileTransfer: string;
  blockUpload: string;
  blockDownload: string;
  sftpRoot: string;
}

export const EMPTY_GUAC_FIELDS: GuacFields = {
  serverLayout: "", colorDepth: "", enableWallpaper: "", enableTheming: "", enableFontSmoothing: "", enableFullWindowDrag: "",
  fileTransfer: "", blockUpload: "", blockDownload: "", sftpRoot: "",
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
    fileTransfer: tri(p.enableFileTransfer),
    blockUpload: tri(p.blockUpload),
    blockDownload: tri(p.blockDownload),
    sftpRoot: p.sftpRoot ?? "",
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
  const triToBool = (v: string, k: "enableFileTransfer" | "blockUpload" | "blockDownload") => {
    if (v === "on") (p as Record<string, unknown>)[k] = true;
    else if (v === "off") (p as Record<string, unknown>)[k] = false;
  };
  triToBool(f.fileTransfer, "enableFileTransfer");
  triToBool(f.blockUpload, "blockUpload");
  triToBool(f.blockDownload, "blockDownload");
  if (f.sftpRoot.trim()) p.sftpRoot = f.sftpRoot.trim();
  return p;
}

// protocol: undefined = show all (Policy defaults); RDP = all; VNC = colour depth only; SSH = none.
export function GuacParamsFields({ value, onChange, protocol }: { value: GuacFields; onChange: (v: GuacFields) => void; protocol?: "RDP" | "SSH" | "VNC" }) {
  const set = (k: keyof GuacFields, v: string) => onChange({ ...value, [k]: v });
  const showLayout = !protocol || protocol === "RDP";
  const showDepth = !protocol || protocol === "RDP" || protocol === "VNC";
  const showPerf = !protocol || protocol === "RDP";
  const showFt = !protocol || protocol === "RDP" || protocol === "SSH";
  const showSftpRoot = !protocol || protocol === "SSH";
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
      {showFt && (
        <label className="field"><span className="field-label">File transfer</span>
          <select className="select" value={value.fileTransfer} onChange={(e) => set("fileTransfer", e.target.value)}>
            <option value="">Default</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </label>
      )}
      {showFt && value.fileTransfer !== "off" && (
        <label className="field"><span className="field-label">Block upload</span>
          <select className="select" value={value.blockUpload} onChange={(e) => set("blockUpload", e.target.value)}>
            <option value="">Default</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </label>
      )}
      {showFt && value.fileTransfer !== "off" && (
        <label className="field"><span className="field-label">Block download</span>
          <select className="select" value={value.blockDownload} onChange={(e) => set("blockDownload", e.target.value)}>
            <option value="">Default</option><option value="on">On</option><option value="off">Off</option>
          </select>
        </label>
      )}
      {showSftpRoot && value.fileTransfer !== "off" && (
        <label className="field"><span className="field-label">SFTP upload folder {protocol ? "" : "(SSH)"}</span>
          <input className="input" type="text" value={value.sftpRoot} placeholder="Auto (the user's home directory)"
            onChange={(e) => set("sftpRoot", e.target.value)} />
          <span className="field-hint">Absolute path on the target where uploaded files are written. Leave blank to use the login user&apos;s home.</span>
        </label>
      )}
    </div>
  );
}
