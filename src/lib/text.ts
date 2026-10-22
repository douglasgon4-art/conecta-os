export function normalizeName(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9ñ ]+/g, " ")
    .replace(/\b(s ?a|s ?de ?r ?l|ltda|cia|y cia)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Últimos 8 dígitos (formato nacional nicaragüense), ignorando prefijos como +505. */
export function phoneDigits(s: string | null | undefined): string | null {
  if (!s) return null;
  const d = s.replace(/\D/g, "");
  if (!d) return null;
  return d.length > 8 ? d.slice(-8) : d;
}

export function emptyToNull<T>(v: T): T | null {
  if (typeof v === "string" && v.trim() === "") return null;
  return v ?? null;
}
