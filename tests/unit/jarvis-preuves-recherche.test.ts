/**
 * M07 slice 3 — Récupération gouvernée de la passerelle (rpc injecté, sans base).
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * Porte appelée sous sa forme allowlistée, orchestration partagée (issue +
 * mapping fil + plafond 800), gouvernance (révoqué écarté), panne porte →
 * [] honnête (jamais d'exception, jamais de preuve partielle).
 * Slice 3 (hybride-live) : jambe vectorielle via rpc injecté + vecteur
 * injecté (le défaut de production — 1 Go de modèle — ne charge JAMAIS en
 * unit : chaque appel passe un vecteur explicite), calibration A3 (voisin
 * pur sous majorité → silence), panne vecteur/porte-vectorielle → lexical.
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * La porte réelle (eval-knowledge-db), le modèle (`sonde-vecteur-production`),
 * l'écran.
 */
import { describe, expect, it } from "vitest";

import {
  recupererPreuves,
  type RpcPreuves,
} from "../../src/server/jarvis/preuves-recherche";

const LIGNE = {
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
};

function fauxRpc(lignes: readonly unknown[]): RpcPreuves & { appels: Array<{ nom: string; args: unknown }> } {
  const appels: Array<{ nom: string; args: unknown }> = [];
  const estVec = (l: unknown): boolean => (l as Record<string, unknown>)["vec"] === true;
  return {
    appels,
    rpc: async <T,>(nom: string, args?: Readonly<Record<string, unknown>>) => {
      appels.push({ nom, args });
      // Chaque porte ne voit que sa jambe (miroir des portes réelles : le
      // lexical en AND ne rend pas les voisins purement vectoriels).
      const data: unknown = nom === "search_knowledge_vector"
        ? lignes.filter(estVec)
        : lignes.filter((l) => !estVec(l));
      return { data: data as T, error: null };
    },
  };
}

/** Vecteur explicite : le défaut de production (modèle 1 Go) ne charge jamais en unit. */
const SANS_VECTEUR = async (): Promise<readonly number[] | null> => null;
const FAUX_VECTEUR = async (): Promise<readonly number[] | null> => [0.1, 0.2, 0.3];

describe("recupererPreuves", () => {
  it("appelle la porte lexicale allowlistée et mappe le fil", async () => {
    const faux = fauxRpc([LIGNE]);
    const preuves = await recupererPreuves(faux, "sertraline 50 mg", SANS_VECTEUR);
    expect(faux.appels).toEqual([
      { nom: "search_knowledge_lexical", args: { p_requete: "sertraline 50 mg", p_langue: "toutes", p_limite: 20 } },
    ]);
    expect(preuves.length).toBeGreaterThan(0);
    expect(preuves[0]).toEqual({
      titre: "Catalogue medicaments",
      section: "Catalogue",
      version: "2026-09-15",
      extrait: "SERTRALINE EG — 50 mg comprime secable",
    });
  });

  it("écarte le révoqué (gouvernance) sans compter", async () => {
    const faux = fauxRpc([{ ...LIGNE, source_statut: "revoked" }]);
    expect(await recupererPreuves(faux, "sertraline", SANS_VECTEUR)).toEqual([]);
  });

  it("panne porte → [] honnête, jamais d'exception", async () => {
    const panne: RpcPreuves = {
      rpc: async () => ({ data: null, error: { message: "panne" } }),
    };
    expect(await recupererPreuves(panne, "sertraline", SANS_VECTEUR)).toEqual([]);
    const levee: RpcPreuves = {
      rpc: async () => {
        throw new Error("rupture");
      },
    };
    expect(await recupererPreuves(levee, "sertraline", SANS_VECTEUR)).toEqual([]);
  });

  it("plafonne l'extrait à 800 caractères", async () => {
    const faux = fauxRpc([{ ...LIGNE, texte: `SERTRALINE EG — 50 mg ${"x".repeat(2000)}` }]);
    const preuves = await recupererPreuves(faux, "sertraline", SANS_VECTEUR);
    expect(preuves.length).toBe(1);
    expect(preuves[0]?.extrait.length).toBeLessThanOrEqual(800);
  });

  it("hybride : la jambe vectorielle est appelée et fusionnée (typo réparée)", async () => {
    // Lexical vide (faute « sertralin ») + voisin vectoriel couvrant 2/3 →
    // preuve rendue (même gain que le service, UNE sémantique).
    const faux = fauxRpc([
      { ...LIGNE, vec: true, chunk_id: "c-vec", texte: "SERTRALINE EG — 50 mg comprime secable", score: 0.73 },
    ]);
    const preuves = await recupererPreuves(faux, "sertralin 50 mg", FAUX_VECTEUR);
    expect(faux.appels.map((a) => a.nom)).toEqual(["search_knowledge_lexical", "search_knowledge_vector"]);
    expect(preuves).toHaveLength(1);
    expect(preuves[0]).toMatchObject({ titre: "Catalogue medicaments", version: "2026-09-15" });
  });

  it("hybride : voisin pur sous majorité → silence (porte A3), pas de preuve faible", async () => {
    // « sertraline ou paroxétine » : le voisin ne couvre que la moitié →
    // aucune preuve (DS-01/WDOSE-01 mesurés `--reel`).
    const faux = fauxRpc([
      { ...LIGNE, vec: true, chunk_id: "c-vec", texte: "La paroxétine 20 mg est un ISRS souvent prescrit.", score: 0.62 },
    ]);
    expect(await recupererPreuves(faux, "sertraline ou paroxétine", FAUX_VECTEUR)).toEqual([]);
  });

  it("hybride : panne vecteur ou porte vectorielle → lexical seul, jamais d'exception", async () => {
    const faux = fauxRpc([LIGNE]);
    const explose = async (): Promise<readonly number[] | null> => {
      throw new Error("modele");
    };
    const preuves = await recupererPreuves(faux, "sertraline 50 mg", explose);
    expect(preuves).toHaveLength(1);
    const porteEnPanne: RpcPreuves = {
      rpc: async <T,>(nom: string) => {
        if (nom === "search_knowledge_vector") throw new Error("porte");
        return { data: [LIGNE] as T, error: null };
      },
    };
    expect(await recupererPreuves(porteEnPanne, "sertraline 50 mg", FAUX_VECTEUR)).toHaveLength(1);
  });
});
