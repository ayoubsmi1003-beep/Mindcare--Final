/**
 * `jarvis-boucle-routage.test.ts` - LE FILTRE M04 PAR ITERATION, EPROUVE EN FAISANT TOURNER.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * TDD RED : vise le filtre d'intention par iteration dans `executerTour`
 * (inexistant) + l'echo `intent` des propositions (inexistant). Chaque test
 * "bloque"/"zero execution" doit ECHOUER avant la passe GREEN.
 *
 * Transport + registre pines : les propositions scriptees portent un `intent`
 * (echo serveur M04). Le filtre decide : intention validee presente ->
 * la proposition doit appartenir a sa famille, sinon zero execution et
 * `motifEchec: "intention-incompatible"`, trace disponible, tour continue.
 * Sans signal d'intention (ni echo, ni chainee) : comportement historique.
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
import { KARIM, MAHMOUD } from "../fixtures/patients";

afterEach(() => {
  effacerCible();
  reinitialiserCarte();
  fixerActivationResolutionM02(true);
});

interface PropositionScript {
  readonly texte?: string;
  readonly proposition?: { nom: string; args: unknown; intent?: unknown } | null;
}

interface AppelCapture {
  readonly message: string;
  readonly conversationId: string;
  readonly clientTurnId: string;
  readonly resultatsOutils?: readonly unknown[];
}

function tourFlux(conversationId: string, suivante: PropositionScript): TourFlux {
  // `intent` (echo serveur M04) transite ici : le type `TourFlux` le porte
  // (optionnel), aucune validation cote transport - jamais.
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
  appels: AppelCapture[];
} {
  const appels: AppelCapture[] = [];
  const transport = (async (params: {
    message: string;
    conversationId: string;
    clientTurnId: string;
    contexte?: unknown;
    resultatsOutils?: readonly unknown[];
  }) => {
    appels.push({
      message: params.message,
      conversationId: params.conversationId,
      clientTurnId: params.clientTurnId,
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

function depsDe(
  transport: DependancesBoucle["transport"],
  registre: DependancesBoucle["registre"],
): DependancesBoucle {
  return { transport, registre, description: () => "- faux" };
}

/** Faux dossier patient : la section `patient` du projecteur le ventile. */
function dossierMarqueur(marqueur: string): Record<string, unknown> {
  return {
    ref: "PATIENT_001",
    age: 45,
    sexe: "M",
    actif: true,
    clinique: { diagnostics: [{ libelle: marqueur }] },
    provenance: [],
  };
}

describe("filtre M04 : proposition hors famille = zero execution", () => {
  it("bloque get_day_revenue sous GET_PATIENT_CONTEXT, le tour continue et repond", async () => {
    const executions: string[] = [];
    const { transport } = transportScripte([
      {
        proposition: {
          nom: "get_day_revenue",
          args: {},
          intent: "GET_PATIENT_CONTEXT",
        },
      },
      { texte: "Je ne peux pas calculer cela ici." },
    ]);
    const registre = registreFaux({
      get_day_revenue: () => {
        executions.push("get_day_revenue");
        return Promise.resolve(fauxResultat({ total: 1 }));
      },
    });
    const bilan = await executerTour(
      { message: "montre ayoub", conversationId: "conv-m04-1" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    // Zero execution : le faux n'a jamais tourne.
    expect(executions).toEqual([]);
    // Echec nomme, trace disponible.
    const rejet = bilan.data.appels.find((a) => a.capacite === "get_day_revenue");
    expect(rejet?.ok).toBe(false);
    expect(rejet?.code).toBe("intention-incompatible");
    // Le tour a continue jusqu'a la reponse textuelle.
    expect(bilan.data.texte).toBe("Je ne peux pas calculer cela ici.");
  });

  it("laisse passer get_patient_context sous GET_PATIENT_CONTEXT", async () => {
    const executions: unknown[] = [];
    const { transport } = transportScripte([
      {
        proposition: {
          nom: "get_patient_context",
          args: { patientId: KARIM.id },
          intent: "GET_PATIENT_CONTEXT",
        },
      },
      { texte: "Voici Karim." },
    ]);
    const registre = registreFaux(
      {
        get_patient_context: (args: unknown) => {
          executions.push(args);
          return Promise.resolve(fauxResultat(dossierMarqueur("MARQUEUR-OK")));
        },
      },
      { get_patient_context: "patientId" },
    );
    const bilan = await executerTour(
      { message: "montre ayoub", conversationId: "conv-m04-2" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    expect(executions).toHaveLength(1);
    expect(bilan.data.appels.find((a) => a.capacite === "get_patient_context")?.ok).toBe(true);
  });

  it("sans signal d'intention : comportement historique permissif (aucune regression)", async () => {
    const executions: string[] = [];
    const { transport } = transportScripte([
      { proposition: { nom: "get_today_agenda", args: {} } },
      { texte: "Voici l'agenda." },
    ]);
    const registre = registreFaux({
      get_today_agenda: () => {
        executions.push("get_today_agenda");
        return Promise.resolve(fauxResultat({ creneaux: [] }));
      },
    });
    const bilan = await executerTour(
      { message: "Qui vient demain ?", conversationId: "conv-m04-3" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    expect(executions).toEqual(["get_today_agenda"]);
  });
});

describe("filtre M04 : frontiere lecture/ecriture inchangee", () => {
  it("intent lecture + proposition d'ecriture = propositionInconnue, zero execution en boucle", async () => {
    const executions: string[] = [];
    const { transport } = transportScripte([
      {
        proposition: {
          nom: "create_appointment",
          args: { patientId: KARIM.id },
          intent: "GET_PATIENT_CONTEXT",
        },
      },
    ]);
    // Registre de LECTURES seul, comme le vrai : l'ecriture y est inconnue.
    const registre = registreFaux({
      get_patient_context: () => {
        executions.push("get_patient_context");
        return Promise.resolve(fauxResultat(dossierMarqueur("MARQUEUR-X")));
      },
    });
    const bilan = await executerTour(
      { message: "montre ayoub", conversationId: "conv-m04-4" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    // La boucle n'execute jamais d'ecriture : elle la rend a l'appelant.
    expect(executions).toEqual([]);
    expect(bilan.data.propositionInconnue?.nom).toBe("create_appointment");
    expect(bilan.data.appels).toEqual([]);
  });

  it("capacite inconnue + intent = propositionInconnue (precedence du registre)", async () => {
    const { transport } = transportScripte([
      {
        proposition: { nom: "outil_invente_par_le_modele", args: {}, intent: "GET_TODAY_AGENDA" },
      },
    ]);
    const registre = registreFaux({});
    const bilan = await executerTour(
      { message: "Qui vient demain ?", conversationId: "conv-m04-5" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    expect(bilan.data.propositionInconnue?.nom).toBe("outil_invente_par_le_modele");
  });
});

describe("filtre M04 : isolation inter-patients au niveau des appels", () => {
  it("tour fil=A lit A, tour fil=B lit B, A absent du tour B", async () => {
    const vus: unknown[] = [];
    const registre = registreFaux(
      {
        get_patient_context: (args: unknown) => {
          vus.push(args);
          const id = (args as { patientId?: unknown }).patientId;
          const marqueur = id === KARIM.id ? "MARQUEUR-A" : "MARQUEUR-B";
          return Promise.resolve(fauxResultat(dossierMarqueur(marqueur)));
        },
      },
      { get_patient_context: "patientId" },
    );

    // Tour 1 : fil Karim.
    definirCible({ id: KARIM.id, libelle: KARIM.libelle, numeroDossier: "", origine: "ecran" });
    const t1 = transportScripte([
      {
        proposition: {
          nom: "get_patient_context",
          args: { patientId: KARIM.id },
          intent: "GET_PATIENT_CONTEXT",
        },
      },
      { texte: "Karim." },
    ]);
    const bilan1 = await executerTour(
      { message: "resume son cas", conversationId: "conv-m04-6" },
      {},
      new AbortController().signal,
      depsDe(t1.transport, registre),
    );
    expect(bilan1.ok).toBe(true);
    if (!bilan1.ok) return;

    // Tour 2 : fil Yasmine.
    effacerCible();
    definirCible({ id: MAHMOUD.id, libelle: MAHMOUD.libelle, numeroDossier: "", origine: "ecran" });
    const t2 = transportScripte([
      {
        proposition: {
          nom: "get_patient_context",
          args: { patientId: MAHMOUD.id },
          intent: "GET_PATIENT_CONTEXT",
        },
      },
      { texte: "Yasmine." },
    ]);
    const bilan2 = await executerTour(
      { message: "resume son cas", conversationId: "conv-m04-6" },
      {},
      new AbortController().signal,
      depsDe(t2.transport, registre),
    );
    expect(bilan2.ok).toBe(true);
    if (!bilan2.ok) return;

    // Niveau journal d'appels : chaque tour n'a vu que son patient.
    expect(vus).toHaveLength(2);
    expect(vus[0]).toEqual({ patientId: KARIM.id });
    expect(vus[1]).toEqual({ patientId: MAHMOUD.id });
    // Niveau contexte reboucle : le tour B ne porte aucune donnee A.
    const chargeB = JSON.stringify(t2.appels[1]?.resultatsOutils ?? []);
    expect(chargeB).not.toContain("MARQUEUR-A");
    expect(chargeB).toContain("MARQUEUR-B");
  });

  it("fil=A + proposition patient B (meme famille) = porte de fil, zero execution", async () => {
    const executions: unknown[] = [];
    const { transport } = transportScripte([
      {
        proposition: {
          nom: "get_patient_context",
          args: { patientId: MAHMOUD.id },
          intent: "GET_PATIENT_CONTEXT",
        },
      },
      { texte: "Lequel ?" },
    ]);
    const registre = registreFaux(
      {
        get_patient_context: (args: unknown) => {
          executions.push(args);
          return Promise.resolve(fauxResultat(dossierMarqueur("MARQUEUR-B")));
        },
      },
      { get_patient_context: "patientId" },
    );
    definirCible({ id: KARIM.id, libelle: KARIM.libelle, numeroDossier: "", origine: "ecran" });
    const bilan = await executerTour(
      { message: "resume son cas", conversationId: "conv-m04-7" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    // Le filtre laisse passer (meme famille) mais la porte de fil bloque.
    expect(executions).toEqual([]);
    expect(
      bilan.data.appels.find((a) => a.capacite === "get_patient_context")?.code,
    ).toBe("patient-hors-fil");
  });
});

describe("filtre M04 : composition multi-outil dans la famille", () => {
  it("deux capacites de la famille agenda s'executent dans le meme tour", async () => {
    const executions: string[] = [];
    const { transport } = transportScripte([
      {
        proposition: { nom: "get_today_agenda", args: {}, intent: "GET_TODAY_AGENDA" },
      },
      {
        proposition: {
          nom: "get_agenda_range",
          args: { du: "2026-09-16T00:00:00+01:00", au: "2026-09-17T00:00:00+01:00" },
          intent: "GET_TODAY_AGENDA",
        },
      },
      { texte: "Voici l'agenda etendu." },
    ]);
    const registre = registreFaux({
      get_today_agenda: () => {
        executions.push("get_today_agenda");
        return Promise.resolve(fauxResultat({ creneaux: [] }));
      },
      get_agenda_range: () => {
        executions.push("get_agenda_range");
        return Promise.resolve(fauxResultat({ creneaux: [] }));
      },
    });
    const bilan = await executerTour(
      { message: "Qui vient demain ?", conversationId: "conv-m04-9" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    expect(executions).toEqual(["get_today_agenda", "get_agenda_range"]);
    expect(
      bilan.data.appels.filter((a) => a.ok && !a.deduplique),
    ).toHaveLength(2);
  });

  it("finance : la valeur gouvernee traverse a l'octet pres (aucun recalcul)", async () => {
    const { transport, appels } = transportScripte([
      {
        proposition: { nom: "get_day_revenue", args: {}, intent: "GET_DAY_REVENUE" },
      },
      { texte: "Total encaisse." },
    ]);
    const registre = registreFaux({
      get_day_revenue: () =>
        Promise.resolve(fauxResultat({ totalDzd: 45000, devise: "DZD" })),
    });
    const bilan = await executerTour(
      { message: "combien encaisse aujourd'hui", conversationId: "conv-m04-10" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    // La charge rebouclee porte la valeur exacte rendue par la capacite.
    const charge = JSON.stringify(appels[1]?.resultatsOutils ?? []);
    expect(charge).toContain("45000");
  });
});

describe("filtre M04 : honestete des echecs (succes/vide/panne distinguables)", () => {
  it("resultat vide valide != panne d'outil : codes et textes distincts", async () => {
    const { transport } = transportScripte([
      { proposition: { nom: "get_patient_timeline", args: { patientId: KARIM.id } } },
      { texte: "Aucune consultation." },
    ]);
    const registre = registreFaux(
      {
        get_patient_timeline: () =>
          Promise.resolve(fauxResultat({ patient: "PATIENT_001", evenements: [] })),
      },
      { get_patient_timeline: "patientId" },
    );
    const bilan = await executerTour(
      { message: "resume son cas", conversationId: "conv-m04-11" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    // Succes a donnees vides : ok:true, aucun motif d'echec.
    const trace = bilan.data.appels.find((a) => a.capacite === "get_patient_timeline");
    expect(trace?.ok).toBe(true);
    expect(trace?.code).toBeUndefined();
    expect(bilan.data.texte).toBe("Aucune consultation.");
  });

  it("panne d'outil : echec nomme, jamais un succes d'apparence", async () => {
    const { transport } = transportScripte([
      { proposition: { nom: "get_waiting_room", args: {} } },
      { texte: "Je n'arrive pas a recuperer la salle d'attente." },
    ]);
    const registre = registreFaux({
      get_waiting_room: () => Promise.resolve(err({ code: "indisponible", message: "panne" })),
    });
    const bilan = await executerTour(
      { message: "qui attend", conversationId: "conv-m04-12" },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    const trace = bilan.data.appels.find((a) => a.capacite === "get_waiting_room");
    expect(trace?.ok).toBe(false);
    expect(trace?.code).toBe("indisponible");
  });
});

describe("filtre M04 : la chainee ne filtre jamais (le serveur decide)", () => {
  it("sans echo, la chainee n'interdit rien : le serveur a pu classifier frais", async () => {
    // Cas nominal : "Montre-moi Karim" (GET_PATIENT_CONTEXT chainee) puis
    // "Sa derniere consultation ?" (serveur classifie GET_CONSULTATION_HISTORY,
    // echo absent ici car transport pine). La boucle ne doit PAS juger la
    // proposition sur l'intent du tour precedent - elle ne voit pas l'intent
    // decide, et la compat serveur reste l'autorite.
    const executions: string[] = [];
    definirCible({ id: KARIM.id, libelle: KARIM.libelle, numeroDossier: "", origine: "ecran" });
    const travail = {
      conversationId: "conv-m04-8",
      intentionPrecedente: "GET_PATIENT_CONTEXT" as const,
      patientId: KARIM.id,
    };
    const { transport } = transportScripte([
      { proposition: { nom: "get_consultation_history", args: { patientId: KARIM.id } } },
      { texte: "Voici." },
    ]);
    const registre = registreFaux(
      {
        get_consultation_history: () => {
          executions.push("get_consultation_history");
          return Promise.resolve(fauxResultat({ evenements: [] }));
        },
      },
      { get_consultation_history: "patientId" },
    );
    const bilan = await executerTour(
      { message: "et sa derniere consultation", conversationId: "conv-m04-8", travail },
      {},
      new AbortController().signal,
      depsDe(transport, registre),
    );
    expect(bilan.ok).toBe(true);
    if (!bilan.ok) return;
    // Preuve du montage : la chainee a bien ete construite sur ce tour...
    expect(bilan.data.resolution?.intentionChainee).toBe("GET_PATIENT_CONTEXT");
    // ...mais elle ne filtre pas : la proposition d'une autre famille passe,
    // comme le serveur l'aurait autorise sous son intent decide.
    expect(executions).toEqual(["get_consultation_history"]);
    expect(
      bilan.data.appels.find((a) => a.capacite === "get_consultation_history")?.ok,
    ).toBe(true);
  });
});
