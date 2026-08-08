"use client";
import type { Role } from "@/generated/prisma/enums";
import type { SearchRecord } from "@/lib/search";
import { CommandPalette } from "./command-palette";
import { ThemeSwitcher } from "@/components/theme-switcher";

export function Topbar({ records, role }: { records: SearchRecord[]; role: Role }) {
  return (
    <header className="topbar">
      <CommandPalette records={records} role={role} />
      <ThemeSwitcher />
    </header>
  );
}
