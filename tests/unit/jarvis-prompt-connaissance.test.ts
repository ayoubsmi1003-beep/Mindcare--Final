/**
 * `PROMPT_CONNAISSANCE` — LE CHEMIN SANS DOSSIER NE DOIT PAS PRÉTENDRE
 * QU'IL N'Y A PAS DE DOSSIERS.
 *
 * ═══ LE DÉFAUT ═══
 * La praticienne demande « can u tell me abt patients ? » (question vague,
 * sans individu désigné → chemin connaissance, par conception de
 * `routing.ts`). Le prompt disait « Tu ne disposes d'AUCUN dossier patient » ;
 * le modèle l'a généralisé en « Je ne dispose d'aucun dossier patient, ni
 * d'informations sur des individus spécifiques… je ne peux pas accéder,
 * stocker ni analyser des données personnelles » — FAUX : le cabinet tient
 * ses dossiers, `search_patients` existe, et le chemin patient y accède sous
 * RLS. La phrase vraie est bornée à CE tour (« ce chemin ne charge aucune
 * donnée individuelle »), et la sortie honnête est d'inviter à préciser le
 * dossier, pas de nier son existence.
 *
 * Ces tests portent sur le TEXTE du prompt (déterministe), pas sur les
 * réponses du modèle (non déterministes) : ils interdisent le retour du
 * mensonge, ils ne prouvent pas la formulation de chaque réponse.
 */
import { describe, expect, it } from "vitest";

import { PROMPT_CONNAISSANCE } from "../../src/app/api/jarvis/jarvis-chat/prompt";

describe("le chemin connaissance dit la vérité bornée sur les dossiers", () => {
  // La clause INTERDIT cite les dénis pour les prohiber : on raisonne sur le
  // prompt amputé de cette clause, sinon le test interdirait sa propre garde.
  const horsInterdiction = PROMPT_CONNAISSANCE.replace(/INTERDIT[\s\S]*?FAUSSES?/i, "");
  it("ne prétend jamais une absence totale de dossiers", () => {
    expect(horsInterdiction).not.toMatch(/ne disposes? d'AUCUN dossier/i);
    expect(horsInterdiction).not.toMatch(/aucun dossier patient/i);
  });

  it("borne l'absence à ce tour : aucune donnée individuelle chargée ici", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/cette réponse|ce tour|ce chemin/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/aucune donnée (individuelle|patient)|ne vois aucun dossier/i);
  });

  it("invite à préciser le dossier au lieu de nier son existence", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/préciser|laquelle|lequel|quel dossier/i);
  });

  it("interdit explicitement les trois dénis mesurés en live", () => {
    // 2026-09-03 : la reformulation douce (v3.0) n'a pas suffi — le modèle a
    // redit « Je ne dispose d'aucun dossier patient » en live. L'interdiction
    // explicite des trois tournures constatées est la seconde tentative, pas
    // une précaution de style.
    expect(PROMPT_CONNAISSANCE).toMatch(/INTERDIT/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/je ne dispose d'aucun dossier/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/données personnelles/i);
  });

  it("garde les garde-fous : aide-mémoire, jamais de conclusion sur une personne", () => {
    expect(PROMPT_CONNAISSANCE).toMatch(/AIDE-MÉMOIRE/i);
    expect(PROMPT_CONNAISSANCE).toMatch(/ne conclus sur\s+aucune personne/i);
  });
});
