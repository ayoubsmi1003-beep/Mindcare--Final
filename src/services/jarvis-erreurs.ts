/**
 * `jarvis-erreurs.ts` — LA TAXONOMIE D'ERREUR ALEXA (§34 de la mission).
 *
 * ═══ POURQUOI UN MODULE SÉPARÉ ═══
 * Avant lui, chaque couche nommait l'échec dans son dialecte : `AppError.code`
 * (`errors.ts`), `motifEchec` (`SafeToolResult`), `etat` du verdict M02
 * (`nonResolu/ambigu`), `IssueExecution` (`ok/echec/inconnue/bloquee`). Le
 * modèle confondait « patient introuvable », « interdit » et « base en panne »
 * parce que rien ne les rangeait dans des tiroirs distincts. Ce module est le
 * tiroir : un code canonique par panne, une fonction pure de classement, et
 * des libellés écran qui ne sur-déclarent jamais (« parmi les dossiers
 * visibles », jamais « n'existe pas »).
 *
 * ⚠️ IL NE DÉTECTE RIEN LUI-MÊME. Il classe des signaux que les couches
 * produisent déjà. Aucun appel réseau, aucune lecture base, aucun modèle.
 * Les codes historiques existants (`sonde-indisponible`, `reference-inconnue`,
 * …) sont CONSERVÉS dans les traces ; ce module les RANGE, il ne les renomme
 * pas — renommer casserait les tests et les agrégats existants.
 */

import { normaliserTexteIdentite } from "@/shared/jarvis/normalisation";

import type { AppErrorCode } from "./errors";

/**
 * Codes canoniques §34. Stables, en MAJUSCULES_SNAKE : ils traversent les
 * logs, la télémétrie et le harnais voix — jamais l'écran tel quel (voir
 * `libelleEcran`).
 */
export type CodeErreurAlexa =
  | "PATIENT_NOT_FOUND"
  | "PATIENT_AMBIGUOUS"
  | "PATIENT_FORBIDDEN"
  | "TOOL_TIMEOUT"
  | "TOOL_UNAVAILABLE"
  | "DB_TIMEOUT"
  | "DB_ERROR"
  | "MODEL_TIMEOUT"
  | "MODEL_ERROR"
  | "KNOWLEDGE_UNAVAILABLE"
  | "INVALID_TOOL_ARGUMENT"
  | "PERMISSION_DENIED"
  | "SENSITIVE_DATA_BLOCKED"
  | "VOICE_UNAVAILABLE"
  | "STT_ERROR"
  | "TTS_ERROR"
  | "OK";

/**
 * ═══ PARE-FEU APPLICATIF §17 — la couche qui dit non, pas le prompt ═══
 *
 * Motifs de DEMANDE de données sensibles (normalisés avant test : accents,
 * casse et repli arabe déjà pliés). Ils portent sur des COMPOSÉS
 * (« carte » + « bancaire/numero/code »), jamais sur un mot seul : « carte »
 * seule ne déclenche rien, « paiement »/« recette »/« encaissé » (questions
 * finance légitimes) non plus. Une demande qui matche ne voit AUCUN modèle,
 * AUCUNE capacité : refus nommé `SENSITIVE_DATA_BLOCKED`, tracé, persistant.
 */
const MOTIFS_SENSIBLES: readonly RegExp[] = [
  /\bcarte\b[^?.!]{0,30}\b(bancaire|bleue|credit|numero|num|code)\b/,
  /\b(numero|num|code)\b[^?.!]{0,30}\b(cartes?)\b/,
  /\b(rib|iban|cvv|cvc|cryptogramme)\b/,
  /\bcode\b[^?.!]{0,20}\b(pin|secret)\b/,
  /\bmot de passe\b/,
  /\bpassword\b/,
  /\b(cle|key)\b[^?.!]{0,20}\b(api|secrete)\b/,
  /\bjeton\b/,
  /\bsession\b[^?.!]{0,20}\btoken\b/,
  // Arabe : racine بطاق (بطاقة/بطاقه, carte), كارت (carte, emprunt).
  /بطاق/,
  /كارت/,
];

/**
 * `true` si le message DEMANDE une donnée sensible (carte, mot de passe,
 * secret, jeton). Pur, déterministe. La boucle l'appelle AVANT sonde, carte,
 * amorce et modèle : un `true` rend un refus, jamais un tour.
 */
export function demandeDonneeSensible(message: string): boolean {
  const forme = normaliserTexteIdentite(message);
  if (forme === "") return false;
  return MOTIFS_SENSIBLES.some((m) => m.test(forme));
}

/** Ce que l'écran a le droit d'en dire — jamais un diagnostic brut. */
const LIBELLES: Readonly<Record<CodeErreurAlexa, string>> = {
  PATIENT_NOT_FOUND:
    "Je ne retrouve pas ce patient avec certitude. Pouvez-vous préciser le nom ?",
  PATIENT_AMBIGUOUS:
    "Plusieurs dossiers correspondent. Lequel voulez-vous voir ?",
  PATIENT_FORBIDDEN:
    "Ce dossier n'est pas visible avec vos droits.",
  TOOL_TIMEOUT:
    "La recherche a pris trop de temps. Pouvez-vous reformuler ?",
  TOOL_UNAVAILABLE:
    "La recherche est indisponible pour l'instant. Pouvez-vous reformuler ?",
  DB_TIMEOUT:
    "La base met trop de temps à répondre. Réessayez dans un instant.",
  DB_ERROR:
    "Une erreur technique empêche la recherche. Réessayez dans un instant.",
  MODEL_TIMEOUT:
    "Le modèle met trop de temps à répondre. Reformulez ou réessayez.",
  MODEL_ERROR:
    "Le service d'analyse est indisponible. Réessayez dans un instant.",
  KNOWLEDGE_UNAVAILABLE:
    "La recherche documentaire est indisponible pour l'instant. Le dossier reste accessible.",
  INVALID_TOOL_ARGUMENT:
    "La demande est incomplète. Pouvez-vous préciser ?",
  PERMISSION_DENIED:
    "Cette action n'est pas autorisée avec votre rôle.",
  SENSITIVE_DATA_BLOCKED:
    "Je ne peux pas afficher les informations de paiement sensibles.",
  VOICE_UNAVAILABLE:
    "La voix est indisponible sur ce poste. Vous pouvez écrire votre demande.",
  STT_ERROR:
    "Je n'ai pas compris l'audio. Pouvez-vous répéter ou écrire ?",
  TTS_ERROR:
    "La synthèse vocale a échoué. Voici la réponse en texte.",
  OK: "",
};

export function libelleEcran(code: CodeErreurAlexa): string {
  return LIBELLES[code];
}

/**
 * Range un `motifEchec` de capacité / trace dans le tiroir canonique.
 * Table fermée : tout code inconnu rend `TOOL_UNAVAILABLE` (aveu nommé,
 * jamais de devinette) — sauf les succès explicites qui rendent `OK`.
 */
export function classerMotifEchec(motif: string | null | undefined): CodeErreurAlexa {
  if (motif === null || motif === undefined || motif === "") return "OK";
  switch (motif) {
    case "ok":
      return "OK";
    case "non-trouve":
    case "introuvable":
    case "patient-introuvable":
      return "PATIENT_NOT_FOUND";
    case "ambigu":
    case "homonymes":
      return "PATIENT_AMBIGUOUS";
    case "interdit":
    case "patient-interdit":
    case "non-autorise":
      return "PATIENT_FORBIDDEN";
    case "delai-depasse":
    case "DELAI_DEPASSE":
      return "TOOL_TIMEOUT";
    case "sonde-indisponible":
    case "capacite-inconnue":
    case "indisponible":
    case "RUPTURE_TRANSPORT":
    case "ECHEC_PORTE":
      return "TOOL_UNAVAILABLE";
    case "reference-inconnue":
    case "arguments-invalides":
    case "valeur-invalide":
      return "INVALID_TOOL_ARGUMENT";
    case "refuse":
    case "bloquee":
    case "BLOQUEE":
      return "PERMISSION_DENIED";
    case "fuite-detectee":
    case "donnee-sensible":
      return "SENSITIVE_DATA_BLOCKED";
    default:
      return "TOOL_UNAVAILABLE";
  }
}

/**
 * Range un code applicatif `AppError` (frontière DB/réseau) dans le tiroir.
 * Les codes qui arrivent jusqu'ici ont déjà été dépouillés de tout message
 * Postgres brut — le tiroir ne voit que le code, jamais la phrase.
 */
export function classerAppError(code: AppErrorCode): CodeErreurAlexa {
  switch (code) {
    case "hors-ligne":
    case "indisponible":
      return "TOOL_UNAVAILABLE";
    case "non-authentifie":
    case "identifiants-refuses":
    case "interdit":
      return "PERMISSION_DENIED";
    case "introuvable":
      return "PATIENT_NOT_FOUND";
    case "conflit":
    case "regle-metier":
      return "INVALID_TOOL_ARGUMENT";
    case "transcription":
      return "STT_ERROR";
    case "synthese":
      return "TTS_ERROR";
    case "analyse":
      return "MODEL_ERROR";
    case "connaissance":
      return "KNOWLEDGE_UNAVAILABLE";
    case "inattendu":
      return "DB_ERROR";
    default: {
      const _exhaustif: never = code;
      void _exhaustif;
      return "DB_ERROR";
    }
  }
}

/**
 * Range un verdict M02 (`resolution-references.ts`) dans le tiroir.
 * `explicite`/`ecran`/`conversation`/`aucun` ne sont pas des erreurs → `OK`.
 */
export function classerVerdict(
  etat: "unique" | "ambigu" | "nonResolu" | "aucun" | "explicite" | "ecran" | "conversation",
): CodeErreurAlexa {
  switch (etat) {
    case "nonResolu":
      return "PATIENT_NOT_FOUND";
    case "ambigu":
      return "PATIENT_AMBIGUOUS";
    default:
      return "OK";
  }
}
