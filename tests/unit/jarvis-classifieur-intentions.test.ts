/**
 * `classifierIntent` — BORNÉ, INJECTABLE, FAIL-CLOSED.
 *
 * ═══ CE QUE CE FICHIER ÉPROUVE, SANS RÉSEAU ═══
 * Le transport est un faux pinné : valide → `valide` ; JSON cassé, nom
 * inventé, UUID en mention → `ecarte/invalide` ; confiance basse → `ecarte/
 * confiance-basse` ; panne → `ecarte/indisponible` ; motif tel/mail → écarté
 * AVANT tout appel (le faux compterait un appel = FAIL). Le refus n'est pas
 * décidé ici : une demande clinique sur personne nommée traverse
 * structurellement (l'appelant la jette avant d'appeler).
 */
import { describe, expect, it, vi } from "vitest";

import {
  classifierIntent,
  construirePromptClassifieur,
  extraireJsonClassifieur,
  INTENT_PROMPT_VERSION,
  porteUnMotifInterdit,
  type IdsClassifieur,
  type TransportClassifieur,
} from "@/server/jarvis/classifieur-intentions";
import { NOMS_INTENTIONS } from "@/shared/jarvis/intentions";

const IDS: IdsClassifieur = {
  conversationId: "00000000-0000-4000-8000-000000000001",
  turnId: "00000000-0000-4000-8000-000000000002",
  runId: "00000000-0000-4000-8000-000000000003",
};

function faux(texte: string | null, modele = "faux/modele-1"): TransportClassifieur {
  return { completer: async () => ({ texte, modele }) };
}

const VALIDE = JSON.stringify({
  name: "GET_NEXT_PATIENT",
  entities: { patientMention: "Karim" },
  references: { pronomSansAntecedent: false, homonymePossible: false },
  confidence: 0.82,
  missingInformation: [],
});

describe("valide", () => {
  it("JSON conforme → statut valide, intent préservé, latence et modèle rendus", async () => {
    const r = await classifierIntent("Qui vient après Karim ?", IDS, faux(VALIDE));
    expect(r.statut).toBe("valide");
    if (r.statut !== "valide") return;
    expect(r.intent.name).toBe("GET_NEXT_PATIENT");
    expect(r.modele).toBe("faux/modele-1");
    expect(r.latenceMs).toBeGreaterThanOrEqual(0);
  });

  it("habillage modèle ( fences + think ) toléré sur la FORME", async () => {
    const r = await classifierIntent(
      "Qui vient après Karim ?",
      IDS,
      faux(`<think>réflexion</think>\n\`\`\`json\n${VALIDE}\n\`\`\``),
    );
    expect(r.statut).toBe("valide");
  });

  it("demande clinique sur personne nommée traverse structurellement (le refus est l'affaire de l'appelant)", async () => {
    const r = await classifierIntent(
      "Dois-je augmenter la dose pour Amina ?",
      IDS,
      faux(
        JSON.stringify({
          name: "GET_CURRENT_MEDICATIONS",
          entities: { patientMention: "Amina" },
          references: { pronomSansAntecedent: false, homonymePossible: false },
          confidence: 0.9,
          missingInformation: [],
        }),
      ),
    );
    // Structurellement classé — la route, qui a déjà vu `refus`, ne l'appelle jamais.
    expect(r.statut).toBe("valide");
  });
});

describe("écarté, jamais deviné", () => {
  it("déchet → invalide", async () => {
    const r = await classifierIntent("Qui vient après Karim ?", IDS, faux("pas du json"));
    expect(r).toMatchObject({ statut: "ecarte", raison: "invalide" });
  });

  it("nom inventé → invalide", async () => {
    const r = await classifierIntent(
      "Qui vient après Karim ?",
      IDS,
      faux('{"name":"EFFACER_BASE","entities":{},"references":{"pronomSansAntecedent":false,"homonymePossible":false},"confidence":0.99,"missingInformation":[]}'),
    );
    expect(r).toMatchObject({ statut: "ecarte", raison: "invalide" });
  });

  it("UUID en mention → invalide (jamais un identifiant)", async () => {
    const r = await classifierIntent(
      "le dossier ?",
      IDS,
      faux(
        '{"name":"GET_PATIENT_CONTEXT","entities":{"patientMention":"123e4567-e89b-12d3-a456-426614174000"},"references":{"pronomSansAntecedent":false,"homonymePossible":false},"confidence":0.9,"missingInformation":[]}',
      ),
    );
    expect(r).toMatchObject({ statut: "ecarte", raison: "invalide" });
  });

  it("confiance 0.2 → confiance-basse (direction fail-closed)", async () => {
    const r = await classifierIntent(
      "Qui vient après Karim ?",
      IDS,
      faux(
        '{"name":"GET_NEXT_PATIENT","entities":{"patientMention":"Karim"},"references":{"pronomSansAntecedent":false,"homonymePossible":false},"confidence":0.2,"missingInformation":[]}',
      ),
    );
    expect(r).toMatchObject({ statut: "ecarte", raison: "confiance-basse" });
  });

  it("panne transport (null / throw) → indisponible", async () => {
    expect(await classifierIntent("Qui vient après Karim ?", IDS, faux(null))).toMatchObject({
      statut: "ecarte",
      raison: "indisponible",
    });
    const quiJette: TransportClassifieur = {
      completer: async () => {
        throw new Error("timeout");
      },
    };
    expect(await classifierIntent("Qui vient après Karim ?", IDS, quiJette)).toMatchObject({
      statut: "ecarte",
      raison: "indisponible",
    });
  });

  it("motif tel/mail → motif-interdit AVANT tout appel réseau", async () => {
    const espion = vi.fn(async () => ({ texte: VALIDE, modele: "faux/modele-1" }));
    for (const message of ["rappelle le 0612345678", "écris à nadia@example.dz"]) {
      expect(porteUnMotifInterdit(message)).toBe(true);
      const r = await classifierIntent(message, IDS, { completer: espion });
      expect(r).toMatchObject({ statut: "ecarte", raison: "motif-interdit" });
    }
    expect(espion).not.toHaveBeenCalled();
  });

  it("message vide → invalide", async () => {
    const espion = vi.fn(async () => ({ texte: VALIDE, modele: "faux/modele-1" }));
    expect(await classifierIntent("   ", IDS, { completer: espion })).toMatchObject({
      statut: "ecarte",
      raison: "invalide",
    });
    expect(espion).not.toHaveBeenCalled();
  });
});

describe("prompt versionné et fermé", () => {
  it("version intent-v1, les 32 noms listés, aucune donnée patient", () => {
    expect(INTENT_PROMPT_VERSION).toBe("intent-v1");
    const p = construirePromptClassifieur();
    for (const nom of NOMS_INTENTIONS) {
      expect(p).toContain(nom);
    }
    expect(p).not.toMatch(/Karim|Amina|PATIENT_001/);
  });

  it("extraireJsonClassifieur : forme tolérée, fond jamais deviné", () => {
    expect(extraireJsonClassifieur(VALIDE)).toMatchObject({ name: "GET_NEXT_PATIENT" });
    expect(extraireJsonClassifieur("rien")).toBeNull();
    expect(extraireJsonClassifieur('préambule {"a":1} suite')).toMatchObject({ a: 1 });
  });
});
