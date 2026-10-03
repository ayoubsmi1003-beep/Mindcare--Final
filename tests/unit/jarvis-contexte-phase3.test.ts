/**
 * Phase 3 du plan Alexa — contexte patient TTL + explicite.
 *
 * ═══ CE QUE CES TESTS GARDENT ═══
 * 1. Établi : une cible posée est TTL-valide, horodatée.
 * 2-3. TTL : valide à 15 min moins une seconde, ABSENTE à 15 min (expiré =
 *    absent, jamais valide ; purge paresseuse).
 * 4. Changement de patient : remplace, ré-horodate, purge la carte (aucun
 *    jeton de A ne survit dans le tour de B).
 * 5. Changement d'écran : `definirContextePatient(null)` efface ; le
 *    patient-actif est horodaté à la pose.
 * 6. Déconnexion : `purgerContexteSession` vide cible ET patient-actif.
 * 7. Ambiguïté : `signalerAmbiguite` purge, et la boucle l'appelle sur un
 *    résultat `ambigu:true` (tour scripté, sans base ni modèle).
 * 8-9. Pronom + cible valide → pas de clarification ; sans cible ou expirée
 *    → clarification, sans deviner.
 * 10. A→B : après B, la carte ne connaît plus aucune identité de A.
 * 11. `quitterContexte` ([Changer]) vide les deux magasins.
 * 12. Clarification `envoyer` : cerveau serveur partagé, chat local seulement,
 *    zéro lecture de dossier et zéro modèle ; aucun patient adopté.
 *
 * Horloge injectée partout (`maintenantMs`) : aucun `setTimeout`, aucune
 * attente réelle de 15 minutes. AUCUNE DONNÉE PATIENT réelle, AUCUN ACCÈS
 * BASE — les seuls chemins exécutés sont purs ou échouent avant tout réseau.
 */
import { describe, expect, it, vi } from "vitest";

import { fr } from "../../src/i18n/fr";
import {
  abonnerConversation,
  definirContextePatient,
  envoyer,
  purgerContexteSession,
  quitterContexte,
} from "../../src/services/conversation";
import {
  besoinDeClarification,
  cibleCourante,
  cibleValide,
  definirCible,
  effacerCible,
  signalerAmbiguite,
  TTL_CONTEXTE_MS,
} from "../../src/services/jarvis-contexte";
import { carte as carteCourante } from "../../src/services/jarvis-identite";
import {
  definirPatientActif,
  effacerPatientActif,
  patientActifCourant,
} from "../../src/services/patient-actif";
import {
  executerTour,
  type DependancesBoucle,
} from "../../src/services/jarvis-boucle";
import type { CapaciteEnregistree } from "../../src/services/jarvis-capacites";
import type { RefPatient } from "../../src/services/jarvis-identite";
import type { TourFlux } from "../../src/services/jarvis";
import { ok } from "../../src/services/result";
import { db, setDbPort } from "../../src/services/db";
import { runAlexa } from "../../src/server/alexa/orchestrator";
import { turnInput } from "../../src/shared/alexa/turn";
import { dialogue } from "../../src/i18n/alexa-dialogue";
import { KARIM, MAHMOUD } from "../fixtures/patients";

const T0 = Date.parse("2026-09-03T10:00:00+01:00");

const CIBLE_A = {
  id: "00000000-0000-4000-8000-0000000000a1",
  libelle: KARIM.libelle,
  numeroDossier: KARIM.numeroDossier,
  origine: "ecran" as const,
};

const CIBLE_B = {
  id: "00000000-0000-4000-8000-0000000000b2",
  libelle: MAHMOUD.libelle,
  numeroDossier: MAHMOUD.numeroDossier,
  origine: "ecran" as const,
};

describe("TTL — établi, valide, expiré = absent", () => {
  it("1. contexte établi : valide et horodaté", () => {
    effacerCible();
    expect(definirCible(CIBLE_A, T0)).toBe(true);
    const valide = cibleValide(T0);
    expect(valide?.id).toBe(CIBLE_A.id);
    expect(valide?.etablieA).toBe(T0);
  });

  it("2. TTL-valide juste avant 15 minutes", () => {
    effacerCible();
    definirCible(CIBLE_A, T0);
    expect(cibleValide(T0 + TTL_CONTEXTE_MS - 1000)?.id).toBe(CIBLE_A.id);
  });

  it("3. expiré à 15 minutes : absent, et purgé", () => {
    effacerCible();
    definirCible(CIBLE_A, T0);
    expect(cibleValide(T0 + TTL_CONTEXTE_MS)).toBeNull();
    expect(cibleCourante()).toBeNull();
  });

  it("TTL vaut 15 minutes", () => {
    expect(TTL_CONTEXTE_MS).toBe(15 * 60 * 1000);
  });
});

describe("remplacement et effacement", () => {
  it("4. changement de patient : remplace, ré-horodate, purge la carte", () => {
    effacerCible();
    definirCible(CIBLE_A, T0);
    const refA = carteCourante().patient(CIBLE_A.id, CIBLE_A.libelle, [CIBLE_A.libelle]);
    expect(definirCible(CIBLE_B, T0 + 60_000)).toBe(true);
    expect(cibleValide(T0 + 60_000)?.id).toBe(CIBLE_B.id);
    expect(cibleValide(T0 + 60_000)?.etablieA).toBe(T0 + 60_000);
    expect(carteCourante().resoudre(refA)).toBeNull();
  });

  it("5. changement d'écran : null efface, la pose horodate le patient-actif", () => {
    // Flux réel : l'écran publie, le panneau propage vers la cible.
    definirPatientActif(
      { id: CIBLE_A.id, nom: CIBLE_A.libelle, numero: CIBLE_A.numeroDossier },
      T0,
    );
    expect(patientActifCourant()?.etablieA).toBe(T0);
    definirContextePatient(patientActifCourant(), T0);
    expect(cibleValide(T0)?.id).toBe(CIBLE_A.id);
    // Changement d'écran : l'écran efface son store, le panneau propage.
    effacerPatientActif();
    definirContextePatient(patientActifCourant(), T0);
    expect(cibleCourante()).toBeNull();
    expect(patientActifCourant()).toBeNull();
  });

  it("6. déconnexion : cible ET patient-actif purgés", () => {
    definirPatientActif(
      { id: CIBLE_A.id, nom: CIBLE_A.libelle, numero: CIBLE_A.numeroDossier },
      T0,
    );
    definirContextePatient(patientActifCourant(), T0);
    expect(cibleCourante()).not.toBeNull();
    expect(patientActifCourant()).not.toBeNull();
    purgerContexteSession();
    expect(cibleCourante()).toBeNull();
    expect(patientActifCourant()).toBeNull();
  });

  it("reposer le même patient ré-arme le TTL sans signaler un changement", () => {
    effacerCible();
    definirCible(CIBLE_A, T0);
    // Même identifiant : pas un changement (les décisions prises restent
    // valables), mais l'horodatage repart.
    expect(definirCible(CIBLE_A, T0 + TTL_CONTEXTE_MS)).toBe(false);
    expect(cibleValide(T0 + TTL_CONTEXTE_MS + 1000)?.id).toBe(CIBLE_A.id);
  });
});

describe("ambiguïté — ne jamais deviner, purger", () => {
  it("7a. signalerAmbiguite purge la cible", () => {
    definirCible(CIBLE_A, T0);
    signalerAmbiguite();
    expect(cibleCourante()).toBeNull();
  });

  it("7b. la boucle purge sur un résultat ambigu (tour scripté, sans base)", async () => {
    definirCible(CIBLE_A, T0);
    let appelsTransport = 0;
    const repondre = (
      params: { conversationId: string },
      suivante: { texte?: string; proposition?: { nom: string; args: unknown } | null },
    ) => {
      const bilan: TourFlux = {
        chemin: "patient",
        texte: suivante.texte ?? "",
        proposition: suivante.proposition ?? null,
        conversationId: params.conversationId,
        persiste: false,
        interrompu: false,
        preuves: [],
      };
      return ok(bilan);
    };
    const transport = async (params: { message: string; conversationId: string }) => {
      const tour = appelsTransport++;
      if (tour === 0) {
        return repondre(params, {
          proposition: { nom: "search_patients", args: { query: "Sadli" } },
        });
      }
      return repondre(params, { texte: "Plusieurs dossiers correspondent." });
    };
    const lancer: CapaciteEnregistree["lancer"] = () =>
      Promise.resolve(
        ok({
          resultats: ["PATIENT_001", "PATIENT_002"],
          ambigu: true,
          total: 2,
        }),
      );
    const registre = (nom: string): CapaciteEnregistree | null =>
      nom === "search_patients"
        ? { nom, description: "faux", budgetOctets: 1000, champsAttendus: "query", lancer }
        : null;
    const deps: DependancesBoucle = {
      transport,
      registre,
      description: () => "- search_patients : faux",
    };
    const r = await executerTour(
      { message: "Montre-moi le dossier de Mohammed Sadli", conversationId: "conv-test" },
      {},
      new AbortController().signal,
      deps,
    );
    expect(r.ok).toBe(true);
    expect(cibleCourante()).toBeNull();
  });
});

describe("références pronominales — la cible ou la question", () => {
  it("8. pronom + cible valide : pas de clarification", () => {
    definirCible(CIBLE_A, T0);
    expect(besoinDeClarification("Résume-moi son dossier", T0 + 60_000)).toBe(false);
    expect(besoinDeClarification("Et ses médicaments ?", T0 + 60_000)).toBe(false);
    expect(besoinDeClarification("Et la dernière séance ?", T0 + 60_000)).toBe(false);
  });

  it("9. pronom sans cible : clarification ; expirée : clarification", () => {
    effacerCible();
    expect(besoinDeClarification("Et ses médicaments ?", T0)).toBe(true);
    expect(besoinDeClarification("Résume-moi son dossier", T0)).toBe(true);
    definirCible(CIBLE_A, T0);
    expect(besoinDeClarification("Et ses médicaments ?", T0 + TTL_CONTEXTE_MS + 1000)).toBe(true);
  });

  it("un nom explicite ne déclenche pas la clarification", () => {
    effacerCible();
    expect(besoinDeClarification("Résume le dossier de Djilali", T0)).toBe(false);
    expect(besoinDeClarification("Qu'ai-je demain matin ?", T0)).toBe(false);
  });
});

describe("contamination A → B", () => {
  it("10. après B, la carte ignore tout de A", () => {
    effacerCible();
    definirCible(CIBLE_A, T0);
    carteCourante().patient(CIBLE_A.id, CIBLE_A.libelle, [
      CIBLE_A.libelle,
      CIBLE_A.numeroDossier,
    ]);
    definirCible(CIBLE_B, T0 + 1000);
    expect(carteCourante().identites()).not.toContain(KARIM.libelle);
    expect(carteCourante().identites()).not.toContain(KARIM.numeroDossier);
    expect(cibleValide(T0 + 1000)?.id).toBe(CIBLE_B.id);
  });
});

describe("[Changer] et persistance", () => {
  it("11. quitterContexte vide les deux magasins", () => {
    definirPatientActif(
      { id: CIBLE_A.id, nom: CIBLE_A.libelle, numero: CIBLE_A.numeroDossier },
      T0,
    );
    definirContextePatient(patientActifCourant(), T0);
    expect(cibleCourante()).not.toBeNull();
    quitterContexte();
    expect(cibleCourante()).toBeNull();
    expect(patientActifCourant()).toBeNull();
  });

  it("le libellé de clarification est en français et versionné en i18n", () => {
    expect(fr.jarvis.contexte.preciserPatient).toBe("De quel patient parlez-vous ?");
  });

  it("12. clarification envoyer : cerveau local partagé, sans dossier ni modèle", async () => {
    purgerContexteSession();
    effacerPatientActif();
    const vus: { etat: string; conversationId: string | null; tours: readonly { role: string; texte: string }[] }[] = [];
    const desabonner = abonnerConversation((e) =>
      vus.push({ etat: e.etat, conversationId: e.conversationId, tours: e.tours }),
    );
    const originalPort = db();
    const chatId = crypto.randomUUID(), chatCalls: string[] = [], clinicalCalls: string[] = [];
    const inference = vi.fn(async () => { throw new Error("Aucun modèle sans dossier"); });
    setDbPort({
      ...originalPort,
      rpc: async <T>(name: string) => {
        chatCalls.push(name);
        if (name !== "start_jarvis_conversation") throw new Error("Écriture inattendue");
        const rows: unknown = [chatId];
        return ok(rows as T[]);
      },
      invokeFunctionStream: async (name, raw, signal) => {
        expect(name).toBe("alexa-turn");
        const input = turnInput.parse(raw);
        expect(input.appContext.patientId).toBeNull();
        let records = "";
        await runAlexa(input, { actor: "phase3-clarification", infer: inference,
          db: { rpc: async name => { clinicalCalls.push(name); throw new Error("Lecture de dossier interdite"); } },
          knowledge: { rpc: async () => { throw new Error("Connaissance non demandée"); } },
        }, event => { records += `data: ${JSON.stringify(event)}\n\n`; }, signal ?? new AbortController().signal);
        return ok(new ReadableStream<Uint8Array>({ start(controller) {
          controller.enqueue(new TextEncoder().encode(records)); controller.close();
        } }));
      },
    });
    try {
      await envoyer("Et ses médicaments ?");
    } finally {
      desabonner();
      setDbPort(originalPort);
      purgerContexteSession();
    }
    const dernier = vus[vus.length - 1];
    expect(dernier?.conversationId).toBe(chatId);
    expect(dernier?.etat).toBe("composition");
    const textes = (dernier?.tours ?? []).map((t) => `${t.role}:${t.texte}`);
    expect(textes).toContain("humain:Et ses médicaments ?");
    expect(textes).toContain(`jarvis:${dialogue("fr").patient}`);
    expect(chatCalls).toEqual(["start_jarvis_conversation"]);
    expect(clinicalCalls).toEqual([]);
    expect(inference).not.toHaveBeenCalled();
    expect(dernier?.tours.at(-1)).toMatchObject({ sourcePatientId: null, alexaSources: [] });
  });
});
