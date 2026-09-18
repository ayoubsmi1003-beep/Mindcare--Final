/**
 * M09 — Preuve replay : fonctions pures (hachage, analyse, comparaison).
 *
 * ═══ CE QUI EST EPROUVE ═══
 * Determinisme de la canonisation et des empreintes, format sha256,
 * analyse des lignes vert/ROUGE, rattachement famille, verdicts honnetes
 * (non-mappe jamais converti en PASS), scan PII (negatifs + positif),
 * comparaison de runs (identique + drifts).
 *
 * ═══ CE QUI NE L'EST PAS ICI ═══
 * L'execution des harnesses (operateur `replay-golden.mjs`), la RLS,
 * la qualite live. Voir `pnpm eval:replay`.
 */
import { describe, expect, it } from "vitest";

import {
  REPLAY_SCHEMA_VERSION,
  chaineCanonique,
  sha256Hex,
  empreinteCas,
  partieDecisionnelle,
  analyserLignes,
  cleRattachee,
  verdictsParCas,
  enregistrementSuite,
  balayerPii,
  comparerRapports,
} from "../../scripts/replay-preuve.mjs";

// NOTE M09 : les .mjs n'ont pas de declarations ; allowJs est local au
// programme de test (tsconfig.test.json). Rien ici ne change le runtime.

describe("canonisation et empreintes", () => {
  it("chaineCanonique est stable quel que soit l'ordre d'insertion", () => {
    const a = chaineCanonique({ b: 1, a: { y: [1, 2], x: "s" } });
    const b = chaineCanonique({ a: { x: "s", y: [1, 2] }, b: 1 });
    expect(a).toBe(b);
  });

  it("chaineCanonique distingue tableaux et objets", () => {
    expect(chaineCanonique([1, 2])).not.toBe(chaineCanonique({ 0: 1, 1: 2 }));
  });

  it("sha256Hex rend un sha256 hexadecimal ASCII", () => {
    const h = sha256Hex("M01-01");
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("M01-01")).toBe(h);
    expect(sha256Hex("M01-02")).not.toBe(h);
  });

  it("empreinteCas change des qu'un champ decisionnel change", () => {
    const base = { id: "X", input: "bonjour", attendu: { statut: "valide" } };
    expect(empreinteCas({ ...base, attendu: { statut: "ecarte" } })).not.toBe(empreinteCas(base));
  });

  it("partieDecisionnelle exclut notes et meta", () => {
    const cas = { id: "M", input: "i", sortieModele: null, attendu: {}, note: "humaine", categorie: "c", langue: "FR" };
    const partie = partieDecisionnelle("intentions", cas);
    expect(partie).toEqual({ id: "M", input: "i", sortieModele: null, attendu: {} });
    expect(partieDecisionnelle("inconnue", cas)).toBeNull();
  });

  it("version du contrat de replay", () => {
    expect(REPLAY_SCHEMA_VERSION).toBe("m09-replay-v1");
  });
});

describe("analyse des lignes de harness", () => {
  it("extrait les cles vertes et rouges", () => {
    const sortie = [
      "  vert  | M01-01 [FR/test] X | modele=p latence=3ms",
      "  ROUGE | M01-02 [FR/test] Y | attendu=... obtenu=...",
      "bruit sans separateur",
      "  vert  | ",
    ].join("\n");
    const { passer, echouer } = analyserLignes(sortie);
    expect(passer).toEqual(["M01-01"]);
    expect(echouer).toEqual(["M01-02"]);
  });

  it("sortie vide : zero cle, zero crash", () => {
    expect(analyserLignes("")).toEqual({ passer: [], echouer: [], vertsAnonymes: 0, rougesAnonymes: 0 });
    expect(analyserLignes(null)).toEqual({ passer: [], echouer: [], vertsAnonymes: 0, rougesAnonymes: 0 });
  });
});

describe("rattachement et verdicts par cas", () => {
  it("intentions : cle exacte seulement", () => {
    expect(cleRattachee("intentions", "M01-01", "M01-01")).toBe(true);
    expect(cleRattachee("intentions", "M01-01", "M01-010")).toBe(false);
    expect(cleRattachee("intentions", "M01-01", "M01-01-r5")).toBe(false);
  });

  it("conversation : prefixe script#T", () => {
    expect(cleRattachee("conversation", "A-chaine", "A-chaine#T1 verdict")).toBe(true);
    expect(cleRattachee("conversation", "A-chaine", "A-chainebis#T1 verdict")).toBe(false);
  });

  it("connaissance : exact ou suffixe -check", () => {
    expect(cleRattachee("connaissance", "FR-01", "FR-01-r5")).toBe(true);
    expect(cleRattachee("connaissance", "FR-01", "FR-010-r5")).toBe(false);
  });

  it("FAIL gagne sur PASS ; absence vaut non-mappe, jamais PASS", () => {
    const v = verdictsParCas("intentions", ["A", "B", "C"], ["A", "B"], ["B"]);
    expect(v).toEqual({ A: "PASS", B: "FAIL", C: "non-mappe" });
  });
});

describe("enregistrement de suite", () => {
  it("NOT RUN porte un compteur not_run et exige une raison en aval", () => {
    const s = enregistrementSuite({ nom: "x", statut: "NOT RUN", raisonNonRun: "env absent", environnementRequis: "base" });
    expect(s.not_run_count).toBe(1);
    expect(s.pass_count).toBe(0);
    expect(s.not_run_reason).toBe("env absent");
  });

  it("FAIL sans cle rouge explicite compte au moins 1", () => {
    expect(enregistrementSuite({ nom: "x", statut: "FAIL" }).fail_count).toBe(1);
  });
});

describe("scan PII", () => {
  it("placeholders synthetiques et corpus declares passent", () => {
    expect(
      balayerPii([
        { nom: "f", brut: "uuid-karim 00000000-0000-0000-0000-000000000000 123e4567-e89b-12d3-a456-426614174000 Karim", corpusIds: [] },
        { nom: "g", brut: "source 11111111-2222-3333-4444-555555555555", corpusIds: ["11111111-2222-3333-4444-555555555555"] },
      ]),
    ).toEqual([]);
  });

  it("courriel, telephone, dossier et uuid reel sont signales", () => {
    const trouve = balayerPii([
      { nom: "f", brut: "contact nadia@example.dz 0612345678 P-0042 9f2c1a3b-4d5e-6f70-81a2-b3c4d5e6f708", corpusIds: [] },
    ]);
    expect(trouvaillesRegles(trouve)).toEqual(["courriel", "dossier", "telephone", "uuid-reel"]);
  });
});

function trouvaillesRegles(trouvailles: string[]): string[] {
  return trouvailles.map((t: string) => (t.split(": ")[1] ?? "").split(" ")[0] ?? "").sort();
}

interface SuiteMini {
  nom: string;
  statut: string;
  pass_count: number;
  fail_count: number;
  not_run_count: number;
  cles_vertes: string[];
  cles_rouges: string[];
  not_run_reason: null;
  required_environment: null;
  latence_ms: number;
  detail: null;
}

interface CasMini {
  famille: string;
  id: string;
  empreinte: string;
  verdict: string;
}

describe("comparaison de runs", () => {
  const rapport = (suites: SuiteMini[], cas: CasMini[], prov: Record<string, string> = {}) => ({
    suites,
    cas,
    provenance: { goldens_hash: "a", schema_version: "v", prompts_hash: "p", ...prov },
  });
  const suite = (nom: string, statut: string, rouges: string[] = []): SuiteMini => ({
    nom, statut, pass_count: 1, fail_count: rouges.length, not_run_count: 0,
    cles_vertes: ["k"], cles_rouges: rouges, not_run_reason: null, required_environment: null, latence_ms: 1, detail: null,
  });

  it("runs identiques : aucune diff", () => {
    const r = rapport([suite("s", "PASS")], [{ famille: "intentions", id: "M", empreinte: "e", verdict: "PASS" }]);
    expect(comparerRapports(r, structuredClone(r)).identique).toBe(true);
  });

  it("changement de verdict, nouveau rouge et golden modifie : trois diffs", () => {
    const a = rapport([suite("s", "PASS")], [{ famille: "intentions", id: "M", empreinte: "e", verdict: "PASS" }]);
    const b = rapport([suite("s", "FAIL", ["M01-9"])], [{ famille: "intentions", id: "M", empreinte: "e2", verdict: "FAIL" }]);
    const { identique, diffs } = comparerRapports(a, b);
    expect(identique).toBe(false);
    expect(diffs.some((d) => d.ecart.includes("PASS -> FAIL"))).toBe(true);
    expect(diffs.some((d) => d.ecart.includes("nouveau-rouge M01-9"))).toBe(true);
    expect(diffs.some((d) => d.ecart.includes("golden change"))).toBe(true);
  });

  it("changement de provenance signale", () => {
    const a = rapport([], []);
    const b = rapport([], [], { prompts_hash: "q" });
    const { diffs } = comparerRapports(a, b);
    expect(diffs.some((d) => d.portee === "provenance" && d.nom === "prompts_hash")).toBe(true);
  });
});
