/**
 * `jarvis-egress-charge-tableau.test.ts` - M09-B, isolement du texte utilisateur.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents),
 * comme `jarvis-egress-classification.test.ts`.
 *
 * Defaut demontre (M09 live) : les appelants de production passent le TABLEAU
 * brut `[{role,content}...]` a `classerCharge()`, mais `extraireScanUtilisateur()`
 * n'isolait le texte utilisateur que pour les charges `{messages:[...]}`.
 * Resultat : le prompt systeme etait scanne comme texte utilisateur et son
 * vocabulaire clinique declenchait R4 (`c1:nom-ancre`) sur chaque demande C4.
 *
 * Contrat epingle ici, sans rien affaiblir :
 * - systeme exclu des heuristiques de personne, jamais du global R1/R2/R6 ;
 * - user ET assistant (historique rejoue, potentiellement rehydrate) scannes ;
 * - jetons, identifiants, agregats sans recu : inchanges ;
 * - aucun texte non-systeme (ou charge non-messages) : repli global fail-closed.
 */
import { describe, expect, it } from "vitest";

import { classerCharge } from "../../src/server/egress/classification";
import { PROMPT_CONNAISSANCE } from "../../src/app/api/jarvis/jarvis-chat/prompt";
import { KARIM } from "../fixtures/patients";

type Role = "system" | "user" | "assistant";

function tableau(...messages: ReadonlyArray<{ readonly role: Role; readonly content: string }>): unknown {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function verdictDe(charge: unknown): { readonly decision: string; readonly classe: string; readonly motif: string } {
  const v = classerCharge(charge, null);
  return { decision: v.decision, classe: v.classe, motif: v.motif };
}

describe("M09-B isolement - tableau brut, systeme non suspect", () => {
  it("systeme + bonjour passe en C4", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: "Bonjour !" },
    ));
    expect(v.decision).toBe("AUTORISER");
    expect(v.classe).toBe("C4");
  });

  it("systeme + question de savoir passe en C4", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: "Explique-moi le trouble panique." },
    ));
    expect(v.decision).toBe("AUTORISER");
    expect(v.classe).toBe("C4");
  });

  it("systeme seul reste bloque (aucun texte utilisateur : repli global)", () => {
    const v = verdictDe(tableau({ role: "system", content: PROMPT_CONNAISSANCE }));
    expect(v.decision).toBe("BLOQUER");
  });
});

describe("M09-B isolement - le texte utilisateur reste scanne", () => {
  it("nom complet en user bloque, meme avec systeme", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: "Karim Djilali consulte aujourd'hui." },
    ));
    expect(v.decision).toBe("BLOQUER");
  });

  it("telephone en user bloque, meme avec systeme", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: "Rappelle-moi au 0551234567 demain." },
    ));
    expect(v.decision).toBe("BLOQUER");
  });

  it("UUID en user bloque, meme avec systeme", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: `Ouvre le dossier ${KARIM.id}.` },
    ));
    expect(v.decision).toBe("BLOQUER");
  });

  it("jeton en user bloque, meme avec systeme", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: "Resume le cas de {{PATIENT_001}}." },
    ));
    expect(v.decision).toBe("BLOQUER");
  });

  it("numero de dossier en user bloque, meme avec systeme", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: `Ouvre le dossier ${KARIM.numeroDossier} s'il te plait.` },
    ));
    expect(v.decision).toBe("BLOQUER");
  });
});

describe("M09-B isolement - l'historique rejoue reste scanne", () => {
  it("nom reel dans un tour assistant bloque (texte rehydrate)", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: "Bonjour !" },
      { role: "assistant", content: `Le dossier de ${KARIM.libelle} est a jour.` },
    ));
    expect(v.decision).toBe("BLOQUER");
  });

  it("historique benign + question C4 passe", () => {
    const v = verdictDe(tableau(
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user", content: "Bonjour !" },
      { role: "assistant", content: "Bonjour, que puis-je pour vous ?" },
      { role: "user", content: "Explique-moi le trouble panique." },
    ));
    expect(v.decision).toBe("AUTORISER");
    expect(v.classe).toBe("C4");
  });
});

describe("M09-B isolement - malforme reste fail-closed", () => {
  it("entrees malformees portant un signal bloquent (repli global)", () => {
    const v = verdictDe([
      { role: "system", content: PROMPT_CONNAISSANCE },
      { role: "user" },
      { nimporte: "Karim Djilali consulte aujourd'hui." },
    ]);
    expect(v.decision).toBe("BLOQUER");
  });

  it("tableau vide sans signal : rien a fuir, repli global C4", () => {
    const v = verdictDe([]);
    expect(v.decision).toBe("AUTORISER");
    expect(v.classe).toBe("C4");
  });
});
