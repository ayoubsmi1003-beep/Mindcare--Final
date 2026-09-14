/**
 * `normalisation.ts` — LA FRONTIÈRE D'ADR-023, RENDUE INDÉPENDANTE DE LA LANGUE
 * SANS QU'UNE SEULE DE SES RÈGLES NE CHANGE.
 *
 * ═══ LE DÉFAUT QUE CE FICHIER CORRIGE ═══
 * `routing.ts` refuse « Karim est-il dépressif ? » par `FORMES_CONCLUSIVES_
 * PERSONNELLES`. La même question en arabe — « هل كريم مكتئب؟ » — ne
 * correspondait à AUCUN motif : elle tombait au défaut `connaissance` et
 * atteignait le modèle sans refus. Mesuré, pas supposé :
 * `grep -rlP "[\x{0600}-\x{06FF}]" src/` rendait ZÉRO fichier — il n'y avait pas
 * un caractère arabe dans le code source.
 *
 * Aucune donnée de dossier ne fuyait par là (le chemin connaissance n'a ni
 * outil ni contexte). Mais l'invariant que `routing.ts` existe pour tenir —
 * AUCUN VERDICT SUR UNE PERSONNE NOMMÉE — était contourné par le simple choix
 * de la langue. Une frontière qui ne tient que dans une langue n'est pas une
 * frontière : c'est une coutume.
 *
 * ═══ LA FORME DE LA CORRECTION ═══
 *
 *   texte brut ─┬────────────────────────► classer(brut) ─────────┐
 *               │                                                 ├─► plusStrict
 *               └─► normaliserDemande() ─► classer(canonique) ─────┘
 *
 *   treillis :   refus  >  patient  >  connaissance
 *
 * ⚠️ LA PROPRIÉTÉ QUI REND CECI SÛR, ET ELLE SE LIT. `plusStrict` prend le
 * MAXIMUM sur un treillis où `refus` domine. Le résultat n'est donc JAMAIS
 * moins restrictif que `classer(brut)` seul. Ajouter une langue au lexique ne
 * peut pas OUVRIR un chemin ; au pire, elle en ferme un. C'est un coût produit
 * — une question de savoir refusée à tort — jamais un coût de sécurité. Le sens
 * du défaut est dicté par le rapport entre les deux conséquences, exactement
 * comme dans `routing.ts` lui-même.
 *
 * Cette propriété n'est pas confiée à ce commentaire : `monotone()` l'exprime
 * en code, et la suite d'évaluation la vérifie sur le corpus entier.
 *
 * ⚠️ `routing.ts` N'EST PAS MODIFIÉ. Pas une ligne, pas un motif. Il est
 * APPELÉ DEUX FOIS. C'est la seule chose que ce fichier lui fait.
 *
 * ⚠️ LE TEXTE CANONIQUE NE VA JAMAIS AU MODÈLE. Il sert à CLASSER, rien
 * d'autre. Le modèle reçoit la phrase d'origine — sans quoi il répondrait en
 * français à une question posée en arabe, et la consigne de langue du prompt
 * deviendrait inapplicable. Représentation de routage ≠ représentation de
 * réponse.
 *
 * ═══ CE QUE CE FICHIER NE FAIT PAS ═══
 * Il ne lit aucune base, ne résout aucune identité de patient, ne décide
 * d'aucune autorisation, n'exécute aucune capacité, n'appelle aucun modèle. Il
 * transforme du texte en texte. Un seul import, `routing.ts` lui-même, qui n'en
 * a aucun : le couple reste compilable et évaluable hors ligne, sous `tsc` puis
 * node, comme l'exige la passe d'évaluation.
 */

import { classer, type Chemin, type Routage } from "./routing";

import { LEXIQUE, LONGUEUR_MAX_NGRAMME } from "./lexique-multilingue";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · NORMALISATION UNICODE
// ═══════════════════════════════════════════════════════════════════════════

/** Signes vocaliques arabes (fatha, damma, kasra, sukun, shadda, tanwin). */
const TASHKIL = /[ً-ْٰ]/g;
/** Le tatweel — un allongement purement typographique, jamais une lettre. */
const TATWEEL = /ـ/g;

/**
 * Replie les variantes graphiques de l'arabe.
 *
 * ⚠️ CE N'EST PAS DE LA COSMÉTIQUE. « اليوم » (aujourd'hui) s'écrit avec ou
 * sans hamza sur l'alef, avec ou sans signes vocaliques, selon le clavier et
 * selon ce que rend la transcription. Sans ce repli, une entrée du lexique ne
 * correspondrait qu'à UNE de ces graphies — et la table paraîtrait fausse alors
 * qu'elle serait seulement mal indexée.
 */
function replierArabe(texte: string): string {
  return texte
    .replace(TASHKIL, "")
    .replace(TATWEEL, "")
    .replace(/[آأإٱ]/g, "ا") // آ أ إ ٱ → ا
    .replace(/ى/g, "ي") // ى → ي
    .replace(/ة/g, "ه"); // ة → ه
}

/**
 * La forme sur laquelle on TRAVAILLE : NFKC puis repli arabe. Appliquée à la
 * demande AVANT tout calcul de position, pour que les décalages restent
 * valides — NFKC peut changer la longueur d'une chaîne.
 *
 * La casse et les accents français sont PRÉSERVÉS : `classer()` teste
 * `NOM_PROPRE_COMPLEMENT` sur le texte non normalisé, et une majuscule perdue
 * ici serait un individu désigné perdu là-bas.
 */
function preparer(texte: string): string {
  return replierArabe(texte.normalize("NFKC"));
}

/** La clé de recherche : minuscules, sans diacritiques latins. */
function cle(mot: string): string {
  return mot
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · L'INDEX, CONSTRUIT UNE FOIS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ LES FORMES DU LEXIQUE TRAVERSENT LA MÊME NORMALISATION QUE LA DEMANDE.
 * Les écrire déjà repliées à la main marcherait le premier jour et divergerait
 * le second : deux définitions du même repli finissent toujours par se
 * contredire, et c'est la plus laxiste qui gagne en silence.
 */
function normaliserForme(forme: string): string {
  return cle(preparer(forme)).trim().replace(/\s+/g, " ");
}

const INDEX: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const entree of LEXIQUE) {
    for (const forme of entree.formes) {
      const k = normaliserForme(forme);
      if (k.length === 0) continue;
      // Première écriture gagnante : une forme déclarée deux fois est une
      // erreur de table, et la faire gagner silencieusement la cacherait.
      if (!m.has(k)) m.set(k, entree.canonique);
    }
  }
  return m;
})();

/**
 * Les mots qui composent les canoniques — LE GARDE-FOU DE LA RÉPARATION FLOUE.
 *
 * ⚠️ TROUVÉ EN CONCEVANT, PAS EN RELISANT. Sans cet ensemble, « patient »
 * (français correct) se trouve à UNE édition de la forme « patients », et la
 * réparation le réécrivait en « patients ». Or `DEICTIQUES` exige
 * `\b(ce|cette|le|la|…)\s(patient|patiente|…)\b` : « ce patients » ne
 * correspond plus — la frontière PERDAIT l'individu désigné sur une phrase
 * française parfaitement écrite. L'union avec le brut aurait sauvé le verdict,
 * mais on aurait affaibli la branche canonique sans le voir.
 *
 * Règle : un mot qui est déjà du français canonique ne se répare pas.
 */
const MOTS_PROTEGES: ReadonlySet<string> = (() => {
  const s = new Set<string>();
  for (const entree of LEXIQUE) {
    for (const mot of normaliserForme(entree.canonique).split(" ")) {
      if (mot.length > 0) s.add(mot);
    }
  }
  return s;
})();

/** Les formes d'un seul mot, en écriture latine — les seules cibles du flou. */
const FORMES_LATINES_UNITAIRES: readonly (readonly [string, string])[] = [
  ...INDEX.entries(),
].filter(([k]) => !k.includes(" ") && /^[a-z0-9]+$/.test(k));

// ═══════════════════════════════════════════════════════════════════════════
// 3 · RÉPARATION DE TRANSCRIPTION — BORNÉE, ET JAMAIS AMBIGUË
// ═══════════════════════════════════════════════════════════════════════════

/** Distance de Levenshtein, abandonnée dès qu'elle dépasse `plafond`. */
function distance(a: string, b: string, plafond: number): number {
  if (Math.abs(a.length - b.length) > plafond) return plafond + 1;
  let precedente: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const courante: number[] = [i];
    let minLigne = i;
    for (let j = 1; j <= b.length; j++) {
      const cout = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(
        (courante[j - 1] ?? 0) + 1,
        (precedente[j] ?? 0) + 1,
        (precedente[j - 1] ?? 0) + cout,
      );
      courante.push(v);
      if (v < minLigne) minLigne = v;
    }
    if (minLigne > plafond) return plafond + 1;
    precedente = courante;
  }
  return precedente[b.length] ?? plafond + 1;
}

/**
 * Répare un mot déformé par la transcription — ou rend `null`.
 *
 * ⚠️ CE N'EST PAS UN CORRECTEUR ORTHOGRAPHIQUE, ET LA DIFFÉRENCE EST LE SUJET.
 * Un correcteur rapproche N'IMPORTE QUEL mot du plus proche voisin. Ici, quatre
 * verrous, et il faut les quatre :
 *
 *   1. la cible appartient au VOCABULAIRE FERMÉ du lexique, jamais à la langue ;
 *   2. le mot fait au moins quatre caractères — en deçà, une édition change le
 *      mot entier, et « dose »/« dois » deviendraient interchangeables ;
 *   3. la tolérance est bornée : une édition sous huit caractères, deux au-delà ;
 *   4. UNE AMBIGUÏTÉ SE REFUSE, elle ne s'arbitre pas. Deux canoniques
 *      différents à égale distance, c'est un mot qu'on ne sait pas lire :
 *      on le laisse tel quel. Deviner ici, ce serait faire dépendre une
 *      décision de frontière d'un départage arbitraire.
 */
function reparer(k: string): string | null {
  if (k.length < 4) return null;
  if (MOTS_PROTEGES.has(k)) return null;
  if (!/^[a-z]+$/.test(k)) return null; // chiffres darija : formes exactes ou rien

  const plafond = k.length < 8 ? 1 : 2;
  let meilleure = plafond + 1;
  const candidats = new Set<string>();

  for (const [forme, canonique] of FORMES_LATINES_UNITAIRES) {
    const d = distance(k, forme, plafond);
    if (d > plafond) continue;
    if (d < meilleure) {
      meilleure = d;
      candidats.clear();
      candidats.add(canonique);
    } else if (d === meilleure) {
      candidats.add(canonique);
    }
  }

  if (candidats.size !== 1) return null;
  const [seul] = [...candidats];
  if (seul === undefined) return null;

  // ⚠️ UNE « RÉPARATION » QUI NE FAIT QUE TRONQUER N'EN EST PAS UNE.
  //
  // MESURÉ LE 2026-09-08, sur du français PARFAITEMENT ORTHOGRAPHIÉ :
  //
  //     « les traitements de … »  →  « les traitement de … »
  //     « ses ordonnances »       →  « ses ordonnance »
  //     « les consultations … »   →  « les consultation … »
  //
  // Quatre phrases françaises correctes sur six étaient altérées. Le mécanisme :
  // `traitements` se trouve à une distance de 2 de la forme DÉFORMÉE `traitemnt`
  // (groupe RÉPARATION_STT), et la tolérance vaut 2 au-delà de huit caractères.
  // La réparation le ramenait donc à `traitement` — elle amputait le pluriel.
  //
  // ⚠️ ET L'EN-TÊTE DU LEXIQUE SUR-DÉCLARAIT. Il affirme qu'« un mot français
  // bien écrit traverse INCHANGÉ, donc une phrase française est son propre
  // canonique ». La discipline n°1 était respectée à la lettre — aucune entrée
  // français → français — mais la réparation obtenait le même effet
  // indirectement. Une garantie fausse dans un fichier de frontière empêche la
  // relecture suivante de la remettre en cause.
  //
  // POURQUOI `MOTS_PROTEGES` NE SUFFISAIT PAS. Il ne contient que les formes
  // littéralement présentes dans les canoniques : `traitement` y est,
  // `traitements` non. `medicaments` survivait par ACCIDENT — son canonique se
  // trouve être écrit au pluriel. La protection était fortuite.
  //
  // La règle ci-dessous couvre toutes les flexions sans en énumérer aucune : si
  // le mot COMMENCE DÉJÀ par le canonique proposé, la « réparation » se
  // contenterait de lui retirer une terminaison. Une vraie déformation, elle, ne
  // commence jamais par sa forme correcte — `traitemnt` ne commence pas par
  // `traitement`, `medicamens` ne commence pas par `medicaments` — et continue
  // donc d'être réparée.
  //
  // Sûreté : cette garde ne fait que RAPPROCHER le canonique du brut. L'union
  // prenant le maximum avec la branche brute, elle ne peut pas rendre un verdict
  // moins restrictif qu'avant.
  // ⚠️ LA RÈGLE EST SYMÉTRIQUE, ET LA PREMIÈRE VERSION NE L'ÉTAIT PAS.
  // Elle ne bloquait que la TRONCATURE (`traitements` → `traitement`) ; le test
  // d'invariance a aussitôt trouvé l'EXTENSION, qui est le même défaut à
  // l'envers : `medicament` (français correct, singulier) se trouve à une
  // édition du canonique `medicaments` et se voyait mettre au pluriel —
  // « la posologie du medicaments ». Une flexion n'est pas une déformation,
  // dans un sens comme dans l'autre.
  //
  // ⚠️ CE QUE CETTE RÈGLE NE BLOQUE PAS, ET C'EST VOULU : une vraie déformation
  // diffère au MILIEU du mot, jamais seulement par sa terminaison. `traitemnt`
  // n'est un préfixe de rien, `medicamens` non plus : les dix réparations
  // mesurées du groupe RÉPARATION_STT continuent toutes de mordre.
  const canonique = normaliserForme(seul);
  if (k.startsWith(canonique) || canonique.startsWith(k)) return null;

  return seul;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LE NORMALISEUR
// ═══════════════════════════════════════════════════════════════════════════

export interface DemandeNormalisee {
  /** Le texte canonique — POUR CLASSER, jamais pour le modèle. */
  readonly canonique: string;
  /**
   * L'ÉCRITURE constatée, pas une identification de langue.
   *
   * ⚠️ On ne prétend PAS identifier une langue : distinguer la darija de
   * l'arabe standard demande un modèle, et ce fichier n'en appelle aucun. On
   * rend ce qu'on a réellement observé — quel alphabet porte la demande — et
   * rien de plus. Un champ qui sur-déclare ce qu'il sait empêche la relecture
   * suivante de le remettre en cause.
   */
  readonly ecriture: "arabe" | "latine" | "mixte" | "vide";
  /** Les concepts canoniques appliqués. Télémétrie : jamais une donnée patient. */
  readonly marqueurs: readonly string[];
}

const MOT = /[\p{L}\p{N}]+/gu;
const ARABE = /[؀-ۿ]/;
const LATIN = /[A-Za-z]/;

/**
 * Ramène la demande vers le vocabulaire que `routing.ts` connaît.
 *
 * Fonction PURE et déterministe : même entrée, même sortie, toujours. Elle ne
 * traduit pas une phrase et ne réordonne aucun mot — elle REMPLACE des mots par
 * leur mot canonique, en place, et laisse tout le reste intact, ponctuation et
 * majuscules comprises.
 */
export function normaliserDemande(texte: string): DemandeNormalisee {
  const prepare = preparer(texte);

  const ecriture: DemandeNormalisee["ecriture"] =
    prepare.trim() === ""
      ? "vide"
      : ARABE.test(prepare) && LATIN.test(prepare)
        ? "mixte"
        : ARABE.test(prepare)
          ? "arabe"
          : "latine";

  // Positions des mots. On garde les BORNES, pas seulement les mots : le
  // canonique se fabrique en substituant dans le texte d'origine, ce qui
  // préserve « d'Amina » (que `NOM_PROPRE_COMPLEMENT` lit) là où un
  // redécoupage/recollage l'aurait cassé en « d ' Amina ».
  const mots: { readonly k: string; readonly debut: number; readonly fin: number }[] = [];
  MOT.lastIndex = 0;
  for (let m = MOT.exec(prepare); m !== null; m = MOT.exec(prepare)) {
    mots.push({ k: cle(m[0]), debut: m.index, fin: m.index + m[0].length });
  }

  const remplacements: { debut: number; fin: number; par: string }[] = [];
  const marqueurs: string[] = [];

  let i = 0;
  while (i < mots.length) {
    let pris = 0;
    let canonique: string | null = null;

    // Du n-gramme le plus LONG au plus court : « شكون جاي » doit gagner sur
    // « شكون » seul, sinon la forme composée du lexique ne sert jamais.
    for (let n = Math.min(LONGUEUR_MAX_NGRAMME, mots.length - i); n >= 1; n--) {
      const tranche = mots.slice(i, i + n);
      const k = tranche.map((t) => t.k).join(" ");
      const trouve = INDEX.get(k);
      if (trouve !== undefined) {
        canonique = trouve;
        pris = n;
        break;
      }
    }

    // Rien d'exact : une seule tentative de réparation, sur le mot seul.
    if (canonique === null) {
      const seul = mots[i];
      if (seul !== undefined) {
        const repare = reparer(seul.k);
        if (repare !== null) {
          canonique = repare;
          pris = 1;
        }
      }
    }

    if (canonique === null || pris === 0) {
      i += 1;
      continue;
    }

    const premier = mots[i];
    const dernier = mots[i + pris - 1];
    if (premier !== undefined && dernier !== undefined) {
      remplacements.push({ debut: premier.debut, fin: dernier.fin, par: canonique });
      marqueurs.push(canonique);
    }
    i += pris;
  }

  // De DROITE à GAUCHE : substituer de gauche à droite invaliderait toutes les
  // bornes suivantes dès le premier remplacement de longueur différente.
  let canoniqueTexte = prepare;
  for (let j = remplacements.length - 1; j >= 0; j--) {
    const r = remplacements[j];
    if (r === undefined) continue;
    canoniqueTexte = canoniqueTexte.slice(0, r.debut) + r.par + canoniqueTexte.slice(r.fin);
  }

  return { canonique: canoniqueTexte, ecriture, marqueurs };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · L'UNION — LA PROPRIÉTÉ DE SÛRETÉ, EN CODE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Le treillis de restriction. `refus` domine, `connaissance` est le plancher —
 * le même ordre que `classer()` applique dans ses branches, rendu ici
 * COMPARABLE pour qu'on puisse en prendre un maximum.
 */
const RANG: Readonly<Record<Chemin, number>> = {
  connaissance: 0,
  patient: 1,
  refus: 2,
};

export function rangDeChemin(chemin: Chemin): number {
  return RANG[chemin];
}

/**
 * `true` si `obtenu` est au moins aussi restrictif que `reference`.
 * Exporté parce qu'une propriété de sûreté qu'on ne peut pas appeler depuis un
 * test n'est pas une propriété : c'est une intention.
 */
export function monotone(reference: Chemin, obtenu: Chemin): boolean {
  return RANG[obtenu] >= RANG[reference];
}

export interface RoutageMultilingue extends Routage {
  /** Ce qui a été classé en second. Utile au diagnostic, jamais au modèle. */
  readonly canonique: string;
  readonly ecriture: DemandeNormalisee["ecriture"];
  readonly marqueurs: readonly string[];
}

/**
 * LA DÉCISION, indépendante de la langue.
 *
 * Remplace `classer()` au SEUL point d'appel d'exécution du dépôt
 * (`jarvis-chat/route.ts`). Tout ce qui suit — le refus constant sans appel de
 * modèle, le chemin connaissance sans outils, le chemin patient sous RLS — est
 * inchangé : cette fonction décide du chemin, elle n'en ouvre aucun.
 */
export function classerMultilingue(phraseUtilisateur: string): RoutageMultilingue {
  const brut = classer(phraseUtilisateur);
  const normalisee = normaliserDemande(phraseUtilisateur);

  // Rien n'a été traduit ni réparé : le canonique EST le brut. On ne classe pas
  // deux fois la même chaîne — même résultat, coût doublé.
  if (normalisee.marqueurs.length === 0) {
    return {
      chemin: brut.chemin,
      motif: brut.motif,
      canonique: normalisee.canonique,
      ecriture: normalisee.ecriture,
      marqueurs: [],
    };
  }

  const canon = classer(normalisee.canonique);

  const gagnant = RANG[canon.chemin] > RANG[brut.chemin] ? canon : brut;
  const parNormalisation = gagnant === canon;

  return {
    chemin: gagnant.chemin,
    motif: parNormalisation ? `${gagnant.motif} (après normalisation)` : gagnant.motif,
    canonique: normalisee.canonique,
    ecriture: normalisee.ecriture,
    marqueurs: normalisee.marqueurs,
  };
}
