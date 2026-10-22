import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { as, at, makeUser, standardContract, uniq } from "./helpers";
import { createClient } from "@/server/services/clients";
import { cancelSession, clientSessions, completeSession, getSession, scheduleSession, sessionAlert, sessionsNeedingAttention, updateSession } from "@/server/services/sessions";
import { contentSessions, productionBoards, productionDeliverables } from "@/server/db/schema";
import { DEFAULT_SETTINGS } from "@/server/services/settings";

describe("Agenda de sesiones", () => {
  it("calcula la siguiente fecha prevista al registrar una sesión realizada (12 oct → 12 nov)", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Pepitos") }, contract: standardContract({ startDate: "2026-10-01", firstSessionDate: "2026-10-12" }) }), at("2026-10-05"));
    const { next: first } = await as(admin, (ctx) => clientSessions(ctx, r.client.id), at("2026-10-05"));
    expect(first!.expectedDate).toBe("2026-10-12");
    expect(first!.coordinationStartDate).toBe("2026-10-02");

    // Llegar la fecha no la marca como realizada
    const s = await as(admin, (ctx) => getSession(ctx, first!.id), at("2026-10-13"));
    expect(s.status).toBe("pendiente_coordinar");
    expect(s.alert.tone).toBe("red");

    const done = await as(admin, (ctx) => completeSession(ctx, first!.id, { completedDate: "2026-10-12" }), at("2026-10-13"));
    expect(done.next!.expectedDate).toBe("2026-11-12");
    expect(done.materialMarked).toBe(6); // reels de octubre: material recibido
    // Re-registrar no duplica
    await expect(as(admin, (ctx) => completeSession(ctx, first!.id, { completedDate: "2026-10-12" }), at("2026-10-13"))).rejects.toMatchObject({ code: "CONFLICT" });

    // Confirmar otra fecha (12 dic) → se vuelve la fecha programada; la prevista se conserva
    const confirmed = await as(admin, (ctx) => updateSession(ctx, done.next!.id, { confirmedDate: "2026-12-12", startTime: "09:00", location: "Consultorio" }), at("2026-10-20"));
    expect(confirmed.status).toBe("confirmada");
    expect(confirmed.expectedDate).toBe("2026-11-12");
    expect(confirmed.confirmedDate).toBe("2026-12-12");
    // Reprogramar conserva el historial
    await as(admin, (ctx) => updateSession(ctx, done.next!.id, { confirmedDate: "2026-12-15" }), at("2026-10-21"));
    const hist = await as(admin, (ctx) => getSession(ctx, done.next!.id), at("2026-10-21"));
    expect(hist.events.some((e) => e.note?.includes("Reprogramada"))).toBe(true);
    expect(hist.alert.tone).toBe("green");
  });

  it("semáforo: amarillo antes de coordinar, rojo si faltan pocos días sin confirmar o si venció", () => {
    const base = { status: "pendiente_coordinar", expectedDate: "2026-11-12", coordinationStartDate: "2026-11-02", confirmedDate: null, proposedDate: null };
    expect(sessionAlert(base, "2026-10-15", DEFAULT_SETTINGS).tone).toBe("gray");
    const y = sessionAlert(base, "2026-10-23", DEFAULT_SETTINGS);
    expect(y).toMatchObject({ tone: "yellow", label: "Comenzar a coordinar en 10 día(s)" });
    expect(sessionAlert(base, "2026-11-05", DEFAULT_SETTINGS).label).toContain("Coordinación atrasada");
    expect(sessionAlert({ ...base, status: "esperando_respuesta" }, "2026-11-05", DEFAULT_SETTINGS).tone).toBe("yellow");
    expect(sessionAlert({ ...base, status: "esperando_respuesta" }, "2026-11-09", DEFAULT_SETTINGS).label).toBe("Faltan 3 día(s) y no se ha confirmado la fecha");
    expect(sessionAlert(base, "2026-11-14", DEFAULT_SETTINGS).label).toContain("vencida");
    expect(sessionAlert({ ...base, status: "confirmada", confirmedDate: "2026-11-12" }, "2026-11-10", DEFAULT_SETTINGS).tone).toBe("green");
  });

  it("lista de sesiones que requieren atención y programación sin duplicados", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Atención") }, contract: standardContract({ startDate: "2026-10-01", firstSessionDate: "2026-11-01" }) }), at("2026-10-15"));
    const list = await as(admin, (ctx) => sessionsNeedingAttention(ctx), at("2026-10-15"));
    expect(list.find((s) => s.clientId === r.client.id)?.alert.tone).toBe("yellow");
    const sched = await as(admin, (ctx) => scheduleSession(ctx, { clientId: r.client.id, date: "2026-11-03", confirmed: true }), at("2026-10-15"));
    expect(sched.created).toBe(false); // actualizó la sesión abierta
    const rows = await as(admin, ({ tx }) => tx.select().from(contentSessions).where(eq(contentSessions.clientId, r.client.id)));
    expect(rows).toHaveLength(1);
    await expect(as(admin, (ctx) => cancelSession(ctx, rows[0].id, "Cliente de viaje"), at("2026-10-16"))).rejects.toMatchObject({ code: "CONFIRMATION_REQUIRED" });
    const c = await as(admin, (ctx) => cancelSession(ctx, rows[0].id, "Cliente de viaje", { confirm: true }), at("2026-10-16"));
    expect(c.status).toBe("cancelada");
  });

  it("no permite registrar como realizada una sesión futura", async () => {
    const admin = await makeUser("administracion");
    const r = await as(admin, (ctx) => createClient(ctx, { client: { tradeName: uniq("Futura") }, contract: standardContract({ startDate: "2026-10-01", firstSessionDate: "2026-10-30" }) }), at("2026-10-15"));
    const { next } = await as(admin, (ctx) => clientSessions(ctx, r.client.id), at("2026-10-15"));
    await expect(as(admin, (ctx) => completeSession(ctx, next!.id, { completedDate: "2026-10-30" }), at("2026-10-15"))).rejects.toMatchObject({ code: "VALIDATION" });
    const ds = await as(admin, async ({ tx }) => {
      const [b] = await tx.select().from(productionBoards).where(and(eq(productionBoards.clientId, r.client.id), eq(productionBoards.period, "2026-10-01")));
      return tx.select().from(productionDeliverables).where(eq(productionDeliverables.boardId, b.id));
    });
    expect(ds.filter((d) => d.status === "material_recibido")).toHaveLength(0);
  });
});
