#!/usr/bin/env node
/**
 * `docs/electron.icon.svg` → `build-ressources/icon.ico` — §I du plan (étape 9).
 *
 * ═══ POURQUOI UN SCRIPT, ET PAS UN .ICO DÉPOSÉ À LA MAIN ═══════════════════
 *
 * L'icône de l'application est un LIVRABLE VISUEL : c'est ce que la
 * praticienne voit dans le menu Démarrer, dans la barre des tâches, dans
 * l'écran de l'installateur et dans le panneau de désinstallation de Windows.
 * Un `.ico` déposé à la main est un binaire opaque dont plus personne ne sait,
 * six mois plus tard, de quelle source il vient ni s'il est à jour. Ici la
 * SOURCE est `docs/electron.icon.svg`, unique et versionnée, et ce script est
 * la seule façon d'en dériver le binaire : si le SVG change, une commande
 * régénère l'icône, et rien d'autre n'est à toucher.
 *
 * Le `.ico` produit EST committé (`build-ressources/` est hors du `build/`
 * ignoré par git, précisément pour ça) : empaqueter ne doit pas exiger
 * Chromium sur la machine de build.
 *
 * ═══ POURQUOI CHROMIUM POUR LE RENDU ═══════════════════════════════════════
 *
 * Le SVG fait 7,9 Mio et contient des images matricielles en base64 sous
 * filtres (`feColorMatrix`) et masques. Les convertisseurs SVG légers
 * (rasterisation « pure vecteur ») rendent ces cas faux ou vides. Chromium
 * est DÉJÀ présent dans le dépôt via Playwright (les mesures au navigateur
 * s'en servent) : c'est le moteur qui affichera l'application, donc celui dont
 * le rendu fait foi. Aucune dépendance nouvelle.
 *
 * ═══ FORMAT ═══════════════════════════════════════════════════════════════
 *
 * ICO multi-tailles, chaque image encodée en PNG (Windows Vista et plus le
 * lit nativement ; c'est aussi ce que produit electron-builder lui-même).
 * 16 → 256 px : Windows choisit la taille selon le contexte, et une seule
 * taille laisserait le système rééchantillonner, ce qui se voit.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(RACINE, "docs", "electron.icon.svg");
const CIBLE = path.join(RACINE, "build-ressources", "icon.ico");

const TAILLES = [16, 24, 32, 48, 64, 128, 256];

/** ICONDIR + ICONDIRENTRY[] + charges PNG concaténées. */
function assemblerIco(images) {
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0); // réservé
  entete.writeUInt16LE(1, 2); // type 1 = icône
  entete.writeUInt16LE(images.length, 4);

  const entrees = Buffer.alloc(16 * images.length);
  let decalage = entete.length + entrees.length;

  images.forEach(({ taille, png }, i) => {
    const b = i * 16;
    // 256 s'écrit 0 : le champ fait un octet, et 256 est sa valeur convenue.
    entrees.writeUInt8(taille === 256 ? 0 : taille, b + 0);
    entrees.writeUInt8(taille === 256 ? 0 : taille, b + 1);
    entrees.writeUInt8(0, b + 2); // palette : aucune (couleurs vraies)
    entrees.writeUInt8(0, b + 3); // réservé
    entrees.writeUInt16LE(1, b + 4); // plans
    entrees.writeUInt16LE(32, b + 6); // bits par pixel (RGBA)
    entrees.writeUInt32LE(png.length, b + 8);
    entrees.writeUInt32LE(decalage, b + 12);
    decalage += png.length;
  });

  return Buffer.concat([entete, entrees, ...images.map((i) => i.png)]);
}

/**
 * Le SVG est INJECTÉ EN LIGNE dans la page, jamais référencé par `<img
 * src="file://…">` : une page construite par `setContent` a une origine
 * opaque, et Chromium refuse alors de charger une ressource `file://`. Le
 * symptôme aurait été une icône entièrement transparente — un échec MUET.
 * En ligne, le SVG est du DOM comme un autre, et ses `width`/`height` sont
 * surchargés pour épouser exactement la taille demandée.
 */
const svgSource = readFileSync(SOURCE, "utf8");

const navigateur = await chromium.launch();
try {
  const page = await navigateur.newPage();
  const images = [];

  for (const taille of TAILLES) {
    await page.setViewportSize({ width: taille, height: taille });
    await page.setContent(
      `<!doctype html><html><body style="margin:0;background:transparent">${svgSource}</body></html>`,
      { waitUntil: "load" },
    );
    await page.evaluate((px) => {
      const svg = document.querySelector("svg");
      if (!(svg instanceof SVGSVGElement)) throw new Error("SVG absent de la page");
      svg.setAttribute("width", String(px));
      svg.setAttribute("height", String(px));
      svg.style.display = "block";
    }, taille);
    const png = await page.screenshot({ omitBackground: true, type: "png" });
    images.push({ taille, png });
  }

  mkdirSync(path.dirname(CIBLE), { recursive: true });
  const ico = assemblerIco(images);
  writeFileSync(CIBLE, ico);
  console.log(
    `icône écrite : ${path.relative(RACINE, CIBLE)} — ${TAILLES.join(", ")} px, ${ico.length} octets`,
  );
} finally {
  await navigateur.close();
}
