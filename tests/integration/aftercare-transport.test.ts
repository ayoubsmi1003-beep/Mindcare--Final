import { createServer, type Server } from "node:http";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { aftercareSignature, dispatchAftercareOutbox, receiveAftercare, verifyAftercareSignature, type AftercareTransportConfig } from "@/server/aftercare/transport";
import { withCaller } from "@/server/db/withCaller";

// This suite must be launched by the fresh native cluster harness, never against a supplied URL.
const active = process.env.AFTERCARE_NATIVE_TEST === "synthetic";
const clinic = "b0000000-0000-4000-8000-000000000001", patient = "b2000000-0000-4000-8000-000000000001", owner = "b1000000-0000-4000-8000-000000000001", binding = "b3000000-0000-4000-8000-000000000001", object = "b5000000-0000-4000-8000-000000000001";
const key = randomUUID() + randomUUID();
let config: AftercareTransportConfig, clinicUrl: string;
let portal: Server, receiver: Server;
let ackMode: "wrong" | "valid" = "wrong";
let seen: unknown;
const listen = (server: Server) => new Promise<string>(resolve => server.listen(0, "127.0.0.1", () => { const address = server.address(); if (!address || typeof address === "string") throw new Error("Missing loopback address"); resolve(`http://127.0.0.1:${address.port}`); }));
const close = (server: Server) => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
describe.skipIf(!active)("Aftercare real native SQL and signed HTTP", () => {
  beforeAll(async () => {
    portal = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); const raw = Buffer.concat(chunks).toString();
      const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
      const request = new Request(new URL(req.url ?? "/", config.url), { method: "POST", headers });
      if (!verifyAftercareSignature(request, raw, config)) { res.writeHead(401).end(); return; }
      if (new URL(request.url).pathname === "/api/sanad/bridge/binding") { res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: true })); return; }
      const event = JSON.parse(raw); seen = event;
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ schemaVersion: 2, eventId: ackMode === "wrong" ? randomUUID() : event.eventId, correlationId: event.correlationId, status: "applied", technicalOnly: true }));
    });
    const portalUrl = await listen(portal); config = { clinic, key, url: `${portalUrl}/api/sanad/bridge` };
    receiver = createServer(async (req, res) => {
      const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
      const response = await receiveAftercare(new Request(`${clinicUrl}/api/aftercare/bridge`, { method: "POST", headers, body: Buffer.concat(chunks).toString() }), config);
      res.writeHead(response.status, { "Content-Type": "application/json" }); res.end(await response.text());
    }); clinicUrl = await listen(receiver);
  });
  afterAll(async () => { await Promise.all([close(portal), close(receiver)]); });
  it("does actual signed POST, refuses mismatched ack then acknowledges the durable original SQL event", async () => {
    expect(await dispatchAftercareOutbox(config)).toEqual({ delivered: 0, pending: 1 });
    expect(JSON.stringify(seen)).not.toContain(patient);
    expect(JSON.stringify(seen)).not.toContain("Synthetic Transport");
    const first = seen;
    ackMode = "valid";
    expect(await dispatchAftercareOutbox(config)).toEqual({ delivered: 1, pending: 0 });
    expect(seen).toEqual(first);
    expect(await dispatchAftercareOutbox(config)).toEqual({ delivered: 0, pending: 0 });
  });
  it("ingests authenticated HTTP, enforces portal identity, duplicates without false human read and denies reception SQL", async () => {
    const event = { schemaVersion: 2, eventId: randomUUID(), patientId: "b4000000-0000-4000-8000-000000000001", bindingId: binding, objectId: object, version: 1, source: "sanad", effectiveAt: new Date().toISOString(), emittedAt: new Date().toISOString(), correlationId: randomUUID(), shareState: "shared", object: { kind: "journal", body: { format: "free", text: "Synthetic HTTP journal", status: "saved" } } };
    async function send(body: unknown, signed = true) { const raw = JSON.stringify(body), timestamp = String(Math.floor(Date.now() / 1000)); return fetch(`${clinicUrl}/api/aftercare/bridge`, { method: "POST", body: raw, headers: { "X-Sanad-Timestamp": timestamp, "X-Sanad-Clinic": clinic, "X-Sanad-Signature": signed ? aftercareSignature(key, timestamp, "/api/aftercare/bridge", raw) : "0".repeat(64) } }); }
    expect((await send(event, false)).status).toBe(401);
    expect((await send({ ...event, patientId: randomUUID() })).status).toBe(422);
    expect(await (await send(event)).json()).toMatchObject({ status: "applied", technicalOnly: true });
    expect(await (await send(event)).json()).toMatchObject({ status: "duplicate", technicalOnly: true });
    const list = await withCaller(owner, q => q.query<{ read_at: string | null }>("SELECT * FROM app.list_aftercare_objects($1::uuid)", [patient]));
    expect(list.some(row => row.read_at === null)).toBe(true);
    expect(await withCaller("b1000000-0000-4000-8000-000000000003", q => q.query("SELECT * FROM app.list_aftercare_objects($1::uuid)", [patient]))).toHaveLength(0);
    await expect(withCaller("b1000000-0000-4000-8000-000000000003", q => q.query("SELECT * FROM app.read_aftercare_object($1::uuid,$2::uuid,1)", [binding, object]))).rejects.toThrow();
    expect(await withCaller(owner, q => q.query("SELECT * FROM app.read_aftercare_object($1::uuid,$2::uuid,1)", [binding, object]))).toHaveLength(1);
  });
  it("publishes trusted treatment/appointment source revisions, immutable retries and stopped/cancelled history without changing sources", async () => {
    const list = () => withCaller(owner, q => q.query<{ source: { id: string; kind: string; sourceVersion: string; publicationVersion: number; body: Record<string, unknown> } }>("SELECT app.list_aftercare_clinical_sources($1::uuid) AS source", [patient]));
    const sources = (await list()).map(row => row.source);
    expect(sources).toHaveLength(2);
    const treatment = sources.find(row => row.kind === "treatment")!, appointment = sources.find(row => row.kind === "appointment")!;
    expect(treatment.body).toMatchObject({ name: "Synthetic medication", dose: "5 mg", schedule: [], remindersAuthorizedUntil: null, sourceVersion: 1 });
    const request = randomUUID();
    const publish = (id: string, kind: string, revision: string, version: number, confirmed: boolean, requestId = randomUUID()) => withCaller(owner, q => q.query<{ envelope: { object: { body: Record<string, unknown> } } }>("SELECT * FROM app.publish_aftercare_clinical_snapshot($1::uuid,$2::text,$3::uuid,$4::text,$5::integer,$6::jsonb,false,$7::uuid,$8::boolean)", [binding, kind, id, revision, version, '["08:00","20:00"]', requestId, confirmed]));
    await expect(publish(treatment.id, "treatment", treatment.sourceVersion, 0, false)).rejects.toThrow();
    await expect(publish(treatment.id, "treatment", "0", 0, true)).rejects.toThrow();
    await expect(withCaller(owner, q => q.query("SELECT * FROM app.publish_aftercare_object($1::uuid,$2::uuid,0,'treatment',$3::jsonb,$4::uuid,true)", [binding, treatment.id, JSON.stringify(treatment.body), randomUUID()]))).rejects.toThrow();
    const approved = await publish(treatment.id, "treatment", treatment.sourceVersion, 0, true, request);
    expect(approved[0]?.envelope.object.body).toMatchObject({ name: "Synthetic medication", dose: "5 mg", schedule: ["08:00", "20:00"], status: "active", sourceVersion: 1, approvedBy: owner });
    expect(await publish(treatment.id, "treatment", treatment.sourceVersion, 0, true, request)).toEqual(approved);
    await publish(appointment.id, "appointment", appointment.sourceVersion, 0, true);
    expect(await withCaller("b1000000-0000-4000-8000-000000000003", q => q.query("SELECT app.list_aftercare_clinical_sources($1::uuid)", [patient]))).toHaveLength(0);
    await expect(withCaller("b1000000-0000-4000-8000-000000000003", q => q.query("SELECT * FROM app.publish_aftercare_clinical_snapshot($1::uuid,'treatment',$2::uuid,'1',1,'[]',false,$3::uuid,true)", [binding, treatment.id, randomUUID()]))).rejects.toThrow();
    await withCaller(owner, q => q.query("UPDATE app.patient_treatments SET status='stopped',stopped_at=now(),current_version=2 WHERE id=$1::uuid", [treatment.id]));
    await withCaller(owner, q => q.query("UPDATE app.appointments SET status='cancelled',updated_at=now() WHERE id=$1::uuid", [appointment.id]));
    await expect(publish(treatment.id, "treatment", treatment.sourceVersion, 1, true)).rejects.toThrow();
    const changed = (await list()).map(row => row.source);
    const stopped = changed.find(row => row.kind === "treatment")!, cancelled = changed.find(row => row.kind === "appointment")!;
    expect(stopped.publicationVersion).toBe(1);
    expect((await publish(stopped.id, "treatment", stopped.sourceVersion, 1, true))[0]?.envelope.object.body).toMatchObject({ status: "stopped", sourceVersion: 2 });
    expect((await publish(cancelled.id, "appointment", cancelled.sourceVersion, 1, true))[0]?.envelope.object.body).toMatchObject({ status: "cancelled", sourceVersion: cancelled.sourceVersion });
    // A lost original response can be retried even after the underlying clinical source changed.
    expect(await publish(treatment.id, "treatment", treatment.sourceVersion, 0, true, request)).toEqual(approved);
    expect(await dispatchAftercareOutbox(config)).toEqual({ delivered: 4, pending: 0 });
  });
  it("audits human support verification atomically, rejects unconfirmed/reception decisions and preserves request conflicts", async () => {
    const relation = randomUUID(), request = randomUUID();
    const approve = (user: string, confirmed: boolean, evidence = "SYNTHETIC/authority/001", scopes = ["legal-representation"]) => withCaller(user, q => q.query<{ approval: unknown }>("SELECT app.approve_aftercare_support_verification($1::uuid,$2::uuid,$3::text,$4::text[],$5::uuid,$6::boolean) AS approval", [binding, relation, evidence, scopes, request, confirmed]));
    await expect(approve(owner, false)).rejects.toThrow();
    await expect(approve("b1000000-0000-4000-8000-000000000003", true)).rejects.toThrow();
    await expect(approve(owner, true, "patient clinical text")).rejects.toThrow();
    await expect(approve(owner, true, "SYNTHETIC/authority/001", ["unknown-authority"])).rejects.toThrow();
    const first = await approve(owner, true);
    expect(first[0]?.approval).toEqual({ bindingId: binding, patientId: "b4000000-0000-4000-8000-000000000001", action: "verify", relationshipId: relation, clinicianId: owner, evidenceRef: "SYNTHETIC/authority/001", scopes: ["legal-representation"] });
    expect(await approve(owner, true)).toEqual(first);
    await expect(approve(owner, true, "SYNTHETIC/authority/002")).rejects.toThrow();
    await expect(withCaller(owner, q => q.query("SELECT * FROM app.aftercare_authority_decisions"))).rejects.toThrow();
  });
});
