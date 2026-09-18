/**
 * M07 — Service : pipeline honnête, borné, sans base réelle.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Validation de requête, lexical-seul nominal pré-B, branche vectorielle
 * avec vecteur injecté, échec de porte → `indisponible` (jamais de preuve
 * partielle), lignes non récupérables écartées, issues honnêtes.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * Les portes réelles (migration 092 + base → NOT RUN, voir eval).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  MAX_REQUETE_CARACTERES,
  rechercherConnaissance,
  type DependancesConnaissance,
  type LignePorte,
} from "../../src/services/connaissance-recherche";
import { setDbPort, type DbPort } from "../../src/services/db";
import type { Result } from "../../src/services/result";
import { err, ok } from "../../src/services/result";

function ligne(surcharge: Partial<LignePorte> = {}): LignePorte {
  return {
    chunk_id: "c1",
    source_id: "s1",
    source_titre: "Guide anxiété",
    source_version: "2026-09-01",
    section: "Traitement",
    version_chunk: "struct-v1",
    langue: "fr",
    texte: "La sertraline 50 mg est une option de première intention dans l'anxiété.",
    score: 0.9,
    source_statut: "active",
    source_classification: "C4",
    source_approuvee_le: "2026-09-01T10:00:00+01:00",
    source_approuvee_par: "00000000-0000-0000-0000-000000000001",
    source_revue_a_jour: true,
    source_remplacee_par: null,
    ...surcharge,
  };
}

/**
 * Faux DbPort substitué via `setDbPort` (idiome ADR-020, cf.
 * `analyse-session-run`) : le service appelle `db()` avec des noms de portes
 * LITTÉRAUX — seule forme que gen-db-allowlist sait extraire (pré-vol 13).
 * `files` rejoue des réponses par porte, dans l'ordre ; `parDefaut` au-delà.
 */
function installerPortes(
  files: Readonly<Record<string, Result<readonly unknown[]>[]>>,
  parDefaut: Result<readonly unknown[]>,
): () => number {
  let appels = 0;
  const restantes = new Map<string, Result<readonly unknown[]>[]>(
    Object.entries(files).map(([nom, liste]) => [nom, [...liste]]),
  );
  const inattendu = (): never => {
    throw new Error("porte factice : méthode non implantée");
  };
  const rpc = async <T>(nom: string, _args: unknown): Promise<Result<readonly T[]>> => {
    appels += 1;
    const file = restantes.get(nom);
    const premier = file?.shift();
    const resultat = premier ?? parDefaut;
    return resultat as Result<readonly T[]>;
  };
  const porte: DbPort = {
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
  setDbPort(porte);
  return () => appels;
}

afterEach(() => {
  setDbPort(undefined);
});

function deps(
  vecteur: readonly number[] | null = null,
): DependancesConnaissance {
  return { vecteurRequete: async (_q) => vecteur };
}

describe("validation", () => {
  it("requête vide → aucune, sans appel porte", async () => {
    const appels = installerPortes({}, ok([ligne()]));
    const resultat = await rechercherConnaissance("   ", "fr", deps());
    expect(resultat.ok).toBe(true);
    if (resultat.ok) expect(resultat.data.issue).toBe("aucune");
    expect(appels()).toBe(0);
  });

  it(`requête > ${MAX_REQUETE_CARACTERES} → refus borné, sans appel porte`, async () => {
    const appels = installerPortes({}, ok([ligne()]));
    const d = deps();
    const resultat = await rechercherConnaissance("x".repeat(MAX_REQUETE_CARACTERES + 1), "fr", d);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("regle-metier");
    expect(appels()).toBe(0);
  });

  it("historique demandé → refus explicite, sans appel porte (H1, jamais de mélange)", async () => {
    const appels = installerPortes({}, ok([ligne()]));
    const d = deps();
    const resultat = await rechercherConnaissance("sertraline", "fr", d, { inclureHistorique: true });
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) {
      expect(resultat.error.code).toBe("regle-metier");
      expect(resultat.error.context).toBe("connaissance:historique");
    }
    expect(appels()).toBe(0);
  });
});

describe("pipeline nominal (lexical seul, pré-B)", () => {
  it("correspondance exacte → pertinent avec preuve complète", async () => {
    installerPortes({}, ok([ligne()]));
    const resultat = await rechercherConnaissance("sertraline 50 mg première intention", "fr", deps());
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.data.issue).toBe("pertinent");
      expect(resultat.data.evidences).toHaveLength(1);
      expect(resultat.data.evidences[0]).toMatchObject({
        sourceTitre: "Guide anxiété",
        sourceVersion: "2026-09-01",
        section: "Traitement",
      });
    }
  });

  it("hors sujet → aucune, evidences vides (n°28)", async () => {
    installerPortes(
      {
        "search_knowledge_lexical": [
          ok([ligne({ texte: "La comptabilité du cabinet se clôture le 31 décembre.", section: "Comptabilité" })]),
        ],
      },
      ok([]),
    );
    const d = deps();
    const resultat = await rechercherConnaissance("posologie sertraline anxiété", "fr", d);
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.data.issue).toBe("aucune");
      expect(resultat.data.evidences).toHaveLength(0);
    }
  });

  it("lignes révoquées/non approuvées écartées même si la porte les rendait", async () => {
    installerPortes(
      {
        "search_knowledge_lexical": [
          ok([
            ligne({ chunk_id: "revoque", source_statut: "revoked" }),
            ligne({ chunk_id: "inactive", source_statut: "inactive" }),
            ligne({ chunk_id: "sans-aval", source_approuvee_le: null, source_approuvee_par: null }),
            ligne({ chunk_id: "c1-c2", source_classification: "C2" }),
            ligne({ chunk_id: "retard", source_revue_a_jour: false }),
            ligne({ chunk_id: "vieux", source_statut: "superseded", source_remplacee_par: "s2" }),
          ]),
        ],
      },
      ok([]),
    );
    const d = deps();
    const resultat = await rechercherConnaissance("sertraline", "fr", d);
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.data.issue).toBe("aucune");
      expect(resultat.data.evidences).toHaveLength(0);
    }
  });

  it("lignes malformées écartées, valides conservées", async () => {
    installerPortes({ "search_knowledge_lexical": [ok([{ n_importe_quoi: 1 }, ligne()])] }, ok([]));
    const d = deps();
    const resultat = await rechercherConnaissance("sertraline 50 mg première intention", "fr", d);
    expect(resultat.ok).toBe(true);
    if (resultat.ok) expect(resultat.data.evidences).toHaveLength(1);
  });
});

describe("branche vectorielle (vecteur injecté)", () => {
  it("candidat vectoriel seul pertinent → pertinent", async () => {
    installerPortes(
      {
        "search_knowledge_lexical": [ok([])],
        "search_knowledge_vector": [
          ok([ligne({ chunk_id: "vec", texte: "Prise en charge de l'anxiété persistante malgré traitement.", score: 0.92 })]),
        ],
      },
      ok([]),
    );
    const d = deps([0.1, 0.2, 0.3]);
    const resultat = await rechercherConnaissance("anxiété persistante malgré traitement", "fr", d);
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.data.issue).toBe("pertinent");
      expect(resultat.data.evidences[0]?.chunkId).toBe("vec");
    }
  });

  it("échec porte vectorielle → indisponible, pas de preuve partielle", async () => {
    installerPortes(
      {
        "search_knowledge_lexical": [ok([ligne()])],
        "search_knowledge_vector": [err({ code: "indisponible", message: "panne" })],
      },
      ok([]),
    );
    const d = deps([0.1]);
    const resultat = await rechercherConnaissance("sertraline", "fr", d);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("indisponible");
  });
});

describe("pannes honnêtes", () => {
  it("échec porte lexicale → indisponible", async () => {
    installerPortes({ "search_knowledge_lexical": [err({ code: "indisponible", message: "panne" })] }, ok([]));
    const d = deps();
    const resultat = await rechercherConnaissance("sertraline", "fr", d);
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) {
      expect(resultat.error.code).toBe("indisponible");
      expect(resultat.error.context).toBe("rpc:search_knowledge_lexical");
    }
  });
});

describe("frontière pg réelle (R3-D) : node-pg rend timestamptz en Date", () => {
  it("approved_at en Date valide → ligne récupérable (pas de zéro-silencieux)", async () => {
    // Charge brute telle que node-pg la rend (Date, pas string) : le service
    // normalise à la frontière, la gouvernance reste string|null en aval.
    const brute = { ...ligne(), source_approuvee_le: new Date("2026-09-01T10:00:00+01:00") };
    installerPortes({ "search_knowledge_lexical": [ok([brute])] }, ok([]));
    const resultat = await rechercherConnaissance("sertraline 50 mg première intention", "fr", deps());
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.data.issue).toBe("pertinent");
      expect(resultat.data.evidences).toHaveLength(1);
    }
  });

  it("approved_at en Date invalide → ligne écartée sans lever, sans fuite", async () => {
    const brute = { ...ligne(), source_approuvee_le: new Date("invalide") };
    installerPortes({ "search_knowledge_lexical": [ok([brute])] }, ok([]));
    const resultat = await rechercherConnaissance("sertraline 50 mg première intention", "fr", deps());
    expect(resultat.ok).toBe(true);
    if (resultat.ok) {
      expect(resultat.data.issue).toBe("aucune");
      expect(resultat.data.evidences).toHaveLength(0);
    }
  });
});
