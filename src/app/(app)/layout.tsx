import Link from "next/link";
import { Bell, LogOut, Search, Sparkles } from "lucide-react";
import { requireActor } from "@/server/auth/session";
import { withCtx } from "@/server/ctx";
import { unreadCount } from "@/server/services/notifications";
import { NAV } from "@/lib/nav";
import { Sidebar } from "@/components/sidebar";
import { logoutAction } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const groups = NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.perms.length || i.perms.some((p) => actor.permissions.has(p))) })).filter((g) => g.items.length);
  const unread = await withCtx(actor, (ctx) => unreadCount(ctx));
  return (
    <div className="min-h-screen">
      <Sidebar groups={groups} />
      <div className="lg:pl-64">
        <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 pl-14 backdrop-blur lg:pl-6">
          <form action="/buscar" className="relative max-w-md flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-slate-400" />
            <input name="q" placeholder="Buscar clientes, prospectos, colaboradores, facturas…" aria-label="Búsqueda global" className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pl-8 pr-3 text-sm focus:border-brand-500 focus:bg-white focus:outline-none" />
          </form>
          <div className="ml-auto flex items-center gap-1">
            {actor.permissions.has("agent.use") && (
              <Link href="/asistente" className="hidden items-center gap-1.5 rounded-md bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100 sm:inline-flex">
                <Sparkles className="size-4" /> Asistente
              </Link>
            )}
            <Link href="/notificaciones" className="relative rounded-md p-2 text-slate-600 hover:bg-slate-100" aria-label={`Notificaciones (${unread} sin leer)`}>
              <Bell className="size-5" />
              {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}
            </Link>
            <Link href="/perfil" className="hidden text-right text-xs leading-tight sm:block">
              <div className="font-medium text-slate-800">{actor.name}</div>
              <div className="text-slate-500">{actor.roles.join(", ")}</div>
            </Link>
            <form action={logoutAction}>
              <button className="rounded-md p-2 text-slate-500 hover:bg-slate-100" aria-label="Cerrar sesión" title="Cerrar sesión">
                <LogOut className="size-4" />
              </button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
