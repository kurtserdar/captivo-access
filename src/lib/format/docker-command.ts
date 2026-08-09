// Pretty-prints a `docker run` one-liner into a readable multi-line form with
// backslash continuations. Pure and deterministic — used only for DISPLAY; the
// original one-liner is what callers copy. A string that is not a `docker run`
// command is returned unchanged.
export function formatDockerRun(oneLiner: string): string {
  const tokens = oneLiner.trim().split(/\s+/);
  if (tokens[0] !== "docker" || tokens[1] !== "run") return oneLiner;

  let i = 2;
  let firstLine = "docker run";
  // Boolean short flags (e.g. -d) right after `run` stay on line 1: a flag is
  // boolean when the next token is another flag or there is no next token.
  while (
    i < tokens.length &&
    /^-[a-zA-Z]$/.test(tokens[i]) &&
    (i + 1 >= tokens.length || tokens[i + 1].startsWith("-"))
  ) {
    firstLine += " " + tokens[i];
    i++;
  }

  const groups: string[] = [firstLine];
  while (i < tokens.length) {
    const t = tokens[i];
    if (t.startsWith("-") && i + 1 < tokens.length && !tokens[i + 1].startsWith("-")) {
      groups.push(`${t} ${tokens[i + 1]}`); // value flag + its value
      i += 2;
    } else {
      groups.push(t); // boolean flag or bare token (image)
      i += 1;
    }
  }
  return groups.join(" \\\n  ");
}
