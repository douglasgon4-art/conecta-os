// Límite simple de intentos fallidos de inicio de sesión (por correo), en memoria del proceso.
// Para varias instancias, reemplazar por un almacén compartido (Redis / tabla).
const WINDOW_MS = 15 * 60_000;
const MAX_FAILS = 5;
const fails = new Map<string, number[]>();

export function isLocked(key: string) {
  const now = Date.now();
  const list = (fails.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  fails.set(key, list);
  return list.length >= MAX_FAILS;
}
export function registerFail(key: string) {
  fails.set(key, [...(fails.get(key) ?? []), Date.now()]);
}
export function clearFails(key: string) {
  fails.delete(key);
}
