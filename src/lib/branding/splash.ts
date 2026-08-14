// Pure validation for an uploaded splash image. Arrives as base64 (or a data: URL)
// plus a MIME type; decodes + bounds it. Rendered only via <img> under a sandboxing
// CSP, so raster + GIF are safe. No SVG (avoid scriptable markup for a full-viewport
// image).
export const ALLOWED_SPLASH_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
export const MAX_SPLASH_BYTES = 2 * 1024 * 1024; // 2 MB (GIFs run larger)

export type SplashUpdate =
  | { action: "clear" }
  | { action: "set"; data: Uint8Array<ArrayBuffer>; type: string }
  | { action: "error"; error: string };

export function parseSplashUpload(image: unknown, type: unknown): SplashUpdate {
  if (image === null || image === "") return { action: "clear" };
  if (typeof image !== "string") return { action: "error", error: "invalid_image" };
  if (typeof type !== "string" || !ALLOWED_SPLASH_TYPES.has(type)) {
    return { action: "error", error: "invalid_image_type" };
  }
  const comma = image.indexOf(",");
  const b64 = image.startsWith("data:") && comma >= 0 ? image.slice(comma + 1) : image;
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) return { action: "error", error: "invalid_image" };
  if (buf.length > MAX_SPLASH_BYTES) return { action: "error", error: "image_too_large" };
  const data = new Uint8Array(buf.length);
  data.set(buf);
  return { action: "set", data, type };
}
