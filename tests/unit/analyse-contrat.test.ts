/**
 * Le contrat de lecture de l'écran Statistiques.
 *
 * ⚠️ CE QUI EST ÉPROUVÉ ICI : la frontière entre Postgres et l'écran. Une porte
 * peut rendre un `jsonb` parfait et l'écran afficher « aucune donnée » parce
 * qu'un champ a été mal lu — c'est le défaut exact que `dashboard.ts` documente
 * (camelCase contre snake_case). Les valeurs ci-dessous ont la FORME réelle
 * rendue par `app.get_analysis_overview`, pas une forme inventée.
 *
 * ⚠️ CE QUI N'EST PAS ÉPROUVÉ ICI : les comptes, la RLS, les fenêtres. Cela
 * vit dans `tests/sql/analyse-gates.sql` et se joue contre une vraie base.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { setDbPort, type DbPort } from "../../src/services/db";
import { err, ok, type Result } from "../../src/services/result";
import { getAnalyseDetail, getAnalyseOverview } from "../../src/services/analyse";

function portRpc(reponse: Result<unknown>): DbPort {
  const inattendu = (): never => {
    throw new Error("port factice : méthode non attendue");
  };
  const rpc = async <T>(): Promise<Result<readonly T[]>> => reponse as Result<readonly T[]>;
  return {
    select: inattendu,
    rpc,
    signIn: inattendu,
    signOut: inattendu,
    getSession: inattendu,
    getInstallationStatus: inattendu,
    provisionOwnerAccount: inattendu,
    invokeFunction: inattendu,
    invokeFunctionStream: inattendu,
  };
}

const FLUX = {
  seances: 314,
  patientes_vues: 159,
  retours: 159,
  nouveaux: 0,
  absences: 27,
  annulations: 3,
  notes_signees: 295,
  notes_manquantes: 20,
  echelles: 55,
  changements_traitement: 0,
};

/** La forme EXACTE rendue par la porte, y compris les clés nullables. */
const APERCU = {
  periode: {
    du: "2026-09-30",
    au: "2026-10-29",
    jours: 30,
    precedente_du: "2026-08-31",
    precedente_au: "2026-09-29",
    granularite: "jour",
  },
  couverture: {
    premiere_activite: "2023-11-30T09:00:00+00:00",
    derniere_activite: "2026-10-27T16:15:00+00:00",
  },
  pulse: {
    ...FLUX,
    patients_total: 1558,
    patients_suivis: 1002,
    rdv_a_venir: 147,
    rdv_non_clotures: 3,
    traitements_actifs: 280,
  },
  comparaison: { ...FLUX, seances: 214 },
  serie: [
    { cle: "2026-09-30", seances: 12, nouveaux: 0, absences: 1, couvert: true },
    { cle: "2026-10-01", seances: 0, nouveaux: 0, absences: 0, couvert: false },
  ],
  statuts: [{ cle: "completed", n: 314 }],
  types: [{ cle: "suivi", n: 300 }, { cle: "non_renseigne", n: 14 }],
  jours_semaine: [{ cle: "1", n: 80 }],
  heures: [{ cle: "9", n: 44 }],
  delais: [{ cle: "8-30", n: 120 }],
  diagnostics: [
    { label: "Trouble anxieux généralisé", code: "F41.1", total: 10, actifs: 8 },
    { label: "Diagnostic sans code", code: null, total: 3, actifs: 3 },
  ],
  echelles: [
    {
      code: "PHQ9",
      nom: "PHQ-9 — dépression",
      n: 10,
      patientes: 8,
      bandes: [{ cle: "minimal", n: 9 }, { cle: null, n: 1 }],
      derniers: [{ cle: "minimal", n: 7 }],
      repetes: 2,
    },
  ],
  encaisse: { montant: 949000, perimetre: "cabinet" },
};

afterEach(() => {
  setDbPort(undefined);
});

describe("aperçu", () => {
  it("lit la forme rendue par la porte et renomme les clés", async () => {
    setDbPort(portRpc(ok([APERCU])));
    const r = await getAnalyseOverview("2026-09-30", "2026-10-29");

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data).not.toBeNull();
    // `jours_semaine` → `joursSemaine` : c'est exactement le décalage qui
    // laisserait un graphique vide sans que rien ne le signale.
    expect(r.data?.joursSemaine[0]?.cle).toBe("1");
    expect(r.data?.pulse.seances).toBe(314);
    expect(r.data?.comparaison.seances).toBe(214);
    expect(r.data?.serie[1]?.couvert).toBe(false);
    expect(r.data?.diagnostics[1]?.code).toBeNull();
  });

  it("rend null quand la porte refuse — sans erreur", async () => {
    // `null` = aucun droit. Ce n'est pas une panne : l'écran affiche son état
    // vide, il n'annonce pas une erreur de lecture.
    setDbPort(portRpc(ok([])));
    const r = await getAnalyseOverview("2026-09-30", "2026-10-29");
    expect(r).toEqual(ok(null));
  });

  it("rend une erreur quand la porte échoue", async () => {
    setDbPort(portRpc(err({ code: "indisponible" as const, message: "Base injoignable." })));
    const r = await getAnalyseOverview("2026-09-30", "2026-10-29");
    expect(r.ok).toBe(false);
  });

  it("rend une erreur de contrat quand un champ obligatoire manque", async () => {
    // `couvert` retiré : la série ne peut plus distinguer un zéro mesuré d'un
    // trou. Mieux vaut une erreur explicite qu'une courbe qui ment.
    const casse: Record<string, unknown> = {
      ...APERCU,
      serie: [{ cle: "2026-09-30", seances: 12, nouveaux: 0, absences: 1 }],
    };
    setDbPort(portRpc(ok([casse])));
    const r = await getAnalyseOverview("2026-09-30", "2026-10-29");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe("inattendu");
  });
});

describe("détail nominatif", () => {
  it("renomme les colonnes et garde les liens", async () => {
    setDbPort(
      portRpc(
        ok([
          {
            total: 387,
            lignes: [
              {
                patient_id: "00000000-0000-0000-0000-0000000000a1",
                nom: "Patiente fictive",
                numero: "P-0001",
                evenement_le: "2026-10-24T05:00:00+00:00",
                consultation_id: "00000000-0000-0000-0000-0000000000b1",
                rendez_vous_id: null,
                valeur: null,
              },
            ],
          },
        ]),
      ),
    );
    const r = await getAnalyseDetail("notes_manquantes", null, "2026-09-30", "2026-10-29");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data?.total).toBe(387);
    expect(r.data?.lignes[0]?.patientId).toBe("00000000-0000-0000-0000-0000000000a1");
    expect(r.data?.lignes[0]?.rendezVousId).toBeNull();
  });

  it("rend null pour un rôle non clinique", async () => {
    setDbPort(portRpc(ok([])));
    const r = await getAnalyseDetail("seances", null, "2026-09-30", "2026-10-29");
    expect(r).toEqual(ok(null));
  });
});
