export type LivePillView = { label: string; live: boolean };

// Maps an active-session count to the pill's label and live flag. Guards against
// negative / non-finite inputs (treated as idle) so the header never renders junk.
export function livePillView(count: number): LivePillView {
  const n = Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  return n > 0 ? { label: `${n} live`, live: true } : { label: "Idle", live: false };
}
