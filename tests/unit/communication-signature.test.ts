/**
 * Signature webhook — HMAC-SHA256 du corps brut, comparaison constante.
 * Sans secret configuré : le routeur exige déjà une session (fail-closed).
 */
import { describe, expect, it } from "vitest";

import { signerCharge, verifierSignatureWebhook } from "../../src/server/communication/signature";

describe("signature webhook", () => {
  it("accepte une signature valide", () => {
    const corps = '{"canal":"whatsapp"}';
    const sig = signerCharge("secret-test", corps);
    expect(verifierSignatureWebhook("secret-test", corps, sig)).toBe(true);
  });

  it("refuse un corps altéré, une signature étrangère, un secret vide", () => {
    const sig = signerCharge("secret-test", '{"canal":"whatsapp"}');
    expect(verifierSignatureWebhook("secret-test", '{"canal":"facebook"}', sig)).toBe(false);
    expect(verifierSignatureWebhook("secret-test", '{"canal":"whatsapp"}', "00")).toBe(false);
    expect(verifierSignatureWebhook("", '{"canal":"whatsapp"}', sig)).toBe(false);
  });
});
