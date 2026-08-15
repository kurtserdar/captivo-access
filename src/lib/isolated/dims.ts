// Picks the isolated desktop size. On a touch device the remote is sized to the
// phone's viewport so the internal web app renders its mobile/responsive layout at
// ~1:1 (native touch usable); otherwise it matches the vendor's screen. The broker
// keeps this size fixed for the session (recording stays correct).
export function isolatedDims(
  isTouch: boolean,
  screenW: number,
  screenH: number,
  innerW: number,
  innerH: number,
): { w: number; h: number } {
  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v)));
  return isTouch
    ? { w: clamp(innerW, 360, 820), h: clamp(innerH, 480, 1180) }
    : { w: clamp(screenW, 1024, 2560), h: clamp(screenH, 640, 1600) };
}
