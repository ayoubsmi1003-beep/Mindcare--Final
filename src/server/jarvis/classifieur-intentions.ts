/**
 * `classifieur-intentions.ts` — LE CLASSIFIEUR NLU BORNÉ (M01).
 *
 * ═══ PLACE DANS L'ARCHITECTURE ═══
 * Appelé par `jarvis-chat/route.ts` APRÈS `classerMultilingue()`, JAMAIS sur
 * un refus (le refus rend sa constante sans modèle). Il transforme le message
 * SEUL — aucun dossier, aucun contexte, aucun historique clinique — en
 * `Intent` validé, ou l'écarte. L'écarté ne devine jamais : la route retombe
 * sur le comportement déterministe historique (cas B) ou un UNKNOWN honnête
 * (cas C), selon la raison.
 *
 * ═══ FRONTIÈRE RÉSEAU ═══
 * Aucun `fetch` ici. Le transport est INJECTÉ (`TransportClassifieur`) : en
 * production un adaptateur de `route.ts` appelle `llm()` de
 * `server/egress/external-call.ts` (passerelle unique, audit chaîné par
 * `sessionToken = run_id`) ; en test un faux pinné. Un faux prouve le
 * fail-closed sans réseau, sans clé, sans base.
 *
 * ═══ PAS DE JOURNAL BRUT ═══
 * Ce module ne journalise RIEN lui-même : la mention patient ne doit finir ni
 * dans un log ni dans une télémétrie. Il rend `latenceMs` + `modele` pour que
 * l'appelant (audit existant + harness) les enregistre en PII-safe.
 */

import {
  DESCRIPTION_INTENTIONS,
  NOMS_INTENTIONS,
  SEUIL_CONFIANCE_MIN,
  validerIntent,
  type IntentValide,
} from "@/shared/jarvis/intentions";

/** Version du prompt classifieur — bumpée à chaque changement de texte. */
export const INTENT_PROMPT_VERSION = "intent-v1";

export const MAX_CARACTERES_CLASSIFIEUR = 2_000;
export const TIMEOUT_MS_CLASSIFIEUR = 10_000;

export interface MessageClassifieur {
  readonly role: "system" | "user";
  readonly content: string;
}

/**
 * Transport minimal : du texte contre du texte. `texte: null` = panne/timeout
 * (jamais une intention devinée). `modele` = nom enregistré pour l'éval.
 */
export interface TransportClassifieur {
  completer(
    messages: readonly MessageClassifieur[],
    opts: { readonly timeoutMs: number },
  ): Promise<{ readonly texte: string | null; readonly modele: string }>;
}

export interface IdsClassifieur {
  readonly conversationId: string;
  readonly turnId: string;
  readonly runId: string;
}

export type RaisonEcart =
  | "invalide"
  | "confiance-basse"
  | "motif-interdit"
  | "indisponible";

export type ResultatClassification =
  | {
      readonly statut: "valide";
      readonly intent: IntentValide;
      readonly latenceMs: number;
      readonly modele: string;
    }
  | {
      readonly statut: "ecarte";
      readonly raison: RaisonEcart;
      readonly latenceMs: number;
      readonly modele: string;
    };

/**
 * Garde de MOTIFS — la même paire que la passerelle (`route.ts`), délibérément
 * dupliquée en lecture seule : un message qui porte un téléphone ou un courriel
 * ne franchit pas vers le classifieur (il suivra le chemin déterministe, où le
 * garde existant tranche). Vérifié AVANT tout appel réseau.
 */
export function porteUnMotifInterdit(message: string): boolean {
  return (
    /\b0[5-7]\d{8}\b/.test(message) ||
    /(?:\+|00)213\s?\d[\d\s.-]{7,}/.test(message) ||
    /[\w.+-]+@[\w-]+\.[\w.-]+/.test(message)
  );
}

/** Le système du classifieur — source unique : `DESCRIPTION_INTENTIONS`. */
export function construirePromptClassifieur(): string {
  const lignes = NOMS_INTENTIONS.map((n) => `- ${n} : ${DESCRIPTION_INTENTIONS[n]}`);
  return [
    "Tu es le classifieur d'intentions du cabinet. Tu lis la demande de la praticienne",
    "et tu rends UNIQUEMENT un objet JSON, sans texte autour, de cette forme exacte :",
    '{"name":"<NOM>","entities":{},"references":{"pronomSansAntecedent":false,"homonymePossible":false},"confidence":0.0,"missingInformation":[]}',
    "",
    "Noms possibles (rien d'autre) :",
    ...lignes,
    "",
    "Règles ABSOLUES :",
    "- entities.patientMention : le nom TEL QU'ÉCRIT (jamais d'UUID, jamais de jeton, jamais de téléphone ni courriel).",
    "- entities.dateMention : le mot TEL QU'ÉCRIT (« demain ») — tu ne calcules AUCUNE date.",
    "- entities.periode : jour|semaine|mois|annee seulement si la demande le dit.",
    "- references.pronomSansAntecedent=true si pronom/référence sans nom (« ses médicaments ? »).",
    "- references.homonymePossible=true si plusieurs personnes pourraient porter ce nom.",
    "- missingInformation : ce qui manque (patientMention|jour|periode|precisionDemande), [] si complet.",
    "- confidence : 0..1. En dessous de 0.55 la demande sera traitée comme incomprise : ne gonfle jamais ce chiffre.",
    "- Demande vague ou hors périmètre → {\"name\":\"UNKNOWN\",...}. Référence ambiguë → ASK_CLARIFICATION.",
    "- Tu ne diagnostiques pas, tu ne prescris pas, tu ne conclus pas : tu NOMMES l'intention, rien de plus.",
  ].join("\n");
}

/**
 * Extrait l'objet JSON — tolérance de FORME seule (balises <think>, clôtures
 * markdown, texte autour), jamais de devinette d'intention. Même discipline
 * que `lireProposition`, dupliquée ici pour ne pas toucher ce fichier gelé.
 */
export function extraireJsonClassifieur(brut: string): unknown {
  const sansReflexion = brut.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const sansClotures = sansReflexion.replace(/```(?:json)?/gi, "");
  const candidat = sansClotures.trim();
  try {
    return JSON.parse(candidat) as unknown;
  } catch {
    const debut = candidat.indexOf("{");
    const fin = candidat.lastIndexOf("}");
    if (debut < 0 || fin <= debut) return null;
    try {
      return JSON.parse(candidat.slice(debut, fin + 1)) as unknown;
    } catch {
      return null;
    }
  }
}

/**
 * Classifie. Ne lève JAMAIS sur une sortie modèle : tout échec structural
 * devient `ecarte`. Ne décide d'AUCUN refus : l'appelant a déjà tranché.
 */
export async function classifierIntent(
  message: string,
  _ids: IdsClassifieur,
  transport: TransportClassifieur,
  opts?: { readonly timeoutMs?: number | undefined },
): Promise<ResultatClassification> {
  const debut = Date.now();
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS_CLASSIFIEUR;
  const demande = message.trim().slice(0, MAX_CARACTERES_CLASSIFIEUR);

  if (demande === "") {
    return { statut: "ecarte", raison: "invalide", latenceMs: Date.now() - debut, modele: "n/a" };
  }
  if (porteUnMotifInterdit(demande)) {
    return {
      statut: "ecarte",
      raison: "motif-interdit",
      latenceMs: Date.now() - debut,
      modele: "n/a",
    };
  }

  let reponse: { readonly texte: string | null; readonly modele: string };
  try {
    reponse = await transport.completer(
      [
        { role: "system", content: construirePromptClassifieur() },
        { role: "user", content: demande },
      ],
      { timeoutMs },
    );
  } catch {
    return { statut: "ecarte", raison: "indisponible", latenceMs: Date.now() - debut, modele: "n/a" };
  }

  const latenceMs = Date.now() - debut;
  if (reponse.texte === null) {
    return { statut: "ecarte", raison: "indisponible", latenceMs, modele: reponse.modele };
  }

  const intent = validerIntent(extraireJsonClassifieur(reponse.texte));
  if (intent === null) {
    return { statut: "ecarte", raison: "invalide", latenceMs, modele: reponse.modele };
  }
  if (intent.confidence < SEUIL_CONFIANCE_MIN) {
    return { statut: "ecarte", raison: "confiance-basse", latenceMs, modele: reponse.modele };
  }
  return { statut: "valide", intent, latenceMs, modele: reponse.modele };
}
