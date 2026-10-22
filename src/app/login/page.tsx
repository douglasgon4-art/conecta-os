"use client";
import { useActionState } from "react";
import { loginAction } from "./actions";

export default function LoginPage() {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form action={action} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <div className="text-2xl font-bold tracking-tight text-brand-700">CONECTA OS</div>
          <p className="text-sm text-slate-500">Inicia sesión para continuar</p>
        </div>
        <label className="block text-sm">
          <span className="font-medium">Correo</span>
          <input name="email" type="email" autoComplete="email" required className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
        </label>
        <label className="block text-sm">
          <span className="font-medium">Contraseña</span>
          <input name="password" type="password" autoComplete="current-password" required className="mt-1 h-10 w-full rounded-md border border-slate-300 px-3" />
        </label>
        {state?.error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</p>}
        <button disabled={pending} className="h-10 w-full rounded-md bg-brand-600 font-medium text-white hover:bg-brand-700 disabled:opacity-60">
          {pending ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
