import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Les libellés de l'écran d'appairage vivent dans un fichier copié tel quel
 * dans le paquet (`electron-builder.yml`, `extraResources`). Une clé absente ne
 * casse rien : elle produit un bouton VIDE, et l'utilisatrice se retrouve
 * devant une fenêtre sans issue — exactement le défaut que l'on corrige.
 *
 * Ce test est la seule chose qui empêche cette régression de passer : il est
 * volontairement explicite plutôt que déduit du code, parce qu'une clé retirée
 * du JSON doit être une décision, pas un effet de bord.
 */
const messages = JSON.parse(
  readFileSync(path.resolve(process.cwd(), "src", "i18n", "cabinet-desktop.fr.json"), "utf8"),
) as Record<string, string>;

const ECRAN_APPAIRAGE = [
  "search",
  "searchHelp",
  "searchCount",
  "searchAgain",
  "missing",
  "found",
  "retry",
  "prepare",
  "hostButton",
  "hostHelp",
  "hostConfirmTitle",
  "hostConfirmBody",
  "hostConfirmDetail",
  "hostConfirmYes",
  "hostConfirmNo",
  "thisComputerName",
  "invitationLabel",
  "pairButton",
  "pairHelp",
  "manualTitle",
  "manualLabel",
  "manualButton",
  "manualHelp",
  "manualInvalid",
  "manualSearch",
  "manualNotFound",
  "diagnosticButton",
  "diagnosticTitle",
  "diagnosticFound",
  "diagnosticNone",
  "diagnosticHint",
  "preparingClinic",
  "preparingClinicDetail",
  "waitingClinic",
  "waitingClinicDetail",
  "reconnecting",
  "appareilRevoque",
  "trustInvalid",
  "close",
];

const ECRAN_REPRISE = [
  "startingLocal",
  "localUnavailable",
  "retryLocal",
  "retryButton",
  "openLogs",
  "reconnectStation",
  "reconnectConfirmTitle",
  "reconnectConfirmBody",
  "reconnectConfirmDetail",
  "clinicUnreachable",
  "clinicUnreachableDetail",
  "hostUnreachable",
  "hostUnreachableDetail",
];

const DIALOGUE_INVITATION = [
  "inviteMenu",
  "quit",
  "invitationTitle",
  "invitationBefore",
  "invitationAfter",
  "invitationComputerName",
  "invitationFailed",
  "installationRefuseeTitre",
  "installationRefusee",
];

describe("libellés du poste de travail", () => {
  it("fournit chaque texte de l'écran d'appairage", () => {
    for (const cle of ECRAN_APPAIRAGE) {
      expect(typeof messages[cle], cle).toBe("string");
      expect(messages[cle]!.trim().length, cle).toBeGreaterThan(0);
    }
  });

  it("fournit chaque texte des écrans d'attente et de reprise", () => {
    for (const cle of ECRAN_REPRISE) {
      expect(typeof messages[cle], cle).toBe("string");
      expect(messages[cle]!.trim().length, cle).toBeGreaterThan(0);
    }
  });

  it("fournit chaque texte du dialogue d'invitation", () => {
    for (const cle of DIALOGUE_INVITATION) {
      expect(typeof messages[cle], cle).toBe("string");
      expect(messages[cle]!.trim().length, cle).toBeGreaterThan(0);
    }
  });

  it("garde les marqueurs remplacés par le code", () => {
    // `bureau-cabinet.ts` remplace ces jetons : sans eux, l'écran afficherait
    // « Recherche {n} sur {total} » littéralement.
    expect(messages.searchCount).toContain("{n}");
    expect(messages.searchCount).toContain("{total}");
    expect(messages.thisComputerName).toContain("{nom}");
    expect(messages.invitationComputerName).toContain("{nom}");
  });

  it("ne promet pas DPAPI pour le jeton de poste", () => {
    // La documentation a déjà menti une fois sur ce point (voir
    // docs/deploiement-cabinet.md). Un test coûte moins cher qu'une fausse
    // garantie de sécurité affichée à une praticienne.
    const doc = readFileSync(path.resolve(process.cwd(), "docs", "deploiement-cabinet.md"), "utf8");
    expect(doc).not.toMatch(/conservé chiffré par Windows \(DPAPI\)/i);
  });
});
