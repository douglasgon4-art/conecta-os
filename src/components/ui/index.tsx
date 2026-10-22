import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Circle, Clock, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { Tone } from "@/lib/domain";

export function Button({ variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "ghost" && "text-slate-700 hover:bg-slate-100",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        className,
      )}
      {...p}
    />
  );
}

export function LinkButton({ variant = "secondary", size = "md", className, ...p }: ComponentProps<typeof Link> & { variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md" }) {
  return (
    <Link
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "ghost" && "text-slate-700 hover:bg-slate-100",
        className,
      )}
      {...p}
    />
  );
}

const inputCls = "w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs placeholder:text-slate-400 focus:border-brand-500 focus:outline-none";
export const Input = ({ className, ...p }: ComponentProps<"input">) => <input className={cn(inputCls, "h-9 py-1.5", className)} {...p} />;
export const Textarea = ({ className, ...p }: ComponentProps<"textarea">) => <textarea className={cn(inputCls, "min-h-20", className)} {...p} />;
export const Select = ({ className, ...p }: ComponentProps<"select">) => <select className={cn(inputCls, "h-9 py-1.5", className)} {...p} />;

export function Field({ label, name, error, hint, children, className }: { label: string; name?: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1 text-sm", className)} htmlFor={name}>
      <span className="font-medium text-slate-700">{label}</span>
      {children}
      {hint && !error && <span className="text-xs text-slate-500">{hint}</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  );
}

export function Card({ className, title, actions, children, padded = true }: { className?: string; title?: ReactNode; actions?: ReactNode; children: ReactNode; padded?: boolean }) {
  return (
    <section className={cn("rounded-xl border border-slate-200 bg-white shadow-xs", className)}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const TONE: Record<Tone, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  yellow: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-800 ring-red-600/20",
  gray: "bg-slate-100 text-slate-700 ring-slate-500/20",
  blue: "bg-sky-50 text-sky-800 ring-sky-600/20",
};
const TONE_ICON: Record<Tone, typeof Circle> = { green: CheckCircle2, yellow: AlertTriangle, red: XCircle, gray: Circle, blue: Clock };

/** Estado con color + icono + texto (nunca solo color). */
export function Badge({ tone = "gray", children, className, icon = true }: { tone?: Tone; children: ReactNode; className?: string; icon?: boolean }) {
  const Icon = TONE_ICON[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", TONE[tone], className)}>
      {icon && <Icon className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

export function StatusBadge({ list, value }: { list: readonly { value: string; label: string; tone: Tone }[]; value: string | null | undefined }) {
  const item = list.find((i) => i.value === value);
  return <Badge tone={item?.tone ?? "gray"}>{item?.label ?? value ?? "—"}</Badge>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, href }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <div className={cn("rounded-xl border bg-white p-4 shadow-xs transition", href && "hover:border-brand-500", tone === "red" ? "border-red-200" : tone === "yellow" ? "border-amber-200" : tone === "green" ? "border-emerald-200" : "border-slate-200")}>
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular text-slate-900">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

export function Progress({ value, tone }: { value: number; tone?: Tone }) {
  const pct = Math.max(0, Math.min(100, value * 100));
  const color = tone === "red" ? "bg-red-500" : tone === "green" || pct >= 100 ? "bg-emerald-500" : "bg-brand-500";
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={cn("h-full rounded-full", color)} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  );
}
export const Th = ({ className, ...p }: ComponentProps<"th">) => <th className={cn("border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500", className)} {...p} />;
export const Td = ({ className, ...p }: ComponentProps<"td">) => <td className={cn("border-b border-slate-100 px-3 py-2 align-middle", className)} {...p} />;

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-2 rounded-lg border border-dashed border-slate-300 p-6 text-sm text-slate-500"><Info className="size-4" />{children}</div>;
}

export function Tabs({ tabs, active }: { tabs: { key: string; label: string; href: string }[]; active: string }) {
  return (
    <nav className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200" aria-label="Pestañas">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", t.key === active ? "border-brand-600 text-brand-700" : "border-transparent text-slate-500 hover:text-slate-800")} aria-current={t.key === active ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs text-slate-500">{k}</dt>
          <dd className="font-medium text-slate-800">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}
