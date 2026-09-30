import { describe, expect, it } from "vitest";
import { segmenterVoix } from "@/shared/jarvis/segments-voix";

describe("French/Arabic local speech segments", () => {
  it("preserves every character and routes mixed scripts to their local voices", () => {
    const text = "Bonjour. واش عندي اليوم؟ Merci بزاف.";
    const segments = segmenterVoix(text);
    expect(segments.map((s) => s.texte).join("")).toBe(text);
    expect(segments.map((s) => s.langue)).toEqual(["fr", "ar", "fr", "ar"]);
  });
  it("numbers and punctuation do not cause new voices or discard text", () => {
    expect(segmenterVoix("الساعة 14:30.")).toEqual([{ texte: "الساعة 14:30.", langue: "ar" }]);
    expect(segmenterVoix("Séance à 14:30.")).toEqual([{ texte: "Séance à 14:30.", langue: "fr" }]);
  });
});
