"use client";
import { useState } from "react";
import Link from "next/link";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { APPOINTMENT_MODES } from "@/lib/domain";
import { quickOutcomeAction } from "./actions";

const OUTCOMES = [
  ["no_contesto", "Llamé y no contestó"],
  ["volver_a_llamar", "Contestó: volver a llamar"],
  ["interesado", "Contestó: está interesado"],
  ["cita", "Agendó una cita"],
  ["si", "Dijo que sí (convertir en cliente)"],
  ["proximo_mes", "Llamar el próximo mes"],
  ["no_interesado", "Dijo que no"],
] as const;

const input = "h-8 rounded-md border border-slate-300 bg-white px-2 text-xs";

/** Cambio rápido de estado desde la lista: queda registrado como llamada en el historial. */
export function QuickStatus({ leadId, today }: { leadId: string; today: string }) {
  const [outcome, setOutcome] = useState("");
  const followup = ["volver_a_llamar", "interesado", "proximo_mes"].includes(outcome);
  return (
    <ActionForm action={quickOutcomeAction} className="space-y-1" onSuccess={() => setOutcome("")} resetOnSuccess>
      <input type="hidden" name="leadId" value={leadId} />
      <select name="outcome" value={outcome} onChange={(e) => setOutcome(e.target.value)} className={`${input} w-52`} aria-label="¿Qué pasó?">
        <option value="">¿Qué pasó?…</option>
        {OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      {outcome === "cita" && (
        <div className="flex flex-wrap gap-1">
          <input type="date" name="nextFollowupAt" required min={today} className={input} aria-label="Fecha de la cita" />
          <input type="time" name="appointmentTime" required className={input} aria-label="Hora de la cita" />
          <select name="appointmentMode" required defaultValue="" className={input} aria-label="Modalidad">
            <option value="" disabled>Modalidad…</option>
            {APPOINTMENT_MODES.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input name="appointmentPlace" placeholder="Lugar o enlace" className={`${input} w-40`} aria-label="Lugar o enlace" />
        </div>
      )}
      {followup && <input type="date" name="nextFollowupAt" className={input} aria-label="Fecha para volver a llamar" title="Fecha para volver a llamar (opcional)" />}
      {outcome === "si" ? (
        <Link href={`/ventas/${leadId}#convertir`} className="inline-block rounded-md bg-green-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-green-700">Convertir en cliente →</Link>
      ) : outcome ? (
        <SubmitButton size="sm">Guardar</SubmitButton>
      ) : null}
    </ActionForm>
  );
}
