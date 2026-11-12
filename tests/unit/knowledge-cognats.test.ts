import { describe, expect, it } from "vitest";
import { cognatAnglais } from "@/server/knowledge/cognats";

describe("the English spelling of a French clinical word, only when the English books contain it", () => {
  it("turns the French ending into the English one", () => {
    for (const [french, english] of [
      ["myocardite", "myocarditis"], ["agranulocytose", "agranulocytosis"], ["akathisie", "akathisia"], ["priapisme", "priapism"],
      ["thyroide", "thyroid"], ["prolactine", "prolactin"], ["epilepsie", "epilepsy"], ["hepatotoxicite", "hepatotoxicity"],
      ["cardiaque", "cardiac"], ["hyperglycemie", "hyperglycemia"], ["cataracte", "cataract"], ["tyramine", "tyramine"],
    ] as const) expect(cognatAnglais(french), french).toBe(english);
  });
  it("invents nothing the books lack, and leaves short everyday words alone", () => {
    for (const word of ["place", "grave", "passe", "abime", "traitement", "contre", "zzzzzite"]) expect(cognatAnglais(word), word).toBeUndefined();
  });
});
