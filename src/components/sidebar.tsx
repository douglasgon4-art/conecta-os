"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import * as Icons from "lucide-react";
import { cn } from "@/lib/cn";
import type { NavGroup } from "@/lib/nav";

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const isActive = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  return (
    <>
      <button className="fixed left-3 top-3 z-40 rounded-md border border-slate-200 bg-white p-2 lg:hidden" onClick={() => setOpen(!open)} aria-label="Abrir menú">
        <Icons.Menu className="size-5" />
      </button>
      <aside className={cn("fixed inset-y-0 left-0 z-30 w-64 transform border-r border-slate-200 bg-white transition lg:translate-x-0", open ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-14 items-center gap-2 border-b border-slate-100 px-5">
          <div className="grid size-8 place-items-center rounded-lg bg-brand-600 text-sm font-bold text-white">C</div>
          <div className="font-semibold tracking-tight">CONECTA OS</div>
        </div>
        <nav className="h-[calc(100vh-3.5rem)] space-y-5 overflow-y-auto px-3 py-4" aria-label="Navegación principal">
          {groups.map((g) => (
            <div key={g.label}>
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400">{g.label}</div>
              {g.items.map((item) => {
                const Icon = (Icons as unknown as Record<string, Icons.LucideIcon>)[item.icon] ?? Icons.Circle;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn("flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm", isActive(item.href) ? "bg-brand-50 font-medium text-brand-700" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900")}
                    aria-current={isActive(item.href) ? "page" : undefined}
                  >
                    <Icon className="size-4" aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/20 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}
