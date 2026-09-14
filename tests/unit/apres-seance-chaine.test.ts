/**
 * LA CHAÎNE COMPLÈTE, DE LA CLÔTURE À LA CONSOLE.
 *
 * ═══ LE TROU QUE CE FICHIER BOUCHE ═══
 *
 * Chaque couche était éprouvée isolément : `apres-seance.test.ts` substitue
 * `analyzeSession`/`genererResumeCas`, et `jarvis-analyse-seance-log.test.ts`
 * substitue le port. Mais le défaut d'origine vivait dans la COMPOSITION —
 * une issue métier attendue qui traversait trois modules jusqu'à la console
 * en se déguisant en panne. Aucun test n'exerçait les vrais modules ensemble.
 *
 * Ici les modules sont VRAIS (`enchainerApresSeance`, `analyzeSession`,
 * `genererResumeCas`, `cleConfirmationApresSeance`) ; seul le transport est
 * faux (`setDbPort`, ADR-020 — la route répond `regle-metier` sans notes,
 * comme la vraie étape 3, et sans appeler aucun LLM). Ce qu'on mesure :
 * l'état final, la séquence exacte des confirmations vues par l'écran, et
 * surtout le niveau de chaque trace — `log.error` ne doit jamais porter
 * l'analyse d'une séance sans notes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import {
  cleConfirmationApresSeance,
  enchainerApresSeance,
  type SuiviApresSeance,
} from "../../src/services/apres-seance";
import { setDbPort, type DbPort } from "../../src/services/db";
import { log } from "../../src/services/log";
import { err, ok, type Result } from "../../src/services/result";

const SANS_NOTES = err({
  code: "regle-metier" as const,
  message: "Aucune note à analyser pour cette séance.",
});
const AVEC_NOTES = ok({
  noteStructuree: { subjective: "s", objective: "o", assessment: "a", plan: "p" },
  evolution: [],
  pointsNonExplores: [],
  analyseId: "a1",
  version: 1,
  persistee: true,
});
const RESUME_OK = ok({
  resume: { id: "r1", version: 1, genere_le: "2026-01-01T00:00:00Z", genere_par: null, content: {} },
});
const RESUME_PANNE = err({ code: "hors-ligne" as const, message: "Le réseau est indisponible." });

/**
 * Port factice COMPLET (aucun cast) qui rejoue la route : `regle-metier` ou
 * succès d'analyse selon le scénario, succès ou panne de résumé.
 */
function portChaine(analyse: Result<unknown>, resume: Result<unknown>): DbPort {
  const repondre = (nom: string): unknown =>
    nom === "jarvis-analyze-session" ? analyse : resume;
  const inattendu = (): never => {
    throw new Error("port factice : méthode non attendue");
  };
  // Générique comme la signature du port : le même faux sert l'analyse
  // comme le résumé, sans cast double (interdit). Pas de `vi.fn` ici : on
  // n'assert rien sur les appels réseau, seulement sur états et journaux.
  const invokeFunction = async <T>(nom: string): Promise<Result<T>> =>
    repondre(nom) as Result<T>;
  return {
    select: inattendu,
    rpc: inattendu,
    signIn: inattendu,
    signOut: inattendu,
    getSession: inattendu,
    getInstallationStatus: inattendu,
    provisionOwnerAccount: inattendu,
    invokeFunction,
    invokeFunctionStream: inattendu,
  };
}

const evenements = (niveau: "warn" | "error"): readonly unknown[] =>
  vi.mocked(log[niveau]).mock.calls.map((appel) => appel[0]);

beforeEach(() => {
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.error).mockClear();
  vi.mocked(log.info).mockClear();
});

afterEach(() => {
  setDbPort(undefined);
});

describe("clôture sans notes, de bout en bout", () => {
  it("résumé fait, confirmation sans-objet, JAMAIS de `log.error`", async () => {
    setDbPort(portChaine(SANS_NOTES, RESUME_OK));

    const cles: unknown[] = [];
    const suivi = await enchainerApresSeance("c1", "p1", (s: SuiviApresSeance) => {
      cles.push(cleConfirmationApresSeance(s));
    });

    expect(suivi).toEqual({ analyse: "ignoree", resume: "faite", message: null });
    // La séquence exacte vue par l'écran : analyse, sans-objet transitoire,
    // résumé en cours, sans-objet final — jamais `terminee` (qui promettrait
    // une analyse inexistante), jamais `analyseEchouee` (rien n'a échoué).
    expect(cles).toEqual(["analyseEnCours", "analyseSansObjet", "resumeEnCours", "analyseSansObjet"]);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
    // Les deux avertissements attendus, et rien d'autre : l'analyse sans
    // objet, puis l'enchaînement qui la constate.
    expect(evenements("warn")).toEqual(["jarvis.analyseSeance", "apresSeance.analyse"]);
  });

  it("si le résumé tombe en panne, l'erreur reste visible ET nommée", async () => {
    setDbPort(portChaine(SANS_NOTES, RESUME_PANNE));

    const suivi = await enchainerApresSeance("c1", "p1");

    expect(suivi).toEqual({
      analyse: "ignoree",
      resume: "echouee",
      message: "Le réseau est indisponible.",
    });
    // On n'a pas aveuglé la console : une vraie panne reste rouge — mais elle
    // porte le nom du résumé, jamais celui de l'analyse. C'est cette
    // distinction qui rend le défaut d'origine impossible à confondre.
    expect(evenements("error")).toEqual(["patients.resumeCas.generation"]);
  });
});

describe("clôture avec notes, de bout en bout (non-régression)", () => {
  it("analyse et résumé faits, confirmation `terminee`, console silencieuse", async () => {
    setDbPort(portChaine(AVEC_NOTES, RESUME_OK));

    const cles: unknown[] = [];
    const suivi = await enchainerApresSeance("c1", "p1", (s: SuiviApresSeance) => {
      cles.push(cleConfirmationApresSeance(s));
    });

    expect(suivi).toEqual({ analyse: "faite", resume: "faite", message: null });
    // Le `null` intermédiaire (`faite`/`attente`) garde le message courant —
    // comportement identique à l'ancien code inline : l'analyse vient de
    // réussir et le résumé n'est pas encore parti, rien de plus précis à
    // dire pendant cette micro-tâche. L'écran ne clignote pas, il enchaîne.
    expect(cles).toEqual(["analyseEnCours", null, "resumeEnCours", "terminee"]);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled();
  });
});
