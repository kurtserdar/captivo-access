// True iff the event stream contains an rrweb FullSnapshot (type 2), the DOM
// anchor rrweb-player must have to render anything. A stream of incrementals
// with no FullSnapshot replays as a blank screen.
export function hasFullSnapshot(events: unknown[]): boolean {
  return events.some(
    (e) => typeof e === "object" && e !== null && (e as { type?: number }).type === 2,
  );
}
