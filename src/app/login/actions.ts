"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, destroySession, SESSION_COOKIE } from "@/server/auth/core";
import { clearFails, isLocked, registerFail } from "@/server/auth/rate-limit";

export async function loginAction(_: { error?: string } | null, fd: FormData) {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Ingresa tu correo y contraseña" };
  const key = email.trim().toLowerCase();
  if (isLocked(key)) return { error: "Demasiados intentos fallidos. Espera 15 minutos e inténtalo de nuevo." };
  const session = await authenticate(email, password);
  if (!session) {
    registerFail(key);
    return { error: "Correo o contraseña incorrectos" };
  }
  clearFails(key);
  (await cookies()).set(SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: session.expiresAt,
  });
  redirect("/");
}

export async function logoutAction() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await destroySession(token);
  store.delete(SESSION_COOKIE);
  redirect("/login");
}
