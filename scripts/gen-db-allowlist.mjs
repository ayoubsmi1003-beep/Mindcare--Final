#!/usr/bin/env node
/**
 * gen-db-allowlist — engendre `src/server/db/allowlist.generated.ts`.
 *
 * ═══ POURQUOI ENGENDRÉE, ET JAMAIS TENUE À LA MAIN ═════════════════════════
 *
 * `/api/db/rpc` est un proxy générique : il exécute une fonction SQL dont le nom
 * arrive dans la requête HTTP. Sans borne, c'est une console SQL ouverte sur le
 * réseau. La borne est une allowlist — mais une allowlist maintenue à la main
 * dérive : on ajoute un appel dans un service, on oublie la liste, l'écran est
 * cassé ; ou l'inverse, on retire l'appel et le nom reste ouvert pour toujours.
 * Le second cas est le dangereux, parce qu'il ne produit aucun symptôme.
 *
 * On DÉRIVE donc la liste de la seule source qui ne peut pas mentir : ce que
 * `src/services/**` appelle réellement. `preflight.sh` la régénère et échoue sur
 * toute différence — la liste ne peut donc pas être en retard sur le code, ni en
 * avance sur lui.
 *
 * ═══ CE QUI REND L'EXTRACTION TOTALE ═══════════════════════════════════════
 *
 * Un `db().rpc(nom, …)` dont le premier argument n'est pas un littéral est un
 * ÉCHEC de ce script, pas un cas ignoré. C'est la condition sans laquelle
 * l'allowlist serait « la liste des appels qu'on a su lire », ce qui n'est pas
 * une garantie. Même règle pour `relation` et `columns` d'un `select`.
 *
 * ═══ CE QUE L'ALLOWLIST N'EST PAS ══════════════════════════════════════════
 *
 * Elle n'est PAS ce qui porte la sécurité. Ce qui la porte reste la RLS, le
 * `FORCE ROW LEVEL SECURITY`, la matrice de droits et le `SELECT` révoqué
 * d'ADR-019 : un appelant qui déjouerait toute cette liste ne lirait toujours
 * pas la patiente d'une autre praticienne, et laisserait toujours une trace.
 * L'allowlist sert à refuser la reconnaissance et à rendre la surface
 * ÉNUMÉRABLE EN REVUE. Elle ne justifie l'assouplissement d'aucun droit.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Import ESM direct plutôt que `createRequire` : `node:module` est interdit par
// `no-restricted-imports` (I3), et l'exception ne se justifierait pas — l'import
// par défaut suffit, TypeScript exposant son API en CommonJS interopérable.
import ts from "typescript";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER_SERVICES = path.join(RACINE, "src", "services");
const SORTIE = path.join(RACINE, "src", "server", "db", "allowlist.generated.ts");

/** @type {string[]} */
const erreurs = [];

/** Tous les .ts de src/services, SAUF db/ (l'adaptateur, pas un appelant). */
function fichiersServices(dossier) {
  /** @type {string[]} */
  const out = [];
  for (const e of fs.readdirSync(dossier, { withFileTypes: true })) {
    const p = path.join(dossier, e.name);
    if (e.isDirectory()) {
      if (e.name === "db") continue;
      out.push(...fichiersServices(p));
    } else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) {
      out.push(p);
    }
  }
  return out;
}

/** `db()` — reconnaît l'appel de résolution du port, seul point d'entrée. */
function estAppelDb(noeud) {
  return (
    ts.isCallExpression(noeud) &&
    ts.isIdentifier(noeud.expression) &&
    noeud.expression.text === "db" &&
    noeud.arguments.length === 0
  );
}

/** Les `const X = [...]` du module, pour résoudre `columns: X`. */
function collecterConstantes(source) {
  /** @type {Map<string, string[]>} */
  const table = new Map();
  for (const stmt of source.statements) {
    if (!ts.isVariableStatement(stmt)) continue;
    for (const d of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.initializer === undefined) continue;
      let init = d.initializer;
      // `as const` et autres assertions : on descend jusqu'au tableau.
      while (ts.isAsExpression(init) || ts.isTypeAssertionExpression?.(init)) {
        init = init.expression;
      }
      if (!ts.isArrayLiteralExpression(init)) continue;
      const valeurs = init.elements.map((el) =>
        ts.isStringLiteral(el) ? el.text : null,
      );
      if (valeurs.every((v) => v !== null)) {
        table.set(d.name.text, /** @type {string[]} */ (valeurs));
      }
    }
  }
  return table;
}

/** Rend le tableau de chaînes derrière un nœud, littéral ou identifiant connu. */
function tableauDeChaines(noeud, constantes, ou) {
  let n = noeud;
  while (ts.isAsExpression(n)) n = n.expression;
  if (ts.isArrayLiteralExpression(n)) {
    const out = [];
    for (const el of n.elements) {
      if (!ts.isStringLiteral(el)) {
        erreurs.push(`${ou} : élément de tableau non littéral.`);
        return [];
      }
      out.push(el.text);
    }
    return out;
  }
  if (ts.isIdentifier(n)) {
    const v = constantes.get(n.text);
    if (v !== undefined) return v;
    erreurs.push(`${ou} : identifiant « ${n.text} » non résoluble en tableau de littéraux.`);
    return [];
  }
  erreurs.push(`${ou} : tableau attendu.`);
  return [];
}

/** Les colonnes citées dans `filters: [{ column: "x" }]` / `order: [...]`. */
function colonnesDeListe(noeud, ou) {
  let n = noeud;
  while (ts.isAsExpression(n)) n = n.expression;
  if (!ts.isArrayLiteralExpression(n)) {
    erreurs.push(`${ou} : liste littérale attendue.`);
    return [];
  }
  const out = [];
  for (const el of n.elements) {
    if (!ts.isObjectLiteralExpression(el)) {
      erreurs.push(`${ou} : objet littéral attendu.`);
      continue;
    }
    for (const p of el.properties) {
      if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
      if (p.name.text !== "column") continue;
      if (!ts.isStringLiteral(p.initializer)) {
        erreurs.push(`${ou} : « column » non littérale.`);
        continue;
      }
      out.push(p.initializer.text);
    }
  }
  return out;
}

const rpc = new Set();
/** @type {Map<string, Set<string>>} */
const relations = new Map();

for (const fichier of fichiersServices(DOSSIER_SERVICES)) {
  const texte = fs.readFileSync(fichier, "utf8");
  const source = ts.createSourceFile(fichier, texte, ts.ScriptTarget.ES2022, true);
  const constantes = collecterConstantes(source);
  const relatif = path.relative(RACINE, fichier).replace(/\\/g, "/");

  const visiter = (noeud) => {
    if (
      ts.isCallExpression(noeud) &&
      ts.isPropertyAccessExpression(noeud.expression) &&
      estAppelDb(noeud.expression.expression)
    ) {
      const methode = noeud.expression.name.text;
      const ligne = source.getLineAndCharacterOfPosition(noeud.getStart()).line + 1;
      const ou = `${relatif}:${ligne}`;

      if (methode === "rpc") {
        const premier = noeud.arguments[0];
        // LA RÈGLE QUI REND L'EXTRACTION TOTALE. Un nom calculé est refusé ici,
        // et non ignoré : une allowlist qui saute ce qu'elle ne sait pas lire
        // n'est plus une allowlist.
        if (premier === undefined || !ts.isStringLiteral(premier)) {
          erreurs.push(
            `${ou} : db().rpc() appelée avec un nom NON LITTÉRAL. ` +
              `L'allowlist ne peut pas être complète tant qu'il existe.`,
          );
        } else {
          rpc.add(premier.text);
        }
      }

      if (methode === "select") {
        const premier = noeud.arguments[0];
        let spec = premier;
        while (spec !== undefined && ts.isAsExpression(spec)) spec = spec.expression;
        if (spec === undefined || !ts.isObjectLiteralExpression(spec)) {
          erreurs.push(`${ou} : db().select() sans objet littéral.`);
        } else {
          let relation;
          /** @type {string[]} */
          let colonnes = [];
          for (const p of spec.properties) {
            if (!ts.isPropertyAssignment(p) || !ts.isIdentifier(p.name)) continue;
            const cle = p.name.text;
            if (cle === "relation") {
              if (!ts.isStringLiteral(p.initializer)) {
                erreurs.push(`${ou} : « relation » non littérale.`);
              } else {
                relation = p.initializer.text;
              }
            } else if (cle === "columns") {
              colonnes.push(...tableauDeChaines(p.initializer, constantes, `${ou} columns`));
            } else if (cle === "filters" || cle === "order") {
              // Les colonnes de filtre et de tri sont interpolées dans le SQL
              // au même titre que celles de `columns` : elles doivent donc être
              // bornées par la même liste, sinon la borne a un trou.
              colonnes.push(...colonnesDeListe(p.initializer, `${ou} ${cle}`));
            }
          }
          if (relation !== undefined) {
            const set = relations.get(relation) ?? new Set();
            for (const c of colonnes) set.add(c);
            relations.set(relation, set);
          }
        }
      }
    }
    ts.forEachChild(noeud, visiter);
  };
  visiter(source);
}

if (erreurs.length > 0) {
  console.error("gen-db-allowlist — extraction INCOMPLÈTE, rien n'a été écrit :");
  for (const e of erreurs) console.error(`  · ${e}`);
  process.exit(1);
}

if (rpc.size === 0 || relations.size === 0) {
  console.error("gen-db-allowlist — aucun appel trouvé. Le walk AST est cassé.");
  process.exit(1);
}

const nomsRpc = [...rpc].sort();
const lignesRelations = [...relations.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([rel, cols]) => `  ${JSON.stringify(rel)}: [${[...cols].sort().map((c) => JSON.stringify(c)).join(", ")}],`)
  .join("\n");

const contenu = `/**
 * ⚠️ FICHIER ENGENDRÉ — NE PAS MODIFIER À LA MAIN.
 *
 * Produit par \`scripts/gen-db-allowlist.mjs\` à partir des appels réels de
 * \`src/services/**\`. \`preflight.sh\` (contrôle 13) le régénère et échoue sur
 * toute différence : une modification manuelle sera écrasée et signalée.
 *
 * Pour ajouter une fonction ou une colonne : écrire l'appel dans le service,
 * puis relancer \`node scripts/gen-db-allowlist.mjs\`.
 *
 * Ce n'est PAS ce qui porte la sécurité — voir l'en-tête du générateur. La RLS
 * décide ; cette liste borne la surface et la rend énumérable en revue.
 */

export const RPC_AUTORISES: ReadonlySet<string> = new Set([
${nomsRpc.map((n) => `  ${JSON.stringify(n)},`).join("\n")}
]);

export const RELATIONS_AUTORISEES: Readonly<Record<string, readonly string[]>> = {
${lignesRelations}
};

/** Nombre d'entrées, pour que le contrôle de démarrage puisse le journaliser. */
export const NB_RPC = ${nomsRpc.length};
`;

const ancien = fs.existsSync(SORTIE) ? fs.readFileSync(SORTIE, "utf8") : "";
if (process.argv.includes("--check")) {
  if (ancien !== contenu) {
    console.error("gen-db-allowlist — l'allowlist engendrée DIFFÈRE du fichier commité.");
    console.error("  Relancer : node scripts/gen-db-allowlist.mjs");
    process.exit(1);
  }
  console.log(`gen-db-allowlist — à jour (${nomsRpc.length} rpc, ${relations.size} relations).`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(SORTIE), { recursive: true });
fs.writeFileSync(SORTIE, contenu, "utf8");
console.log(
  `gen-db-allowlist — ${nomsRpc.length} fonctions, ${relations.size} relations écrites dans ${path.relative(RACINE, SORTIE)}.`,
);
