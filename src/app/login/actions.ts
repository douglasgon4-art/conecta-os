"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticate, destroySession, SESSION_COOKIE } from "@/server/auth/core";

export async function loginAction(_: { error?: string } | null, fd: FormData) {
  const email = String(fd.get("email") ?? "");
  const password = String(fd.get("password") ?? "");
  if (!email || !password) return { error: "Ingresa tu correo y contraseña" };
  const session = await authenticate(email, password);
  if (!session) return { error: "Correo o contraseña incorrectos" };
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
