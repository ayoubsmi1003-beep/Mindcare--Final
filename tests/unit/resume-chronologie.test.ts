/**
 * LE RÉSUMÉ CHRONOLOGIQUE — APERÇU DÉTERMINISTE ET RÉCIT ANCRÉ.
 *
 * Ce que ces tests protègent, dans l'ordre d'importance :
 *
 *  1. L'aperçu ne doit RIEN inventer. C'est la section qu'une praticienne lit
 *     en premier et sur laquelle elle se fie sans rouvrir le dossier : nom,
 *     âge, résidence, diagnostics, traitement. Elle est recopiée du socle SQL,
 *     jamais rédigée par un modèle, et ces tests le vérifient champ par champ.
 *  2. Une absence reste une absence. Pas d'âge « plausible », pas de « aucun
 *     traitement en cours » — le vide se montre par le vide (règle 8).
 *  3. Le récit du modèle est FILTRÉ : une citation inventée disparaît sans
 *     emporter l'item, et un résumé sans aucun récit est refusé plutôt
 *     qu'enregistré vide.
 *
 * Les fixtures ont la forme exacte de `app.build_case_context` (068), relevée
 * sur la base ; les valeurs sont inventées — aucune donnée patient ici.
 */
import { describe, expect, it } from "vitest";

import {
  assemblerSchema2,
  construireApercu,
  idsAutorisesDuContexte,
} from "@/server/jarvis/resume-chronologie";

const ID_DIAG = "22222222-2222-4222-8222-222222222222";
const ID_PRESC = "44444444-4444-4444-8444-444444444444";
const ID_ECH = "11111111-1111-4111-8111-111111111111";
const ID_CONS = "33333333-3333-4333-8333-333333333333";

const SOCLE = {
  identite: {
    first_name: "Fixture",
    last_name: "Longitudinale",
    record_number: "TEST-0001",
    sex: "F",
    birth_date: "1985-03-11",
    age: 41,
  },
  residence: "Alger",
  diagnostics: [
    {
      id: ID_DIAG,
      code: "F32.1",
      label: "Épisode dépressif moyen",
      is_primary: true,
      onset_date: "2025-11-02",
      resolved_at: null,
    },
  ],
  traitement_documente: {
    prescription_id: ID_PRESC,
    prescribed_at: "2026-01-05T09:00:00+01:00",
    lignes: [{ medicament: "Sertraline", dose: "50 mg", frequence: 1, duree_jours: 30 }],
  },
  echelles: [
    {
      scale_name: "PHQ-9",
      points: [
        { id: ID_ECH, date: "2026-08-20", score: 8 },
        { id: "aaaa1111-1111-4111-8111-111111111111", date: "2026-05-14", score: 12 },
      ],
    },
  ],
};

describe("l'aperçu, recopié et non rédigé", () => {
  it("porte le nom, l'âge et la résidence tels quels", () => {
    const a = construireApercu(SOCLE);
    expect(a?.nom).toBe("Fixture Longitudinale");
    expect(a?.age).toBe(41);
    expect(a?.residence).toBe("Alger");
  });

  it("cite chaque diagnostic par son identifiant", () => {
    const a = construireApercu(SOCLE);
    expect(a?.diagnostics).toHaveLength(1);
    expect(a?.diagnostics[0]?.texte).toContain("Épisode dépressif moyen");
    expect(a?.diagnostics[0]?.sources).toEqual([{ t: "diagnostic", id: ID_DIAG }]);
  });

  it("porte la posologie ET la date de l'ordonnance", () => {
    const a = construireApercu(SOCLE);
    const textes = a?.traitements.map((t) => t.texte) ?? [];
    expect(textes.some((t) => t.includes("Sertraline") && t.includes("50 mg"))).toBe(true);
    // « documenté » n'est pas « en cours » : la date doit être lisible.
    expect(textes.some((t) => t.includes("2026-01-05"))).toBe(true);
    expect(a?.traitements.every((t) => t.sources.length > 0)).toBe(true);
  });

  it("rend la trajectoire d'échelle en chiffres, sans mot de valence", () => {
    const a = construireApercu(SOCLE);
    const ligne = a?.contexte[0]?.texte ?? "";
    expect(ligne).toContain("PHQ-9");
    // Du plus ancien au plus récent — une trajectoire se lit dans le sens du temps.
    expect(ligne.indexOf("12")).toBeLessThan(ligne.indexOf("8 ("));
    expect(ligne).not.toMatch(/amélior|aggrav|mieux|pire|stable/i);
  });

  it("une absence reste une absence — aucun champ inventé", () => {
    const maigre = {
      identite: { first_name: "A", last_name: "B", age: null },
      residence: null,
      diagnostics: [],
      traitement_documente: null,
      echelles: [],
    };
    const a = construireApercu(maigre);
    expect(a?.age).toBeNull();
    expect(a?.residence).toBeNull();
    // Surtout PAS un item « aucun traitement en cours » : ce serait une
    // affirmation, et elle devrait alors être sourcée.
    expect(a?.traitements).toEqual([]);
    expect(a?.diagnostics).toEqual([]);
  });

  it("refuse un socle sans identité plutôt que d'en fabriquer une", () => {
    expect(construireApercu({ identite: { first_name: "", last_name: "" } })).toBeNull();
    expect(construireApercu(null)).toBeNull();
  });
});

describe("le récit, filtré", () => {
  const apercu = construireApercu(SOCLE);
  const ids = new Set([ID_DIAG, ID_PRESC, ID_ECH, ID_CONS]);

  it("écarte une citation inventée sans perdre l'item", () => {
    const contenu = assemblerSchema2(
      apercu!,
      {
        chronologie: [
          {
            periode: "2026",
            entrees: [
              {
                texte: "Séance de suivi notée le 20 août 2026.",
                sources: [
                  { t: "consultation", id: "99999999-9999-4999-8999-999999999999" },
                  { t: "consultation", id: ID_CONS },
                ],
              },
            ],
          },
        ],
      },
      ids,
    );
    const entree = contenu?.chronologie[0]?.entrees[0];
    expect(entree?.texte).toContain("Séance de suivi");
    expect(entree?.sources).toEqual([{ t: "consultation", id: ID_CONS }]);
  });

  it("ordonne les périodes de la plus récente à la plus ancienne", () => {
    const contenu = assemblerSchema2(
      apercu!,
      {
        chronologie: [
          { periode: "2024", entrees: [{ texte: "Ancien.", sources: [] }] },
          { periode: "2026", entrees: [{ texte: "Récent.", sources: [] }] },
          { periode: "2025", entrees: [{ texte: "Intermédiaire.", sources: [] }] },
        ],
      },
      ids,
    );
    expect(contenu?.chronologie.map((p) => p.periode)).toEqual(["2026", "2025", "2024"]);
  });

  it("refuse un résumé sans aucun récit plutôt que d'enregistrer un aperçu seul", () => {
    // L'aperçu est déterministe : sans récit, l'enregistrer serait ranger une
    // version « la plus récente » qui n'apporte rien de neuf.
    expect(assemblerSchema2(apercu!, { chronologie: [] }, ids)).toBeNull();
    expect(assemblerSchema2(apercu!, {}, ids)).toBeNull();
  });

  it("écarte une période vide, et une période sans libellé", () => {
    const contenu = assemblerSchema2(
      apercu!,
      {
        chronologie: [
          { periode: "", entrees: [{ texte: "Sans période.", sources: [] }] },
          { periode: "2026", entrees: [] },
          { periode: "2025", entrees: [{ texte: "Retenu.", sources: [] }] },
        ],
      },
      ids,
    );
    expect(contenu?.chronologie).toHaveLength(1);
    expect(contenu?.chronologie[0]?.periode).toBe("2025");
  });

  it("lit la liste d'identifiants citables du contexte", () => {
    const set = idsAutorisesDuContexte({ ids_autorises: [ID_CONS, ID_DIAG, 42] });
    expect(set.has(ID_CONS)).toBe(true);
    expect(set.size).toBe(2);
  });
});
