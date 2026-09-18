/**
 * `jarvis-contexte.ts` — LE BROKER DE CONTEXTE.
 *
 * ═══ CE QU'IL FAIT, ET CE QU'IL NE FAIT PAS ═══
 * Il assemble le contexte MINIMAL d'un tour, et il tient l'invariant de cible
 * unique. Il n'expédie JAMAIS le dossier entier : « lecture complète » veut dire
 * que la surface autorisée est ATTEIGNABLE, pas qu'elle est envoyée à chaque
 * tour. Le reste, le modèle le DEMANDE, capacité par capacité — c'est ce qui
 * rend la boucle utile plutôt que coûteuse.
 *
 * ⚠️ CE FICHIER NE REQUÊTE PRESQUE RIEN LUI-MÊME. Il appelle les services
 * existants et les capacités du registre. Toute requête écrite ici serait un
 * second chemin d'accès aux données, avec sa propre dérive.
 *
 * ═══ L'INVARIANT DE CIBLE UNIQUE ═══
 *
 *     À tout instant :  patientCible ∈ { ∅, un seul patient }
 *
 * Ce n'est pas une convention d'écriture, c'est la propriété qui empêche
 * l'erreur la plus grave que ce produit puisse commettre : parler du dossier de
 * Karim en croyant parler de celui de Nadia. Changer de patient REMPLACE la
 * cible, purge la carte d'identité et jette les résultats de capacité du patient
 * précédent. Rien n'est jamais accumulé.
 *
 * ⚠️ POURQUOI LA PURGE DE LA CARTE EST INDISPENSABLE ET PAS SEULEMENT PRUDENTE.
 * Les jetons sont attribués dans l'ordre de frappe : `PATIENT_001` désigne le
 * premier dossier rencontré du tour. Sans purge au changement de cible,
 * `PATIENT_001` continuerait de désigner Nadia pendant qu'on parle de Karim, et
 * le sidecar rendrait la réponse avec le mauvais nom — une erreur d'identité
 * dans un dossier médical, produite par une optimisation de cache.
 */

import { getOpenConsultation } from "./consultations";
import { aujourdHui } from "./jarvis-capacites";
import {
  carte as carteCourante,
  reinitialiserCarte,
  type CarteIdentite,
  type RefPatient,
} from "./jarvis-identite";
import { mesurerOctets } from "./jarvis-projections";
import { normaliserDemande } from "@/shared/jarvis/normalisation";
import { log } from "./log";
import type { PatientActif } from "./patient-actif";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LA CIBLE
// ═══════════════════════════════════════════════════════════════════════════

export interface CiblePatient {
  /** L'identifiant RÉEL. Ne franchit jamais — il sert aux capacités. */
  readonly id: string;
  /** Ce que la praticienne lit à l'écran. Ne franchit jamais non plus. */
  readonly libelle: string;
  readonly numeroDossier: string;
  /**
   * Comment la cible a été établie. Journalisé en télémétrie (§12) parce que
   * « d'où vient la cible » est la première question quand une réponse porte sur
   * le mauvais dossier.
   */
  readonly origine: "ecran" | "recherche" | "agenda" | "consultation";
  /**
   * Époque (ms) de pose. Phase 3 : borne la réutilisation (TTL). Jamais lu
   * par le modèle, jamais persisté — de la mémoire module, rien de plus.
   */
  readonly etablieA: number;
}

/** Ce que l'appelant fournit — l'horodatage est posé par `definirCible`. */
export type SaisieCible = Omit<CiblePatient, "etablieA">;

/**
 * TTL Phase 3 — 15 minutes. Passé ce délai, la cible est traitée comme
 * ABSENTE : un pronom (« ses médicaments ? ») ne doit plus résoudre vers un
 * patient dont la praticienne ne parle peut-être plus.
 */
export const TTL_CONTEXTE_MS = 15 * 60 * 1000;

let cible: CiblePatient | null = null;

export function cibleCourante(): CiblePatient | null {
  return cible;
}

/**
 * La cible TTL-VALIDE, ou `null`.
 *
 * ⚠️ EXPIRÉ = ABSENT, ET PURGÉ PARESSEUSEMENT. Un appel qui constate
 * l'expiration efface la cible (et, par `definirCible`, la carte d'identité) :
 * aucun jeton frappé pour elle ne doit survivre à sa validité.
 */
export function cibleValide(maintenantMs: number = Date.now()): CiblePatient | null {
  if (cible === null) return null;
  if (maintenantMs - cible.etablieA >= TTL_CONTEXTE_MS) {
    definirCible(null);
    return null;
  }
  return cible;
}

/** Une cible existe mais a dépassé son TTL — diagnostic UI et tests. */
export function contexteExpire(maintenantMs: number = Date.now()): boolean {
  return cible !== null && maintenantMs - cible.etablieA >= TTL_CONTEXTE_MS;
}

/**
 * Établit — ou remplace — la cible. Rend `true` si la cible a CHANGÉ, ce qui
 * oblige l'appelant à repartir d'un contexte propre.
 *
 * ⚠️ REMPLACE, N'AJOUTE PAS. Il n'existe volontairement aucune fonction
 * `ajouterCible` : le type de `cible` est `CiblePatient | null`, jamais un
 * tableau, et c'est la forme même de l'état qui rend l'accumulation
 * impossible à écrire par distraction.
 *
 * Phase 3 : l'horodatage est posé ICI, jamais par l'appelant — une cible dont
 * l'âge viendrait de l'écran serait une hypothèse sur l'horloge du poste.
 * Reposer le MÊME patient ré-arme le TTL (revoir son dossier, c'est reprendre
 * la conversation) sans signaler un changement : les décisions déjà prises
 * pour lui restent valables.
 */
export function definirCible(
  nouvelle: SaisieCible | null,
  maintenantMs: number = Date.now(),
): boolean {
  const change = (cible?.id ?? null) !== (nouvelle?.id ?? null);
  if (change) {
    cible = nouvelle === null ? null : { ...nouvelle, etablieA: maintenantMs };
    // La purge est SOLIDAIRE du changement de cible — même instruction, même
    // ligne de code. Les séparer laisserait un chemin où l'une a lieu sans
    // l'autre, et ce chemin serait exactement le bogue de contamination.
    reinitialiserCarte();
  } else if (cible !== null && nouvelle !== null) {
    cible = { ...nouvelle, etablieA: maintenantMs };
  }
  return change;
}

/** Efface la cible. Appelé quand la praticienne retire le contexte patient. */
export function effacerCible(): void {
  definirCible(null);
}

/**
 * Signale une résolution AMBIGUË (homonymes) — Phase 3.
 *
 * Trancher entre deux dossiers serait deviner, et deviner sur une action
 * destructive est un incident : on purge. La praticienne désigne, la cible
 * repart d'une désignation explicite, jamais d'un choix implicite.
 */
export function signalerAmbiguite(): void {
  if (cible === null) return;
  log.warn("jarvis.contexte.ambiguite", { count: 1 });
  effacerCible();
}

// ═══════════════════════════════════════════════════════════════════════════
// 1ter · LA PRÉCÉDENCE — QUI DÉCIDE DE QUI L'ON PARLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Le résultat d'une résolution, AVEC SA PROVENANCE.
 *
 * ⚠️ LA PROVENANCE EST DANS LE TYPE, PAS DANS UN CHAMP OPTIONNEL. « D'où vient
 * la cible » est la première question posée quand une réponse porte sur le
 * mauvais dossier ; un `CiblePatient | null` nu obligeait à la reconstituer
 * après coup, à partir du seul champ `origine`, qui n'avait qu'un écrivain.
 *
 * ⚠️ `aucun` ET `ambigu` SONT DEUX CHOSES DIFFÉRENTES, et les confondre serait
 * le bogue. `aucun` veut dire « je ne sais pas de qui on parle » ; `ambigu`
 * veut dire « je sais qu'il y en a plusieurs et je refuse de choisir ». Le
 * second doit fermer des chemins que le premier laisse ouverts.
 */
export type ResolutionCible =
  | { readonly etat: "explicite"; readonly cible: SaisieCible }
  | { readonly etat: "ecran"; readonly cible: SaisieCible }
  | { readonly etat: "conversation"; readonly cible: CiblePatient }
  | { readonly etat: "aucun" }
  | { readonly etat: "ambigu" }
  /**
   * M02 — mention explicite NON RÉSOLUE (0 candidat à la sonde).
   *
   * ⚠️ BLOQUANT, PAS UNE ABSENCE. `aucun` (« je ne sais pas ») laisse la
   * porte ouverte au rang du dessous quand il est RENDU par défaut ; ici la
   * praticienne A désigné quelqu'un que la sonde ne trouve pas — retomber
   * sur l'écran ou le fil serait répondre sur Karim à une question sur
   * Sarah (M02-I1). `nonResolu` ne purge pas (un échec de recherche ne
   * détruit pas un fil valide) mais n'adopte rien : le tour clarifie.
   */
  | { readonly etat: "nonResolu"; readonly texte: string };

/**
 * Ce que l'on sait au moment de décider.
 *
 * ⚠️ `undefined` ET `null` NE VEULENT PAS DIRE LA MÊME CHOSE, et toute la
 * justesse de `adopterPatientActif` en dépend. `ecran: undefined` = « l'écran
 * ne dit rien » ; `ecran: null` = « la praticienne a RETIRÉ le contexte »
 * ([Changer], navigation hors dossier). Le second est une décision humaine
 * explicite : il efface, et aucun rang inférieur ne le rattrape. Les traiter
 * pareil ferait survivre un dossier que la praticienne vient de fermer.
 */
export interface SignauxCible {
  /** Patient désigné explicitement et résolu à UN SEUL candidat. */
  readonly explicite?: SaisieCible | null | undefined;
  /**
   * M02 — le TEXTE désigné, présent quand la désignation n'a PAS abouti à
   * un candidat unique (0 ou échec de preuve). Tant qu'il est présent,
   * `resoudreCible` rend `nonResolu` : AUCUN rang inférieur (écran, fil,
   * ancre) ne rattrape une mention explicite non résolue (M02-I1).
   */
  readonly mentionExplicite?: string | undefined;
  /** Dossier ouvert à l'écran. `null` = retrait explicite. */
  readonly ecran?: SaisieCible | null | undefined;
  /** Une recherche a rendu plusieurs candidats : on ne choisit pas. */
  readonly ambigu?: boolean | undefined;
}

/**
 * LA PRÉCÉDENCE, écrite une fois et testable.
 *
 *     ambigu  >  explicite  >  NON-RÉSOLU (bloquant)  >  écran  >  conversation (TTL-valide)  >  aucun
 *
 * L'ordre est le livrable de cette fonction, pas son code. Il se lit ainsi :
 * une désignation explicite prime sur ce qui est affiché (la praticienne vient
 * de nommer quelqu'un d'autre) ; une désignation explicite NON RÉSOLUE bloque
 * tout ce qui suit — retomber sur l'écran ou le fil serait répondre sur un
 * autre dossier que celui nommé (M02-I1) ; l'affichage prime sur le fil (elle
 * a changé d'écran en cours de conversation) ; et le fil ne sert que s'il
 * est encore valide.
 *
 * ⚠️ UNE CIBLE EXPIRÉE VAUT ABSENCE, JAMAIS REPLI. Le rang 3 lit `cibleValide`,
 * qui purge paresseusement — il n'existe AUCUN chemin de cette fonction vers
 * `cible` brute. C'est la forme du code qui l'interdit, pas une consigne : un
 * pronom ne doit pas résoudre vers un patient dont on ne parle plus depuis un
 * quart d'heure.
 *
 * ⚠️ ELLE N'ÉCRIT RIEN. Choisir et écrire sont séparés pour que la décision
 * soit éprouvable sans état : `definirCible` reste le seul écrivain, et donc le
 * seul endroit où la purge de la carte d'identité peut être oubliée — c'est-à-
 * dire un endroit, pas deux.
 */
export function resoudreCible(
  signaux: SignauxCible,
  maintenantMs: number = Date.now(),
): ResolutionCible {
  if (signaux.ambigu === true) return { etat: "ambigu" };
  if (signaux.explicite !== undefined && signaux.explicite !== null) {
    return { etat: "explicite", cible: signaux.explicite };
  }
  // M02-I1 : une mention explicite non résolue ne retombe JAMAIS sur
  // l'écran, le fil ou l'ancre — ni ici, ni chez l'appelant.
  if (signaux.mentionExplicite !== undefined) {
    return { etat: "nonResolu", texte: signaux.mentionExplicite };
  }
  if (signaux.ecran !== undefined) {
    // Retrait explicite : rien en dessous ne le rattrape.
    if (signaux.ecran === null) return { etat: "aucun" };
    return { etat: "ecran", cible: signaux.ecran };
  }
  const fil = cibleValide(maintenantMs);
  if (fil !== null) return { etat: "conversation", cible: fil };
  return { etat: "aucun" };
}

/**
 * Applique une résolution. Rend `true` si la cible a CHANGÉ.
 *
 * `conversation` n'écrit pas : conserver ce qui est déjà là ne doit pas
 * ré-armer le TTL, sinon une conversation qui tourne en rond garderait
 * indéfiniment vivante une cible que personne n'a reconfirmée.
 */
export function adopterResolution(
  resolution: ResolutionCible,
  maintenantMs: number = Date.now(),
): boolean {
  switch (resolution.etat) {
    case "ambigu":
      signalerAmbiguite();
      return false;
    case "explicite":
    case "ecran":
      return definirCible(resolution.cible, maintenantMs);
    case "aucun":
      return definirCible(null, maintenantMs);
    // M02 : un échec de recherche ne détruit pas un fil valide (pas de
    // purge), et n'en crée pas (pas d'adoption). Le tour clarifie ; l'état
    // reste exactement ce qu'il était avant la mention.
    case "nonResolu":
      return false;
    case "conversation":
      return false;
  }
}

/**
 * L'ancre de conversation est-elle utilisable pour CE tour ?
 *
 * Elle vit tout en bas de la précédence, et cette fonction est l'endroit où
 * cela se lit :
 *
 *     ambigu > explicite > écran > cible en cours > ANCRE > aucun
 *
 * Elle ne sert donc que dans le silence de tout le reste. Trois refus, dans
 * l'ordre où ils se posent :
 *
 *   · `ecranOccupe` — un dossier est ouvert : c'est lui que la praticienne
 *     regarde en parlant, et il prime sur ce dont on parlait avant ;
 *   · une cible encore valide — le fil en cours n'a pas besoin d'être rattrapé ;
 *   · l'âge — ⚠️ EXPIRÉ VAUT ABSENT, exactement comme pour la cible et pour la
 *     même raison : un quart d'heure plus tard, « ses traitements » ne désigne
 *     plus rien de sûr. On redemande.
 *
 * ⚠️ ELLE NE DIT PAS « CE PATIENT EST AUTORISÉ ». Elle dit « ce mot-là désigne
 * probablement cette personne ». Le tour qui suit repasse intégralement par la
 * carte d'identité, Zod, la porte SQL et la RLS ; si le serveur refuse, il
 * refuse, et l'ancre n'y change rien.
 */
export function ancreApplicable(
  ancre: { readonly poseeA: number } | null,
  ecranOccupe: boolean,
  maintenantMs: number = Date.now(),
): boolean {
  if (ancre === null) return false;
  if (ecranOccupe) return false;
  if (cibleValide(maintenantMs) !== null) return false;
  return maintenantMs - ancre.poseeA < TTL_CONTEXTE_MS;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1bis · RÉFÉRENCES PRONOMINALES — Phase 3
// ═══════════════════════════════════════════════════════════════════════════

/** Minuscules et sans accents : « séance » et « seance » sont un seul mot. */
function normaliserPhrase(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Un nom propre en position de COMPLÉMENT DE PERSONNE — même lecture que
 * `NOM_PROPRE_COMPLEMENT` de `src/shared/jarvis/routing.ts` (qui reste la
 * seule frontière ADR-023, non modifiée) : une désignation explicite suit le
 * chemin recherche, pas la clarification.
 */
const NOM_PROPRE_COMPLEMENT =
  /(?:^|[^\p{L}])(?:(?:à|a|pour|chez|de|avec|sur)\s+|d'|l')([A-ZÀ-Þ][\p{L}'-]{2,})/u;

/**
 * Ce qui, dans la phrase, renvoie à un patient SANS le nommer.
 *
 * ⚠️ VOLONTAIREMENT ÉTROITE. Un possessif seul (« sa demi-vie » — la molécule)
 * ne déclenche rien : seuls un possessif + nom clinique, « lui », « dernier »
 * + nom de séance, ou un déictique patient comptent. Un faux négatif envoie la
 * question au chemin normal (le modèle demandera ou la recherche tranchera) ;
 * un faux positif bloquerait une question de connaissance derrière une
 * clarification inutile.
 */
const REFERENCE_PATIENT: readonly RegExp[] = [
  /\b(son|sa|ses|leur|leurs)\s+(dossiers?|traitements?|ordonnances?|medicaments?|notes?|consultations?|seances?|posologie|bilans?|suivi|documents?|etats?|derniere)\b/,
  /\blui\b/,
  /\b(derniere|dernier)\s+(seances?|consultations?|notes?|ordonnances?|visites?)\b/,
  /\b(ce|cette)\s+(patients?|patientes?|malades?)\b/,
];

/**
 * `true` quand le message renvoie à un patient sans le nommer ALORS QU'aucune
 * cible TTL-valide n'existe : l'appelant doit demander « de quel patient »,
 * jamais deviner. Avec une cible valide — ou une désignation explicite, ou
 * sans aucune référence — `false` : le chemin normal s'applique.
 */
export function besoinDeClarification(
  message: string,
  maintenantMs: number = Date.now(),
): boolean {
  if (cibleValide(maintenantMs) !== null) return false;
  const brut = message.trim();
  if (brut === "") return false;

  // La forme CANONIQUE, en plus du brut — même vocabulaire fermé que le
  // routage, jamais un second dictionnaire à faire dériver.
  //
  // ⚠️ MESURÉ AVANT D'ÊTRE ÉCRIT (2026-09-07, sonde hors ligne sur 22 cas) :
  // « دواءه؟ », « dwa dyalou? », « And his medication? » et 8 autres ne
  // déclenchaient AUCUNE clarification — 11 trous, 0 faux positif. Sans cible,
  // la question partait au modèle, qui devinait de quel dossier il s'agit.
  // C'est le seul défaut de cette tranche qui produit une réponse FAUSSE en
  // silence, là où les trous de routage produisaient un refus ou une boucle.
  //
  // ⚠️ ET LA NORMALISATION SEULE N'EN REFERMAIT AUCUN (0/11, même sonde) :
  // `REFERENCE_PATIENT` exige un possessif français DEVANT un nom clinique, et
  // le lexique traduisait les mots de contenu en laissant tomber la morphologie
  // possessive. Cette ligne est la plomberie ; ce qui referme les trous, ce
  // sont les entrées possessives du lexique (groupe 5bis), sur le patron que
  // « تشخيصه » y tenait déjà seul.
  const canonique = normaliserDemande(brut).canonique;

  // Un nom propre explicite dans l'UNE OU L'AUTRE forme suffit à écarter la
  // clarification : la praticienne a désigné, on ne lui redemande pas.
  if (NOM_PROPRE_COMPLEMENT.test(brut) || NOM_PROPRE_COMPLEMENT.test(canonique)) return false;

  // ⚠️ CETTE UNION N'EST PAS MONOTONE COMME CELLE DU ROUTAGE. Là-bas, plus
  // restrictif est toujours plus sûr ; ici, une clarification indue BLOQUE une
  // question légitime derrière une question inutile. Le corpus français doit
  // donc rendre des verdicts identiques, et c'est un test, pas une intention.
  return [brut, canonique].some((forme) =>
    REFERENCE_PATIENT.some((m) => m.test(normaliserPhrase(forme))),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 1ter · SIGNAUX M02 — les mêmes motifs, exposés purs pour la boucle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * M02 — la mention explicite d'un tour, ou `null`.
 *
 * RÈGLE : la première suite de 1 à 3 mots capitalisés (≥3 lettres, capitale
 * initiale) qui N'OUVRE PAS le message. Le premier mot est presque toujours
 * le verbe ou le cadre (« Montre-moi… », « Et… », « Quelle… ») — le sonder
 * serait clarifier à tort ; un nom en position directe (« Montre-moi
 * Karim ») ou en complément (« …de Karim Djilali ») est capturé pareil.
 * La fidélité va dans le sens sûr : « Karim Djilali » (nommé complet) ne
 * matche qu'un dossier quand « Karim » seul en matcherait deux.
 *
 * ⚠️ CE N'EST QU'UN CANDIDAT À LA SONDE, PAS UNE DÉSIGNATION. La porte
 * (`search_patients`, `total_count`) tranche : unique = adopte, 0 = clarifie
 * sans repli (M02-I1), N = clarifie en listant. Un faux positif (éponyme,
 * sujet de phrase) coûte au pire une clarification honnête — jamais un
 * mauvais dossier. Et la boucle ne sonde que sur chemin patient (sinon un
 * « Parkinson ? » de savoir partirait en clarification).
 *
 * `besoinDeClarification` est inchangé — positions historiques intactes.
 */
const CANDIDAT_MENTION =
  /[A-ZÀ-Þ][\p{L}'-]{2,}(?:\s+[A-ZÀ-Þ][\p{L}'-]{2,}){0,2}/gu;

export function extraireMentionExplicite(message: string): string | null {
  const brut = message.trim();
  if (brut === "") return null;
  const formes = [brut, normaliserDemande(brut).canonique];
  for (const forme of formes) {
    CANDIDAT_MENTION.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CANDIDAT_MENTION.exec(forme)) !== null) {
      let candidat = m[0];
      if (m.index === 0) {
        // Position 0 = le verbe/le cadre (« Montre-moi… », « Il… »), jamais
        // une désignation SEULE. Mais le motif mange aussi la suite
        // (« Montre-moi Karim » capturé d'un bloc) : on retire alors le
        // premier mot — le cadre — et on garde la désignation. Un mot seul
        // en position 0 (« Mohamed. », « Karim, … ») est ignoré : le fil ou
        // la clarification prend le relais (jamais de devinette).
        const mots = candidat.trim().split(/\s+/);
        if (mots.length < 2) continue;
        candidat = mots.slice(1).join(" ");
      }
      const mention = candidat.trim().replace(/\s+/g, " ");
      // Hors borne Zod (`query` ≤ 80) : part entière à la sonde, qui la
      // refuse — jamais de sonde TRONQUÉE (un préfixe pourrait matcher
      // unique quand le nom complet matche zéro : fail-closed).
      if (mention.length >= 2) return mention;
    }
  }
  return null;
}

/**
 * M02 — le tour renvoie-t-il à un patient SANS le nommer ?
 * Même union que `besoinDeClarification`, sans le test de cible : la boucle
 * connaît déjà le fil au moment où elle demande.
 */
export function aUneReferencePatient(message: string): boolean {
  const brut = message.trim();
  if (brut === "") return false;
  const canonique = normaliserDemande(brut).canonique;
  return [brut, canonique].some((forme) =>
    REFERENCE_PATIENT.some((m) => m.test(normaliserPhrase(forme))),
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LES BUDGETS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * §6.1 du plan. Budgets INDÉPENDANTS : un seul plafond global laisserait un
 * tour consommer sa totalité en un appel, ou boucler indéfiniment sur des
 * appels minuscules. Chacun borne une dimension différente de la dérive.
 */
export const BUDGETS = {
  /** Allers-retours modèle → outil → modèle dans un même tour. */
  MAX_TOURS_OUTIL: 3,
  /** Appels de capacité cumulés sur le tour, toutes itérations confondues. */
  MAX_APPELS_OUTIL: 6,
  /** Taille sérialisée du contexte envoyé au modèle. */
  MAX_OCTETS_CONTEXTE: 24_000,
  /** Durée d'une capacité, puis du tour entier. */
  MAX_MS_CAPACITE: 20_000,
  MAX_MS_TOUR: 60_000,
  /**
   * ⚠️ UNE SEULE ÉCRITURE PAR TOUR, SANS EXCEPTION. Deux écritures enchaînées
   * sans reprise de parole humaine, ce serait une confirmation qui vaut pour
   * une action que l'humaine n'a pas lue. L2 tombe.
   */
  MAX_ECRITURES_PAR_TOUR: 1,
} as const;

// ═══════════════════════════════════════════════════════════════════════════
// 3 · LES FAITS DÉTERMINISTES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ LE MODÈLE NE CALCULE AUCUNE DATE (§7.2). « Demain », « jeudi », « ce
 * matin » se résolvent ICI, en TypeScript, dans le calendrier du cabinet, et
 * partent comme des FAITS. Un modèle qui calcule une date se trompe d'un jour
 * une fois sur vingt, en silence, et un rendez-vous décalé d'un jour est une
 * patiente qui se déplace pour rien.
 *
 * ⚠️ AUCUNE DE CES VALEURS N'EST IDENTIFIANTE : ce sont des dates et un fuseau.
 * Elles traversent la frontière sans transformation, et c'est légitime.
 */
export interface FaitsTemporels {
  /** `YYYY-MM-DD`, calendrier du cabinet. */
  readonly aujourdHui: string;
  /** Instant courant, ISO 8601 avec décalage d'Alger. */
  readonly maintenant: string;
  readonly decalage: string;
  readonly bornesAujourdHui: { readonly du: string; readonly au: string };
  readonly bornesDemain: { readonly du: string; readonly au: string };
}

const FUSEAU = "Africa/Algiers";

/**
 * Le décalage d'Alger à cet instant, calculé par différence entre l'heure
 * murale et l'instant absolu — jamais codé en dur à `+01:00`.
 *
 * L'Algérie n'observe pas l'heure d'été aujourd'hui, mais un décalage écrit en
 * dur est une hypothèse silencieuse sur une décision politique. Le calcul coûte
 * trois lignes et ne peut pas devenir faux.
 */
function decalageAlger(maintenantMurale: string, maintenantMs: number): string {
  const murAlger = Date.parse(`${maintenantMurale.replace(" ", "T")}Z`);
  const minutes = Math.round((murAlger - maintenantMs) / 60_000);
  const signe = minutes < 0 ? "-" : "+";
  const abs = Math.abs(minutes);
  return `${signe}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

function ajouterJours(jour: string, n: number): string {
  const d = new Date(`${jour}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function faitsTemporels(maintenant: Date = new Date()): FaitsTemporels {
  const murale = maintenant.toLocaleString("sv-SE", { timeZone: FUSEAU });
  const decalage = decalageAlger(murale, maintenant.getTime());
  const jour = aujourdHui();
  const demain = ajouterJours(jour, 1);
  const bornes = (j: string) => ({
    du: `${j}T00:00:00${decalage}`,
    au: `${ajouterJours(j, 1)}T00:00:00${decalage}`,
  });
  return {
    aujourdHui: jour,
    maintenant: `${murale.replace(" ", "T")}${decalage}`,
    decalage,
    bornesAujourdHui: bornes(jour),
    bornesDemain: bornes(demain),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LE CONTEXTE D'AMORÇAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Ce que le modèle reçoit AVANT d'avoir demandé quoi que ce soit. Volontairement
 * maigre : une référence de patient s'il y en a une, les faits temporels, et
 * rien d'autre. Le dossier lui-même ne part que si le modèle appelle
 * `get_patient_context` — c'est-à-dire quand la question le justifie.
 *
 * ⚠️ « QUI EST LE PROCHAIN PATIENT ? » NE DOIT PAS COÛTER UN DOSSIER COMPLET.
 * C'est la mesure du succès de ce fichier : deux kilo-octets pour une question
 * d'agenda, douze pour une préparation de consultation, zéro pour une question
 * de connaissance générale.
 */
export interface ContexteAmorce {
  readonly temps: FaitsTemporels;
  /** La cible, si elle existe — en RÉFÉRENCE, jamais en nom. */
  readonly patientCible?: RefPatient;
  /** Une séance est-elle ouverte ? Un booléen, pas le dossier. */
  readonly consultationOuverte: boolean;
  readonly octets: number;
}

/**
 * Assemble l'amorce et frappe le jeton de la cible s'il y en a une.
 *
 * La carte reçue est celle du TOUR : c'est ici qu'elle apprend l'identité de la
 * cible, donc c'est à partir d'ici que le pare-feu saura la masquer dans le
 * message libre de la praticienne (§1.5 — « Ouvre le dossier de Nadia » devient
 * « Ouvre le dossier de {{PATIENT_001}} »).
 */
export async function assemblerAmorce(
  carte: CarteIdentite = carteCourante(),
): Promise<ContexteAmorce> {
  const temps = faitsTemporels();

  let patientCible: RefPatient | undefined;
  // Phase 3 : seule une cible TTL-VALIDE entre dans l'amorce. Expirée, elle
  // est absente — et `cibleValide` l'a purgée paresseusement, carte comprise.
  const valide = cibleValide();
  if (valide !== null) {
    // Les entrées VIDES sont écartées : une cible de rang 1 (recherche) ne
    // porte pas de numéro de dossier, et une chaîne vide dans une liste de
    // masquage n'est pas une identité — c'est un motif qui masque tout.
    patientCible = carte.patient(
      valide.id,
      valide.libelle,
      [
        valide.libelle,
        valide.numeroDossier,
        ...valide.libelle.split(/\s+/).filter((m) => m.length >= 3),
      ].filter((m) => m.trim() !== ""),
    );
  }

  // Un booléen, pas la séance. Savoir QU'IL Y A une consultation ouverte suffit
  // au modèle pour proposer `get_consultation` ; lui envoyer la note d'office
  // serait envoyer un dossier que personne n'a demandé.
  const ouverte = await getOpenConsultation();
  const consultationOuverte = ouverte.ok && ouverte.data !== null;

  const amorce = {
    temps,
    ...(patientCible === undefined ? {} : { patientCible }),
    consultationOuverte,
  };
  return { ...amorce, octets: mesurerOctets(amorce) };
}

/**
 * Adopte le dossier ouvert à l'écran comme cible.
 *
 * ⚠️ CE N'EST JAMAIS UNE AUTORISATION (L3). C'est une CIBLE pré-résolue, pour
 * éviter au modèle de deviner de qui l'on parle. La RLS décide de tout le reste
 * sous le JWT de l'appelante, et une cible pointant vers un dossier hors
 * périmètre ne rendra rien — « introuvable ≡ hors périmètre » (ADR-003).
 */
export function adopterPatientActif(
  patient: PatientActif | null,
  maintenantMs: number = Date.now(),
): boolean {
  // Passe par la précédence plutôt que d'écrire directement : `null` y est un
  // RETRAIT explicite (rang au-dessus du fil), pas une absence de signal.
  const ecran: SaisieCible | null =
    patient === null
      ? null
      : {
          id: patient.id,
          libelle: patient.nom,
          numeroDossier: patient.numero,
          origine: "ecran",
        };
  return adopterResolution(resoudreCible({ ecran }, maintenantMs), maintenantMs);
}
