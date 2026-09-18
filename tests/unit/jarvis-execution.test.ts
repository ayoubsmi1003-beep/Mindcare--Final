/**
 * M06 — chemin d'exécution partagé : EXÉCUTER → VÉRIFIER → GARDER.
 *
 * ═══ CE QUI EST ÉPROUVÉ ═══
 * `executerEcritureConfirmee` avec des doublures injectées (même patron que
 * `DEPENDANCES_REELLES` de `jarvis-boucle.ts`) — le RÉEL n'est pas simulé, ce
 * sont les PORTES qui sont doublées pour exercer le moniteur :
 *   · succès vérifié → `ok` (seul chemin de succès) ;
 *   · échec porte → `echec`, message de la porte, UN SEUL appel (zéro rejeu) ;
 *   · délai dépassé → `inconnue`, jamais un succès, jamais un rejeu ;
 *   · rupture de transport → `inconnue` (l'écriture a pu être validée) ;
 *   · doublon de session → `duplicata`, zéro appel métier supplémentaire ;
 *   · entrée malformée / outil inconnu → `bloquee`, porte jamais appelée ;
 *   · aucun message d'échec ne prétend « C'est fait ».
 *
 * ═══ RÈGLE DU DÉPÔT ═══
 * Ces tests portent sur le vrai `executerEcritureConfirmee` + la vraie
 * `garderReponse` (importées réellement) ; seules les portes d'entrée/sortie
 * (`executer`, `verifierPour`) sont doublées pour piloter le temps et
 * l'échec. Les invariants base (machine d'état, RLS, doublon concurrent
 * réel) sont éprouvés en base : `scripts/checkpoint-v2.sql` C11b/C11c/C17 et
 * `tests/integration/jarvis-approbation.test.ts`.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { fr } from "../../src/i18n/fr";
import {
  executerEcritureConfirmee,
  reinitialiserTermineesPourTest,
  type DependancesExecution,
} from "../../src/services/jarvis-execution";
import type { CapaciteEcritureEnregistree } from "../../src/services/jarvis-ecritures";
import { err, ok, type Result } from "../../src/services/result";

const ACTION = "11111111-1111-1111-8111-111111111111";
const AFFECTE = "22222222-2222-2222-8222-222222222222";
const ARGS = {
  appointmentId: "33333333-3333-3333-8333-333333333333",
  nouveauDebut: "2026-09-20T15:00:00+01:00",
};

function fauxVerificateur(
  reussir: boolean,
  espionArgs?: { recues: unknown[] },
): CapaciteEcritureEnregistree {
  return {
    nom: "reschedule_appointment",
    description: "doublure",
    critique: false,
    preparer: async () => err({ code: "regle-metier", message: "inutilisé" }),
    verifier: async (args) => {
      espionArgs?.recues.push(args);
      return reussir
        ? ok(undefined)
        : err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    },
  };
}

function dependances(
  executer: (actionId: string) => Promise<Result<string>>,
  verifierOk = true,
  espionArgs?: { recues: unknown[] },
): DependancesExecution {
  return {
    executer,
    verifierPour: (outil) =>
      outil === "reschedule_appointment" ? fauxVerificateur(verifierOk, espionArgs) : null,
    delaiMs: 50,
    maintenant: () => Date.now(),
  };
}

beforeEach(() => {
  reinitialiserTermineesPourTest();
});

describe("succès vérifié — seul chemin ok", () => {
  it("porte ok + relecture ok → ok avec l'affecté, zéro tentative", async () => {
    const espion = { recues: [] as unknown[] };
    let appels = 0;
    const issue = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      dependances(
        async () => {
          appels++;
          return ok(AFFECTE);
        },
        true,
        espion,
      ),
    );
    expect(issue).toMatchObject({ ok: true, affecteId: AFFECTE, tentatives: 0 });
    expect(appels).toBe(1);
    // La relecture porte sur les arguments CANONIQUES, avec l'affecté rendu.
    expect(espion.recues).toHaveLength(1);
    expect(espion.recues[0]).toEqual(ARGS);
  });
});

describe("échec porte — jamais un succès, jamais un rejeu", () => {
  it("porte en échec → echec, message de la porte, UN SEUL appel", async () => {
    let appels = 0;
    const issue = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      dependances(async () => {
        appels++;
        return err({ code: "regle-metier", message: fr.jarvis.actionSansEffet });
      }),
    );
    expect(issue.ok).toBe(false);
    if (!issue.ok) {
      expect(issue.issue).toBe("echec");
      expect(issue.message).toBe(fr.jarvis.actionSansEffet);
      expect(issue.tentatives).toBe(0);
    }
    // Même l'échec d'affaires n'est pas rejoué : un seul appel.
    expect(appels).toBe(1);
  });

  it("relecture en échec → bloquee, message du vérifieur", async () => {
    const issue = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      dependances(async () => ok(AFFECTE), false),
    );
    expect(issue.ok).toBe(false);
    if (!issue.ok) {
      expect(issue.issue).toBe("bloquee");
      expect(issue.raison).toBe("NOT_VERIFIED");
      expect(issue.message).toBe(fr.jarvis.ecriture.nonVerifiee);
    }
  });

  it("outil sans capacité enregistrée → bloquee (jamais « enregistré » sans relecture)", async () => {
    let appels = 0;
    const issue = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "outil_inconnu", argsCanoniques: { ...ARGS } },
      dependances(async () => {
        appels++;
        return ok(AFFECTE);
      }),
    );
    expect(issue.ok).toBe(false);
    if (!issue.ok) {
      expect(issue.issue).toBe("bloquee");
      expect(issue.raison).toBe("NOT_VERIFIED");
    }
    expect(appels).toBe(1);
  });
});

describe("délai et rupture — inconnue, jamais succès, jamais rejeu", () => {
  it("délai dépassé → inconnue, message honnête, zéro tentative", async () => {
    let appels = 0;
    const issue = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      dependances(async () => {
        appels++;
        await new Promise((resoudre) => setTimeout(resoudre, 5_000));
        return ok(AFFECTE);
      }),
    );
    expect(issue.ok).toBe(false);
    if (!issue.ok) {
      expect(issue.issue).toBe("inconnue");
      expect(issue.raison).toBe("DELAI_DEPASSE");
      expect(issue.message).toBe(fr.jarvis.ecriture.nonVerifiee);
      expect(issue.tentatives).toBe(0);
    }
    expect(appels).toBe(1);
  });

  it("rupture de transport (la porte lève) → inconnue, pas echec", async () => {
    const issue = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      dependances(async () => {
        throw new Error("TypeError: Failed to fetch");
      }),
    );
    // La réponse est perdue : l'écriture a PU être validée. `echec`
    // prétendrait savoir qu'elle n'a pas eu lieu — faux.
    expect(issue.ok).toBe(false);
    if (!issue.ok) {
      expect(issue.issue).toBe("inconnue");
      expect(issue.raison).toBe("RUPTURE_TRANSPORT");
      expect(issue.message).toBe(fr.jarvis.ecriture.nonVerifiee);
      expect(issue.tentatives).toBe(0);
    }
  });

  it("l'argent ne se rejoue jamais : paiement en échec = UN SEUL appel", async () => {
    let appels = 0;
    const issue = await executerEcritureConfirmee(
      {
        actionId: ACTION,
        outil: "record_payment_collected",
        argsCanoniques: { paymentId: "66666666-6666-6666-8666-666666666666" },
      },
      {
        executer: async () => {
          appels++;
          return err({ code: "regle-metier", message: fr.jarvis.actionSansEffet });
        },
        verifierPour: () => fauxVerificateur(true),
        delaiMs: 50,
        maintenant: () => Date.now(),
      },
    );
    expect(issue.ok).toBe(false);
    expect(appels).toBe(1);
    if (!issue.ok) expect(issue.tentatives).toBe(0);
  });
});

describe("doublon — zéro exécution supplémentaire", () => {
  it("succès puis nouvel appel → duplicata, porte non rappelée", async () => {
    let appels = 0;
    const deps = dependances(async () => {
      appels++;
      return ok(AFFECTE);
    });
    const premiere = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      deps,
    );
    expect(premiere.ok).toBe(true);
    const seconde = await executerEcritureConfirmee(
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      deps,
    );
    expect(seconde.ok).toBe(false);
    if (!seconde.ok) {
      expect(seconde.issue).toBe("duplicata");
      expect(seconde.raison).toBe("DUPLICATE");
    }
    expect(appels).toBe(1);
  });

  it("deux appels concurrents → un succès, un duplicata", async () => {
    const deps = dependances(async () => ok(AFFECTE));
    const [premiere, seconde] = await Promise.all([
      executerEcritureConfirmee(
        { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
        deps,
      ),
      executerEcritureConfirmee(
        { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
        deps,
      ),
    ]);
    const issues = [premiere.ok, seconde.ok].sort();
    expect(issues).toEqual([false, true]);
    const perdante = premiere.ok ? seconde : premiere;
    expect(perdante.ok).toBe(false);
    if (!perdante.ok) {
      expect(perdante.issue).toBe("duplicata");
      expect(perdante.raison).toBe("DUPLICATE");
    }
  });
});

describe("entrée malformée — porte jamais appelée", () => {
  it.each([
    ["actionId vide", { actionId: "", outil: "reschedule_appointment", argsCanoniques: { ...ARGS } }],
    ["outil vide", { actionId: ACTION, outil: "", argsCanoniques: { ...ARGS } }],
    ["args null (carte historique)", { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: null }],
    ["args non-objet", { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: "texte" }],
  ])("%s → bloquee MALFORMED", async (_cas, entree) => {
    let appels = 0;
    const issue = await executerEcritureConfirmee(entree, dependances(async () => {
      appels++;
      return ok(AFFECTE);
    }));
    expect(issue.ok).toBe(false);
    if (!issue.ok) {
      expect(issue.issue).toBe("bloquee");
      expect(issue.raison).toBe("MALFORMED");
    }
    expect(appels).toBe(0);
  });
});

describe("honnêteté des messages", () => {
  it("aucune issue en échec ne prétend « C'est fait »", async () => {
    const cas: Array<Parameters<typeof executerEcritureConfirmee>[0]> = [
      { actionId: ACTION, outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
      { actionId: "", outil: "reschedule_appointment", argsCanoniques: { ...ARGS } },
    ];
    const depsEchec = dependances(async () =>
      err({ code: "regle-metier", message: fr.jarvis.actionSansEffet }),
    );
    for (const entree of cas) {
      const issue = await executerEcritureConfirmee(entree, depsEchec);
      if (!issue.ok) {
        expect(issue.message).not.toContain("C'est fait");
        expect(issue.message).not.toBe(fr.jarvis.ecriture.verifiee);
      }
    }
    const inconnue = await executerEcritureConfirmee(cas[0] as never, dependances(async () => {
      await new Promise((resoudre) => setTimeout(resoudre, 5_000));
      return ok(AFFECTE);
    }));
    if (!inconnue.ok) {
      expect(inconnue.message).not.toContain("C'est fait");
      expect(inconnue.message).toBe(fr.jarvis.ecriture.nonVerifiee);
    }
  });
});
