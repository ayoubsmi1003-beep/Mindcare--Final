import { afterEach, describe, expect, it, vi } from "vitest";
import type { TourVoix } from "@/shared/alexa/voice-loop";
import type { EtatConversationPublique } from "@/services/conversation";
const { voice } = vi.hoisted(() => ({ voice: { callback: null as ((event: TourVoix) => void) | null } }));
vi.mock("@/services/alexa-local", () => ({ abonnerTourVoixLocale: (callback: (event: TourVoix) => void) => { voice.callback = callback; return () => {}; }, arreterVoixLocale: () => {} }));
import { abonnerConversation, purgerContexteSession } from "@/services/conversation";
const subscriptions: (() => void)[] = [];
afterEach(() => { for (const unsubscribe of subscriptions.splice(0)) unsubscribe(); purgerContexteSession(); });
describe("voice answer conversation integration", () => {
  it("stores the same source links and patient scope as a typed answer", () => {
    let snapshot: EtatConversationPublique | undefined;
    const unsubscribe = abonnerConversation(state => { snapshot = state; });
    subscriptions.push(unsubscribe);
    const sources = [{ id: "source-id", type: "treatment" as const, label: "Traitement", version: "r7" }];
    voice.callback?.({ id: "voice-citations", texte: "Le traitement ?" });
    voice.callback?.({ id: "voice-citations", texte: "Le traitement ?", reponse: "Réponse vérifiée.", sources, patientId: "resolved-patient", persiste: true });
    expect(snapshot?.tours.at(-1)).toMatchObject({ texte: "Réponse vérifiée.", alexaSources: sources, sourcePatientId: "resolved-patient", persiste: true });
    expect(snapshot?.etat).toBe("composition"); unsubscribe();
  });
  it("closes an interrupted voice turn rather than leaving the input in envoi", () => {
    let snapshot: EtatConversationPublique | undefined;
    const unsubscribe = abonnerConversation(state => { snapshot = state; });
    subscriptions.push(unsubscribe);
    voice.callback?.({ id: "voice-stop", texte: "آخر جلسة" }); expect(snapshot?.etat).toBe("envoi");
    voice.callback?.({ id: "voice-stop", texte: "آخر جلسة", error: "interrompu", reponse: "Réponse interrompue." });
    expect(snapshot?.etat).toBe("composition"); expect(snapshot?.tours.at(-1)?.interrompu).toBe(true); unsubscribe();
  });
});
