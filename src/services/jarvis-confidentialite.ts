/**
 * `jarvis-confidentialite.ts` — LE PARE-FEU DÉTERMINISTE.
 *
 * Deuxième des trois couches de la frontière (§1.3 du plan) :
 *   1. PROJECTION      `jarvis-projections.ts` — ce qui n'est pas listé ne sort pas ;
 *   2. PARE-FEU        ce fichier — ce qui est connu est masqué ;
 *   3. FAIL-CLOSED     `verifierSortant()` ici, ET `assertSafe()` côté passerelle —
 *                      ce qui a échappé fait ANNULER l'appel.
 *
 * ═══ POURQUOI CE FICHIER NE RÉUTILISE PAS `_shared/pseudonymize.ts` ═══
 * Ce n'est pas un oubli, et ce n'est pas une duplication : `supabase/functions`
 * est EXCLU de `tsconfig.json` (code Deno, `npm:` et le global `Deno` n'existent
 * pas sous `moduleResolution: "bundler"`). `src/` ne peut donc pas l'importer,
 * et forcer le passage créerait un fichier que ni `tsc` ni eslint ne couvrent.
 *
 * Surtout, les deux ne font PAS la même chose, et les confondre serait le vrai
 * défaut : `pseudonymize` frappe des jetons `P1`, `P2` régénérés à chaque appel,
 * sans mémoire ; ici on substitue les jetons STABLES de `CarteIdentite`, ceux
 * que le modèle doit pouvoir citer en retour (`{{PATIENT_001}}`) et que le
 * sidecar sait résoudre. Deux mécanismes, deux rôles, aucun recouvrement.
 *
 * ═══ RÉPARTITION DES DEUX GARDES FAIL-CLOSED, ET SA RAISON ═══
 * Le garde côté CLIENT (`verifierSortant`) connaît les identités du cabinet :
 * il vérifie les NOMS. Le garde côté PASSERELLE (`assertSafe`) ne les connaît
 * pas : il vérifie les MOTIFS (téléphone, e-mail).
 *
 * ⚠️ ET C'EST DÉLIBÉRÉ QUE LA PASSERELLE NE LES CONNAISSE PAS. Lui transmettre
 * la liste des noms du cabinet pour qu'elle puisse vérifier leur absence
 * reviendrait à METTRE LES NOMS DANS LA CHARGE pour prouver que les noms n'y
 * sont pas. Les deux gardes sont complémentaires précisément parce qu'aucun des
 * deux n'exige qu'une identité franchisse la frontière.
 *
 * ⚠️ CE QUE CE FICHIER NE PRÉTEND PAS FAIRE. Un pare-feu déterministe est
 * exhaustif sur ce qu'il CONNAÎT. Une praticienne peut écrire dans une note un
 * surnom que le dossier ne porte pas ; aucune substitution ne le rattrapera.
 * C'est pourquoi la couche 1 (liste blanche) est la défense principale et
 * celle-ci la seconde. Écrire l'inverse serait sur-déclarer une garantie, et
 * une garantie fausse empêche la relecture suivante de la remettre en cause.
 */

import type { CarteIdentite } from "./jarvis-identite";

/**
 * Levée quand une donnée identifiante est détectée dans une charge SORTANTE.
 *
 * ⚠️ NE PORTE JAMAIS LA VALEUR FAUTIVE — ni dans le message, ni dans une
 * propriété. La journaliser recréerait dans les logs la fuite que cette classe
 * existe pour empêcher. Le message ne porte que le FAIT et la CLASSE.
 */
export class FuiteDetectee extends Error {
  constructor(readonly classe: "identite" | "telephone" | "courriel") {
    super(`frontiere:fuite:${classe}`);
    this.name = "FuiteDetectee";
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1 · MOTIFS INCONDITIONNELS — vrais sans connaître aucun dossier
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Mobile algérien. Le même motif que `assertSafe` côté passerelle, et il doit
 * le rester : deux définitions du « numéro de téléphone » divergeraient, et
 * celle qui est trop laxiste gagnerait en silence.
 *
 * Il attrape aussi le numéro d'un TIERS cité dans une note — quelqu'un qui
 * n'est dans aucune liste d'identités, et que la couche 2 ne pourrait pas
 * connaître autrement.
 */
const MOTIF_TELEPHONE = /\b0[5-7]\d{8}\b/g;

/** Fixe algérien (021…, 041…) — absent d'`assertSafe`, ajouté ici. */
const MOTIF_FIXE = /\b0[1-4]\d{7,8}\b/g;

/** International : +213…, 00213… */
const MOTIF_INTERNATIONAL = /(?:\+|00)213\s?\d[\d\s.-]{7,}/g;

const MOTIF_COURRIEL = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

const REMPLACEMENT = "[retiré]";

/**
 * Retire les motifs identifiants d'un texte, sans connaître aucun dossier.
 * S'applique à TOUTE feuille textuelle qui franchit, y compris celles qu'aucune
 * liste d'identités ne couvre.
 */
export function retirerMotifs(texte: string): string {
  return texte
    .replace(MOTIF_INTERNATIONAL, REMPLACEMENT)
    .replace(MOTIF_TELEPHONE, REMPLACEMENT)
    .replace(MOTIF_FIXE, REMPLACEMENT)
    .replace(MOTIF_COURRIEL, REMPLACEMENT);
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · SUBSTITUTION PAR JETONS — ce qui est connu est masqué
// ═══════════════════════════════════════════════════════════════════════════

/** Minuscules et sans accents : « Nassim » et « nassím » sont la même fuite. */
function normaliser(valeur: string): string {
  return valeur
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

function echapper(valeur: string): string {
  return valeur.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Motif d'identité à FRONTIÈRES UNICODE — le correctif du fail-closed B1,
 * trouvé au navigateur le 2026-09-03, pas par relecture.
 *
 * DEUX collisions partageaient la même cause — une comparaison en sous-chaîne
 * nue (`includes` / regex sans bornes) là où il faut une comparaison en MOT :
 *   1. Un dossier nommé « Patient » (données synthétiques, 2 dossiers) rendait
 *      `{{PATIENT_001}}` — le jeton lui-même — déclencheur de `verifierSortant`,
 *      et corrompait au passage la référence (`PATIENT_001` → `{{PATIENT_00X}}_001`).
 *      Tout tour touchant ce dossier échouait FERME, déterminisme total.
 *   2. La même sur-sensibilité guettait tout prénom court (« Ali » dans
 *      « qualité ») : un garde-fou qui refuse le cas normal n'est pas prudent,
 *      il est faux.
 *
 * ⚠️ `\b` NE SUFFIT PAS, ET CE N'EST PAS UNE PRÉFÉRENCE. `\b` est ASCII-only
 * même sous drapeau `u` : un nom commençant par une accentuée (« Élise ») n'y
 * a aucune frontière. Les gardes négatifs Unicode ci-dessous traitent lettres,
 * chiffres ET `_` comme matière de mot — le `_` protège `PATIENT_001`.
 *
 * ⚠️ MASQUE ET VÉRIFIE PARTAGENT CE MOTIF, ET C'EST LE POINT. Deux sensibilités
 * différentes rouvrent exactement ce défaut dans un sens ou dans l'autre :
 * un masque plus étroit que la vérification refait du fail-closed fantôme,
 * l'inverse laisse passer.
 */
function motifIdentite(identite: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}_])${echapper(identite)}(?![\\p{L}\\p{N}_])`, "giu");
}

/**
 * Masque dans `texte` toute identité connue de la carte, par le jeton du
 * dossier correspondant.
 *
 * ⚠️ LES PLUS LONGUES D'ABORD — `carte.identites()` les rend déjà triées, et ce
 * commentaire existe pour qu'on ne « nettoie » pas ce tri un jour. Sans lui, un
 * nom de famille court contenu dans un nom composé laisserait un résidu
 * partiel : masquer « Ali » avant « Ben Ali » rend « Ben PATIENT_001 », qui
 * porte encore la moitié de l'identité.
 *
 * ⚠️ LES IDENTITÉS DE MOINS DE TROIS CARACTÈRES SONT IGNORÉES. Un jeton posé
 * sur « Li » pseudonymiserait « quaLIté » et « déLIre » — le texte clinique
 * deviendrait illisible sans que personne ne soit mieux protégé.
 */
export function masquerIdentites(texte: string, carte: CarteIdentite): string {
  let sortie = texte;
  for (const identite of carte.identites()) {
    if (identite.length < 3) continue;
    const ref = carte.refPourIdentite(identite);
    if (ref === null) continue;
    sortie = sortie.replace(motifIdentite(identite), `{{${ref}}}`);
  }
  return sortie;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · LE PASSAGE — appliqué à TOUTE structure qui franchit
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Applique motifs + jetons à chaque FEUILLE TEXTUELLE d'une structure.
 *
 * ⚠️ FEUILLE PAR FEUILLE, JAMAIS SUR LE JSON SÉRIALISÉ. Traiter la chaîne JSON
 * entière casserait au premier nom portant une apostrophe typographique ou un
 * guillemet, et casserait SILENCIEUSEMENT — en rendant un objet mal formé là où
 * on croit rendre l'original. `jarvis-chat/index.ts` a déjà payé cette leçon
 * avec `rehydraterProfond` ; on ne la repaie pas.
 *
 * ⚠️ LES CLÉS D'OBJET NE SONT PAS TRAITÉES, et c'est également une leçon payée :
 * la substitution est textuelle et ne distingue pas une DONNÉE d'un mot de
 * STRUCTURE. Un dossier dont le prénom est « Patient » a déjà fait partir
 * `P3Id=` à la place de `patientId=`. Les clés de nos DTO sont fixes et écrites
 * par nous : elles n'ont aucune raison d'être masquées, et tout à perdre à
 * l'être.
 */
export function assainir<T>(valeur: T, carte: CarteIdentite): T {
  return assainirBrut(valeur, carte) as T;
}

function assainirBrut(valeur: unknown, carte: CarteIdentite): unknown {
  if (typeof valeur === "string") {
    // ⚠️ LES MOTIFS D'ABORD, LES JETONS ENSUITE. L'ORDRE EST LE CORRECTIF, ET
    // IL A ÉTÉ TROUVÉ EN REGARDANT UNE CHARGE RÉELLE — PAS PAR RELECTURE.
    //
    // Dans l'ordre inverse, une note contenant « nadia@example.dz » voyait
    // d'abord son PRÉNOM masqué : la chaîne devenait
    // « {{PATIENT_001}}@example.dz », qui ne correspond plus à
    // `MOTIF_COURRIEL` — `{` et `}` ne sont pas dans `[\w.+-]`. L'adresse
    // survivait donc au pare-feu, amputée de son seul morceau déjà protégé,
    // et le domaine partait en clair.
    //
    // Pire que la fuite elle-même : le CONTRÔLE passait au vert. Il cherchait
    // l'adresse ENTIÈRE, qui n'existait effectivement plus. Un test qui cherche
    // la chaîne d'origine après une substitution partielle est vert par
    // construction. C'est pourquoi `eval-jarvis-frontiere` vérifie désormais
    // aussi le DOMAINE seul, qui, lui, ne bouge pas.
    return masquerIdentites(retirerMotifs(valeur), carte);
  }
  if (Array.isArray(valeur)) {
    return valeur.map((v) => assainirBrut(v, carte));
  }
  if (typeof valeur === "object" && valeur !== null) {
    const sortie: Record<string, unknown> = {};
    for (const [cle, v] of Object.entries(valeur as Record<string, unknown>)) {
      sortie[cle] = assainirBrut(v, carte);
    }
    return sortie;
  }
  return valeur;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LE GARDE FAIL-CLOSED — la dernière chose avant le départ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * S'exécute sur la charge COMPLÈTE qui s'apprête à quitter la machine — contexte,
 * message de l'utilisatrice, résultats de capacité, tout.
 *
 * ⚠️ ÉCHOUE BRUYAMMENT, ET C'EST L'ARBITRAGE. Un tour de Jarvis qui échoue est
 * un incident mineur : la praticienne reformule, et toutes les fonctions de
 * l'application restent accessibles. Une fuite est irréversible. Le rapport
 * entre les deux coûts n'est pas discutable, donc le sens du défaut non plus.
 *
 * ⚠️ CONTRAIREMENT À `assertSafe` CÔTÉ PASSERELLE, CELUI-CI VOIT LES NOMS —
 * parce qu'il s'exécute AVANT la frontière, là où les connaître ne coûte rien.
 * C'est ce qui lui permet de vérifier ce que la passerelle ne peut pas vérifier
 * sans se faire livrer la chose même qu'elle protège (voir l'en-tête).
 */
/**
 * Les FEUILLES textuelles d'une charge — les valeurs, jamais les clés.
 *
 * Le vérifieur ci-dessous testait `JSON.stringify(charge)` ENTIER, clés
 * comprises — pendant que le masqueur les ignore (voir `assainirBrut` : les
 * clés sont notre schéma, pas des données). Dès qu'un dossier porte un nom
 * qui est aussi un mot de schéma — « Patient » et la clé `"patient"`, présente
 * dans chaque créneau — le garde refuse une charge que le masque a pourtant
 * correctement traitée. Même famille que le jeton `{{PATIENT_*}}` : comparer
 * des mots de structure à des noms de personnes, c'est confondre la carte et
 * le territoire dans les deux sens.
 */
function feuillesTextuelles(valeur: unknown, acc: string[]): string[] {
  if (typeof valeur === "string") {
    acc.push(valeur);
  } else if (Array.isArray(valeur)) {
    for (const v of valeur) feuillesTextuelles(v, acc);
  } else if (typeof valeur === "object" && valeur !== null) {
    for (const v of Object.values(valeur as Record<string, unknown>)) feuillesTextuelles(v, acc);
  }
  return acc;
}

export function verifierSortant(charge: unknown, carte: CarteIdentite): void {
  const texte = JSON.stringify(charge ?? null);
  // Identités : feuilles SEULES (voir `feuillesTextuelles`). Les motifs
  // (téléphone, courriel) restent testés sur la chaîne entière, inchangés :
  // aucune clé de notre schéma ne porte de chiffres ni d'arobase.
  const foin = feuillesTextuelles(charge, []).map((f) => normaliser(f));

  for (const identite of carte.identites()) {
    const valeur = identite.trim();
    // Trois caractères : en deçà, une « identité » est un fragment qui apparaît
    // dans des mots ordinaires, et le garde refuserait le cas normal. Un
    // garde-fou qui refuse le cas normal n'est pas prudent, il est faux.
    if (valeur.length < 3) continue;
    // Même frontière qu'au masquage (voir `motifIdentite`) : le jeton
    // `{{PATIENT_001}}` contient « patient » en sous-chaîne, et « qualité »
    // contient « ali » — ni l'un ni l'autre n'est la personne.
    const cible = motifIdentite(normaliser(valeur));
    // `motifIdentite` porte le drapeau `g` (exigé par `replace` au masquage) :
    // un `test()` répété sur le même objet reprendrait au `lastIndex` précédent
    // et raterait la feuille suivante. On réarme à chaque feuille.
    if (
      foin.some((feuille) => {
        cible.lastIndex = 0;
        return cible.test(feuille);
      })
    )
      throw new FuiteDetectee("identite");
  }

  if (
    MOTIF_TELEPHONE.test(texte) ||
    MOTIF_FIXE.test(texte) ||
    MOTIF_INTERNATIONAL.test(texte)
  ) {
    // `lastIndex` remis à zéro : ces motifs portent le drapeau `g`, et un
    // `test()` laisse un curseur qui ferait rater la détection SUIVANTE. Défaut
    // classique, silencieux, et exactement du mauvais côté.
    reinitialiserMotifs();
    throw new FuiteDetectee("telephone");
  }
  if (MOTIF_COURRIEL.test(texte)) {
    reinitialiserMotifs();
    throw new FuiteDetectee("courriel");
  }
  reinitialiserMotifs();
}

function reinitialiserMotifs(): void {
  MOTIF_TELEPHONE.lastIndex = 0;
  MOTIF_FIXE.lastIndex = 0;
  MOTIF_INTERNATIONAL.lastIndex = 0;
  MOTIF_COURRIEL.lastIndex = 0;
}

/**
 * LE PASSAGE COMPLET, en un appel : assainir puis vérifier.
 *
 * C'est CETTE fonction que la boucle appelle, jamais `assainir` seule — et
 * l'ordre est le point : vérifier avant d'assainir lèverait sur du contenu
 * qu'on s'apprêtait justement à masquer, et assainir sans vérifier laisserait
 * passer ce que la substitution n'a pas couvert. Les deux, dans cet ordre.
 */
export function preparerPourLeModele<T>(charge: T, carte: CarteIdentite): T {
  const propre = assainir(charge, carte);
  verifierSortant(propre, carte);
  return propre;
}
