import { afterEach, describe, expect, it, vi } from "vitest";
import type { TourVoix } from "@/shared/alexa/voice-loop";
import type { EtatConversationPublique } from "@/services/conversation";
const { voice } = vi.hoisted(() => ({ voice: { callback: null as ((event: TourVoix) => void) | null } }));
vi.mock("@/services/alexa-local", () => ({ abonnerPropositionVoixLocale: () => () => {}, abonnerTourVoixLocale: (callback: (event: TourVoix) => void) => { voice.callback = callback; return () => {}; }, arreterVoixLocale: () => {} }));
import { abonnerConversation, idsLues, marquerTourLu, purgerContexteSession } from "@/services/conversation";
import { choisirTourAuto } from "@/services/lecture-auto";
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
  it("does not read the same live answer again after a remount, until the session is purged", () => {
    const opts = { lectureAuto: true, conversationChargee: true } as const;
    const t1 = { id: "t1", role: "jarvis" as const, texte: "Bonjour docteur." };
    const t2 = { ...t1, id: "t2", texte: "Réponse arrivée après le montage." };
    marquerTourLu("t1");
    expect(choisirTourAuto([t1, t2], new Set<string>(), idsLues(), opts)).toMatchObject({ id: "t2" });
    marquerTourLu("t2");
    expect(choisirTourAuto([t1, t2], new Set<string>(), idsLues(), opts)).toBeNull();
    purgerContexteSession();
    expect(idsLues().size).toBe(0);
    expect(choisirTourAuto([t1, t2], new Set<string>(), idsLues(), opts)).toMatchObject({ id: "t2" });
  });
});
