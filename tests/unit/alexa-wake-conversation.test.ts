/**
 * "Alexa" in standby hands the whole exchange to the voice conversation and
 * takes the detector back when it ends. The detector is a scripted fake (the
 * real Vosk spotter is proven in tests/integration/alexa-wake-real.test.ts).
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  armerReveil,
  conversationVoixEnCours,
  desarmerReveil,
  etatVoix,
  installerConversationVoix,
  installerDetecteur,
  signalerParole,
  type DetecteurReveil,
} from "@/services/jarvis-reveil";
import { ok } from "@/services/result";

function detecteurScripte() {
  const journal: string[] = [];
  let reveil: () => void = () => {};
  const d: DetecteurReveil = {
    nom: "scripte",
    disponible: async () => true,
    demarrer: async (surReveil) => { reveil = surReveil; return ok(true); },
    suspendre: () => { journal.push("suspendre"); },
    reprendre: () => { journal.push("reprendre"); },
    arreter: () => { journal.push("arreter"); },
  };
  return { d, journal, dire: () => reveil() };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

afterEach(() => { installerConversationVoix(null); desarmerReveil(); installerDetecteur(null); });

describe("wake word → conversation handoff", () => {
  it("opens the conversation, keeps the detector suspended during it, and resumes it after", async () => {
    const s = detecteurScripte();
    let fin!: () => void;
    let ouvertures = 0;
    installerConversationVoix(() => { ouvertures++; return new Promise<void>((r) => { fin = r; }); });
    installerDetecteur(s.d);
    expect((await armerReveil({ onCommande: async () => {} })).ok).toBe(true);
    expect(etatVoix()).toBe("veille");

    s.dire(); await flush();
    expect(ouvertures).toBe(1);
    expect(conversationVoixEnCours()).toBe(true);
    expect(s.journal.at(-1)).toBe("suspendre");

    // A second "Alexa" (or Alexa's own voice) during the conversation opens nothing.
    s.dire(); await flush();
    expect(ouvertures).toBe(1);
    // The conversation's own playback does not hand the speaker back to the wake machine.
    signalerParole();
    expect(etatVoix()).toBe("veille");

    fin(); await flush();
    expect(conversationVoixEnCours()).toBe(false);
    expect(s.journal.at(-1)).toBe("reprendre");
  });

  it("a conversation that fails still gives the detector back", async () => {
    const s = detecteurScripte();
    installerConversationVoix(async () => { throw new Error("capture"); });
    installerDetecteur(s.d);
    await armerReveil({ onCommande: async () => {} });
    s.dire(); await flush();
    expect(conversationVoixEnCours()).toBe(false);
    expect(s.journal.at(-1)).toBe("reprendre");
  });
});
