// Fechas de negocio como cadenas ISO "YYYY-MM-DD" para evitar desfases de zona horaria.

export const APP_TIMEZONE = process.env.APP_TIMEZONE ?? "America/Managua";

const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date, timeZone = APP_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  return parts; // en-CA => YYYY-MM-DD
}

export function todayISO(now = new Date()): string {
  return toISODate(now);
}

export function parseISO(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return { y, m, d };
}

export function makeISO(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Suma meses conservando el día; si no existe (31 → febrero) usa el último día del mes. */
export function addMonths(s: string, n: number): string {
  const { y, m, d } = parseISO(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeISO(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addDays(s: string, n: number): string {
  const { y, m, d } = parseISO(s);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return makeISO(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
}

export function diffDays(a: string, b: string): number {
  const pa = parseISO(a);
  const pb = parseISO(b);
  return Math.round((Date.UTC(pa.y, pa.m - 1, pa.d) - Date.UTC(pb.y, pb.m - 1, pb.d)) / 86_400_000);
}

export function firstOfMonth(s: string): string {
  const { y, m } = parseISO(s);
  return makeISO(y, m, 1);
}

export function lastOfMonth(s: string): string {
  const { y, m } = parseISO(s);
  return makeISO(y, m, daysInMonth(y, m));
}

export function withDay(period: string, day: number): string {
  const { y, m } = parseISO(period);
  return makeISO(y, m, Math.min(day, daysInMonth(y, m)));
}

/** Fechas del mes que caen en los días de la semana indicados (1 = lunes … 7 = domingo), en orden. */
export function weekdayDatesInMonth(period: string, weekdays: readonly number[]): string[] {
  const { y, m } = parseISO(period);
  const set = new Set(weekdays);
  const out: string[] = [];
  for (let d = 1; d <= daysInMonth(y, m); d++) {
    const wd = new Date(Date.UTC(y, m - 1, d)).getUTCDay() || 7;
    if (set.has(wd)) out.push(makeISO(y, m, d));
  }
  return out;
}

export function monthsBetween(fromPeriod: string, toPeriod: string): number {
  const a = parseISO(fromPeriod);
  const b = parseISO(toPeriod);
  return (b.y - a.y) * 12 + (b.m - a.m);
}

export function maxDate(...ds: (string | null | undefined)[]): string | null {
  const v = ds.filter(Boolean) as string[];
  return v.length ? v.sort().at(-1)! : null;
}

export function minDate(...ds: (string | null | undefined)[]): string | null {
  const v = ds.filter(Boolean) as string[];
  return v.length ? v.sort()[0] : null;
}

export function isValidISODate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
}

const MONTHS = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];

export function formatPeriod(period: string): string {
  const { y, m } = parseISO(period);
  return `${MONTHS[m - 1]} de ${y}`;
}

export function formatDate(s: string | null | undefined, opts: { withWeekday?: boolean } = {}): string {
  if (!s) return "—";
  const { y, m, d } = parseISO(s);
  const dt = new Date(Date.UTC(y, m - 1, d, 12));
  return new Intl.DateTimeFormat("es-NI", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(opts.withWeekday ? { weekday: "short" } : {}),
  }).format(dt);
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("es-NI", {
    timeZone: APP_TIMEZONE,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(dt);
}

export function weekdayIndex(s: string): number {
  const { y, m, d } = parseISO(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
}

export function startOfWeek(s: string): string {
  const wd = weekdayIndex(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd); // semana inicia lunes
}
