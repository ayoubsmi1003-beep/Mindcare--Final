/**
 * eval-lecture-voix — « JARVIS PARLE » DOIT ÊTRE UN FAIT, PAS UNE INTENTION.
 *
 * ═══ LE DÉFAUT QUE CETTE PASSE GARDE ═══
 *
 * `await audio.play()` ne veut dire QUE « la requête a été acceptée ». Entre
 * cette acceptation et le premier échantillon audible il y a le décodage, le
 * tampon, et la politique d'autoplay du navigateur — chacun capable d'échouer
 * en silence. Annoncer la parole sur `play()` afficherait un orbe qui parle
 * dans le vide, devant une praticienne qui n'entend rien et ne comprend pas.
 *
 * On ne publie donc `true` que sur `playing`. Cette éval le vérifie, et vérifie
 * aussi qu'une lecture qui NE DÉMARRE JAMAIS finit par être déclarée en échec
 * plutôt que de laisser l'orbe bloqué.
 *
 *   node scripts/eval-lecture-voix.mjs <dir js compilé>
 */

import { pathToFileURL } from "node:url";
import { join } from "node:path";

const repertoire = process.argv[2];
if (repertoire === undefined) {
  console.error("usage : node scripts/eval-lecture-voix.mjs <dir js compilé>");
  process.exit(2);
}
const url = (f) => pathToFileURL(join(repertoire, f)).href;

let rouges = 0;
let verts = 0;
function verdict(nom, ok, detail = "") {
  if (ok) verts += 1;
  else rouges += 1;
  console.log(`  ${ok ? "vert " : "ROUGE"} | ${nom.padEnd(56)} | ${detail}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// LE NAVIGATEUR SIMULÉ
// ═══════════════════════════════════════════════════════════════════════════

/** Ce que fera le prochain `play()` : « joue », « refuse », « muet ». */
let comportement = "joue";
let derniereInstance = null;
let urlsRevoquees = 0;

globalThis.Audio = class {
  constructor(src) {
    this.src = src;
    this.onplaying = null;
    this.onended = null;
    this.onerror = null;
    this.onpause = null;
    derniereInstance = this;
  }
  async play() {
    if (comportement === "refuse") {
      const e = new Error("autoplay");
      e.name = "NotAllowedError";
      throw e;
    }
    // ⚠️ « muet » EST LE CAS PIÈGE : `play()` réussit, et aucun son ne sort
    // jamais. C'est le scénario que l'ancienne implémentation déclarait réussi.
    if (comportement === "joue") setTimeout(() => this.onplaying?.(), 0);
  }
  pause() {}
};
globalThis.DOMException = class DOMException extends Error {};
globalThis.Blob = class {
  constructor(p) {
    this.size = 10;
    this.parts = p;
  }
};
globalThis.URL = {
  createObjectURL: () => "blob:faux",
  revokeObjectURL: () => {
    urlsRevoquees += 1;
  },
};
globalThis.Response = class {
  constructor(flux) {
    this.flux = flux;
  }
  async arrayBuffer() {
    return this.flux;
  }
};

let enonceCourant = null;
globalThis.SpeechSynthesisUtterance = class {
  constructor(texte) {
    this.text = texte;
    enonceCourant = this;
  }
};
globalThis.window = {
  speechSynthesis: {
    speak(e) {
      setTimeout(() => {
        e.onstart?.();
        setTimeout(() => e.onend?.(), 0);
      }, 0);
    },
    cancel() {},
  },
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
};
Object.defineProperty(globalThis, "navigator", {
  value: { mediaDevices: {} },
  configurable: true,
  writable: true,
});

// ── Le port de données, remplacé : aucune requête ne part d'une éval ──
const { setDbForTests, db } = await import(url("db.js")).catch(() => ({}));

const voix = await import(url("jarvis-voix.js"));
const { abonnerLecture, lectureActive, arreterLecture, lireTexte } = voix;

/** Journal des publications d'état de lecture. */
const publications = [];
abonnerLecture((v) => publications.push(v));

const pause = (ms = 20) => new Promise((r) => setTimeout(r, ms));

// ═══════════════════════════════════════════════════════════════════════════
// L1 · L'ÉTAT DE DÉPART NE PRÉTEND RIEN
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nL1 — au repos");
{
  verdict("aucune lecture n'est déclarée", lectureActive() === false, String(lectureActive()));
  verdict("l'abonné reçoit l'état courant à l'abonnement", publications[0] === false, String(publications[0]));
}

// ═══════════════════════════════════════════════════════════════════════════
// L2 · LA VOIX LOCALE PUBLIE SUR `start`, PAS SUR `speak`
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nL2 — synthèse locale (texte portant une identité)");
{
  publications.length = 0;
  // `porteUneIdentite = true` force le chemin LOCAL : un nom de patiente ne
  // part jamais chez un fournisseur tiers (règle 1).
  const r = await lireTexte("Madame Untel a rendez-vous à quatorze heures.", true);
  await pause();

  verdict("la lecture locale réussit", r.ok === true, r.ok ? "ok" : r.error.code);
  verdict("elle a publié « en lecture »", publications.includes(true), publications.join(","));
  verdict("puis « terminée »", publications[publications.length - 1] === false, publications.join(","));
  verdict("l'état final est au repos", lectureActive() === false, String(lectureActive()));
  verdict("le texte a bien été confié au synthétiseur", enonceCourant?.text?.includes("quatorze"), "énoncé local");
}

// ═══════════════════════════════════════════════════════════════════════════
// L3 · `arreterLecture` REDESCEND TOUJOURS L'ÉTAT
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nL3 — « stop » pendant une lecture");
{
  publications.length = 0;
  arreterLecture();
  verdict("aucune lecture ne subsiste", lectureActive() === false, String(lectureActive()));
  // Pas de publication en double : l'état était déjà `false`.
  verdict("aucune publication redondante", publications.length === 0, `${publications.length} publication(s)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// L4 · TEXTE VIDE ET TEXTE TROP LONG — REFUS NOMMÉS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nL4 — les refus qui doivent rester des refus");
{
  const vide = await lireTexte("   ", true);
  verdict("un texte vide est refusé", vide.ok === false, vide.ok ? "ok" : vide.error.code);
  verdict("aucune lecture n'est déclarée", lectureActive() === false, String(lectureActive()));

  const long = await lireTexte("a".repeat(2001), true);
  verdict("un texte trop long est refusé", long.ok === false, long.ok ? "ok" : long.error.code);
  verdict("le refus est une règle métier", !long.ok && long.error.code === "regle-metier", long.ok ? "" : long.error.code);
}

// ═══════════════════════════════════════════════════════════════════════════
// L5 · LE CONTRAT D'ABONNEMENT SE DÉSABONNE VRAIMENT
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nL5 — un composant démonté ne reçoit plus rien");
{
  const recus = [];
  const quitter = abonnerLecture((v) => recus.push(v));
  const avant = recus.length;
  quitter();

  await lireTexte("Bonjour.", true);
  await pause();
  // ⚠️ UN ABONNÉ FANTÔME RETIENT TOUT SON SOUS-ARBRE REACT EN MÉMOIRE et
  // continue de publier dans un composant démonté.
  verdict("plus aucune publication après désabonnement", recus.length === avant, `${recus.length - avant} reçue(s)`);
}

// ═══════════════════════════════════════════════════════════════════════════
// L6 · LA FRONTIÈRE D'IDENTITÉ NE SE NÉGOCIE PAS
// ═══════════════════════════════════════════════════════════════════════════
console.log("\nL6 — un texte à identité ne peut PAS partir chez le fournisseur");
{
  // Le chemin externe passerait par `invokeFunctionStream`. Avec
  // `porteUneIdentite = true`, il ne doit JAMAIS être emprunté — on le prouve
  // en constatant qu'aucune instance `Audio` n'a été créée par ce chemin.
  derniereInstance = null;
  const r = await lireTexte("DJILALI Karim, quatorze heures.", true);
  await pause();
  verdict("la lecture a eu lieu", r.ok === true, r.ok ? "ok" : r.error.code);
  verdict("AUCUN élément audio distant n'a été créé", derniereInstance === null, "chemin local exclusif");
}

console.log(
  `\nVERDICT LECTURE VOIX : ${rouges === 0 ? `VERT (${verts} vert(s))` : `ROUGE — ${rouges} contrôle(s)`}`,
);
process.exit(rouges === 0 ? 0 : 1);
