import { describe, expect, it } from "vitest";
import { porteLexicale, porteVectorielle } from "@/server/knowledge/stockage";

describe("live knowledge RPC signatures (migrations 092/093)", () => {
  it("uses precisely the three installed lexical parameters", () => {
    expect(porteLexicale("critères", "fr", 20).args).toEqual({ p_requete: "critères", p_langue: "fr", p_limite: 20 });
  });
  it("uses precisely the two installed vector parameters", () => {
    expect(porteVectorielle("[0,1]", 20).args).toEqual({ p_embedding_json: "[0,1]", p_limite: 20 });
  });
  it("refuses historical access until its separate SQL gate exists", () => {
    expect(() => porteLexicale("x", "fr", 1, true)).toThrow();
    expect(() => porteVectorielle("[0,1]", 1, true)).toThrow();
  });
});
