"use client";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import type { Role } from "@/generated/prisma/enums";
import { can, type Capability } from "@/lib/auth/roles";
import type { SearchRecord } from "@/lib/search";
import { filterCommandItems, type CommandItem } from "@/lib/command";

const PAGES: { label: string; href: string; cap: Capability | null }[] = [
  { label: "Overview", href: "/", cap: null },
  { label: "My access", href: "/access", cap: null },
  { label: "Grants", href: "/admin/grants", cap: "read_console" },
  { label: "Connectors", href: "/admin/connectors", cap: "configure" },
  { label: "Resources", href: "/admin/sites", cap: "configure" },
  { label: "Notifications", href: "/admin/notifications", cap: "read_console" },
  { label: "Live sessions", href: "/admin/live", cap: "read_console" },
  { label: "Users", href: "/admin/users", cap: "configure" },
  { label: "Invites", href: "/admin/invites", cap: "configure" },
  { label: "Sessions", href: "/admin/sessions", cap: "configure" },
  { label: "Audit log", href: "/admin/audit", cap: "read_console" },
  { label: "Settings", href: "/settings/passkeys", cap: null },
];
const GROUP_FOR: Record<SearchRecord["type"], CommandItem["group"]> = {
  site: "Resources",
  connector: "Connectors",
  user: "Users",
};

// No-op subscribe: the Mac/non-Mac platform never changes during a session,
// so this store never needs to notify listeners of an update.
function subscribeNever() {
  return () => {};
}
function getIsMacSnapshot() {
  return navigator.userAgent.includes("Mac");
}
function getIsMacServerSnapshot() {
  return false;
}

export function CommandPalette({ records, role }: { records: SearchRecord[]; role: Role }) {
  const [open, setOpen] = useState(false);
  // useSyncExternalStore (rather than a mount-effect + setState) avoids both
  // a hydration mismatch and an effect-triggered re-render.
  const isMac = useSyncExternalStore(subscribeNever, getIsMacSnapshot, getIsMacServerSnapshot);

  const items: CommandItem[] = useMemo(() => {
    const pages: CommandItem[] = PAGES.filter((p) => p.cap === null || can(role, p.cap)).map((p) => ({
      id: `page:${p.href}`, label: p.label, sub: null, href: p.href, group: "Pages",
    }));
    const recs: CommandItem[] = records.map((r) => ({
      id: `${r.type}:${r.id}`, label: r.label, sub: r.sub, href: r.href, group: GROUP_FOR[r.type],
    }));
    return [...pages, ...recs];
  }, [records, role]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button className="cmd-trigger" onClick={() => setOpen(true)} aria-label="Search">
        <svg className="cmd-trigger-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
        <span className="cmd-trigger-text">Search…</span>
        <kbd>{isMac ? "⌘" : "Ctrl"} K</kbd>
      </button>
      {open && <PaletteOverlay items={items} onClose={() => setOpen(false)} />}
    </>
  );
}

// Mounted only while the palette is open, so `query`/`active` start fresh
// every time — no reset-on-open effect needed.
function PaletteOverlay({ items, onClose }: { items: CommandItem[]; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(t);
  }, []);

  const results = useMemo(() => filterCommandItems(query, items), [query, items]);

  function select(item: CommandItem | undefined) {
    if (!item) return;
    onClose();
    router.push(item.href);
  }

  function onQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    setActive(0);
  }

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      select(results[active]);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      e.preventDefault();
    }
  }

  const groups: { name: string; rows: { item: CommandItem; index: number }[] }[] = [];
  results.forEach((item, index) => {
    let g = groups.find((x) => x.name === item.group);
    if (!g) {
      g = { name: item.group, rows: [] };
      groups.push(g);
    }
    g.rows.push({ item, index });
  });

  // Portal to <body> so the fixed overlay escapes the topbar's containing block
  // (the topbar's backdrop-filter would otherwise clip inset:0 to the topbar box).
  return createPortal(
    <div className="cmd-overlay" onClick={onClose} role="dialog" aria-modal="true" aria-label="Command palette">
      <div className="cmd-panel" onClick={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="cmd-input"
          placeholder="Jump to a page, resource, connector, or user…"
          value={query}
          onChange={onQueryChange}
          onKeyDown={onInputKey}
        />
        <div className="cmd-results" role="listbox" aria-label="Results">
          {results.length === 0 ? (
            <div className="cmd-empty">No matches.</div>
          ) : (
            groups.map((g) => (
              <div key={g.name} className="cmd-section">
                <div className="cmd-group">{g.name}</div>
                {g.rows.map(({ item, index }) => (
                  <button
                    key={item.id}
                    className={`cmd-item${index === active ? " active" : ""}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseMove={() => setActive(index)}
                    onClick={() => select(item)}
                  >
                    <span className="cmd-label">{item.label}</span>
                    {item.sub && <span className="cmd-sub">{item.sub}</span>}
                    {item.group !== "Pages" && <span className="cmd-type">{item.group.slice(0, -1)}</span>}
                  </button>
                ))}
              </div>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
