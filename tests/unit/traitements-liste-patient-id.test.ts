/**
 * `getPatientTreatments` — LA PORTE NE PROJETTE PAS `patient_id`.
 *
 * ═══ LE DÉFAUT ═══
 * `app.get_patient_treatments` (076) sélectionne explicitement ses colonnes
 * et n'y met jamais `pt.patient_id` (toutes les lignes appartiennent au
 * patient filtré, par construction). `TREATMENT_ROW` exigeait pourtant
 * `patient_id: z.string()` : TOUT patient avec ≥1 traitement échouait en
 * `regle-metier` (`zod:actifs.0.patient_id`, mesuré en live le 2026-09-03
 * sur « medicaments de ayoub salmi » → la boucle avouait après 3 tours).
 * Les patients SANS traitement passaient (`[]`), masquant la panne.
 *
 * Le correctif suit la doctrine déjà écrite dans `patient-treatments.ts`
 * (lignes 90-100, cas miroir) : la porte de lecture remplit depuis
 * l'argument `patientId`, qui est la même valeur que le filtre SQL.
 * Les sept portes d'écriture (075, table nue) sont intouchées.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { setDbPort, type DbPort } from "../../src/services/db";
import { getPatientTreatments } from "../../src/services/patient-treatments";
import { ok, type Result } from "../../src/services/result";
import { afterEach } from "vitest";

/** Ligne EXACTE de la projection 076 (branche `actifs`) : sans patient_id. */
const LIGNE_076 = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  status: "active",
  dose: "1 cp",
  dose_unit: null,
  frequency: "matin",
  timing: ["morning"],
  instructions: null,
  start_date: "2026-08-01",
  end_date: null,
  stopped_at: null,
  stopped_reason: null,
  current_version: 1,
  created_at: "2026-08-01T10:00:00+01:00",
  updated_at: "2026-08-01T10:00:00+01:00",
  medication_id: "bbbbbbbb-0000-4000-8000-000000000002",
  medication_raw: "Sertraline",
  brand_name: null,
  form: null,
  strength: null,
  inn: null,
  consultation_id: null,
  previous_treatment_id: null,
};

function portListe(lignes: readonly unknown[]): DbPort {
  const inattendu = (): never => {
    throw new Error("port factice : méthode non attendue");
  };
  // Un seul `as` (la règle I9 interdit la double assertion) : on passe par
  // une variable typée `unknown`, jamais par deux assertions chaînées.
  const reponse: unknown = [
    {
      actifs: lignes,
      en_pause: [],
      arretes_recents: [],
      total_actifs: lignes.length,
      total: lignes.length,
    },
  ];
  return {
    select: inattendu,
    rpc: async <T>(): Promise<Result<readonly T[]>> => ok(reponse as readonly T[]),
    signIn: inattendu,
    signOut: inattendu,
    getSession: inattendu,
    getInstallationStatus: inattendu,
    provisionOwnerAccount: inattendu,
    invokeFunction: inattendu,
    invokeFunctionStream: inattendu,
  };
}

afterEach(() => {
  setDbPort(undefined);
});

describe("lignes 076 sans patient_id", () => {
  it("aboutit, patientId repris du filtre", async () => {
    setDbPort(portListe([LIGNE_076]));
    const r = await getPatientTreatments("1ee6d07d-0000-4000-8000-000000000000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.actifs).toHaveLength(1);
    expect(r.data.actifs[0]?.patientId).toBe("1ee6d07d-0000-4000-8000-000000000000");
  });

  it("aucun traitement → listes vides, toujours ok", async () => {
    setDbPort(portListe([]));
    const r = await getPatientTreatments("1ee6d07d-0000-4000-8000-000000000000");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.total).toBe(0);
  });
});
