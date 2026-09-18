/**
 * L'ENCHAÎNEMENT D'APRÈS-SÉANCE — ET SA PROPRIÉTÉ NON NÉGOCIABLE.
 *
 * ═══ CE QUI EST ÉPROUVÉ ICI ═══
 *
 * La règle qui gouverne tout ce module : AUCUNE PANNE D'IA NE TOUCHE LA
 * DOCUMENTATION CLINIQUE. La consultation est close avant que quoi que ce soit
 * ne commence ; l'enchaînement ne peut donc que RAPPORTER, jamais échouer d'une
 * façon qui remonterait à l'appelant comme une erreur de clôture.
 *
 * Concrètement, trois propriétés :
 *   1. il ne LÈVE jamais, même si une étape rejette ;
 *   2. si l'analyse échoue, le résumé n'est pas tenté — il lui manquerait sa
 *      source, et un résumé « à jour » qui ignore la séance qu'on vient de
 *      clore est plus trompeur qu'un résumé visiblement périmé ;
 *   3. l'ordre est SÉQUENTIEL, parce que le résumé consomme l'analyse.
 *
 * ⚠️ CES TESTS SUBSTITUENT LES DEUX APPELS RÉSEAU, ET RIEN D'AUTRE. Le sujet
 * du test reste le vrai `enchainerApresSeance` : c'est sa logique de
 * séquencement et de défaillance qu'on mesure, pas un simulacre.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const analyzeSession = vi.fn();
const genererResumeCas = vi.fn();

vi.mock("../../src/services/jarvis", () => ({ analyzeSession }));
vi.mock("../../src/services/resume-cas", () => ({ genererResumeCas }));
vi.mock("../../src/services/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

const { cleConfirmationApresSeance, enchainerApresSeance } = await import(
  "../../src/services/apres-seance"
);

const OK_ANALYSE = {
  ok: true as const,
  data: { persistee: true, analyseId: "a1", version: 1 },
};
const OK_RESUME = { ok: true as const, data: { resume: {} } };
const ECHEC = (code: string, message: string) => ({
  ok: false as const,
  error: { code, message },
});

beforeEach(() => {
  analyzeSession.mockReset();
  genererResumeCas.mockReset();
});

describe("le chemin nominal", () => {
  it("analyse puis résume, dans cet ordre", async () => {
    const appels: string[] = [];
    analyzeSession.mockImplementation(() => {
      appels.push("analyse");
      return Promise.resolve(OK_ANALYSE);
    });
    genererResumeCas.mockImplementation(() => {
      appels.push("resume");
      return Promise.resolve(OK_RESUME);
    });

    const suivi = await enchainerApresSeance("c1", "p1");

    // L'ordre n'est pas une préférence : le résumé LIT l'analyse persistée.
    expect(appels).toEqual(["analyse", "resume"]);
    expect(suivi.analyse).toBe("faite");
    expect(suivi.resume).toBe("faite");
    expect(suivi.message).toBeNull();
  });

  it("rapporte chaque changement d'état à l'écran", async () => {
    analyzeSession.mockResolvedValue(OK_ANALYSE);
    genererResumeCas.mockResolvedValue(OK_RESUME);
    const vus: string[] = [];
    await enchainerApresSeance("c1", "p1", (s) => vus.push(`${s.analyse}/${s.resume}`));
    expect(vus[0]).toBe("en-cours/attente");
    expect(vus.at(-1)).toBe("faite/faite");
  });
});

describe("quand l'IA tombe", () => {
  it("n'essaie PAS le résumé si l'analyse a échoué", async () => {
    analyzeSession.mockResolvedValue(ECHEC("indisponible", "Assistant indisponible."));
    const suivi = await enchainerApresSeance("c1", "p1");

    expect(genererResumeCas).not.toHaveBeenCalled();
    expect(suivi.analyse).toBe("echouee");
    // `ignoree` et non `echouee` : le résumé n'a pas échoué, il n'a pas eu
    // lieu. Les confondre enverrait chercher un défaut là où il n'y en a pas.
    expect(suivi.resume).toBe("ignoree");
    expect(suivi.message).toBe("Assistant indisponible.");
  });

  it("compte une analyse NON PERSISTÉE comme un échec", async () => {
    // Calculée mais pas rangée : la séance suivante ne la retrouvera pas et le
    // résumé ne peut pas s'appuyer dessus. L'afficher comme « faite » serait
    // promettre une permanence qui n'existe pas.
    analyzeSession.mockResolvedValue({
      ok: true as const,
      data: { persistee: false, analyseId: null, version: null },
    });
    genererResumeCas.mockResolvedValue(OK_RESUME);
    const suivi = await enchainerApresSeance("c1", "p1");
    expect(suivi.analyse).toBe("echouee");
  });

  it("laisse la version précédente en place si le résumé échoue", async () => {
    analyzeSession.mockResolvedValue(OK_ANALYSE);
    genererResumeCas.mockResolvedValue(ECHEC("hors-ligne", "Le réseau est indisponible."));
    const suivi = await enchainerApresSeance("c1", "p1");
    expect(suivi.analyse).toBe("faite");
    expect(suivi.resume).toBe("echouee");
    expect(suivi.message).toBe("Le réseau est indisponible.");
  });

  it("NE LÈVE JAMAIS — une clôture ne peut pas casser sur une panne d'IA", async () => {
    analyzeSession.mockRejectedValue(new Error("réseau coupé"));
    // Si cette promesse rejetait, un appelant qui aurait écrit `await`
    // remonterait l'échec sur le geste de clôture. C'est précisément ce que
    // l'architecture interdit — le rejet est donc absorbé et RAPPORTÉ.
    const suivi = await enchainerApresSeance("c1", "p1");
    expect(suivi.analyse).toBe("echouee");
    expect(suivi.resume).toBe("ignoree");
    expect(genererResumeCas).not.toHaveBeenCalled();
  });
});

describe("sans patient", () => {
  it("n'appelle rien du tout", async () => {
    const suivi = await enchainerApresSeance("c1", null);
    expect(analyzeSession).not.toHaveBeenCalled();
    expect(genererResumeCas).not.toHaveBeenCalled();
    expect(suivi.analyse).toBe("ignoree");
    expect(suivi.resume).toBe("ignoree");
  });
});

describe("séance sans notes (`regle-metier` n'est pas un échec)", () => {
  it("marque l'analyse `ignoree` mais génère QUAND MÊME le résumé", async () => {
    // La route rend `regle-metier` quand `raw_notes` est vide (SOAP seul, ou
    // clôture sans notes — gelé à la clôture, mig. 026, rien à « relancer »).
    // Le résumé (`build_case_context`, 068) agrège le reste du dossier : le
    // sauter laisserait un résumé périmé affiché comme à jour.
    analyzeSession.mockResolvedValue(ECHEC("regle-metier", "Aucune note à analyser pour cette séance."));
    genererResumeCas.mockResolvedValue(OK_RESUME);

    const suivi = await enchainerApresSeance("c1", "p1");

    expect(genererResumeCas).toHaveBeenCalledTimes(1);
    expect(suivi.analyse).toBe("ignoree");
    expect(suivi.resume).toBe("faite");
    expect(suivi.message).toBeNull();
  });

  it("rapporte l'échec du résumé quand il suit un sans-objet", async () => {
    analyzeSession.mockResolvedValue(ECHEC("regle-metier", "Aucune note à analyser pour cette séance."));
    genererResumeCas.mockResolvedValue(ECHEC("hors-ligne", "Le réseau est indisponible."));

    const suivi = await enchainerApresSeance("c1", "p1");

    expect(suivi.analyse).toBe("ignoree");
    expect(suivi.resume).toBe("echouee");
    expect(suivi.message).toBe("Le réseau est indisponible.");
  });
});

describe("la confirmation affichée pour chaque état", () => {
  // La correspondance état → clé `fr.feedback.apresSeance` vivait inline dans
  // `clore()` : six branches non testées, dont deux portent le correctif
  // `regle-metier`. Chaque ligne ci-dessous est un état que l'écran traverse
  // réellement après une clôture.
  const cas: ReadonlyArray<readonly [string, string | null, string | null]> = [
    ["analyse en cours", "en-cours/attente", "analyseEnCours"],
    ["analyse en panne", "echouee/ignoree", "analyseEchouee"],
    ["sans objet, résumé pas encore parti", "ignoree/attente", "analyseSansObjet"],
    ["résumé en cours (avec analyse)", "faite/en-cours", "resumeEnCours"],
    ["résumé en cours (sans objet)", "ignoree/en-cours", "resumeEnCours"],
    ["résumé en panne", "faite/echouee", "resumeEchoue"],
    ["tout à jour", "faite/faite", "terminee"],
    ["sans objet puis résumé à jour", "ignoree/faite", "analyseSansObjet"],
    ["état initial jamais émis", "attente/attente", null],
  ];
  it.each(cas)("%s → %s", (_libelle, etat, attendue) => {
    const [analyse, resume] = (etat as string).split("/");
    expect(
      cleConfirmationApresSeance({
        analyse: analyse as "attente" | "en-cours" | "faite" | "echouee" | "ignoree",
        resume: resume as "attente" | "en-cours" | "faite" | "echouee" | "ignoree",
        message: null,
      }),
    ).toBe(attendue);
  });

  it("sans patient (`ignoree`/`ignoree`) : garde le message courant", () => {
    // `clore()` a posé « Séance terminée. » avant l'enchaînement : un retour
    // non-`null` ici l'écraserait — et un retour `analyseSansObjet` mentirait,
    // le résumé n'ayant même pas été tenté.
    expect(
      cleConfirmationApresSeance({ analyse: "ignoree", resume: "ignoree", message: null }),
    ).toBeNull();
  });
});
