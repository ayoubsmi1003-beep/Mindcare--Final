/**
 * `analyzeSession` — LE CONTRAT DE TERMINAISON.
 *
 * ═══ CE QUI EST ÉPROUVÉ ICI ═══
 *
 * Chaque exécution d'analyse atteint exactement UN état terminal, sans
 * jamais rester en `running` ni relancer toute seule :
 *   1. vol unique : deux déclenchements concurrents pour la MÊME séance
 *      partagent le même run — un seul appel fournisseur (SA-06) ;
 *   2. timeout dur : un fournisseur qui ne répond pas bascule en
 *      `delai-depasse` terminal, jamais en attente infinie (SA-05) ;
 *   3. annulation terminale : un abandon (navigation, séance changée, run
 *      supersédé) est une issue contrôlée `annule`, et un succès tardif
 *      est JETÉ, jamais appliqué (SA-07, stale) ;
 *   4. réessai = nouveau run : après un terminal, un nouvel appel refait
 *      un appel fournisseur (SA-09) ;
 *   5. `regle-metier` reste un `warn` métier attendu, pas une panne (SA-02,
 *      non-régression de `jarvis-analyse-seance-log.test.ts`).
 *
 * ⚠️ CES TESTS SUBSTITUENT LE PORT (`setDbPort`, ADR-020), ET RIEN D'AUTRE.
 * Le sujet reste la vraie `analyzeSession` : c'est son vol unique, son
 * délai et son abandon qu'on mesure, pas un simulacre. Aucun appel
 * fournisseur réel, aucune base.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { setDbPort, type DbPort } from "../../src/services/db";
import { analyseEnCours, analyzeSession, DELAI_ANALYSE_MS } from "../../src/services/jarvis";
import { log } from "../../src/services/log";
import { err, ok, type Result } from "../../src/services/result";

const SUCCES = ok({
  noteStructuree: { subjective: "s", objective: "o", assessment: "a", plan: "p" },
  evolution: [],
  pointsNonExplores: [],
  analyseId: "a1",
  version: 1,
  persistee: true,
  sources: { historiqueNotes: 3 },
});

/** Contrôle manuel de la résolution du faux transport. */
interface FauxAnalyse {
  port: DbPort;
  appels: () => number;
  resoudre: (resultat: Result<unknown>) => void;
}

function portAnalyseDiffere(): FauxAnalyse {
  let appels = 0;
  const inattendu = (): never => {
    throw new Error("port factice : méthode non attendue");
  };
  // Générique comme la signature du port et `portChaine`
  // (`apres-seance-chaine.test.ts`) : le faux rejoue la route sans connaître
  // de schéma — la file retient de l'`unknown`, converti à la résolution.
  const enAttente: Array<(resultat: unknown) => void> = [];
  const invokeFunction = <T>(
    _nom: string,
    _corps: unknown,
    signal?: AbortSignal,
  ): Promise<Result<T>> => {
    appels += 1;
    return new Promise<Result<T>>((resoudre) => {
      // Un abandon ne rejette jamais : le transport réel (`poster`) traduit
      // l'interruption en `Result` en échec — le faux fait pareil.
      const rendreEchec = (): void => {
        resoudre(err({ code: "indisponible", message: "abandon" }));
      };
      if (signal?.aborted) {
        rendreEchec();
        return;
      }
      signal?.addEventListener("abort", rendreEchec, { once: true });
      enAttente.push((resultat: unknown) => {
        signal?.removeEventListener("abort", rendreEchec);
        resoudre(resultat as Result<T>);
      });
    });
  };
  return {
    port: {
      select: inattendu,
      rpc: inattendu,
      signIn: inattendu,
      signOut: inattendu,
      getSession: inattendu,
      getInstallationStatus: inattendu,
      provisionOwnerAccount: inattendu,
      invokeFunction,
      invokeFunctionStream: inattendu,
    },
    appels: () => appels,
    resoudre: (resultat: Result<unknown>) => {
      const rendre = enAttente.shift();
      if (rendre === undefined) throw new Error("port factice : aucun appel en attente");
      rendre(resultat);
    },
  };
}

beforeEach(() => {
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.error).mockClear();
  vi.mocked(log.info).mockClear();
});

afterEach(() => {
  setDbPort(undefined);
});

describe("le délai est une borne d'architecture, pas un chiffre inventé", () => {
  it("DELAI_ANALYSE_MS vaut le budget de tour existant (60 s)", () => {
    expect(DELAI_ANALYSE_MS).toBe(60_000);
  });
});

describe("vol unique par séance (SA-06)", () => {
  it("deux déclenchements concurrents = un seul appel fournisseur", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);

    const premier = analyzeSession("c-vol-unique");
    const second = analyzeSession("c-vol-unique");
    expect(analyseEnCours("c-vol-unique")).toBe(true);

    faux.resoudre(SUCCES);
    const [r1, r2] = await Promise.all([premier, second]);

    expect(faux.appels()).toBe(1);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(analyseEnCours("c-vol-unique")).toBe(false);
  });

  it("deux séances différentes ne se partagent pas", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);

    const a = analyzeSession("c-A");
    const b = analyzeSession("c-B");
    faux.resoudre(SUCCES);
    faux.resoudre(SUCCES);
    await Promise.all([a, b]);

    expect(faux.appels()).toBe(2);
  });
});

describe("timeout dur terminal (SA-05)", () => {
  it("un fournisseur muet bascule en `delai-depasse`, en `warn`, sans `error`", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);

    const resultat = await analyzeSession("c-timeout", undefined, 20);

    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.error.technical).toBe("delai-depasse");
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
    expect(analyseEnCours("c-timeout")).toBe(false);
  });
});

describe("annulation terminale et succès tardif jeté (SA-07)", () => {
  it("abandon explicite = issue `annule` contrôlée, jamais une panne", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);
    const controleur = new AbortController();

    const promesse = analyzeSession("c-annule", controleur.signal, 60_000);
    controleur.abort();
    const resultat = await promesse;

    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.error.technical).toBe("annule");
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
  });

  it("un succès arrivé après abandon est jeté, jamais appliqué", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);
    const controleur = new AbortController();

    const promesse = analyzeSession("c-tardif", controleur.signal, 60_000);
    controleur.abort();
    // Le fournisseur finit quand même : le run est déjà terminal.
    faux.resoudre(SUCCES);
    const resultat = await promesse;

    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.error.technical).toBe("annule");
  });
});

describe("réessai = nouveau run (SA-09)", () => {
  it("après un terminal, un nouvel appel refait un appel fournisseur", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);

    const echec = analyzeSession("c-reessai");
    faux.resoudre(err({ code: "indisponible", message: "panne" }));
    const r1 = await echec;
    expect(r1.ok).toBe(false);

    const second = analyzeSession("c-reessai");
    faux.resoudre(SUCCES);
    const r2 = await second;

    expect(faux.appels()).toBe(2);
    expect(r2.ok).toBe(true);
  });
});

describe("portée longitudinale explicite (SA-03)", () => {
  it("la portée du run est transmise telle quelle, sans contenu", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);

    const promesse = analyzeSession("c-portee");
    faux.resoudre(SUCCES);
    const resultat = await promesse;

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.sources).toEqual({ historiqueNotes: 3 });
  });

  it("une portée absente ou malformée vaut 0 (« jour seul »), jamais une panne", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);

    const sansSources = ok({
      noteStructuree: { subjective: "s", objective: "o", assessment: "a", plan: "p" },
      evolution: [],
      pointsNonExplores: [],
      analyseId: "a1",
      version: 1,
      persistee: true,
    });
    const promesse = analyzeSession("c-portee-defaut");
    faux.resoudre(sansSources);
    const resultat = await promesse;

    expect(resultat.ok).toBe(true);
    if (!resultat.ok) return;
    expect(resultat.data.sources).toEqual({ historiqueNotes: 0 });
  });
});

describe("relecture : la portée survit à la persistance (SA-03)", () => {
  // La porte rend la ligne ENTIÈRE (`a.*`, 067) : `content` ET `source_state`
  // sont deux colonnes sœurs, jamais imbriquées.
  function portLecture(contenu: unknown, etat: unknown): DbPort {
    const inattendu = (): never => {
      throw new Error("port factice : méthode non attendue");
    };
    const ligne: unknown = {
      id: "a1",
      version: 2,
      content: contenu,
      ...(etat !== undefined && { source_state: etat }),
    };
    return {
      select: inattendu,
      rpc: async <T>(): Promise<Result<readonly T[]>> =>
        ok([ligne] as readonly T[]),
      signIn: inattendu,
      signOut: inattendu,
      getSession: inattendu,
      getInstallationStatus: inattendu,
      provisionOwnerAccount: inattendu,
      invokeFunction: inattendu,
      invokeFunctionStream: inattendu,
    };
  }

  const CONTENU = {
    noteStructuree: { subjective: "s", objective: "o", assessment: "a", plan: "p" },
    evolution: [],
    pointsNonExplores: [],
  };

  it("`source_state` objet est relu (2 notes antérieures)", async () => {
    const { chargerAnalyse } = await import("../../src/services/jarvis");
    setDbPort(portLecture(CONTENU, { historique_notes: 2 }));

    const relue = await chargerAnalyse("c-relue");
    expect(relue.ok).toBe(true);
    if (!relue.ok || relue.data === null) return;
    expect(relue.data.sources).toEqual({ historiqueNotes: 2 });
  });

  it("`source_state` absent ou texte corrompu vaut 0, jamais une panne", async () => {
    const { chargerAnalyse } = await import("../../src/services/jarvis");

    setDbPort(portLecture(CONTENU, undefined));
    const sansEtat = await chargerAnalyse("c-relue");
    expect(sansEtat.ok).toBe(true);
    if (!sansEtat.ok || sansEtat.data === null) return;
    expect(sansEtat.data.sources).toEqual({ historiqueNotes: 0 });

    setDbPort(portLecture(CONTENU, "{corrompu"));
    const corrompue = await chargerAnalyse("c-relue");
    expect(corrompue.ok).toBe(true);
    if (!corrompue.ok || corrompue.data === null) return;
    expect(corrompue.data.sources).toEqual({ historiqueNotes: 0 });
  });
});

describe("non-régression : `regle-metier` reste un `warn` attendu (SA-02)", () => {
  it("séance sans notes = `warn`, jamais `error`, jamais de timeout", async () => {
    const faux = portAnalyseDiffere();
    setDbPort(faux.port);

    const promesse = analyzeSession("c-sans-notes");
    faux.resoudre(err({ code: "regle-metier", message: "Aucune note à analyser." }));
    const resultat = await promesse;

    expect(resultat.ok).toBe(false);
    if (resultat.ok) return;
    expect(resultat.error.code).toBe("regle-metier");
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
  });
});
