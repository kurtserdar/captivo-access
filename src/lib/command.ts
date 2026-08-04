export type CommandItem = {
  id: string;
  label: string;
  sub: string | null;
  href: string;
  group: "Pages" | "Sites" | "Connectors" | "Users";
};

export function filterCommandItems(query: string, items: CommandItem[], limit = 12): CommandItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.filter((i) => i.group === "Pages");
  const matches = items.filter(
    (i) => i.label.toLowerCase().includes(q) || (i.sub ? i.sub.toLowerCase().includes(q) : false),
  );
  return matches.slice(0, limit);
}
