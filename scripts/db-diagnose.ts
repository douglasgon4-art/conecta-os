// Diagnóstico seguro de una cadena de conexión: nunca imprime la contraseña.
export function describeConnection(name: string, raw: string | undefined) {
  if (!raw) return `✗ ${name} no está definida`;
  const problems: string[] = [];
  if (raw !== raw.trim()) problems.push("tiene espacios al inicio o al final");
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return `✗ ${name} no tiene un formato válido (debe empezar con postgresql:// y contener usuario:contraseña@servidor:puerto/postgres)`;
  }
  const pass = decodeURIComponent(url.password);
  if (!pass) problems.push("no tiene contraseña");
  if (/[[\]]|YOUR-PASSWORD|TU-|NUEVA-|CONTRASENA|ESCRIBE-AQUI/i.test(pass)) problems.push("la contraseña parece un texto de ejemplo sin reemplazar");
  if (/\s/.test(pass)) problems.push("la contraseña contiene espacios");
  return `${problems.length ? "✗" : "•"} ${name}: usuario "${decodeURIComponent(url.username)}", servidor ${url.hostname}, puerto ${url.port || "5432"}, base "${url.pathname.slice(1)}", contraseña de ${pass.length} caracteres${problems.length ? ` — PROBLEMA: ${problems.join("; ")}` : ""}`;
}

export function explainDbError(e: unknown) {
  const err = e as { code?: string; message?: string; cause?: { code?: string; message?: string } };
  const code = err?.code ?? err?.cause?.code;
  const msg = err?.cause?.message ?? err?.message ?? String(e);
  const hints: Record<string, string> = {
    "28P01": "La contraseña no coincide con la del usuario en Supabase. Revisa que la contraseña de la variable sea exactamente la misma que pusiste en Supabase.",
    XX000: "Supabase no reconoce el usuario o el proyecto. Revisa que el usuario tenga la forma nombre.codigo-del-proyecto.",
    ENOTFOUND: "No se encontró el servidor. Revisa la parte después de la @.",
  };
  return `✗ Error de base de datos${code ? ` (${code})` : ""}: ${msg}${code && hints[code] ? `\n  → ${hints[code]}` : ""}`;
}
