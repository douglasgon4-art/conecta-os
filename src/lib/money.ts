export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function sum(ns: (number | null | undefined)[]): number {
  return round2(ns.reduce<number>((a, b) => a + (b ?? 0), 0));
}

export function formatMoney(amount: number | null | undefined, currency = "NIO"): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) return "—";
  const symbol = currency === "USD" ? "US$" : currency === "NIO" ? "C$" : currency;
  return `${symbol} ${new Intl.NumberFormat("es-NI", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)}`;
}

export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) return "—";
  const v = ratio * 100;
  const s = Number.isInteger(round2(v)) ? String(Math.round(v)) : v.toFixed(digits);
  return `${s}%`;
}

/** Convierte a la moneda base usando el tipo de cambio configurado (USD→NIO). */
export function toBase(amount: number, currency: string, usdToNio: number, base = "NIO"): number {
  if (currency === base) return amount;
  if (currency === "USD" && base === "NIO") return round2(amount * usdToNio);
  if (currency === "NIO" && base === "USD") return round2(amount / usdToNio);
  return amount;
}
