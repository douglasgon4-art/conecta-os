"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ActionState } from "@/app/(app)/_lib/action";

type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

export function SubmitButton({ children, variant = "primary", size = "md", className, disabled }: { children: ReactNode; variant?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm" | "md"; className?: string; disabled?: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className={cn(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition disabled:opacity-60",
        size === "sm" ? "h-8 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
        variant === "primary" && "bg-brand-600 text-white hover:bg-brand-700",
        variant === "secondary" && "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50",
        variant === "danger" && "bg-red-600 text-white hover:bg-red-700",
        variant === "ghost" && "text-slate-700 hover:bg-slate-100",
        className,
      )}
    >
      {pending && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

/**
 * Formulario conectado a una Server Action. Muestra el resultado real del servidor
 * (nunca un "guardado" optimista) y, si el servidor exige confirmación, la solicita y reenvía.
 */
export function ActionForm({ action, children, className, resetOnSuccess = false, inline = false, onSuccess }: { action: Action; children: ReactNode | ((s: ActionState) => ReactNode); className?: string; resetOnSuccess?: boolean; inline?: boolean; onSuccess?: () => void }) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [showMsg, setShowMsg] = useState(true);
  useEffect(() => {
    setShowMsg(true);
    if (state?.ok) {
      if (resetOnSuccess) ref.current?.reset();
      onSuccess?.();
    }
    if (state?.confirm && ref.current && confirmRef.current) {
      if (window.confirm(state.confirm)) {
        confirmRef.current.value = "1";
        ref.current.requestSubmit();
      }
    } else if (confirmRef.current) confirmRef.current.value = "";
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form ref={ref} action={formAction} className={cn(inline ? "inline-flex flex-wrap items-center gap-2" : "space-y-3", className)}>
      <input type="hidden" name="__confirm" ref={confirmRef} defaultValue="" />
      {typeof children === "function" ? children(state) : children}
      {showMsg && state && !state.confirm && (state.error || state.message) && (
        <div
          role="status"
          className={cn("flex items-start gap-2 rounded-md px-3 py-2 text-sm", state.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-800", inline && "py-1 text-xs")}
        >
          {state.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <XCircle className="mt-0.5 size-4 shrink-0" />}
          <span>{state.ok ? state.message : state.error}</span>
          <button type="button" className="ml-auto text-xs opacity-60 hover:opacity-100" onClick={() => setShowMsg(false)} aria-label="Cerrar">✕</button>
        </div>
      )}
      {state?.fieldErrors && Object.keys(state.fieldErrors).length > 1 && (
        <ul className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <AlertTriangle className="size-4 shrink-0" />
          <span>{Object.entries(state.fieldErrors).map(([k, v]) => `${k}: ${v}`).join(" · ")}</span>
        </ul>
      )}
    </form>
  );
}
