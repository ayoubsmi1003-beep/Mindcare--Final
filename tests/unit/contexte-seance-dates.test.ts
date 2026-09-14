/**
 * DATES LUES EN BASE — CHAÎNE ISO OU `Date`, JAMAIS UNE LEVÉE.
 *
 * ═══ LE DÉFAUT QUE CE FICHIER VERROUILLE ═══
 *
 * PostgREST rendait les `timestamptz` en chaînes ISO ; `pg` direct les rend en
 * objets `Date`. `formaterHistoriqueNotes` appelait `started_at.slice()` :
 * dès que l'historique existait, l'analyse levait `TypeError` AVANT tout appel
 * modèle (constaté en journal serveur : `started_at?.slice is not a function`).
 * Pire, `analysesAnterieures` ne levait PAS — son garde `texte()` rendait
 * `null` sur un `Date`, et chaque analyse antérieure était ÉCARTÉE en silence :
 * le résumé longitudinal perdait sa mémoire sans un seul journal.
 *
 * Fixtures SANS PII : des dates et des corps factices, aucun patient.
 */
import { describe, expect, it } from "vitest";

import { analysesAnterieures } from "@/server/jarvis/contrat-workspace";
import { formaterHistoriqueNotes } from "@/server/jarvis/contexte-seance";

function note(debut: string, startedAt: unknown): Record<string, unknown> {
  return {
    consultation_id: "c1",
    started_at: startedAt,
    note_status: "signed",
    subjective: `${debut} ecture`,
  };
}

describe("formaterHistoriqueNotes accepte les `Date` pg comme les chaînes", () => {
  it("une `Date` rend `YYYY-MM-DD` et ne lève pas", () => {
    const rendu = formaterHistoriqueNotes([
      note("l", new Date("2026-09-03T10:00:00.000Z")),
    ] as never);

    expect(rendu.texte).toContain("Consultation du 2026-09-03");
    expect(rendu.notesRetenues).toBe(1);
  });

  it("chaînes et `Date` se trient ensemble, plus récent d'abord", () => {
    const rendu = formaterHistoriqueNotes([
      note("ancienne", "2026-08-01T10:00:00.000Z"),
      note("recente", new Date("2026-09-03T10:00:00.000Z")),
    ] as never);

    expect(rendu.notesRetenues).toBe(2);
    // Ordre de LECTURE chronologique (le plus ancien d'abord) : le tri
    // interne retient depuis le plus récent, puis inverse pour le récit.
    const texte = rendu.texte ?? "";
    expect(texte.indexOf("ancienne")).toBeLessThan(texte.indexOf("recente"));
  });

  it("une date illisible dit « date inconnue » et part en fin, sans évincer", () => {
    const rendu = formaterHistoriqueNotes([
      note("sans-date", 12_345),
      note("datee", "2026-09-03T10:00:00.000Z"),
    ] as never);

    // Ni évincée (retenue malgré le budget), ni crash : étiquetée.
    expect(rendu.notesRetenues).toBe(2);
    const texte = rendu.texte ?? "";
    expect(texte).toContain("date inconnue");
    expect(texte).toContain("Consultation du 2026-09-03");
  });

  it("un amendement à `created_at` non-chaîne ne lève pas", () => {
    const rendu = formaterHistoriqueNotes([
      {
        consultation_id: "c1",
        started_at: "2026-09-03T10:00:00.000Z",
        note_status: "signed",
        subjective: "corps",
        amendments: [{ reason: "coquille", body: "correctif", created_at: new Date(0) }],
      },
    ] as never);

    expect(rendu.notesRetenues).toBe(1);
    expect(rendu.texte).toContain("Amendement du 1970-01-01");
  });
});

describe("analysesAnterieures garde les lignes à `generated_at` `Date`", () => {
  function ligne(generatedAt: unknown): unknown {
    return {
      consultation_id: "c9",
      generated_at: generatedAt,
      content: {
        noteStructuree: { assessment: "a", plan: "p" },
        evolution: [],
      },
    };
  }

  it("un `Date` est relu (mémoire longitudinale conservée)", () => {
    const lues = analysesAnterieures([ligne(new Date("2026-08-20T10:00:00.000Z"))]);

    expect(lues).toHaveLength(1);
    expect(lues[0]?.date).toBe("2026-08-20");
  });

  it("une valeur illisible reste écartée, sans lever", () => {
    expect(analysesAnterieures([ligne(42)])).toHaveLength(0);
    expect(analysesAnterieures([ligne(null)])).toHaveLength(0);
  });
});
