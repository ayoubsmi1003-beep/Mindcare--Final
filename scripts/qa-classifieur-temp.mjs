#!/usr/bin/env node
/**
 * qa-classifieur-temp — VERDICT DETERMINISTE DU CLASSIFIEUR D'EGRESS. TEMPORAIRE.
 *
 * ⚠️ ZERO modèle, ZÉRO base, ZÉRO réseau. Importe l'artefact compilé de
 * l'ARBRE COURANT (`.eval-out/server/egress/classification.js`, produit par le
 * mécanisme d'eval du dépôt) et applique `classerCharge` exactement comme la
 * passerelle `jarvis-chat` l'applique — sur la charge entière, `recu = null`.
 *
 * Ce fichier ne conclut rien sur la qualité d'une réponse : il prouve
 * seulement QUI passe la frontière et QUI est bloqué, et par quel motif.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const m = require(path.join(RACINE, ".eval-out/server/egress/classification.js"));

const SYSTEME = "Tu es l'assistant. Tu peux lire un dossier, une consultation, un traitement.";

/** Reproduit la forme réelle : système (hors scan personne) + voix utilisateur. */
const charge = (message) => [
  { role: "system", content: SYSTEME },
  { role: "user", content: message },
];

const CONTROLES = [
  ["Qui vient aujourd'hui ?", "question d'agenda SANS aucune identité"],
  ["Qui est mon prochain patient ?", "question d'agenda SANS aucune identité"],
  ["Quelle heure est-il ?", "générique, aucun signal"],
  ["Bonjour.", "générique"],
  ["Combien j'ai encaissé aujourd'hui ?", "finance agrégée, sans nom"],
  ["Explique-moi la différence entre anxiété et trouble panique.", "connaissance"],
  ["Qui vient après Karim ?", "nom RÉEL après un verbe clinique (doit bloquer)"],
  ["Ouvre son dossier.", "référence pronominale sans identité (doit bloquer)"],
  ["Montre-moi le dossier de Karim Djilali.", "nom complet (doit bloquer)"],
];

console.log("CONTROLES — verdict du classifieur (0 modèle, 0 réseau)\n");
let fauxPositifs = 0;
for (const [phrase, note] of CONTROLES) {
  const v = m.classerCharge(charge(phrase), null);
  const bloque = v.decision === "BLOQUER";
  // Un faux positif = bloqué alors qu'AUCUNE identité n'est présente.
  const sansIdentite = !/Karim|son dossier/i.test(phrase);
  const faux = bloque && sansIdentite;
  if (faux) fauxPositifs += 1;
  console.log(
    `${bloque ? "BLOQUER    " : "AUTORISER  "} ${String(v.classe).padEnd(7)} ${String(v.motif).padEnd(26)} ` +
      `${faux ? "*** FAUX POSITIF *** " : ""}« ${phrase} »`,
  );
  console.log(`           └ ${note}`);
}
console.log(`\nFAUX POSITIFS DÉTECTÉS : ${fauxPositifs} / ${CONTROLES.length}`);
