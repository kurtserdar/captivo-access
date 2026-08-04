export function composePhone(dial: string, national: string): string {
  const n = national.trim();
  if (!n) return "";
  return `${dial} ${n}`;
}
