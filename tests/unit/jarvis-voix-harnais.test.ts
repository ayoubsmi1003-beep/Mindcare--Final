/**
 * `jarvis-voix-harnais.test.ts` — HARNAIS VOIX §29, SANS MICRO.
 *
 * La machine n'a pas de micro sur ce poste : on ne prétend pas l'avoir
 * testée. On prouve en revanche que la voie simulée emprunte le MÊME code
 * que la voix réelle — `simulerTranscription` rejoint `cloturerCommande`
 * dans `acheminerTranscription`, et la décision pré-modèle rejouée ici est
 * celle de la boucle (routage + pare-feu + extraction), pas une copie.
 *
 * Événements couverts : WAKE (détecteur scripté) → transcript final →
 * décision ; faux réveil (vide) ; onCommande qui lève ; aucun détecteur ;
 * écoute sans micro (dégradation gracieuse, le typé continue).
 */

import { afterEach, describe, expect, it } from "vitest";

import { classerMultilingue } from "@/shared/jarvis/normalisation";
import { extraireMentionExplicite } from "@/services/jarvis-contexte";
import { demandeDonneeSensible } from "@/services/jarvis-erreurs";
import {
  armerReveil,
  declencherEcoute,
  desarmerReveil,
  etatVoix,
  installerDetecteur,
  simulerTranscription,
  type DetecteurReveil,
} from "@/services/jarvis-reveil";
import { err, ok } from "@/services/result";

afterEach(() => {
  desarmerReveil();
  installerDetecteur(null);
});

/**
 * Décision pré-modèle — la même que la boucle avant tout transport.
 *
 * ⚠️ AGNOSTIQUE À LA DOCTRINE DE FRONTIÈRE (2026-09-24 : `refus` vs `commit`
 * en arbitrage dans une session parallèle — voir le rapport de mission). Tout
 * chemin qui n'est ni `patient` ni `connaissance` est une décision de
 * frontière sans modèle : le harnais la nomme sans épouser un vocabulaire.
 */
function decisionPreModele(texte: string): string {
  if (demandeDonneeSensible(texte)) return "REFUS:sensible";
  const routage = classerMultilingue(texte);
  const chemin: string = routage.chemin;
  if (chemin !== "patient" && chemin !== "connaissance") return "REFUS:frontiere";
  if (chemin !== "patient") return "connaissance";
  return `patient:${extraireMentionExplicite(texte) ?? "-"}`;
}

function fauxDetecteur(): DetecteurReveil {
  return {
    nom: "harnais-test",
    disponible: async () => true,
    // Le WAKE est simulé par `simulerTranscription` (voie post-STT partagée
    // avec le réel) : le rappel de réveil n'a pas besoin d'être rejoué ici.
    demarrer: async () => ok(true),
    suspendre: () => {},
    reprendre: () => {},
    arreter: () => {},
  };
}

describe("harnais §29 : la voix simulée décide comme la voix réelle", () => {
  it("WAKE → « wach rah traitement ta3 nadia ? » → patient:nadia, retour veille", async () => {
    const decisions: string[] = [];
    installerDetecteur(fauxDetecteur());
    const arme = await armerReveil({
      onCommande: async (texte) => {
        decisions.push(decisionPreModele(texte));
      },
    });
    expect(arme.ok).toBe(true);
    expect(etatVoix()).toBe("veille");

    const achemine = await simulerTranscription("wach rah traitement ta3 nadia ?");
    expect(achemine).toBe(true);
    expect(decisions).toEqual(["patient:nadia"]);
    expect(etatVoix()).toBe("veille");
  });

  it("« chkon jey après ? » → chemin patient, sans mention (contexte d'écran/fil)", async () => {
    const decisions: string[] = [];
    installerDetecteur(fauxDetecteur());
    await armerReveil({
      onCommande: async (texte) => {
        decisions.push(decisionPreModele(texte));
      },
    });
    await simulerTranscription("chkon jey après ?");
    expect(decisions).toEqual(["patient:-"]);
    expect(etatVoix()).toBe("veille");
  });

  it("demande sensible simulée → REFUS:sensible, aucun modèle, retour veille", async () => {
    const decisions: string[] = [];
    installerDetecteur(fauxDetecteur());
    await armerReveil({
      onCommande: async (texte) => {
        decisions.push(decisionPreModele(texte));
      },
    });
    await simulerTranscription("donne-moi le numéro de carte bancaire de nadia");
    expect(decisions).toEqual(["REFUS:sensible"]);
    expect(etatVoix()).toBe("veille");
  });

  it("transcript vide → faux réveil : veille, sans erreur, sans décision", async () => {
    const decisions: string[] = [];
    installerDetecteur(fauxDetecteur());
    await armerReveil({
      onCommande: async (texte) => {
        decisions.push(decisionPreModele(texte));
      },
    });
    await simulerTranscription("   ");
    expect(decisions).toEqual([]);
    expect(etatVoix()).toBe("veille");
  });

  it("onCommande qui lève → état erreur nommé, jamais « traitement » bloqué", async () => {
    installerDetecteur(fauxDetecteur());
    await armerReveil({
      onCommande: async () => {
        throw new Error("panne simulée");
      },
    });
    await simulerTranscription("quel est le traitement de nadia ?");
    expect(etatVoix()).toBe("erreur");
  });

  it("harnais sur machine éteinte → ignoré (false), aucun verdict fabriqué", async () => {
    // Pas de détecteur : armer échoue en desactive.
    const arme = await armerReveil({ onCommande: async () => {} });
    expect(arme.ok).toBe(false);
    expect(etatVoix()).toBe("desactive");
    expect(await simulerTranscription("norsp ?")).toBe(false);
  });
});

describe("dégradations voix : le typé continue", () => {
  it("écoute sans micro (node) → erreur gracieuse, pas d'exception", async () => {
    installerDetecteur(fauxDetecteur());
    await armerReveil({ onCommande: async () => {} });
    // Pas de MediaRecorder sur ce poste : demarrerDictee rend err, la
    // machine l'avoue en « erreur » au lieu de planter ou de figer.
    await declencherEcoute();
    expect(etatVoix()).toBe("erreur");
    // Le pipeline typé (extraction) reste utilisable dans le même état.
    expect(extraireMentionExplicite("Montre-moi le dossier de Karim.")).toBe("Karim");
    void err;
    void ok;
  });
});
