/**
 * M07 slice 2 — UNE sémantique (service == passerelle).
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Sur les mêmes lignes de portes brutes, le service
 * (`rechercherConnaissance`, portes via DbPort factice) et l'orchestrateur
 * partagé (`orchestrerRecherche`, voie de la passerelle) rendent la même
 * issue et les mêmes preuves : la factorisation n'a rien changé, et tout
 * changement futur devra passer ici.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * Les portes réelles (eval-knowledge-db), le modèle, l'écran.
 */
import { describe, expect, it } from "vitest";

import { orchestrerRecherche } from "../../src/server/knowledge/recherche";
import {
  rechercherConnaissance,
  type DependancesConnaissance,
} from "../../src/services/connaissance-recherche";
import { setDbPort, type DbPort } from "../../src/services/db";
import { ok, type Result } from "../../src/services/result";

const LIGNES: readonly unknown[] = [
  {
    chunk_id: "c1",
    source_id: "s1",
    source_titre: "Catalogue medicaments",
    source_version: "2026-09-15",
    section: "Catalogue",
    version_chunk: "struct-v1",
    langue: "fr",
    texte: "SERTRALINE EG — 50 mg comprime secable",
    score: 0.9,
    source_statut: "active",
    source_classification: "C4",
    source_approuvee_le: "2026-09-15T00:00:00.000Z",
    source_approuvee_par: "00000000-0000-0000-0000-0000000000a1",
    source_revue_a_jour: true,
    source_remplacee_par: null,
  },
];

const FAUX_PORT: DbPort = {
  select: () => Promise.reject(new Error("non implante")),
  rpc: async <T,>(nom: string): Promise<Result<readonly T[]>> => {
    if (nom === "search_knowledge_lexical") return ok(LIGNES as readonly T[]);
    return ok([] as readonly T[]);
  },
  signIn: () => Promise.reject(new Error("non implante")),
  signOut: () => Promise.reject(new Error("non implante")),
  getSession: () => Promise.reject(new Error("non implante")),
  getInstallationStatus: () => Promise.reject(new Error("non implante")),
  provisionOwnerAccount: () => Promise.reject(new Error("non implante")),
  invokeFunction: () => Promise.reject(new Error("non implante")),
  invokeFunctionStream: () => Promise.reject(new Error("non implante")),
};

const DEPS: DependancesConnaissance = {
  vecteurRequete: async () => null,
};

describe("orchestrateur partage", () => {
  it("service et orchestrateur rendent issue + preuves identiques", async () => {
    setDbPort(FAUX_PORT);
    try {
      const viaService = await rechercherConnaissance("sertraline 50 mg", "fr", DEPS);
      expect(viaService.ok).toBe(true);
      if (!viaService.ok) return;
      const viaOrchestrateur = await orchestrerRecherche("sertraline 50 mg", LIGNES, []);
      expect(viaOrchestrateur.issue).toBe(viaService.data.issue);
      expect(viaOrchestrateur.evidences).toEqual([...viaService.data.evidences]);
    } finally {
      setDbPort(undefined);
    }
  });

  it("lignes malformées écartées des deux côtés, sans lever", async () => {
    setDbPort(FAUX_PORT);
    try {
      const viaOrchestrateur = await orchestrerRecherche("x", [{ pas: "une ligne" }, null, 42], []);
      expect(viaOrchestrateur.issue).toBe("aucune");
      expect(viaOrchestrateur.evidences).toEqual([]);
    } finally {
      setDbPort(undefined);
    }
  });
});
