/**
 * Diagnostic des refus provider — les trois refus RÉELS rencontrés le
 * 2026-09-29 doivent être classés honnêtement, pas confondus avec une panne.
 */
import { describe, expect, it } from "vitest";

import {
  classerRefusProvider,
  messageRefusProvider,
} from "../../src/server/communication/diagnostic-refus";

describe("classerRefusProvider", () => {
  it("reconnaît la fenêtre 24 h Meta (subcode 2534022)", () => {
    const corps = {
      message:
        "Failed to send message (status 403). Response: {\"error\":{\"message\":\"This message is sent outside of allowed window.\",\"type\":\"IGApiException\",\"code\":10,\"error_subcode\":2534022}}",
    };
    expect(classerRefusProvider(403, corps)).toBe("fenetre");
  });

  it("reconnaît le refus d'autorisation Meta (WABA/Graph 100-33)", () => {
    const corps = {
      error: {
        message:
          "Unsupported get request. Object with ID '2458085234677347' does not exist, cannot be loaded due to missing permissions.",
        type: "GraphMethodException",
        code: 100,
        error_subcode: 33,
      },
    };
    expect(classerRefusProvider(400, corps)).toBe("autorisation");
  });

  it("reconnaît un destinataire ou un gabarit refusé", () => {
    expect(classerRefusProvider(400, { error: { message: "Invalid template name" } })).toBe("cible");
  });

  it("classe 5xx/429 en transitoire (le seul cas qui mérite un rejouement)", () => {
    expect(classerRefusProvider(503, null)).toBe("transitoire");
    expect(classerRefusProvider(429, null)).toBe("transitoire");
  });

  it("ne laisse rien passer en « inconnu » quand le corps est vide", () => {
    expect(classerRefusProvider(null, null)).toBe("inconnu");
  });
});

describe("messageRefusProvider", () => {
  it("n'invite pas à réessayer quand réessayer ne sert à rien", () => {
    const autorisation = messageRefusProvider("autorisation");
    expect(autorisation).toContain("mode Live");
    expect(autorisation.toLowerCase()).not.toContain("réessayez");
  });

  it("distingue la fenêtre d'un refus d'autorisation", () => {
    expect(messageRefusProvider("fenetre")).toContain("24 heures");
    expect(messageRefusProvider("fenetre")).not.toBe(messageRefusProvider("autorisation"));
  });

  it("ne prétend jamais qu'un envoi a eu lieu", () => {
    for (const famille of ["fenetre", "autorisation", "cible", "transitoire", "inconnu"] as const) {
      // Un refus peut CONTRADIRE l'envoi (« aucun message n'a été envoyé »),
      // ce qui est honnête. Ce qu'il ne doit jamais faire, c'est l'affirmer.
      expect(messageRefusProvider(famille)).not.toMatch(/message (a été )?envoyé/i);
      expect(messageRefusProvider(famille)).not.toMatch(/^Message envoyé/i);
    }
  });
});
