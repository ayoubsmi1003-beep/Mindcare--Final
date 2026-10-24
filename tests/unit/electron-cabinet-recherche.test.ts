import { describe, expect, it } from "vitest";

import {
  RECHERCHES_RAPIDES,
  creerResolveur,
  delaiEntreRecherches,
  fenetreRecherche,
  nomHoteValide,
  proposerHote,
} from "../../electron/main/recherche-cabinet";

/**
 * L'écran d'appairage restait dix secondes sur « Recherche du cabinet… » et
 * proposait ensuite la connexion manuelle sans aucune validation. Ces tests
 * figent les trois comportements qui l'empêchent de redevenir un écran gelé :
 * la cadence courte, la décision d'hôte, et le nom saisi.
 */
describe("cadence de recherche du cabinet", () => {
  it("décide en moins de cinq secondes sur un réseau vide", () => {
    // Trois fenêtres rapides + deux pauses rapides, plus la dernière écoute.
    const total = fenetreRecherche(0) + delaiEntreRecherches(0)
      + fenetreRecherche(1) + delaiEntreRecherches(1)
      + fenetreRecherche(2);
    expect(total).toBeLessThan(5_000);
  });

  it("ralentit après la décision au lieu de marteler le réseau", () => {
    expect(fenetreRecherche(0)).toBeLessThan(fenetreRecherche(RECHERCHES_RAPIDES));
    expect(delaiEntreRecherches(0)).toBeLessThan(delaiEntreRecherches(RECHERCHES_RAPIDES));
    // Une pause lente reste bornée : un poste laissé ouvert toute une nuit ne
    // doit pas produire des milliers de paquets.
    expect(delaiEntreRecherches(1_000)).toBeLessThan(10_000);
  });

  it("ne propose « ce PC est le PC médecin » qu'après trois recherches vides", () => {
    expect(proposerHote(0, 0, false)).toBe(false);
    expect(proposerHote(RECHERCHES_RAPIDES - 1, 0, false)).toBe(false);
    expect(proposerHote(RECHERCHES_RAPIDES, 0, false)).toBe(true);
  });

  it("ne propose jamais l'hôte quand un cabinet répond ou qu'une base existe", () => {
    expect(proposerHote(RECHERCHES_RAPIDES, 1, false)).toBe(false);
    expect(proposerHote(RECHERCHES_RAPIDES, 0, true)).toBe(false);
    expect(proposerHote(50, 0, true)).toBe(false);
  });
});

describe("nom du PC médecin saisi à la main", () => {
  it("accepte un nom NetBIOS, un nom DNS et une adresse IPv4", () => {
    expect(nomHoteValide("CABINET-PC")).toBe(true);
    expect(nomHoteValide("cabinet-pc")).toBe(true);
    expect(nomHoteValide(" cabinet-pc ")).toBe(true);
    expect(nomHoteValide("cabinet-pc.clinic.local")).toBe(true);
    expect(nomHoteValide("192.168.1.42")).toBe(true);
  });

  it("refuse une URL, un chemin, un nom vide et un IPv6", () => {
    expect(nomHoteValide("")).toBe(false);
    expect(nomHoteValide("   ")).toBe(false);
    expect(nomHoteValide("https://cabinet-pc:43118")).toBe(false);
    expect(nomHoteValide("cabinet-pc/../secret")).toBe(false);
    expect(nomHoteValide("cabinet pc")).toBe(false);
    expect(nomHoteValide("-cabinet")).toBe(false);
    expect(nomHoteValide("cabinet-.local")).toBe(false);
    expect(nomHoteValide("fe80::1")).toBe(false);
    expect(nomHoteValide("a".repeat(64))).toBe(false);
  });

  it("résout un nom et rend null plutôt que de lever", async () => {
    const appels: string[] = [];
    const resoudre = creerResolveur(async (nom, options) => {
      appels.push(`${nom}:${String(options.family)}:${String(options.all)}`);
      if (nom === "cabinet-pc") return [{ address: "192.168.1.42", family: 4 }];
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    });

    await expect(resoudre("cabinet-pc")).resolves.toBe("192.168.1.42");
    await expect(resoudre("absent")).resolves.toBeNull();
    // Une saisie invalide n'atteint jamais le résolveur.
    await expect(resoudre("https://x")).resolves.toBeNull();
    expect(appels).toEqual(["cabinet-pc:4:true", "absent:4:true"]);
  });

  it("rend null si le DNS ne renvoie qu'une adresse IPv6", async () => {
    const resoudre = creerResolveur(async () => [{ address: "fe80::1", family: 6 }]);
    await expect(resoudre("cabinet-pc")).resolves.toBeNull();
  });

  it("court-circuite le DNS pour une adresse IPv4 déjà saisie", async () => {
    let appele = false;
    const resoudre = creerResolveur(async () => { appele = true; return []; });
    await expect(resoudre("192.168.1.42")).resolves.toBe("192.168.1.42");
    expect(appele).toBe(false);
  });
});
