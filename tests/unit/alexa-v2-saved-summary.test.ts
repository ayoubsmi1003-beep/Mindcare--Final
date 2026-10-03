import { beforeEach, expect, it, vi } from "vitest";
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/services/db", () => ({ db: () => ({ rpc }) }));
import { chargerResumeCas } from "@/services/resume-cas";

const id = "11111111-1111-4111-8111-111111111111";
const row = { id, version: 2, genere_le: "2026-10-01T10:00:00Z", genere_par: null, aJour: false,
  content: { schema: 2, apercu: { nom: "Dossier clinique", traitements: [{ texte: "Sertraline 50 mg", sources: [{ t: "treatment", id }] }] }, chronologie: [], anterieur: [], etat_actuel: [] } };
beforeEach(() => rpc.mockReset());

it("reads the persisted summary through its audited gate and preserves stale status and sources", async () => {
  rpc.mockResolvedValue({ ok: true, data: [row] });
  expect(await chargerResumeCas(id)).toMatchObject({ ok: true, data: { resume: { id, version: 2, aJour: false,
    contenu: { schema: 2, apercu: { traitements: [{ sources: [{ t: "treatment", id }] }] } } } } });
  expect(rpc).toHaveBeenCalledWith("get_alexa_case_summary", { p_patient_id: id });
});
it("treats the gate's explicit null as an unavailable or absent summary without disclosing which", async () => {
  rpc.mockResolvedValue({ ok: true, data: [null] });
  expect(await chargerResumeCas(id)).toEqual({ ok: true, data: { resume: null } });
});
it("rejects malformed metadata rather than presenting a false empty summary", async () => {
  for (const data of [[], [{ ...row, aJour: "true" }], [{ ...row, version: -1 }], [{ ...row, content: undefined }]]) {
    rpc.mockResolvedValue({ ok: true, data });
    expect((await chargerResumeCas(id)).ok).toBe(false);
  }
});
it("keeps a legacy schema-one summary readable", async () => {
  rpc.mockResolvedValue({ ok: true, data: [{ ...row, aJour: true, content: { schema: 1, en_bref: [{ texte: "Fait consigné", sources: [] }] } }] });
  expect(await chargerResumeCas(id)).toMatchObject({ ok: true, data: { resume: { aJour: true, contenu: { schema: 1, enBref: [{ texte: "Fait consigné" }] } } } });
});
it("preserves the recorded generator display name instead of requiring an internal UUID", async () => {
  rpc.mockResolvedValue({ ok: true, data: [{ ...row, genere_par: "Dr Développement" }] });
  expect(await chargerResumeCas(id)).toMatchObject({ ok: true, data: { resume: { generePar: "Dr Développement", genereLe: row.genere_le } } });
});
