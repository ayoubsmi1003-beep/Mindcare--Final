import { describe, expect, it } from "vitest";
import { createSocket } from "node:dgram";
import { randomBytes } from "node:crypto";

import { annoncerCabinet, appairerCabinet, decouvrirCabinets } from "../../electron/main/decouverte-cabinet";

const cabinet = { id: "9b2a5a41-6f0a-4f7e-9b5d-1c2e3f4a5b6c", origin: "https://doctor-pc:43118" };

async function portLibre(): Promise<number> {
  const sonde = createSocket("udp4");
  await new Promise<void>((r) => sonde.bind(0, "127.0.0.1", r));
  const adresse = sonde.address();
  await new Promise<void>((r) => sonde.close(r));
  return adresse.port;
}

/**
 * Les trois garanties ajoutées par la migration 178 côté transport :
 *   · le code est brûlé AVANT l'envoi de la réponse (usage unique) ;
 *   · un paquet invalide est SIGNALÉ à l'appelant (compteur d'échecs) ;
 *   · le poste reçoit un jeton, une seule fois, dans la réponse scellée.
 */
describe("appairage durci — usage unique, échecs comptés, jeton de poste", () => {
  it("consomme l'invitation avant de répondre, remet un jeton, et refuse le rejeu", async () => {
    const port = await portLibre();
    const secret = randomBytes(18).toString("base64url");

    let consommee = false;
    let enregistrements = 0;
    const serveur = await annoncerCabinet(cabinet, "public-cert-test", {
      // Le contrat réel : `lireInvitation` rend `undefined` dès que le fichier
      // a été supprimé par `consommerInvitation`.
      invitation: () => (consommee ? undefined : { secret, expiresAt: Date.now() + 60_000 }),
      consommer: () => {
        consommee = true;
      },
      enregistrerAppareil: (label) => {
        enregistrements += 1;
        return { deviceId: "11111111-1111-4111-8111-111111111111", deviceToken: "A".repeat(43), label };
      },
    }, port);

    try {
      const trouves = await decouvrirCabinets(200, port, ["127.0.0.1"]);
      expect(trouves).toHaveLength(1);

      const confiance = await appairerCabinet(trouves[0]!, secret, port, 500, "PC-ACCUEIL");
      expect(confiance).toMatchObject({
        id: cabinet.id,
        origin: cabinet.origin,
        deviceId: "11111111-1111-4111-8111-111111111111",
        deviceToken: "A".repeat(43),
      });
      expect(consommee).toBe(true);
      expect(enregistrements).toBe(1);

      // Rejeu du même code : le serveur ne trouve plus d'invitation.
      await expect(appairerCabinet(trouves[0]!, secret, port, 300, "PC-ACCUEIL")).rejects.toThrow();
      expect(enregistrements).toBe(1);
    } finally {
      await new Promise<void>((r) => serveur.close(r));
    }
  });

  it("compte un paquet invalide au lieu de l'ignorer silencieusement", async () => {
    const port = await portLibre();
    const secret = randomBytes(18).toString("base64url");
    let echecs = 0;

    const serveur = await annoncerCabinet(cabinet, "public-cert-test", {
      invitation: () => ({ secret, expiresAt: Date.now() + 60_000 }),
      echec: () => {
        echecs += 1;
      },
    }, port);

    const client = createSocket("udp4");
    try {
      await new Promise<void>((r) => client.bind(0, "127.0.0.1", r));
      // Bon préfixe, mauvais chiffré : c'est exactement ce qu'un poste qui
      // devine le code enverrait.
      const faux = Buffer.concat([Buffer.from("MC-PAIR-1:"), randomBytes(80)]);
      client.send(faux, port, "127.0.0.1", () => {});
      client.send(faux, port, "127.0.0.1", () => {});

      await new Promise((r) => setTimeout(r, 250));
      expect(echecs).toBeGreaterThanOrEqual(1);
    } finally {
      await new Promise<void>((r) => client.close(r));
      await new Promise<void>((r) => serveur.close(r));
    }
  });

  it("un hôte sans jeton reste appairable (compatibilité ascendante)", async () => {
    const port = await portLibre();
    const secret = randomBytes(18).toString("base64url");
    const serveur = await annoncerCabinet(cabinet, "public-cert-test", () => ({ secret, expiresAt: Date.now() + 60_000 }), port);
    try {
      const trouves = await decouvrirCabinets(200, port, ["127.0.0.1"]);
      const confiance = await appairerCabinet(trouves[0]!, secret, port, 500);
      expect(confiance).toEqual({ ...cabinet, certificate: "public-cert-test" });
      expect(confiance.deviceToken).toBeUndefined();
    } finally {
      await new Promise<void>((r) => serveur.close(r));
    }
  });
});
