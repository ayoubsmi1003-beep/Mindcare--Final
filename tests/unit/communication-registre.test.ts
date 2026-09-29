/**
 * Registre d'outils Communication + garde egress Composio.
 * Sans réseau : fetch global substitué, base absente (journal best-effort).
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { reinitialiserEnv } from "../../src/server/env";
import { appelComposio } from "../../src/server/egress/external-call";
import {
  capaciteConnue,
  exigeApprobation,
  OUTILS_COMMUNICATION,
} from "../../src/server/communication/registre-outils";

describe("registre fermé", () => {
  it("ne contient que du composio, chaque entrée déclare ses gardes", () => {
    expect(OUTILS_COMMUNICATION.length).toBeGreaterThan(0);
    for (const o of OUTILS_COMMUNICATION) {
      expect(o.provider).toBe("composio");
      // Rien n'est activé par défaut : chaque capacité porte son périmètre,
      // son approbation, son audit et son idempotence.
      expect(o.approbationRequise !== undefined).toBe(true);
      expect(o.evenementAudit.length).toBeGreaterThan(0);
      expect(o.idempotence.length).toBeGreaterThan(0);
      // Résolution sans devinette : toute capacité réseau porte ≥1 motif.
      if (o.toolkit !== "local") expect(o.motifs.length).toBeGreaterThan(0);
    }
  });

  it("connaît instagram (compte connecté) avec publication approuvée", () => {
    expect(capaciteConnue("instagram.envoyer_reponse")).toBe(true);
    expect(exigeApprobation("instagram.publier")).toBe(true);
  });

  it("refuse les slugs inconnus et exige l'approbation pour publier", () => {
    expect(capaciteConnue("outil.inexistant")).toBe(false);
    expect(capaciteConnue("whatsapp.envoyer_texte")).toBe(true);
    expect(exigeApprobation("facebook.publier")).toBe(true);
    expect(exigeApprobation("whatsapp.envoyer_texte")).toBe(false);
  });
});

describe("garde egress composio", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.COMPOSIO_API_KEY;
    delete process.env.MINDCARE_DATABASE_URL;
    reinitialiserEnv();
  });

  it("bloque une charge à signal patient SANS appel réseau", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    const appels: unknown[] = [];
    vi.stubGlobal("fetch", async (...args: unknown[]) => {
      appels.push(args);
      return new Response(JSON.stringify({ id: "wamid.x" }), { status: 200 });
    });
    const resultat = await appelComposio({
      outil: "whatsapp.envoyer_texte",
      charge: { texte: "Bonjour Karim, rappel 0612345678" },
      cleIdempotence: "comm:c:1",
      sessionToken: "00000000-0000-4000-8000-000000000000",
    });
    expect(resultat.ok).toBe(false);
    if (!resultat.ok) expect(resultat.error.code).toBe("frontiere");
    expect(appels).toHaveLength(0);
  });

  it("laisse passer une charge générique (fetch moqué)", async () => {
    process.env.MINDCARE_DATABASE_URL = "postgresql://test";
    process.env.COMPOSIO_API_KEY = "cle-test";
    reinitialiserEnv();
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ id: "wamid.x" }), { status: 200 });
    });
    const resultat = await appelComposio({
      outil: "whatsapp.envoyer_texte",
      charge: { texte: "Le cabinet sera ouvert samedi matin." },
      cleIdempotence: "comm:c:2",
      sessionToken: "00000000-0000-4000-8000-000000000001",
    });
    expect(resultat.ok).toBe(true);
  });
});
