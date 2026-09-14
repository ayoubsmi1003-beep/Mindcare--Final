/**
 * `lireProposition` — L'ENVELOPPE NUE DU MODÈLE.
 *
 * ═══ LE DÉFAUT ═══
 * Avec qwen, le chemin patient rend 3/3 fois `{"type":"search_patients",
 * "query":"…"}` — le NOM de l'outil en `type`, sans enveloppe `outil`.
 * `lireProposition` ne connaissait que `{type:"outil",nom,…}` et
 * `{type:"texte",…}` : chaque proposition d'outil mourait en
 * `indisponible`, et TOUT le chemin patient-outil était inopérant en silence
 * (les réponses `texte` passaient, masquant la panne).
 *
 * ═══ POURQUOI ACCEPTER N'EST PAS DEVINER ═══
 * Le modèle NOMME l'outil explicitement, parmi les cinq décrits
 * (`DESCRIPTION_OUTILS`) ; le client (Zod, `jarvis-tools.ts`) puis la base
 * (allowlist 033/063) revalident nom ET arguments. Seul un nom CONNU est
 * rabattu — un nom inventé reste `null`. Ce test verrouille les deux sens.
 */
import { describe, expect, it } from "vitest";

import { lireProposition } from "../../src/server/jarvis/proposition";

describe("enveloppe canonique (non-régression)", () => {
  it("outil nommé → outil", () => {
    expect(
      lireProposition('{"type":"outil","nom":"search_patients","args":{"query":"ayoub"}}'),
    ).toEqual({ type: "outil", nom: "search_patients", args: { query: "ayoub" } });
  });

  it("texte → texte", () => {
    expect(lireProposition('{"type":"texte","reponse":"bonjour"}')).toEqual({
      type: "texte",
      reponse: "bonjour",
    });
  });

  it("déchet → null", () => {
    expect(lireProposition("pas du json")).toBeNull();
    expect(lireProposition('{"type":"invente","x":1}')).toBeNull();
  });
});

describe("enveloppe nue du modèle (qwen, mesuré 3/3)", () => {
  it("nom d'outil connu en `type` → outil, le reste en args", () => {
    expect(
      lireProposition('{"type":"search_patients","query":"ayoub salmi"}'),
    ).toEqual({ type: "outil", nom: "search_patients", args: { query: "ayoub salmi" } });
  });

  it("nue sous clôture markdown → outil", () => {
    expect(
      lireProposition('```json\n{"type":"get_agenda","from":"a","to":"b"}\n```'),
    ).toEqual({ type: "outil", nom: "get_agenda", args: { from: "a", to: "b" } });
  });

  it("nom inconnu en `type` → null, jamais deviné", () => {
    expect(lireProposition('{"type":"effacer_base","vite":true}')).toBeNull();
  });

  it("mélange des deux conventions → un niveau d'args désemballe", () => {
    // Mesuré en boucle live : le modèle envoie parfois `{type:<outil>,
    // args:{…}}` (enveloppe `args` + nom nu). Sans désemballage, la clé
    // `args` fait échouer `strictObject` et brûle un tour de boucle.
    expect(
      lireProposition('{"type":"search_patients","args":{"query":"ayoub salmi"}}'),
    ).toEqual({ type: "outil", nom: "search_patients", args: { query: "ayoub salmi" } });
  });

  it("args non-objet sous enveloppe mélangée → null", () => {
    expect(lireProposition('{"type":"search_patients","args":"ayoub"}')).toBeNull();
  });
});
