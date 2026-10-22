import { describe, expect, it } from "vitest";
import { as, asSystem, at, makeUser, standardContract, uniq } from "./helpers";
import { createClient } from "@/server/services/clients";
import { closePublicationDay, complianceHistory, createPublication, dailyCompliance, reschedulePublication, updatePublication } from "@/server/services/publications";

describe("Community Management", () => {
  it("cumplimiento diario solo con obligaciones aplicables, historial inmutable y confirmación trazada", async () => {
    const manager = await makeUser("gerencia");
    const cm = await makeUser("community_manager");
    const day = "2026-09-08"; // martes
    const mk = async (name: string) =>
      (await as(manager, (ctx) => createClient(ctx, { client: { tradeName: uniq(name), communityManagerId: cm.employeeId }, contract: standardContract({ startDate: "2026-09-01" }) }), at("2026-09-01"))).client;
    const a = await mk("A");
    const b = await mk("B");
    const c = await mk("C"); // sin publicaciones ese día: no debe contar
    const pA1 = await as(cm, (ctx) => createPublication(ctx, { clientId: a.id, network: "facebook", scheduledDate: day, contentTitle: "Post 1" }), at("2026-09-07"));
    const pA2 = await as(cm, (ctx) => createPublication(ctx, { clientId: a.id, network: "instagram", scheduledDate: day, contentTitle: "Post 1" }), at("2026-09-07"));
    const pB1 = await as(cm, (ctx) => createPublication(ctx, { clientId: b.id, network: "instagram", scheduledDate: day, contentTitle: "Reel" }), at("2026-09-07"));
    await expect(as(cm, (ctx) => createPublication(ctx, { clientId: c.id, network: "tiktok", scheduledDate: day, contentTitle: "X" }), at("2026-09-07"))).rejects.toMatchObject({ code: "CONFLICT" });

    const pub = await as(cm, (ctx) => updatePublication(ctx, pA1.id, { status: "publicada", evidenceUrl: "https://facebook.com/post/1" }), at(day));
    expect(pub.confirmedBy).toBe(cm.userId);
    expect(pub.confirmedAt).not.toBeNull();
    await as(cm, (ctx) => updatePublication(ctx, pA2.id, { status: "publicada" }), at(day));
    await as(cm, (ctx) => updatePublication(ctx, pB1.id, { status: "fallida", notes: "Error de la plataforma" }), at(day));

    const live = await as(manager, (ctx) => dailyCompliance(ctx, day), at(day));
    expect(live.total).toMatchObject({ planned: 3, published: 2, failed: 1, clientsPlanned: 2, clientsCompliant: 1 });
    expect(live.byClient.find((x) => x.key === c.id)).toBeUndefined();

    // Cierre del día y edición posterior: el registro del martes no cambia
    expect(await asSystem((ctx) => closePublicationDay(ctx, day), at("2026-09-09"))).toBeGreaterThan(0);
    expect(await asSystem((ctx) => closePublicationDay(ctx, day), at("2026-09-09"))).toBe(0);
    await as(cm, (ctx) => updatePublication(ctx, pB1.id, { status: "publicada" }), at("2026-09-09"));
    const closed = await as(manager, (ctx) => dailyCompliance(ctx, day), at("2026-09-10"));
    expect(closed.closed).toBe(true);
    expect(closed.total.published).toBe(2);
    const hist = await as(manager, (ctx) => complianceHistory(ctx, { from: "2026-09-01", to: "2026-09-30", groupBy: "month" }), at("2026-09-10"));
    expect(hist[0].ratio).toBeGreaterThan(0);
  });

  it("reprogramar crea un nuevo registro y el original no cuenta como incumplimiento", async () => {
    const manager = await makeUser("gerencia");
    const client = (await as(manager, (ctx) => createClient(ctx, { client: { tradeName: uniq("Repro") }, contract: standardContract() }), at("2026-10-01"))).client;
    const p = await as(manager, (ctx) => createPublication(ctx, { clientId: client.id, network: "instagram", scheduledDate: "2026-10-05", contentTitle: "Carrusel" }), at("2026-10-01"));
    const n = await as(manager, (ctx) => reschedulePublication(ctx, p.id, { scheduledDate: "2026-10-07", reason: "Cliente pidió cambio" }), at("2026-10-04"));
    expect(n.rescheduledFromId).toBe(p.id);
    const d5 = await as(manager, (ctx) => dailyCompliance(ctx, "2026-10-05"), at("2026-10-05"));
    expect(d5.byClient.find((x) => x.key === client.id)).toBeUndefined();
    const d7 = await as(manager, (ctx) => dailyCompliance(ctx, "2026-10-07"), at("2026-10-07"));
    expect(d7.byClient.find((x) => x.key === client.id)?.planned).toBe(1);
  });

  it("un CM no puede actualizar publicaciones de clientes ajenos", async () => {
    const manager = await makeUser("gerencia");
    const cm1 = await makeUser("community_manager");
    const cm2 = await makeUser("community_manager");
    const client = (await as(manager, (ctx) => createClient(ctx, { client: { tradeName: uniq("Ajeno"), communityManagerId: cm1.employeeId }, contract: standardContract() }), at("2026-10-01"))).client;
    const p = await as(cm1, (ctx) => createPublication(ctx, { clientId: client.id, network: "facebook", scheduledDate: "2026-10-10", contentTitle: "Post" }), at("2026-10-01"));
    await expect(as(cm2, (ctx) => updatePublication(ctx, p.id, { status: "publicada" }), at("2026-10-10"))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
