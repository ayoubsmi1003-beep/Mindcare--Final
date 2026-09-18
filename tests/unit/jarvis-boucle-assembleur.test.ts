/**
 * `jarvis-boucle-assembleur.test.ts` - LE CABLAGE M03, EPROUVE EN FAISANT TOURNER.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * Transport + registre pines (mise en forme M02) : prouve, sur des tours reels,
 *   - runId stable par tour logique, clientTurnId distinct par appel ;
 *   - un cliche par appel modele, cliche.clientTurnId == appel envoye ;
 *   - le hash du cliche == hash de la charge transportee (pare-feu no-op ici) ;
 *   - la contamination A->epoque-close : purge d'ambiguite en cours de tour,
 *     l'appel de synthese n'embarque plus les succes perimes ;
 *   - zero appel modele supplementaire (comptes identiques a M02).
 */
import { describe, expect, it, afterEach } from "vitest";

import {
  executerTour,
  type DependancesBoucle,
} from "../../src/services/jarvis-boucle";
import { effacerCible } from "../../src/services/jarvis-contexte";
import { reinitialiserCarte } from "../../src/services/jarvis-identite";
import {
  hacherContribution,
  jsonCanonique,
} from "../../src/services/jarvis-assembleur";
import type {
  CapaciteEnregistree,
  ContexteExecution,
  SafeRechercheContext,
  ValeurSafe,
} from "../../src/services/jarvis-capacites";
import type {
  SafeAgendaContext,
  SafePatientContext,
} from "../../src/services/jarvis-projections";
import type { TourFlux } from "../../src/services/jarvis";
import { fixerActivationResolutionM02 } from "../../src/shared/jarvis/resolution-references";
import { err, ok, type Result } from "../../src/services/result";
import { KARIM } from "../fixtures/patients";

afterEach(() => {
  effacerCible();
  reinitialiserCarte();
  fixerActivationResolutionM02(true);
});

interface PropositionScript {
  readonly texte?: string;
  readonly proposition?: { nom: string; args: unknown } | null;
}

interface AppelCapture {
  readonly message: string;
  readonly conversationId: string;
  readonly clientTurnId: string;
  readonly runId?: string;
  readonly contexte: unknown;
  readonly resultatsOutils?: readonly unknown[];
}

function tourFlux(conversationId: string, suivante: PropositionScript): TourFlux {
  return {
    chemin: "patient",
    texte: suivante.texte ?? "",
    proposition: suivante.proposition ?? null,
    conversationId,
    persiste: false,
    interrompu: false,
    preuves: [],
  };
}

function transportScripte(suite: readonly PropositionScript[]): {
  transport: DependancesBoucle["transport"];
  appels: AppelCapture[];
} {
  const appels: AppelCapture[] = [];
  const transport = (async (params: {
    message: string;
    conversationId: string;
    clientTurnId: string;
    runId?: string;
    contexte?: unknown;
    resultatsOutils?: readonly unknown[];
  }) => {
    appels.push({
      message: params.message,
      conversationId: params.conversationId,
      clientTurnId: params.clientTurnId,
      ...(params.runId === undefined ? {} : { runId: params.runId }),
      contexte: params.contexte,
      ...(params.resultatsOutils === undefined ? {} : { resultatsOutils: params.resultatsOutils }),
    });
    const suivante = suite[appels.length - 1];
    if (suivante === undefined) throw new Error("transport : plus de reponse scriptee");
    return ok(tourFlux(params.conversationId, suivante));
  }) as DependancesBoucle["transport"];
  return { transport, appels };
}

type Comportement = (
  args: unknown,
  ctx: ContexteExecution,
) => Promise<Result<ValeurSafe>>;

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

function depsDe(
  transport: DependancesBoucle["transport"],
  registre: DependancesBoucle["registre"],
): DependancesBoucle {
  return { transport, registre, description: () => "- faux" };
}

const AGENDA_FAUX: SafeAgendaContext = {
  creneaux: [
    {
      ref: "RDV_001",
      patient: "PATIENT_001",
      debut: "2026-09-15T09:00:00+01:00",
      fin: "2026-09-15T09:30:00+01:00",
      dureeMinutes: 30,
      statut: "scheduled",
      type: "suivi",
      arriveA: null,
    },
  ],
  provenance: [{ porte: "app.dashboard_today", luA: "2026-09-15T08:00:00Z", tronque: false }],
};

describe("cablage M03 : correlation et cliches", () => {
  it("runId stable, turns distincts, un cliche par appel, hash prouve", async () => {
    const { transport, appels } = transportScripte([
      { proposition: { nom: "get_today_agenda", args: {} } },
      { texte: "Voici l'agenda." },
    ]);
    const registre = registreFaux(
      { get_today_agenda: () => Promise.resolve(ok(AGENDA_FAUX)) },
      { get_today_agenda: "jour" },
    );
    const bilan = await executerTour(
      { message: "Qui vient demain ?", conversationId: "conv-m03-1" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    const r = bilan.data;

    // Correlation : un runId par tour, un clientTurnId par appel.
    expect(r.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(appels).toHaveLength(2);
    expect(appels[0]?.runId).toBe(r.runId);
    expect(appels[1]?.runId).toBe(r.runId);
    expect(appels[0]?.clientTurnId).not.toBe(appels[1]?.clientTurnId);

    // Un cliche par appel modele, dans l'ordre, sur le bon appel.
    expect(r.snapshots).toHaveLength(2);
    expect(r.snapshots[0]?.clientTurnId).toBe(appels[0]?.clientTurnId);
    expect(r.snapshots[1]?.clientTurnId).toBe(appels[1]?.clientTurnId);
    expect(r.snapshots[0]?.runId).toBe(r.runId);
    expect(r.snapshots[0]?.tourIndex).toBe(0);
    expect(r.snapshots[1]?.tourIndex).toBe(1);

    // Le hash prouve la charge transportee (pare-feu no-op : aucune identite
    // en clair dans cette charge, tout est deja en jetons).
    for (let i = 0; i < appels.length; i++) {
      const appel = appels[i];
      const cliche = r.snapshots[i];
      expect(cliche).toBeDefined();
      if (appel === undefined || cliche === undefined) continue;
      const recalcule = hacherContribution(
        jsonCanonique({ contexte: appel.contexte, resultats: appel.resultatsOutils ?? [] }),
      );
      expect(cliche.contributionHash).toBe(recalcule);
    }

    // La section agenda voyage, les jetons survivent.
    expect(JSON.stringify(appels[1]?.resultatsOutils ?? "")).toContain("RDV_001");
    expect(r.snapshots[1]?.sections.some((s) => s.section === "agenda")).toBe(true);
  });
});

describe("cablage M03 : purge d'ambiguite en cours de tour", () => {
  it("l'appel de synthese ecarte les succes perimes, garde la preuve ambigue", async () => {
    fixerActivationResolutionM02(false);
    let recherches = 0;
    const { transport, appels } = transportScripte([
      { proposition: { nom: "search_patients", args: { query: "Karim" } } },
      { proposition: { nom: "get_patient_context", args: { patientId: "PATIENT_001" } } },
      { proposition: { nom: "search_patients", args: { query: "Mohamed" } } },
      { texte: "De quel patient parlez-vous ?" },
    ]);
    const registre = registreFaux(
      {
        search_patients: (_args, ctx) => {
          recherches += 1;
          if (recherches === 1) {
            const ref = ctx.carte.patient(KARIM.id, KARIM.libelle, [KARIM.libelle]);
            const donnees: SafeRechercheContext = { resultats: [ref], total: 1, ambigu: false };
            return Promise.resolve(ok(donnees));
          }
          const donnees: SafeRechercheContext = {
            resultats: ["PATIENT_002", "PATIENT_003"],
            total: 7,
            ambigu: true,
          };
          return Promise.resolve(ok(donnees));
        },
        get_patient_context: () => {
          const donnees: SafePatientContext = {
            ref: "PATIENT_001",
            age: 45,
            sexe: "M",
            actif: true,
            clinique: {
              diagnostics: [],
              echelles: [],
              derniereConsultation: null,
              nombreConsultations: 1,
            },
            traitements: null,
            agenda: { prochainRendezVous: null, dernierRendezVous: null, nombreRendezVous: 0 },
            documents: { nombre: 0, dernierEmisLe: null },
            provenance: [],
          };
          return Promise.resolve(ok(donnees));
        },
      },
      { search_patients: "query", get_patient_context: "patientId" },
    );
    const bilan = await executerTour(
      { message: "Montre-moi Karim", conversationId: "conv-m03-2" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    const r = bilan.data;
    expect(appels).toHaveLength(4);

    // Iteration 1 : la recherche Karim voyage encore (epoque courante).
    const deuxieme = appels[1];
    expect(JSON.stringify(deuxieme?.resultatsOutils ?? "")).toContain("PATIENT_001");

    // Synthese (epoque 1, portee ambigue) : le succes perime est ecarte,
    // la recherche ambigue (matiere de clarification) survit.
    const synthese = appels[3];
    const portes = (synthese?.resultatsOutils ?? []) as Array<{ capacite: string; ok: boolean }>;
    expect(portes).toHaveLength(1);
    expect(portes[0]?.capacite).toBe("search_patients");
    const clicheSynthese = r.snapshots[3];
    expect(clicheSynthese?.scope.etat).toBe("ambigu");
    expect(clicheSynthese?.resultatsEcartesPortee).toBe(2);
    expect("patientCible" in ((synthese?.contexte ?? {}) as Record<string, unknown>)).toBe(false);
  });
});
