/**
 * `jarvis-heure-cabinet.test.ts` — ALEXA DIT L'HEURE DU CABINET, PAS CELLE D'UTC.
 *
 * ═══ LE DÉFAUT QUE CES TESTS FIGENT ═══
 * Mesuré au navigateur le 2026-09-06, sur la MÊME donnée, dans le MÊME produit :
 *
 *     base            : 2026-09-06T16:41:00+00:00
 *     écran Agenda    : « 17:41 – 18:11 »   ← juste (Intl, Africa/Algiers)
 *     Alexa           : « 16:41 à 17:11 »   ← faux (chaîne brute lue au cadran)
 *
 * La projection envoyait l'instant UTC au modèle et le laissait convertir. Il
 * lisait les chiffres et perdait une heure — sur un rendez-vous clinique. C'est
 * exactement ce que `jarvis-contexte.ts` interdit : « LE MODÈLE NE CALCULE
 * AUCUNE DATE ».
 *
 * ⚠️ CE QUI EST VÉRIFIÉ ICI, ET QUI COMPTE PLUS QUE L'HEURE AFFICHÉE :
 * l'INSTANT ne bouge pas. On n'a pas « ajouté une heure » — on exprime le même
 * point du temps dans le calendrier du cabinet. Si un jour quelqu'un
 * remplaçait ce calcul par un `+1h`, le test des bornes de journée et celui de
 * l'invariance d'instant tomberaient tous les deux.
 *
 * Fixtures synthétiques, aucun accès base.
 */

import { describe, expect, it } from "vitest";

import { CarteIdentite } from "@/services/jarvis-identite";
import { enHeureCabinet, projeterCreneau, type SourceCreneau } from "@/services/jarvis-projections";

function creneau(startsAt: string, endsAt: string): SourceCreneau {
  return {
    id: "00000000-0000-4000-8000-0000000000b1",
    startsAt,
    endsAt,
    status: "confirmed",
    kind: null,
    arrivedAt: null,
    patientId: null,
    recordNumber: null,
    firstName: null,
    lastName: null,
  };
}

describe("enHeureCabinet — le même instant, dans le calendrier du cabinet", () => {
  it("rend l'heure murale d'Alger avec son décalage", () => {
    // Le cas EXACT mesuré à l'écran.
    expect(enHeureCabinet("2026-09-06T16:41:00+00:00")).toBe("2026-09-06T17:41:00+01:00");
  });

  it("NE DÉPLACE PAS l'instant — c'est la propriété centrale", () => {
    // Si l'on avait « ajouté une heure », cette égalité tomberait.
    const cas = [
      "2026-09-06T16:41:00+00:00",
      "2026-01-15T23:30:00+00:00",
      "2026-07-01T00:00:00+00:00",
    ];
    for (const iso of cas) {
      expect(Date.parse(enHeureCabinet(iso))).toBe(Date.parse(iso));
    }
  });

  it("accepte une entrée déjà exprimée en heure locale, sans la décaler deux fois", () => {
    // Idempotence : reconvertir une valeur déjà convertie ne bouge rien. Sans
    // cela, une projection appliquée deux fois décalerait de deux heures.
    const une = enHeureCabinet("2026-09-06T16:41:00+00:00");
    expect(enHeureCabinet(une)).toBe(une);
  });

  it("une chaîne illisible traverse telle quelle — jamais une heure devinée", () => {
    expect(enHeureCabinet("pas une date")).toBe("pas une date");
    expect(enHeureCabinet("")).toBe("");
  });
});

describe("bornes de journée — minuit ne change pas de jour", () => {
  /**
   * ⚠️ LE PIÈGE QUE CLAUDE.md NOMME EXPLICITEMENT : « une recette du jour
   * calculée en UTC est fausse une heure par nuit ». Entre 23:00 et 00:00 UTC,
   * Alger est DÉJÀ au lendemain. Un rendez-vous à 23:30 UTC appartient au jour
   * suivant pour le cabinet, et l'afficher au mauvais jour est pire qu'une
   * heure fausse.
   */
  it("23:30 UTC est déjà le lendemain à Alger", () => {
    expect(enHeureCabinet("2026-01-15T23:30:00+00:00")).toBe("2026-01-16T00:30:00+01:00");
  });

  it("00:00 UTC est 01:00 le même jour à Alger", () => {
    expect(enHeureCabinet("2026-01-15T00:00:00+00:00")).toBe("2026-01-15T01:00:00+01:00");
  });

  it("23:00 UTC bascule exactement à minuit d'Alger", () => {
    expect(enHeureCabinet("2026-03-10T23:00:00+00:00")).toBe("2026-03-11T00:00:00+01:00");
  });
});

describe("projeterCreneau — ce que le modèle reçoit est déjà l'heure du cabinet", () => {
  it("debut et fin sortent en heure d'Alger", () => {
    const carte = new CarteIdentite();
    const c = projeterCreneau(
      creneau("2026-09-06T16:41:00+00:00", "2026-09-06T17:11:00+00:00"),
      carte,
    );
    expect(c.debut).toBe("2026-09-06T17:41:00+01:00");
    expect(c.fin).toBe("2026-09-06T18:11:00+01:00");
    // C'est l'heure que l'écran Agenda affiche déjà : « 17:41 – 18:11 ».
    expect(c.debut).toContain("17:41");
    expect(c.fin).toContain("18:11");
  });

  it("la durée reste juste — la conversion ne déplace aucun instant", () => {
    const carte = new CarteIdentite();
    const c = projeterCreneau(
      creneau("2026-09-06T16:41:00+00:00", "2026-09-06T17:11:00+00:00"),
      carte,
    );
    expect(c.dureeMinutes).toBe(30);
  });

  it("une durée à cheval sur minuit reste juste", () => {
    const carte = new CarteIdentite();
    const c = projeterCreneau(
      creneau("2026-01-15T23:45:00+00:00", "2026-01-16T00:15:00+00:00"),
      carte,
    );
    expect(c.dureeMinutes).toBe(30);
    expect(c.debut).toBe("2026-01-16T00:45:00+01:00");
    expect(c.fin).toBe("2026-01-16T01:15:00+01:00");
  });

  it("l'heure de début SURVIT toujours au masquage (régression du 2026-09-06)", () => {
    // Le correctif du pare-feu et celui du fuseau touchent la même valeur :
    // on vérifie qu'ils tiennent ENSEMBLE, et pas seulement séparément.
    const carte = new CarteIdentite();
    const c = projeterCreneau(
      creneau("2026-09-06T16:41:00+00:00", "2026-09-06T17:11:00+00:00"),
      carte,
    );
    expect(c.debut).not.toContain("{{");
    expect(c.ref).toBe("RDV_001");
  });
});
