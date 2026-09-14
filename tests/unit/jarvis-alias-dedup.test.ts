/**
 * `jarvis-alias-dedup.test.ts` — UN ALIAS EST LE MÊME APPEL, DONC LE MÊME.
 *
 * ═══ LE DÉFAUT QUE CES TESTS FIGENT ═══
 * Mesuré à l'écran le 2026-09-06 sur « Qu'ai-je demain matin ? » : le modèle a
 * appelé `get_agenda`, puis `get_agenda_range`. Le premier est un ALIAS du
 * second ; les deux ont rendu 1 457 octets rigoureusement identiques.
 *
 * La déduplication ne l'a pas vu, parce que sa clé était le nom PROPOSÉ :
 * « get_agenda » et « get_agenda_range » sont deux chaînes différentes. Deux
 * exécutions pour un seul appel, budget d'itérations épuisé, et le garde de
 * répétition rompant un tour dont la donnée était complète depuis le premier
 * appel — sur l'une des questions les plus banales du matin.
 *
 * ⚠️ LE GARDE N'A PAS ÉTÉ TOUCHÉ. Ce n'est pas lui qu'on corrige : c'est la
 * clé qu'il consulte. Un garde qui compare les mauvais objets n'est pas trop
 * strict, il est aveugle.
 */

import { describe, expect, it } from "vitest";

import { canoniserAppel } from "@/services/jarvis-capacites";

describe("canoniserAppel — le vrai nom, et les vrais arguments", () => {
  it("ramène un alias à sa capacité cible", () => {
    expect(canoniserAppel("get_agenda", { du: "2026-09-07", au: "2026-09-08" }).nom).toBe(
      "get_agenda_range",
    );
    expect(canoniserAppel("get_next_appointment", {}).nom).toBe("get_next_patient");
    expect(canoniserAppel("search_patient", { q: "x" }).nom).toBe("search_patients");
    expect(canoniserAppel("get_patient_summary", { id: "u" }).nom).toBe("get_patient_context");
  });

  it("laisse un nom réel intact", () => {
    const r = canoniserAppel("get_today_agenda", { jour: "2026-09-07" });
    expect(r.nom).toBe("get_today_agenda");
    expect(r.args).toEqual({ jour: "2026-09-07" });
  });

  it("traduit AUSSI les arguments — sinon le trou se rouvre par eux", () => {
    // `{date_from,date_to}` et `{du,au}` sont le même appel : sans la
    // traduction, ils formeraient deux clés et la déduplication échouerait
    // encore, cette fois par les arguments plutôt que par le nom.
    const a = canoniserAppel("get_agenda", { date_from: "2026-09-07", date_to: "2026-09-08" });
    const b = canoniserAppel("get_agenda_range", { du: "2026-09-07", au: "2026-09-08" });
    expect(a.nom).toBe(b.nom);
    expect(a.args).toEqual(b.args);
  });

  it("LE CAS MESURÉ : get_agenda et get_agenda_range deviennent une seule clé", () => {
    const bornes = { du: "2026-09-07T00:00:00+01:00", au: "2026-09-08T00:00:00+01:00" };
    const parAlias = canoniserAppel("get_agenda", bornes);
    const parNomReel = canoniserAppel("get_agenda_range", bornes);
    expect(JSON.stringify(parAlias)).toBe(JSON.stringify(parNomReel));
  });

  it("un nom inconnu traverse sans être inventé", () => {
    const r = canoniserAppel("capacite_inexistante", { a: 1 });
    expect(r.nom).toBe("capacite_inexistante");
    expect(r.args).toEqual({ a: 1 });
  });
});
