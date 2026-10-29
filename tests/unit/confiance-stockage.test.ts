import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ChiffrementIndisponible,
  ConfianceIllisible,
  ecrireConfianceStockee,
  lireConfianceStockee,
  type Scelleur,
} from "../../electron/main/confiance-stockage";
import type { ConfianceCabinet } from "../../electron/main/decouverte-cabinet";

const dossier = (): string => mkdtempSync(path.join(tmpdir(), "mindcare-confiance-"));
const nettoyer: string[] = [];
afterEach(() => {
  for (const d of nettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

const scelleur: Scelleur = {
  disponible: () => true,
  sceller: (texte) => Buffer.from(`S:${texte}`, "utf8"),
  desceller: (donnees) => {
    const texte = donnees.toString("utf8");
    if (!texte.startsWith("S:")) throw new Error("scellement invalide");
    return texte.slice(2);
  },
};

const confiance: ConfianceCabinet = {
  id: "11111111-1111-4111-8111-111111111111",
  origin: "https://doctor.local:43118",
  certificate: "-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----",
  deviceId: "22222222-2222-4222-8222-222222222222",
  deviceToken: "A".repeat(43),
};

describe("confiance scellée du poste d'accueil", () => {
  it("lit un ancien fichier en clair et demande sa migration", () => {
    const d = dossier(); nettoyer.push(d);
    const fichier = path.join(d, "clinic-trust.json");
    writeFileSync(fichier, JSON.stringify(confiance), "utf8");

    const lu = lireConfianceStockee(fichier, scelleur);
    expect(lu?.migrer).toBe(true);
    expect(lu?.value).toEqual(confiance);
  });

  it("écrit un fichier scellé qui ne contient plus le jeton en clair", () => {
    const d = dossier(); nettoyer.push(d);
    const fichier = path.join(d, "clinic-trust.json");
    ecrireConfianceStockee(fichier, confiance, scelleur);

    const brut = readFileSync(fichier, "utf8");
    expect(brut).not.toContain(confiance.deviceToken);
    expect(brut).not.toContain("A".repeat(43));
    expect(JSON.parse(brut)).toMatchObject({ version: 2 });

    const lu = lireConfianceStockee(fichier, scelleur);
    expect(lu?.migrer).toBe(false);
    expect(lu?.value).toEqual(confiance);
  });

  it("refuse un contenu scellé corrompu au lieu de retomber sur un poste non appairé", () => {
    const d = dossier(); nettoyer.push(d);
    const fichier = path.join(d, "clinic-trust.json");
    writeFileSync(fichier, JSON.stringify({ version: 2, sealed: Buffer.from("X:pas-un-scellement").toString("base64") }), "utf8");
    expect(() => lireConfianceStockee(fichier, scelleur)).toThrow(ConfianceIllisible);
  });

  it("refuse une enveloppe de forme invalide", () => {
    const d = dossier(); nettoyer.push(d);
    const fichier = path.join(d, "clinic-trust.json");
    writeFileSync(fichier, JSON.stringify({ version: 3, sealed: "abc" }), "utf8");
    expect(() => lireConfianceStockee(fichier, scelleur)).toThrow(ConfianceIllisible);

    writeFileSync(fichier, JSON.stringify({ id: "pas-un-uuid", origin: "https://doctor.local", certificate: "x" }), "utf8");
    expect(() => lireConfianceStockee(fichier, scelleur)).toThrow(ConfianceIllisible);
  });

  it("n'écrit jamais en clair quand le chiffrement est indisponible", () => {
    const d = dossier(); nettoyer.push(d);
    const fichier = path.join(d, "clinic-trust.json");
    const indisponible: Scelleur = { ...scelleur, disponible: () => false };
    expect(() => ecrireConfianceStockee(fichier, confiance, indisponible)).toThrow(ChiffrementIndisponible);
    expect(() => readFileSync(fichier, "utf8")).toThrow();
  });

  it("ignore un demi-jeton plutôt que de le conserver comme valide", () => {
    const d = dossier(); nettoyer.push(d);
    const fichier = path.join(d, "clinic-trust.json");
    writeFileSync(fichier, JSON.stringify({ ...confiance, deviceToken: undefined }), "utf8");
    const lu = lireConfianceStockee(fichier, scelleur);
    expect(lu?.value.deviceId).toBeUndefined();
    expect(lu?.value.deviceToken).toBeUndefined();
  });

  it("ne laisse aucun fichier temporaire après une écriture", () => {
    const d = dossier(); nettoyer.push(d);
    const fichier = path.join(d, "clinic-trust.json");
    ecrireConfianceStockee(fichier, confiance, scelleur);
    expect(readdirSync(d)).toEqual(["clinic-trust.json"]);
  });

  it("rend undefined quand le fichier est absent", () => {
    const d = dossier(); nettoyer.push(d);
    expect(lireConfianceStockee(path.join(d, "absent.json"), scelleur)).toBeUndefined();
  });
});
