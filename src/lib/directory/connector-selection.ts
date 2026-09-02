// Decide the directory form's connector <select> initial value and whether to
// warn the admin. The saved connectorId can dangle: the connector it named may
// have been deleted or revoked, so it is absent from the pickable list. When
// that happens we force an explicit re-pick (empty value + warning) instead of
// silently showing the first connector while keeping the stale id in state.
export function resolveConnectorChoice(
  savedId: string | null | undefined,
  connectors: { id: string }[],
): { value: string; savedMissing: boolean } {
  const exists = !!savedId && connectors.some((c) => c.id === savedId);
  if (savedId && !exists) return { value: "", savedMissing: true };
  // Fresh/never-configured: convenience-default to the first connector.
  return { value: savedId || connectors[0]?.id || "", savedMissing: false };
}
