/**
 * `jarvis-outil-call-id.test.ts` - LE TRACE SEAM M04, EPROUVE EN FAISANT TOURNER.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * Invariant : une invocation reelle de capacite = un `toolCallId` opaque.
 * - unique par invocation, format UUID, sans PII ni clinique ni autorisation ;
 * - present sur succes comme sur echec d'invocation (lancer appelee) ;
 * - ABSENT quand rien n'a ete invoque : rejets de portes, dedup servie par
 *   le cache, echecs pre-invocation, sonde indisponible ;
 * - lie au tour par `BilanTour.runId` (memes `appels` + `snapshots`).
 */
import { describe, expect, it, afterEach } from "vitest";

import {
  executerTour,
  type DependancesBoucle,
} from "../../src/services/jarvis-boucle";
import { definirCible, effacerCible } from "../../src/services/jarvis-contexte";
import { reinitialiserCarte } from "../../src/services/jarvis-identite";
import type {
  CapaciteEnregistree,
  ContexteExecution,
  ValeurSafe,
} from "../../src/services/jarvis-capacites";
import type { TourFlux } from "../../src/services/jarvis";
import { fixerActivationResolutionM02 } from "../../src/shared/jarvis/resolution-references";
import { err, ok, type Result } from "../../src/services/result";
import { KARIM } from "../fixtures/patients";

afterEach(() => {
  effacerCible();
  reinitialiserCarte();
  fixerActivationResolutionM02(true);
});

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface PropositionScript {
  readonly texte?: string;
  readonly proposition?: { nom: string; args: unknown; intent?: unknown } | null;
}

function tourFlux(conversationId: string, suivante: PropositionScript): TourFlux {
  const proposition: TourFlux["proposition"] =
    suivante.proposition === undefined || suivante.proposition === null
      ? null
      : {
          nom: suivante.proposition.nom,
          args: suivante.proposition.args,
          ...(suivante.proposition.intent === undefined
            ? {}
            : { intent: suivante.proposition.intent }),
        };
  return {
    chemin: "patient",
    texte: suivante.texte ?? "",
    proposition,
    conversationId,
    persiste: false,
    interrompu: false,
    preuves: [],
  };
}

function transportScripte(suite: readonly PropositionScript[]): {
  transport: DependancesBoucle["transport"];
} {
  const appels: unknown[] = [];
  const transport = (async (params: {
    message: string;
    conversationId: string;
    clientTurnId: string;
    contexte?: unknown;
    resultatsOutils?: readonly unknown[];
  }) => {
    appels.push(params.clientTurnId);
    const suivante = suite[appels.length - 1];
    if (suivante === undefined) throw new Error("transport : plus de reponse scriptee");
    return ok(tourFlux(params.conversationId, suivante));
  }) as DependancesBoucle["transport"];
  return { transport };
}

type Comportement = (
  args: unknown,
  ctx: ContexteExecution,
) => Promise<Result<ValeurSafe>>;

/**
 * Faux de test : `unknown` -> `ValeurSafe` en UNE assertion (idiome du
 * depot, cf. `jarvis-assembleur-contexte.test.ts`). La double assertion
 * `as unknown as` est interdite par l'ESLint du depot.
 */
function fauxResultat(donnees: unknown): Result<ValeurSafe> {
  return ok(donnees as ValeurSafe);
}

function registreFaux(
  comportements: Readonly<Record<string, Comportement>>,
  champs: Readonly<Record<string, string>> = {},
): (nom: string) => CapaciteEnregistree | null {
  return (nom: string): CapaciteEnregistree | null => {
    const comporter = comportements[nom];
    if (comporter === undefined) return null;
    return {
      nom,
      description: "faux",
      budgetOctets: 10_000,
      champsAttendus: champs[nom] ?? "aucun",
      lancer: (argsBruts: unknown, ctx: ContexteExecution) =>
        comporter(argsBruts, ctx),
    };
  };
}

describe("tool_call_id M04 : une invocation reelle = un ID opaque", () => {
  it("chaque invocation porte un ID unique, format UUID, sans PII", async () => {
    const { transport } = transportScripte([
      { proposition: { nom: "get_today_agenda", args: {} } },
      { proposition: { nom: "get_waiting_room", args: {} } },
      { texte: "Voici." },
    ]);
    const registre = registreFaux({
      get_today_agenda: () => Promise.resolve(fauxResultat({ creneaux: [] })),
      get_waiting_room: () => Promise.resolve(fauxResultat({ creneaux: [] })),
    });
    const bilan = await executerTour(
      { message: "Qui vient demain ?", conversationId: "conv-m04-id-1" },
      {},
      new AbortController().signal,
      { transport, registre, description: () => "- faux" },
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    const traces = bilan.data.appels.filter((a) => !a.deduplique && a.ok);
    expect(traces).toHaveLength(2);
    const ids = traces.map((t) => t.toolCallId);
    for (const id of ids) expect(id).toMatch(UUID_RE);
    // Uniques par invocation.
    expect(new Set(ids).size).toBe(2);
    // Opaques : ni UUID patient, ni nom, ni clinique.
    for (const id of ids ?? []) {
      expect(id).not.toContain(KARIM.id);
      expect(id).not.toContain("Karim");
    }
    // Lies au tour : memes runId, snapshots presents.
    expect(bilan.data.runId).toMatch(UUID_RE);
    expect(bilan.data.snapshots.length).toBeGreaterThan(0);
    for (const s of bilan.data.snapshots) expect(s.runId).toBe(bilan.data.runId);
  });

  it("echec d'invocation (lancer leve) porte un ID ; rejet de porte n'en porte pas", async () => {
    const { transport } = transportScripte([
      { proposition: { nom: "get_today_agenda", args: {} } },
      {
        proposition: {
          nom: "get_day_revenue",
          args: {},
          intent: "GET_TODAY_AGENDA",
        },
      },
      { texte: "Voici." },
    ]);
    const registre = registreFaux({
      get_today_agenda: () => Promise.reject(new Error("panne")),
      get_day_revenue: () => Promise.resolve(fauxResultat({ total: 1 })),
    });
    const bilan = await executerTour(
      { message: "Qui vient demain ?", conversationId: "conv-m04-id-2" },
      {},
      new AbortController().signal,
      { transport, registre, description: () => "- faux" },
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    // L'invocation qui a leve : trace en echec MAIS avec ID (elle a eu lieu).
    const panne = bilan.data.appels.find((a) => a.capacite === "get_today_agenda");
    expect(panne?.ok).toBe(false);
    expect(panne?.toolCallId).toMatch(UUID_RE);
    // Le rejet d'intention : aucune invocation, donc aucun ID.
    const rejet = bilan.data.appels.find((a) => a.capacite === "get_day_revenue");
    expect(rejet?.ok).toBe(false);
    expect(rejet?.code).toBe("intention-incompatible");
    expect(rejet?.toolCallId).toBeUndefined();
  });

  it("rejet hors-fil et echec pre-invocation ne portent pas d'ID", async () => {
    const { transport } = transportScripte([
      {
        proposition: {
          nom: "get_patient_context",
          args: { patientId: "22222222-2222-4222-8222-222222222222" },
          intent: "GET_PATIENT_CONTEXT",
        },
      },
      {
        proposition: {
          nom: "get_patient_context",
          args: { patientId: "{{PATIENT_999}}" },
          intent: "GET_PATIENT_CONTEXT",
        },
      },
      { texte: "Lequel ?" },
    ]);
    const registre = registreFaux(
      {
        get_patient_context: () => Promise.resolve(fauxResultat({})),
      },
      { get_patient_context: "patientId" },
    );
    definirCible({ id: KARIM.id, libelle: KARIM.libelle, numeroDossier: "", origine: "ecran" });
    const bilan = await executerTour(
      { message: "resume son cas", conversationId: "conv-m04-id-3" },
      {},
      new AbortController().signal,
      { transport, registre, description: () => "- faux" },
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    const traces = bilan.data.appels.filter((a) => a.capacite === "get_patient_context");
    expect(traces).toHaveLength(2);
    // Hors-fil : porte, zero invocation, zero ID.
    expect(traces[0]?.code).toBe("patient-hors-fil");
    expect(traces[0]?.toolCallId).toBeUndefined();
    // Jeton inconnu : echec pre-invocation (reference-inconnue), zero ID.
    expect(traces[1]?.code).toBe("reference-inconnue");
    expect(traces[1]?.toolCallId).toBeUndefined();
  });
});
