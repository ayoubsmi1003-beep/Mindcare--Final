/**
 * `route.ts` - LE RUNID M03 RESTE UNE CORRELATION CLIENTE OPAQUE.
 *
 * NOTE D'ENCODAGE : fichier volontairement ASCII-only (francais sans accents).
 *
 * Lecture de source (precedent `jarvis-intentions-route.test.ts`) : le `runId`
 * de tour est valide a la frontiere puis ignore par ailleurs. Il ne devient
 * JAMAIS un `sessionToken` (audit 028 : un `sessionToken` est aleatoire par
 * appel et ne correle rien), n'entre dans aucune decision, et `external-call`
 * ne le connait pas.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const route = readFileSync(
  join(process.cwd(), "src/app/api/jarvis/jarvis-chat/route.ts"),
  "utf8",
);
const egress = readFileSync(
  join(process.cwd(), "src/server/egress/external-call.ts"),
  "utf8",
);
const boucle = readFileSync(
  join(process.cwd(), "src/services/jarvis-boucle.ts"),
  "utf8",
);

describe("runId : valide a la frontiere, sans effet de bord", () => {
  it("le corps accepte un runId opaque borne, refuse l'informe", () => {
    expect(route).toContain("const runId = (v as { runId?: unknown }).runId;");
    expect(route).toContain("runId.length <= 80");
  });

  it("le runId de tour n'est jamais promu sessionToken", () => {
    // UN SEUL `sessionToken: runId` existe : le classifieur NLU M01, dont le
    // run_id est deja le sessionToken par conception documentee. L'appel
    // raisonnement (chemin patient) garde son aleatoire par appel.
    expect(route.match(/sessionToken: runId/g)?.length ?? 0).toBe(1);
    expect(route).toContain("sessionToken: crypto.randomUUID()");
    // Le runId de tour (champ `runId` du corps) n'alimente aucun sessionToken.
    expect(route).not.toMatch(/sessionToken:[^;]*corps[^;]*runId/);
  });

  it("external-call ne connait pas runId (singularite inchangee)", () => {
    expect(egress).not.toContain("runId");
  });
});

describe("boucle : un runId par tour, porte par le transport", () => {
  it("le bilan porte runId + snapshots, plus traceId", () => {
    expect(boucle).toContain("readonly runId: string;");
    expect(boucle).toContain("readonly snapshots: readonly ContextSnapshot[];");
    expect(boucle).not.toContain("traceId");
  });

  it("le transport boucle envoie runId avec chaque appel", () => {
    expect(boucle).toContain("clientTurnId: appelId,");
    expect(boucle).toContain("runId,");
  });
});
