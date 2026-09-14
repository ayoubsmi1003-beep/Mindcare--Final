/**
 * Pare-feu B1 — comparaison en MOTS, pas en sous-chaînes (2026-09-03).
 *
 * ═══ CE QUE CES TESTS GARDENT ═══
 * Un dossier nommé « Patient » (données synthétiques cloud-dev, 2 dossiers)
 * faisait échouer FERME tout tour le touchant : le jeton `{{PATIENT_001}}`
 * contient « patient » en sous-chaîne, la clé `"patient"` aussi, et la
 * comparaison nue les prenait pour la personne. Même classe de faux positif :
 * « Ali » dans « qualité ».
 *
 * Le masque et le vérifieur comparent désormais en mots à frontières Unicode
 * (`motifIdentite`), et le vérifieur ne lit que les feuilles (valeurs), jamais
 * les clés de notre schéma. Ces tests fixent les trois propriétés :
 *   1. un dossier « Patient » passe, références intactes ;
 *   2. un prénom court dans un mot ordinaire passe ;
 *   3. un vrai nom en toutes lettres lève toujours `FuiteDetectee`.
 *
 * ⚠️ FIXTURES SYNTHÉTIQUES UNIQUEMENT, AUCUN ACCÈS BASE. « Patient » est ici
 * un prénom de fixture qui rejoue la collision mesurée, pas un dossier réel.
 */
import { describe, expect, it } from "vitest";

import {
  FuiteDetectee,
  preparerPourLeModele,
  verifierSortant,
} from "../../src/services/jarvis-confidentialite";
import { CarteIdentite } from "../../src/services/jarvis-identite";
import { KARIM } from "../fixtures/patients";

const UUID_A = "00000000-0000-4000-8000-0000000000a1";
const UUID_RDV = "00000000-0000-4000-8000-0000000000b2";

function carteAvecDossierPatient(): CarteIdentite {
  const carte = new CarteIdentite();
  carte.patient(UUID_A, "TEST Patient", ["TEST", "Patient", "P-0099", "TEST Patient"]);
  carte.rendezVous(UUID_RDV, "2026-09-03T09:00:00+01:00");
  return carte;
}

function chargeAgenda(carte: CarteIdentite): { contexte: unknown; resultatsOutils: readonly unknown[]; message: string } {
  const ref = carte.patient(UUID_A, "TEST Patient", ["TEST", "Patient", "P-0099", "TEST Patient"]);
  return {
    contexte: { temps: { aujourdHui: "2026-09-03" }, consultationOuverte: false, octets: 0 },
    resultatsOutils: [
      {
        creneaux: [
          {
            ref: carte.rendezVous(UUID_RDV, "2026-09-03T09:00:00+01:00"),
            patient: ref,
            debut: "2026-09-03T09:00:00+01:00",
            fin: "2026-09-03T09:30:00+01:00",
            dureeMinutes: 30,
            statut: "confirmed",
            type: "suivi",
            arriveA: null,
          },
        ],
        provenance: [{ porte: "app.dashboard_today", luA: "2026-09-03T08:00:00+01:00", tronque: false }],
      },
    ],
    message: "Qu'est-ce que j'ai aujourd'hui dans mon agenda ?",
  };
}

describe("pare-feu — mots, jetons et clés ne sont pas des personnes", () => {
  it("un dossier nommé « Patient » traverse, références intactes", () => {
    const carte = carteAvecDossierPatient();
    const propre = preparerPourLeModele(chargeAgenda(carte), carte);
    const creneau = (propre.resultatsOutils[0] as { creneaux: { ref: string; patient: string }[] }).creneaux[0];
    expect(creneau?.patient).toBe("PATIENT_001");
    expect(creneau?.ref).toBe("RDV_001");
  });

  /**
   * ⚠️ RÉGRESSION DU 2026-09-06 — LE TEST VOISIN NE L'AVAIT PAS VUE, ET LA
   * RAISON MÉRITE D'ÊTRE ÉCRITE.
   *
   * Le cas « un dossier nommé Patient traverse » ci-dessus construit DÉJÀ un
   * créneau dont `debut` vaut exactement le libellé du rendez-vous. Il
   * n'affirmait que deux choses : que les RÉFÉRENCES sont bien frappées, et que
   * le pare-feu ne lève pas. Il ne vérifiait jamais que la DONNÉE avait
   * survécu.
   *
   * Elle ne survivait pas. `frapper` ajoutait d'office le libellé aux identités
   * à masquer ; le libellé d'un rendez-vous étant son heure de début,
   * `assainir` remplaçait le champ `debut` par « {{RDV_001}} ». Mesuré au
   * navigateur : le modèle recevait un créneau sans heure de début, ne pouvait
   * pas répondre « qui vient aujourd'hui », redemandait l'agenda, et le garde
   * de répétition rompait le tour sur « Je tourne en rond ». Un garde de
   * sûreté masquait une corruption de données en amont.
   *
   * La leçon, et c'est elle qu'on fige ici : « le pare-feu ne lève pas » ne dit
   * RIEN sur l'intégrité de ce qui traverse. Un masquage se juge dans les deux
   * sens — ce qui doit disparaître, et ce qui doit rester.
   */
  it("l'heure de début du créneau SURVIT au masquage", () => {
    const carte = carteAvecDossierPatient();
    const propre = preparerPourLeModele(chargeAgenda(carte), carte);
    const creneau = (
      propre.resultatsOutils[0] as { creneaux: { debut: string; fin: string; ref: string }[] }
    ).creneaux[0];

    expect(creneau?.debut).toBe("2026-09-03T09:00:00+01:00");
    // `fin` n'a jamais été atteint — il n'est le libellé de personne. C'est
    // l'ASYMÉTRIE entre les deux champs qui signait le défaut.
    expect(creneau?.fin).toBe("2026-09-03T09:30:00+01:00");
    expect(creneau?.debut).not.toContain("{{");
    // La référence, elle, reste bien un jeton.
    expect(creneau?.ref).toBe("RDV_001");
  });

  it("un horodatage n'est pas une identité — il ne fait pas lever le vérifieur", () => {
    const carte = new CarteIdentite();
    carte.rendezVous(UUID_RDV, "2026-09-03T09:00:00+01:00");
    expect(() =>
      verifierSortant({ debut: "2026-09-03T09:00:00+01:00" }, carte),
    ).not.toThrow();
  });

  it("le masquage du libellé PATIENT reste, lui, obligatoire", () => {
    // Le correctif ne desserre le masquage QUE pour la famille RDV. Si un jour
    // quelqu'un généralisait `masquerLibelle:false`, ce test tomberait — et
    // c'est exactement ce qu'on veut.
    const carte = new CarteIdentite();
    carte.patient(UUID_A, KARIM.libelle, []);
    const propre = preparerPourLeModele(
      { contexte: {}, resultatsOutils: [{ note: KARIM.libelle }], message: "bonjour" },
      carte,
    );
    expect(JSON.stringify(propre)).not.toContain(KARIM.nom.toUpperCase());
  });

  it("« Ali » dans « qualité » ne fait pas lever", () => {
    const carte = new CarteIdentite();
    carte.patient(UUID_A, "BEN Ali", ["BEN", "Ali", "P-0100", "BEN Ali"]);
    expect(() =>
      preparerPourLeModele(
        { contexte: {}, resultatsOutils: [{ note: "une prise en charge de qualité" }], message: "bonjour" },
        carte,
      ),
    ).not.toThrow();
  });

  it("un vrai nom en toutes lettres lève toujours", () => {
    const carte = new CarteIdentite();
    carte.patient(UUID_A, "BEN Ali", ["BEN", "Ali", "P-0100", "BEN Ali"]);
    let attrape: unknown = null;
    try {
      verifierSortant({ note: "Ali va mieux" }, carte);
    } catch (e) {
      attrape = e;
    }
    expect(attrape).toBeInstanceOf(FuiteDetectee);
    expect((attrape as FuiteDetectee).classe).toBe("identite");
  });

  it("un nom accentué reste masqué puis vérifié, dans les deux sens", () => {
    const carte = new CarteIdentite();
    carte.patient(UUID_A, "AMRANI Hicham", ["AMRANI", "Hicham", "P-0101", "AMRANI Hicham"]);
    const propre = preparerPourLeModele(
      { contexte: {}, resultatsOutils: [{ note: "Hicham va mieux" }], message: "bonjour" },
      carte,
    );
    expect(JSON.stringify(propre)).not.toContain("Hicham");
  });
});
