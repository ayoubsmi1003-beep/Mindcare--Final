/**
 * `analyzeSession` — `regle-metier` NE DOIT JAMAIS TOUCHER `log.error`.
 *
 * ═══ LE DÉFAUT QUE CE FICHIER VERROUILLE ═══
 *
 * Clore une séance sans notes brutes rend `regle-metier` (route
 * `jarvis-analyze-session`, étape 3 : `raw_notes` vide — SOAP seul, ou
 * clôture sans notes). C'est une issue métier ATTENDUE, pas une panne. La
 * logger en `error` la rendait indiscernable d'une vraie panne
 * (indisponible / transport) dans la console : un « Console Error » rouge
 * après chaque clôture sans notes, alors que rien n'avait échoué.
 *
 * ⚠️ CES TESTS SUBSTITUENT LE PORT (`setDbPort`, ADR-020), ET RIEN D'AUTRE.
 * Le sujet reste la vraie `analyzeSession` : c'est son aiguillage
 * warn/error qu'on mesure, pas un simulacre.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/services/log", () => ({
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { setDbPort, type DbPort } from "../../src/services/db";
import type { AppError } from "../../src/services/errors";
import { analyzeSession } from "../../src/services/jarvis";
import { log } from "../../src/services/log";
import { err } from "../../src/services/result";

/**
 * Port factice COMPLET (aucun cast) : seule `invokeFunction` répond, en
 * échec ; tout autre appel lève — un faux qui devine masquerait le chemin
 * réellement exercé.
 */
function portEnEchec(code: AppError["code"]): DbPort {
  const echec = err({ code, message: "message-serveur" });
  const inattendu = (): never => {
    throw new Error("port factice : méthode non attendue");
  };
  return {
    select: inattendu,
    rpc: inattendu,
    signIn: inattendu,
    signOut: inattendu,
    getSession: inattendu,
    getInstallationStatus: inattendu,
    provisionOwnerAccount: inattendu,
    invokeFunction: vi.fn().mockResolvedValue(echec),
    invokeFunctionStream: inattendu,
  };
}

beforeEach(() => {
  vi.mocked(log.warn).mockClear();
  vi.mocked(log.error).mockClear();
});

afterEach(() => {
  setDbPort(undefined);
});

describe("le niveau de journal d'un échec d'analyse", () => {
  it("`regle-metier` (séance sans notes) loggue `warn`, jamais `error`", async () => {
    setDbPort(portEnEchec("regle-metier"));

    const resultat = await analyzeSession("c-sans-notes");

    expect(resultat.ok).toBe(false);
    expect(vi.mocked(log.warn)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.error)).not.toHaveBeenCalled();
  });

  it("une vraie panne (`indisponible`) loggue toujours `error`", async () => {
    setDbPort(portEnEchec("indisponible"));

    const resultat = await analyzeSession("c-panne");

    expect(resultat.ok).toBe(false);
    expect(vi.mocked(log.error)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(log.warn)).not.toHaveBeenCalled();
  });
});
