/**
 * `jarvis-boucle-verbalisation.test.ts` — LE TOUR QUI MANQUE.
 *
 * ═══ LE DÉFAUT ═══
 * Mesuré en live le 2026-09-04 (carnet serveur) : `search_patients` →
 * `get_current_medications` (référence nue, valide) → `get_patient_context`
 * (valide), trois succès, puis l'aveu `tropDIterations`. La donnée des
 * médicaments était RENDUE par la capacité à la 2ᵉ itération mais le modèle
 * ne l'a jamais vue verbaliser : la boucle s'arrête après sa 3ᵉ exécution
 * sans jamais refaire parler le modèle. Un premier tour gaspillé (référence
 * hallucinée, recherche qui corrige) + un budget de 3 = réponse tuée alors
 * que tout a fonctionné.
 *
 * ═══ LE COMPORTEMENT EXIGÉ ═══
 * Quand la boucle épuise ses itérations ALORS QUE la dernière exécution a
 * RÉUSSI, elle accorde au modèle UN appel final de verbalisation — sans
 * exécuter aucune proposition éventuelle (le budget d'outils reste épuisé).
 * Quand la dernière exécution a ÉCHOUÉ, l'aveu reste immédiat : on ne demande
 * pas au modèle de broder sur des erreurs (fail-closed inchangé).
 */
import { describe, expect, it } from "vitest";

import {
  executerTour,
  type DependancesBoucle,
} from "../../src/services/jarvis-boucle";
import { BUDGETS } from "../../src/services/jarvis-contexte";
import type {
  CapaciteEnregistree,
  ContexteExecution,
  SafeRechercheContext,
} from "../../src/services/jarvis-capacites";
import type { TourFlux } from "../../src/services/jarvis";
import { fr } from "../../src/i18n/fr";
import { err, ok, type Result } from "../../src/services/result";
import type { ValeurSafe } from "../../src/services/jarvis-capacites";
import { KARIM } from "../fixtures/patients";

interface PropositionScript {
  readonly texte?: string;
  readonly proposition?: { nom: string; args: unknown } | null;
}

function tourFlux(
  conversationId: string,
  suivante: PropositionScript,
): TourFlux {
  return {
    chemin: "patient",
    texte: suivante.texte ?? "",
    proposition: suivante.proposition ?? null,
    conversationId,
    persiste: false,
    interrompu: false,
  };
}

function transportScripte(suite: readonly PropositionScript[]) {
  const appels: { message: string; resultats: number }[] = [];
  const transport = async (params: {
    message: string;
    conversationId: string;
    resultatsOutils?: readonly unknown[];
  }) => {
    const rang = appels.length;
    appels.push({
      message: params.message,
      resultats: params.resultatsOutils?.length ?? 0,
    });
    const suivante = suite[rang];
    if (suivante === undefined) throw new Error("transport : plus de réponse scriptée");
    return ok(tourFlux(params.conversationId, suivante));
  };
  return { transport, appels };
}

type Comportement = (
  args: unknown,
  ctx: ContexteExecution,
) => Promise<Result<ValeurSafe>>;

function registreFaux(
  comportements: Readonly<Record<string, Comportement>>,
): (nom: string) => CapaciteEnregistree | null {
  return (nom: string): CapaciteEnregistree | null => {
    const comporter = comportements[nom];
    if (comporter === undefined) return null;
    return {
      nom,
      description: "faux",
      budgetOctets: 10_000,
      champsAttendus: "aucun",
      lancer: (argsBruts: unknown, ctx: ContexteExecution) =>
        comporter(argsBruts, ctx),
    };
  };
}

const fauxContexte: SafeRechercheContext = {
  resultats: [],
  ambigu: false,
  total: 0,
};

describe("verbalisation après budget épuisé", () => {
  it("trois succès puis épuisement : UN appel final verbalise au lieu d'avouer", async () => {
    const { transport, appels } = transportScripte([
      { proposition: { nom: "search_patients", args: { query: "Djilali" } } },
      {
        proposition: {
          nom: "get_current_medications",
          args: { patientId: "PATIENT_001" },
        },
      },
      {
        proposition: {
          nom: "get_patient_context",
          args: { patientId: "PATIENT_001" },
        },
      },
      { texte: "Voici le dossier." },
    ]);
    const registre = registreFaux({
      // La frappe imite la projection réelle : premier dossier = PATIENT_001.
      search_patients: (_args, ctx) => {
        const ref = ctx.carte.patient(KARIM.id, KARIM.libelle, [
          KARIM.nom,
          KARIM.prenom,
          KARIM.numeroDossier,
        ]);
        return Promise.resolve(ok({ resultats: [ref], ambigu: false, total: 1 }));
      },
      get_current_medications: () => Promise.resolve(ok(fauxContexte)),
      get_patient_context: () => Promise.resolve(ok(fauxContexte)),
    });
    const deps: DependancesBoucle = {
      transport,
      registre,
      description: () => "- search_patients : faux",
    };
    const r = await executerTour(
      { message: "Quels sont les traitements de Karim Djilali ?", conversationId: "conv-verb" },
      {},
      new AbortController().signal,
      deps,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // L'appel final a eu lieu ET a porté les trois résultats au modèle.
    expect(appels.length).toBe(BUDGETS.MAX_TOURS_OUTIL + 1);
    expect(appels[appels.length - 1]?.resultats).toBe(3);
    expect(r.data.texte).toBe("Voici le dossier.");
  });

  it("trois échecs puis épuisement : aveu immédiat, SANS appel final", async () => {
    const { transport, appels } = transportScripte([
      { proposition: { nom: "cap_a", args: {} } },
      { proposition: { nom: "cap_b", args: {} } },
      { proposition: { nom: "cap_c", args: {} } },
      { texte: "Je brode." },
    ]);
    const echec: Comportement = () =>
      Promise.resolve(err({ code: "indisponible", message: "panne" }));
    const registre = registreFaux({ cap_a: echec, cap_b: echec, cap_c: echec });
    const deps: DependancesBoucle = {
      transport,
      registre,
      description: () => "- cap_a : faux",
    };
    const r = await executerTour(
      { message: "question", conversationId: "conv-echec" },
      {},
      new AbortController().signal,
      deps,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Fail-closed : l'aveu, pas une broderie sur des erreurs.
    expect(appels.length).toBe(BUDGETS.MAX_TOURS_OUTIL);
    expect(r.data.texte).toBe(fr.jarvis.boucle.tropDIterations);
  });

  it("triple identique : enBoucle inchangé, SANS appel final", async () => {
    const { transport, appels } = transportScripte([
      { proposition: { nom: "cap_a", args: {} } },
      { proposition: { nom: "cap_a", args: {} } },
      { proposition: { nom: "cap_a", args: {} } },
      { texte: "Je brode." },
    ]);
    const registre = registreFaux({
      cap_a: () => Promise.resolve(ok(fauxContexte)),
    });
    const deps: DependancesBoucle = {
      transport,
      registre,
      description: () => "- cap_a : faux",
    };
    const r = await executerTour(
      { message: "question", conversationId: "conv-boucle" },
      {},
      new AbortController().signal,
      deps,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(appels.length).toBe(BUDGETS.MAX_TOURS_OUTIL);
    expect(r.data.texte).toBe(fr.jarvis.boucle.enBoucle);
  });
});
