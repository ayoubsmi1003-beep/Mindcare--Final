import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { consommerInvitation, enregistrerEchec, lireInvitation } from "../../electron/main/invitations";

/**
 * L'invitation d'appairage est le seul secret qui autorise un nouveau poste.
 * Trois propriétés doivent être vraies SANS exception :
 *   · elle expire ;
 *   · elle ne sert qu'une fois ;
 *   · cinq paquets invalides la détruisent.
 */
describe("invitation d'appairage — usage unique et verrou", () => {
  let dossier: string;
  let fichier: string;

  beforeEach(() => {
    dossier = mkdtempSync(path.join(tmpdir(), "mc-invitation-"));
    fichier = path.join(dossier, "clinic-invitation.json");
  });

  afterEach(() => {
    rmSync(dossier, { recursive: true, force: true });
  });

  function ecrire(valeur: Record<string, unknown>): void {
    writeFileSync(fichier, JSON.stringify(valeur));
  }

  it("lit une invitation fraîche et refuse une invitation expirée", () => {
    const maintenant = Date.now();
    ecrire({ secret: "a".repeat(24), expiresAt: maintenant + 60_000 });
    expect(lireInvitation(fichier, maintenant)).toMatchObject({ secret: "a".repeat(24), attempts: 0 });

    ecrire({ secret: "b".repeat(24), expiresAt: maintenant - 1 });
    expect(lireInvitation(fichier, maintenant)).toBeUndefined();
  });

  it("refuse une invitation consommée, mal formée, ou à durée déraisonnable", () => {
    const maintenant = Date.now();
    ecrire({ secret: "c".repeat(24), expiresAt: maintenant + 60_000, consumedAt: new Date().toISOString() });
    expect(lireInvitation(fichier, maintenant)).toBeUndefined();

    ecrire({ secret: "court", expiresAt: maintenant + 60_000 });
    expect(lireInvitation(fichier, maintenant)).toBeUndefined();

    ecrire({ secret: "d".repeat(24), expiresAt: maintenant + 3_600_000 });
    expect(lireInvitation(fichier, maintenant)).toBeUndefined();
  });

  it("la consommation supprime le fichier : un rejeu ne trouve plus rien", () => {
    const maintenant = Date.now();
    ecrire({ secret: "e".repeat(24), expiresAt: maintenant + 60_000 });
    expect(lireInvitation(fichier, maintenant)).toBeDefined();
    consommerInvitation(fichier);
    expect(existsSync(fichier)).toBe(false);
    expect(lireInvitation(fichier, maintenant)).toBeUndefined();
  });

  it("cinq échecs détruisent l'invitation, quatre la laissent utilisable", () => {
    const maintenant = Date.now();
    ecrire({ secret: "f".repeat(24), expiresAt: maintenant + 60_000 });

    for (let i = 0; i < 4; i += 1) enregistrerEchec(fichier);
    expect(lireInvitation(fichier, maintenant)?.attempts).toBe(4);

    enregistrerEchec(fichier);
    expect(existsSync(fichier)).toBe(false);
  });

  it("accepte le format écrit par le script d'administration (sans compteur)", () => {
    const maintenant = Date.now();
    ecrire({ secret: "g".repeat(24), expiresAt: maintenant + 300_000 });
    expect(readFileSync(fichier, "utf8")).not.toContain("attempts");
    expect(lireInvitation(fichier, maintenant)?.attempts).toBe(0);
  });
});
