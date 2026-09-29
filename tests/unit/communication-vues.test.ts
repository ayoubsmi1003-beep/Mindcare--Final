/**
 * Filtre de vue des conversations — jamais une protection (cf. MessagesPieces).
 */
import { describe, expect, it } from "vitest";

import { filtrerConversations } from "../../src/components/MessagesPieces";
import type { ResumeConversation } from "../../src/services/communication/types";

function fabrique(
  id: string,
  canal: "whatsapp" | "facebook" | "instagram",
  etat: ResumeConversation["etatHandoff"],
): ResumeConversation {
  return {
    id,
    canal,
    etatHandoff: etat,
    patientId: null,
    dernierMessageA: "2026-09-29T10:00:00Z",
    clotureA: null,
  };
}

const lot: readonly ResumeConversation[] = [
  fabrique("a", "whatsapp", "AI_HANDLING"),
  fabrique("b", "facebook", "HUMAN_REQUIRED"),
  fabrique("c", "whatsapp", "HUMAN_HANDLING"),
  fabrique("d", "facebook", "RESOLVED"),
  fabrique("e", "instagram", "AI_HANDLING"),
];

describe("filtrerConversations", () => {
  it("rend tout sur tous", () => {
    expect(filtrerConversations(lot, "tous")).toHaveLength(5);
  });

  it("sépare les canaux", () => {
    expect(filtrerConversations(lot, "whatsapp").map((c) => c.id)).toEqual(["a", "c"]);
    expect(filtrerConversations(lot, "facebook").map((c) => c.id)).toEqual(["b", "d"]);
    expect(filtrerConversations(lot, "instagram").map((c) => c.id)).toEqual(["e"]);
  });

  it("non traités = humain explicitement requis", () => {
    expect(filtrerConversations(lot, "non_traites").map((c) => c.id)).toEqual(["b"]);
  });

  it("humain requis = requis + pris en charge", () => {
    expect(filtrerConversations(lot, "humain_requis").map((c) => c.id)).toEqual(["b", "c"]);
  });
});
