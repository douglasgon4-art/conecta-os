"use client";
import { useRef, useState, useTransition } from "react";
import { Bot, Check, Loader2, Send, User, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { decideAction, sendToAgent } from "./actions";

type Pending = { id: string; tool: string; summary: string; state?: "ejecutada" | "rechazada" | "fallida" | "error"; result?: string };
type Msg = { role: "user" | "assistant" | "system"; text: string; actions?: { tool: string; status: string; summary: string }[]; pending?: Pending[] };

const EXAMPLES = [
  "¿Qué clientes tienen contenido listo para publicar?",
  "Muéstrame los clientes que todavía no tienen sus reels editados",
  "¿Cuánto gastamos este mes?",
  "Muéstrame las facturas pendientes",
  "Registra un gasto de 80 dólares por herramientas de IA",
  "Crea un prospecto para llamar mañana: Clínica Ejemplo, Estelí",
];

export function AgentChat({ initial, conversationId: initialId, configured }: { initial: Msg[]; conversationId: string | null; configured: boolean }) {
  const [messages, setMessages] = useState<Msg[]>(initial);
  const [conversationId, setConversationId] = useState(initialId);
  const [input, setInput] = useState("");
  const [pending, start] = useTransition();
  const endRef = useRef<HTMLDivElement>(null);
  const scroll = () => setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), 50);

  const send = (text: string) => {
    if (!text.trim() || pending) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    scroll();
    start(async () => {
      const r = await sendToAgent(conversationId, text);
      if (r.status === "not_configured" || r.status === "error") {
        setMessages((m) => [...m, { role: "system", text: r.message }]);
      } else {
        setConversationId(r.conversationId);
        setMessages((m) => [...m, { role: "assistant", text: r.reply, actions: r.actions, pending: r.pending }]);
      }
      scroll();
    });
  };

  const decide = (msgIdx: number, p: Pending, decision: "confirmar" | "rechazar") => {
    start(async () => {
      const r = await decideAction(p.id, decision);
      setMessages((m) => m.map((msg, i) => (i !== msgIdx ? msg : { ...msg, pending: msg.pending?.map((x) => (x.id === p.id ? { ...x, state: r.status, result: r.summary } : x)) })));
    });
  };

  return (
    <div className="flex h-[calc(100vh-10rem)] flex-col rounded-xl border border-slate-200 bg-white">
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {!messages.length && (
          <div className="mx-auto max-w-xl py-8 text-center">
            <Bot className="mx-auto size-10 text-brand-600" />
            <h2 className="mt-2 font-semibold">¿Qué hacemos hoy?</h2>
            <p className="text-sm text-slate-500">Dame instrucciones en español. Ejecuto acciones reales con tus permisos y te pido confirmación para las sensibles.</p>
            {!configured && <p className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900">El asistente está pendiente de configuración (falta la clave del proveedor de IA en el servidor).</p>}
            <div className="mt-4 flex flex-wrap justify-center gap-2">{EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="rounded-full border border-slate-200 px-3 py-1 text-xs hover:bg-slate-50">{e}</button>)}</div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={cn("flex gap-2", m.role === "user" && "justify-end")}>
            {m.role !== "user" && <Bot className="mt-1 size-5 shrink-0 text-brand-600" />}
            <div className={cn("max-w-[80%] rounded-xl px-3 py-2 text-sm", m.role === "user" ? "bg-brand-600 text-white" : m.role === "system" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-900")}>
              <div className="whitespace-pre-wrap">{m.text}</div>
              {m.actions && m.actions.length > 0 && (
                <ul className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-xs">
                  {m.actions.map((a, j) => <li key={j} className={a.status === "ejecutada" ? "text-emerald-700" : "text-red-700"}>{a.status === "ejecutada" ? "✓" : "✕"} {a.tool}: {a.summary}</li>)}
                </ul>
              )}
              {m.pending?.map((p) => (
                <div key={p.id} className="mt-2 rounded-lg border border-amber-300 bg-white p-2 text-xs text-slate-800">
                  <div className="font-semibold text-amber-800">Requiere tu confirmación</div>
                  <div className="my-1 break-words">{p.summary}</div>
                  {p.state ? (
                    <div className={p.state === "ejecutada" ? "text-emerald-700" : "text-red-700"}>{p.state === "ejecutada" ? "✓ Ejecutada: " : p.state === "rechazada" ? "Rechazada. " : "✕ "}{p.result}</div>
                  ) : (
                    <div className="flex gap-2">
                      <button disabled={pending} onClick={() => decide(i, p, "confirmar")} className="inline-flex items-center gap-1 rounded bg-brand-600 px-2 py-1 text-white"><Check className="size-3" />Confirmar</button>
                      <button disabled={pending} onClick={() => decide(i, p, "rechazar")} className="inline-flex items-center gap-1 rounded border px-2 py-1"><X className="size-3" />Rechazar</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
            {m.role === "user" && <User className="mt-1 size-5 shrink-0 text-slate-400" />}
          </div>
        ))}
        {pending && <div className="flex items-center gap-2 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" />Trabajando…</div>}
        <div ref={endRef} />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-200 p-3">
        <textarea value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); } }} rows={2} placeholder="Ej.: Agrega a Douglas González como colaborador, salario 9,000 córdobas, empezó el 21 de octubre de 2026" className="flex-1 resize-none rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" aria-label="Instrucción para el asistente" />
        <button disabled={pending || !input.trim()} className="inline-flex items-center gap-1 self-end rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"><Send className="size-4" />Enviar</button>
      </form>
    </div>
  );
}
