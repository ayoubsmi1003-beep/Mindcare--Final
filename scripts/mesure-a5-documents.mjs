#!/usr/bin/env node
/**
 * mesure-a5-documents — LE PAPIER A5, MESURÉ. Pas supposé.
 *
 *   node scripts/mesure-a5-documents.mjs
 *
 * ⚠️ CE QU'IL MESURE, ET SUR QUOI.
 *
 * Il ne recompose RIEN. Le HTML qu'il met en page est le `rendered_html` FIGÉ
 * par `app.issue_document` dans la base jetable `v8fresh` — le même octet que
 * celui qui partirait à l'imprimante. Écrire ici une substitution en
 * JavaScript pour « simuler » un certificat créerait une seconde vérité, qui
 * divergerait un jour du moteur de 030 sans que rien ne le signale : c'est
 * exactement la faute que `FeuilleDocument.tsx` refuse de commettre, et un
 * instrument de mesure n'a pas le droit d'être plus laxiste que le produit.
 *
 * La feuille de style est celle du BUILD (`.next/static/css`), servie avec ses
 * fontes auto-hébergées. Mesurer contre `tokens.css` lu au disque laisserait
 * dehors ce que Tailwind produit réellement, et les fontes tomberaient sur des
 * substituts système — dont les métriques ne sont pas celles de Newsreader.
 *
 * ⚠️ IL NE REMPLACE PAS LE TIRAGE PAPIER, et aucun de ses verts ne vaut
 * approbation physique. Il répond à trois questions, pas davantage :
 *   · la page composée fait-elle bien 148 × 210 mm ?
 *   · le certificat tient-il sur UNE page, réserve de signature comprise ?
 *   · reste-t-il un marqueur au format moustache sur ce qui serait imprimé ?
 *
 * PRÉALABLE : `bash scripts/checkpoint-v8-documents.sh` (qui crée `v8fresh` et
 * y émet les quatre certificats) et `pnpm build`.
 */

import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { chromium } from "playwright";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PREUVES = path.join(RACINE, "checkpoints", "v8-preuves");
const CONTENEUR = process.env["SUPABASE_DB_CONTAINER"] ?? "supabase_db_Final_Mindcare";
const BASE = process.env["V8_DB"] ?? "v8fresh";

// ── Les constantes du papier. Elles doivent rester la SEULE définition de A5
//    dans ce fichier : les recalculer ailleurs ferait diverger deux vérités.
const MM_PAR_PX = 25.4 / 96; // 1 px CSS = 1/96 pouce, par définition du CSS.
const A5 = { largeur: 148, hauteur: 210 };
const MARGE = { v: 13, h: 14 }; // doit refléter --doc-marge-* de tokens.css
const UTILE = {
  largeur: A5.largeur - 2 * MARGE.h, // 120 mm
  hauteur: A5.hauteur - 2 * MARGE.v, // 184 mm
};

let echecs = 0;
let n = 0;
const controle = (titre, ok, detail) => {
  n += 1;
  process.stdout.write(
    `${String(n).padEnd(2)} ${titre.padEnd(58)} ${ok ? "VERT " : "ROUGE"}  ${detail ?? ""}\n`,
  );
  if (!ok) echecs += 1;
};
const releve = (titre, detail) =>
  process.stdout.write(`   relevé | ${titre.padEnd(55)} | ${detail}\n`);

// ---------------------------------------------------------------------------
// 1 · Les pièces, telles que la BASE les a figées
// ---------------------------------------------------------------------------
function psql(sql) {
  return execFileSync(
    "docker",
    [
      "exec", "-i", CONTENEUR, "psql", "-U", "postgres", "-d", BASE,
      "-qtAX", "-v", "ON_ERROR_STOP=1", "-c", sql,
    ],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
}

// ⚠️ LES VALEURS HOSTILES SONT ÉMISES PAR LA BASE, PAS INJECTÉES DANS LE HTML.
// Un nom long collé à la main dans `rendered_html` ne passerait pas par
// `html_escape`, et mesurerait une mise en page que le produit ne produit pas.
// Le patient est une FIXTURE de base JETABLE (règle 8) : rien de tout ceci ne
// touche l'instance du cabinet, et `v8fresh` est recréée à chaque checkpoint.
const OWNER = "00000000-0000-0000-0000-0000000000a1";
const PAT_H = "00000000-0000-0000-0000-0000000000b9";
const CAB = "00000000-0000-0000-0000-000000000001";

function preparerHostile() {
  // Le cumul de ce qui casse une colonne de 120 mm : longueur, accents,
  // apostrophes, traits d'union insécables de fait, et un 29 février.
  // ⚠️ `is_synthetic = true` N'EST PAS UNE FORMALITÉ : `assert_synthetic_when_cloud`
  // (ADR-016) REFUSE l'insertion sans lui tant que le déploiement est « cloud-dev ».
  // Le garde a effectivement bloqué la première version de cette fixture. Le
  // renseigner ici, c'est dire la vérité — ce patient EST fictif ; le contourner
  // aurait été poser une donnée qui se fait passer pour réelle.
  psql(
    "INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number, first_name, last_name, phone, sex, birth_date, is_synthetic) " +
      `VALUES ('${PAT_H}', '${CAB}', '${OWNER}', 'PAT-HOSTILE', ` +
      "'Abdelkrim-Mohammed Chérif El-Hadj', 'BENABDERRAHMANE-BOUMEDIENE', '0000000000', 'M', '1948-02-29', true) " +
      "ON CONFLICT (id) DO UPDATE SET first_name = EXCLUDED.first_name, " +
      "last_name = EXCLUDED.last_name, sex = EXCLUDED.sex, birth_date = EXCLUDED.birth_date, " +
      "is_synthetic = true;",
  );

  // Un profil réaliste-LONG : sur A5 c'est l'en-tête qui se serre le premier,
  // et le nom arabe complet est plus large que le « الدكتورة » du checkpoint.
  psql(
    "UPDATE app.profiles SET full_name = 'LARBI-BENSALEM Nadjet Yasmine', title = 'Dr', " +
      "speciality_fr = 'Médecin Spécialiste en Psychiatrie et Psychothérapie', " +
      "speciality_ar = 'طبيبة مختصة في الأمراض النفسية العقلية والعصبية', " +
      "order_number = '16/16780', phone = '0554813911', " +
      `signature_block = '{"full_name_ar": "الدكتورة العربي بن سالم نجاة ياسمين"}'::jsonb ` +
      `WHERE id = '${OWNER}';`,
  );

  const asOwner = `SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='${OWNER}';`;
  const emettre = (type, vars) =>
    psql(
      `${asOwner} SELECT app.issue_document('${PAT_H}', '${type}', '${vars.replace(/'/g, "''")}');`,
    ).trim();

  return {
    bonne_sante_mentale: emettre(
      "bonne_sante_mentale",
      JSON.stringify({
        id_document_number: "109887654321000/2019",
        mairie: "Sidi M'Hamed, Wilaya d'Alger",
      }),
    ),
    suivi_medical: emettre(
      "suivi_medical",
      // 365 : le plus long « en toutes lettres » du domaine 1–999 côté jours.
      JSON.stringify({ jours: "365", jours_lettres: "ignoré", date_debut: "29/02/2024" }),
    ),
    // 045 · v2 : DEUX lignes de traitement, toutes deux remplies ET longues —
    // c'est le pire cas de hauteur pour ce modèle. Le cas où `traitement_2` est
    // VIDE est éprouvé par le checkpoint, qui sait lire le HTML en base ; ici on
    // mesure une mise en page, donc on la charge au maximum.
    certificat_medical: emettre(
      "certificat_medical",
      JSON.stringify({
        date_naissance: "29/02/1948",
        traitement_1:
          "Rispéridone 2 mg — 1 comprimé le matin et 1 comprimé le soir, au cours du repas",
        traitement_2:
          "Sertraline 50 mg — 1 comprimé le matin à jeun, contrôle biologique mensuel",
      }),
    ),
    justification: emettre("justification", JSON.stringify({ date_consultation: "14/07/2026" })),
  };
}

// ---------------------------------------------------------------------------
// 2 · Un serveur minuscule : la CSS du build ET ses fontes auto-hébergées
// ---------------------------------------------------------------------------
// Les fontes sont référencées par `/_next/static/media/…` depuis la feuille de
// style. Ouvrir la page en `file://` les ferait tomber sur un substitut système,
// dont les métriques ne sont pas celles de Newsreader : la mesure porterait
// alors sur une mise en page que personne n'imprimera jamais.
const CSS_DIR = path.join(RACINE, ".next", "static", "css");
const feuilles = readdirSync(CSS_DIR)
  .filter((f) => f.endsWith(".css"))
  .map((f) => `/_next/static/css/${f}`);

const TYPES_MIME = {
  ".css": "text/css",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".js": "text/javascript",
};

function pageHarnais(html) {
  // `doc-racine` + `ecran-cache` : EXACTEMENT le portail d'impression de
  // /documents. Mesurer une feuille posée hors du portail mesurerait une mise
  // en page que la règle `body > *:not(.doc-racine)` n'imprime pas.
  return (
    '<!doctype html><html lang="fr"><head><meta charset="utf-8">\n' +
    feuilles.map((f) => `<link rel="stylesheet" href="${f}">`).join("\n") +
    '\n</head><body><div class="doc-racine ecran-cache">' +
    `<article class="doc-feuille doc-corps">${html}</article></div></body></html>`
  );
}

function servir(pages) {
  return createServer((req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);

    if (url.startsWith("/_next/static/")) {
      const fichier = path.join(RACINE, ".next", url.slice("/_next/".length));
      try {
        if (!statSync(fichier).isFile()) throw new Error("dossier");
        res.writeHead(200, {
          "content-type": TYPES_MIME[path.extname(fichier)] ?? "application/octet-stream",
        });
        res.end(readFileSync(fichier));
        return;
      } catch {
        res.writeHead(404).end();
        return;
      }
    }
    if (url === "/marque-certificat.svg") {
      res.writeHead(200, { "content-type": "image/svg+xml" });
      res.end(readFileSync(path.join(RACINE, "public", "marque-certificat.svg")));
      return;
    }
    const html = pages.get(url);
    if (html === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(html);
  });
}

// ---------------------------------------------------------------------------
// 3 · La mesure
// ---------------------------------------------------------------------------
mkdirSync(PREUVES, { recursive: true });

process.stdout.write("MESURE A5 — les quatre certificats, sur données hostiles\n\n");

let ids;
try {
  ids = preparerHostile();
} catch (e) {
  process.stdout.write(
    `BLOQUÉ — base ${BASE} injoignable ou fixture refusée.\n${String(e).slice(0, 400)}\n`,
  );
  process.stdout.write("Rejouer d'abord : bash scripts/checkpoint-v8-documents.sh\n");
  process.exit(2);
}

const pages = new Map();
const cas = [];
for (const [type, id] of Object.entries(ids)) {
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    process.stdout.write(`BLOQUÉ — émission refusée pour ${type} : ${id.slice(0, 300)}\n`);
    process.exit(2);
  }
  const html = psql(`SELECT rendered_html FROM app.documents WHERE id = '${id}';`);
  pages.set(`/${type}`, pageHarnais(html));
  cas.push({ type, html });
}

const serveur = servir(pages);
await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
const port = serveur.address().port;

const navigateur = await chromium.launch();
const contexte = await navigateur.newContext();
const page = await contexte.newPage();

for (const c of cas) {
  process.stdout.write(`\n── ${c.type} ──────────────────────────────────────────\n`);

  // ── L'INVARIANT DE SORTIE, sur la pièce elle-même ────────────────────────
  const marqueurs = c.html.match(/\{\{[^{}]*\}\}/g) ?? [];
  controle(
    "zéro marqueur non résolu sur la pièce",
    marqueurs.length === 0,
    marqueurs.length === 0 ? "" : `${marqueurs.length} : ${[...new Set(marqueurs)].join(" ")}`,
  );

  await page.goto(`http://127.0.0.1:${port}/${c.type}`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  // ⚠️ LA FENÊTRE EST RAMENÉE À LA ZONE IMPRIMABLE — 120 × 184 mm — ET C'EST
  // LA CORRECTION D'UN INSTRUMENT QUI MENTAIT. En média `print`, `.doc-feuille`
  // passe en `width: auto` : elle prend la largeur de SA FENÊTRE, pas celle du
  // papier. Mesurée dans la fenêtre par défaut de 1280 px, la colonne faisait
  // 339 mm de large — donc moins de lignes, donc une hauteur trop flatteuse, et
  // « tient sur une A5 » sortait VERT sur un certificat que le PDF paginait sur
  // DEUX pages. Le désaccord entre les deux contrôles est ce qui a révélé le
  // défaut : c'est le PDF qui avait raison, parce que lui seul paginait pour de
  // bon. Ne pas remettre une fenêtre plus large « pour voir la feuille en
  // entier » — la mesure redeviendrait fausse dans le sens rassurant.
  await page.setViewportSize({
    width: Math.round(UTILE.largeur / MM_PAR_PX),
    height: Math.round(UTILE.hauteur / MM_PAR_PX),
  });
  // `emulateMedia('print')` applique les règles @media print : la feuille perd
  // son ombre, son arrondi et sa largeur imposée. C'est l'état exact dans
  // lequel l'imprimante la prend.
  await page.emulateMedia({ media: "print" });

  const m = await page.evaluate(() => {
    const f = document.querySelector(".doc-feuille");
    const e = document.querySelector(".doc-entete");
    const r = document.documentElement;
    return {
      hauteur: f.getBoundingClientRect().height,
      hauteurEntete: e === null ? 0 : e.getBoundingClientRect().height,
      // Le débordement se lit sur l'ÉCART entre ce qui déborde et ce qui tient,
      // pas sur une largeur absolue : c'est la seule forme qui reste juste quel
      // que soit le format de la fenêtre.
      debordement: Math.max(r.scrollWidth - r.clientWidth, f.scrollWidth - f.clientWidth),
    };
  });

  const hMm = m.hauteur * MM_PAR_PX;
  const feuillets = Math.max(1, Math.ceil(hMm / UTILE.hauteur - 0.001));

  controle(
    "tient sur UNE feuille A5",
    feuillets === 1,
    `${hMm.toFixed(1)} mm / ${UTILE.hauteur} mm utiles`,
  );
  controle(
    "aucun débordement horizontal",
    m.debordement <= 0,
    `${(m.debordement * MM_PAR_PX).toFixed(1)} mm hors colonne`,
  );
  releve("hauteur de l'en-tête", `${(m.hauteurEntete * MM_PAR_PX).toFixed(1)} mm`);
  releve("blanc restant sous la réserve de signature", `${(UTILE.hauteur - hMm).toFixed(1)} mm`);

  // ── LE PDF : la seule preuve qui porte VRAIMENT le format de page ─────────
  // La mesure DOM ci-dessus dit la hauteur du contenu ; elle ne dit rien de
  // `@page { size: A5 }`, qui n'est lu qu'au moment de la pagination. Sans ce
  // PDF, une régression remettant `size: A4` passerait tous les verts.
  const pdf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
  const brut = pdf.toString("latin1");
  const boite = /MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(brut);
  const feuilletsPdf = (brut.match(/\/Type\s*\/Page[^s]/g) ?? []).length;

  if (boite === null) {
    controle("le PDF déclare un format de page", false, "MediaBox introuvable");
  } else {
    // PDF : 1 pt = 1/72 pouce. A5 = 419,53 × 595,28 pt.
    const lPt = (Number(boite[1]) * 25.4) / 72;
    const hPt = (Number(boite[2]) * 25.4) / 72;
    controle(
      "@page rend bien du 148 × 210 mm (A5)",
      Math.abs(lPt - A5.largeur) < 1 && Math.abs(hPt - A5.hauteur) < 1,
      `${lPt.toFixed(1)} × ${hPt.toFixed(1)} mm`,
    );
  }
  controle("le PDF ne contient qu'UNE page", feuilletsPdf === 1, `${feuilletsPdf} page(s)`);

  writeFileSync(path.join(PREUVES, `a5-${c.type}.pdf`), pdf);

  // ⚠️ LA CAPTURE RESTE EN MÉDIA `print`. Le harnais monte la feuille dans le
  // portail `.doc-racine.ecran-cache`, que `tokens.css` masque À L'ÉCRAN — une
  // capture en média `screen` rendait une image entièrement VIDE, et une preuve
  // vide qu'on ne regarde pas est pire qu'une preuve absente.
  await page.screenshot({ path: path.join(PREUVES, `a5-${c.type}.png`), fullPage: true });
}

// ---------------------------------------------------------------------------
// 4 · LE CONTRÔLE NÉGATIF — la preuve que cet instrument SAIT rougir
// ---------------------------------------------------------------------------
// ⚠️ SANS LUI, LES VINGT VERTS CI-DESSUS NE VALENT RIEN. Un détecteur de
// marqueurs qui n'a jamais vu de marqueur est indiscernable d'un détecteur qui
// ne cherche pas — c'est la leçon des trois faux verdicts de la session
// précédente, où un instrument prenait une erreur pour une valeur.
//
// On vide donc `signature_block` — l'état RÉEL de l'instance du cabinet au
// 2026-08-22, §7 de STATE.md — puis on émet. La base doit rendre un certificat
// portant le marqueur `praticien.full_name_ar` EN TOUTES LETTRES : c'est le
// comportement voulu de 030 §1quater, et c'est exactement le papier que l'écran
// doit refuser d'imprimer. Ce contrôle est VERT quand le trou est bien là.
process.stdout.write("\n── contrôle négatif : profil incomplet ─────────────────\n");

psql(`UPDATE app.profiles SET signature_block = '{}'::jsonb WHERE id = '${OWNER}';`);
const asOwnerNeg = `SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='${OWNER}';`;
const idTroue = psql(
  `${asOwnerNeg} SELECT app.issue_document('${PAT_H}', 'justification', ` +
    `'{"date_consultation":"14/07/2026"}');`,
).trim();
const htmlTroue = psql(`SELECT rendered_html FROM app.documents WHERE id = '${idTroue}';`);
const trouves = htmlTroue.match(/\{\{[^{}]*\}\}/g) ?? [];

controle(
  "un profil incomplet produit BIEN un marqueur littéral",
  trouves.includes("{{praticien.full_name_ar}}"),
  trouves.length === 0 ? "aucun marqueur — le détecteur ne prouve rien" : trouves.join(" "),
);
controle(
  "…et le détecteur de l'écran le voit",
  htmlTroue.includes("{{"),
  "contientMarqueurNonResolu() rend true → impression refusée",
);

await navigateur.close();
serveur.close();

process.stdout.write("\n");
process.stdout.write(
  echecs === 0
    ? "VERDICT : VERT AU NAVIGATEUR — les 4 certificats tiennent sur une A5.\n"
    : `VERDICT : ROUGE — ${echecs} contrôle(s) en échec.\n`,
);
process.stdout.write(
  "\n⚠️  VERT AU NAVIGATEUR N'EST PAS VERT SUR PAPIER. Ce script mesure ce que\n" +
    "    Chromium compose ; il ne dit rien des marges non imprimables du bac A5,\n" +
    "    ni de la mise à l'échelle appliquée par le pilote. Le tirage reste dû.\n",
);
process.exit(echecs === 0 ? 0 : 1);
