/**
 * COURBES PAR TYPE — l'alignement jour × type, sans arithmétique métier.
 *
 * POURQUOI CE FICHIER EXISTE. Le graphique « Calendrier » multi-lignes (look
 * 21st.dev) trace une courbe par type de consultation, jour par jour. La porte
 * rend des lignes éparses `{ jour_iso, cle, nb }` — seuls les couples
 * (jour, type) non nuls sont présents. Le composant a besoin de séries
 * ALIGNÉES (une valeur par jour, zéro quand absent) pour poser ses points.
 *
 * RÈGLE : cet alignement est de la GÉOMÉTRIE (remplir les trous par zéro),
 * jamais de la comptabilité — aucun total, aucune part, aucune moyenne n'est
 * calculée ici. Les nombres viennent de SQL ; ce module les RANGE.
 */
import { describe, expect, it } from "vitest";

import { alignerCourbesTypes } from "@/components/ui/Graphes";

const JOURS = ["2026-09-01", "2026-09-02", "2026-09-03"];
const CLES = ["suivi", "premiere_consultation"];

describe("alignerCourbesTypes", () => {
  it("aligne les valeurs sur les jours, zéro quand le couple est absent", () => {
    const lignes = [
      { jour_iso: "2026-09-01", cle: "suivi", nb: 2 },
      { jour_iso: "2026-09-03", cle: "suivi", nb: 1 },
      { jour_iso: "2026-09-02", cle: "premiere_consultation", nb: 3 },
    ];

    const courbes = alignerCourbesTypes(lignes, JOURS, CLES);

    expect(courbes).toEqual([
      { cle: "suivi", valeurs: [2, 0, 1] },
      { cle: "premiere_consultation", valeurs: [0, 3, 0] },
    ]);
  });

  it("ignore les lignes hors périmètre (jour ou clé inconnus)", () => {
    const lignes = [
      { jour_iso: "2026-09-01", cle: "suivi", nb: 1 },
      { jour_iso: "2026-09-09", cle: "suivi", nb: 5 },
      { jour_iso: "2026-09-01", cle: "teleconsultation", nb: 4 },
    ];

    const courbes = alignerCourbesTypes(lignes, JOURS, CLES);

    expect(courbes).toEqual([
      { cle: "suivi", valeurs: [1, 0, 0] },
      { cle: "premiere_consultation", valeurs: [0, 0, 0] },
    ]);
  });

  it("respecte l'ordre des clés donné (ordre SQL : non-rattaché en dernier)", () => {
    const lignes = [{ jour_iso: "2026-09-02", cle: "__non_rattache__", nb: 1 }];

    const courbes = alignerCourbesTypes(lignes, JOURS, ["suivi", "__non_rattache__"]);

    expect(courbes.map((c) => c.cle)).toEqual(["suivi", "__non_rattache__"]);
    expect(courbes[1]).toEqual({ cle: "__non_rattache__", valeurs: [0, 1, 0] });
  });
});
