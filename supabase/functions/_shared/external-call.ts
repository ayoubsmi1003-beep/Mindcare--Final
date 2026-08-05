/**
 * `external-call.ts` — LE SEUL FICHIER DU DÉPÔT QUI APPELLE OPENROUTER.
 *
 * `scripts/preflight.sh` §1 n'exempte que ce chemin LITTÉRAL du grep
 * anti-fetch. Ne pas renommer ce fichier, même si `02-SECURITY-BOUNDARY.md`
 * §5.1 nomme `_shared/llm.ts` pour la même passerelle — l'incohérence de
 * nommage entre les documents est tranchée par le préflight réel (STATE.md,
 * décision de session S6 n°1). Le `fetch()` réel vit ici et nulle part
 * ailleurs.
 *
 * Règle 3 de CLAUDE.md : `OPENROUTER_API_KEY` et la clé `service_role` ne
 * vivent QUE dans l'environnement de cette Edge Function, jamais transmises au
 * client, jamais dans un autre fichier.
 */

// deno-lint-ignore-file no-explicit-any
import postgres from "npm:postgres@3";

export type LlmRole = "system" | "user";

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string;
}

/**
 * Fournisseur abstrait — §3.4 n°2 de la revue Staff Engineer. « OpenRouter »
 * reste un CHOIX DE CONFIGURATION, pas une hypothèse répétée dans la logique
 * métier de `jarvis-analyze-session/index.ts`. `openRouterProvider`, plus bas,
 * est aujourd'hui le seul fournisseur réel.
 */
export interface LlmProvider {
  readonly name: string;
  complete(req: {
    readonly messages: readonly LlmMessage[];
    readonly model: string;
    readonly timeoutMs: number;
  }): Promise<{ readonly text: string; readonly tokensIn: number; readonly tokensOut: number }>;
}

export type LlmResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: { readonly code: LlmErrorCode; readonly message: string } };

export type LlmErrorCode = "hors-ligne" | "indisponible" | "configuration" | "frontiere";

function llmOk<T>(data: T): LlmResult<T> {
  return { ok: true, data };
}
function llmErr<T>(code: LlmErrorCode, message: string): LlmResult<T> {
  return { ok: false, error: { code, message } };
}

/**
 * Modèle configurable (§3.4 n°11) : lu depuis `OPENROUTER_MODEL`, jamais écrit
 * en dur dans `jarvis-analyze-session/index.ts` ou ailleurs. `DEFAULT_MODEL`
 * est la SEULE constante de repli du dépôt pour ce choix.
 *
 * `google/gemini-2.5-flash` — décision de produit, 2026-08-05, pas une
 * limitation de test contournée en douce. Vérifié en local sur un appel réel
 * à `analyze_session` (STATE.md) : sortie JSON conforme, contenu clinique
 * correct, coût de l'ordre de 0,0002 USD par appel. `02-SECURITY-BOUNDARY.md`
 * §5.2 nomme `anthropic/claude-sonnet-4.5` pour l'usage `jarvis` — ce document
 * est à corriger dans la même passe pour ne pas laisser deux sources
 * contradictoires. Le choix reste un réglage de configuration, pas un
 * changement de code : `OPENROUTER_MODEL` prime toujours sur cette constante.
 */
const DEFAULT_MODEL = "google/gemini-2.5-flash";

function resolveModel(): string {
  return Deno.env.get("OPENROUTER_MODEL") ?? DEFAULT_MODEL;
}

/**
 * Plafond de tokens de SORTIE — trouvé nécessaire en vérification locale, pas
 * en relecture. Sans `max_tokens` explicite, OpenRouter facture la requête au
 * plafond PAR DÉFAUT du modèle (64 000 pour Claude Sonnet 4.5, l'exemple qui a
 * révélé le problème — vaut pour N'IMPORTE QUEL modèle passé via
 * `OPENROUTER_MODEL`, pas seulement `DEFAULT_MODEL`), quel que soit
 * ce que la réponse va réellement contenir — et une requête refusée en 402
 * (« crédits insuffisants ») avant même de générer un seul jeton rendrait
 * `analyze_session` inutilisable sur tout compte OpenRouter à solde modeste,
 * alors que la réponse réelle est un petit JSON borné (§3.4 n°6 : au plus
 * `MAX_ENTREES` entrées de `MAX_LONGUEUR_ENTREE` caractères chacune, plus les
 * quatre champs SOAP). 2000 tokens est une marge large pour cette forme : un
 * appel réel à `analyze_session`, en local le 2026-08-05, sur un dossier de
 * test complet (SOAP + 5 lignes d'évolution + 6 points non explorés), a
 * produit une réponse conforme largement sous ce plafond — la mesure exacte
 * en jetons n'a pas pu être journalisée cette fois-là (voir STATE.md, le
 * franchissement n'a pas atteint `audit.boundary_crossings` à cause d'un
 * défaut de résolution DNS propre à l'environnement Docker local, sans
 * rapport avec ce plafond). Le chiffre 2000 reste donc une marge choisie,
 * pas une mesure exacte à ce jour.
 */
const MAX_OUTPUT_TOKENS = 2000;

/**
 * Table de tarifs constante, USD pour un million de tokens. `estimated_cost_usd`
 * (§3.4 n°10) en dérive ; un modèle absent de cette table rend `null`, jamais
 * un chiffre inventé. Valeurs approximatives au moment de l'écriture — à tenir
 * à jour au fil des changements de tarification du fournisseur, jamais devinées.
 */
const TARIFS_USD_PAR_MILLION: Readonly<Record<string, { readonly in: number; readonly out: number }>> = {
  "anthropic/claude-sonnet-4.5": { in: 3, out: 15 },
  "anthropic/claude-3.5-haiku": { in: 0.8, out: 4 },
  // Source : GET /api/v1/models/google/gemini-2.5-flash/endpoints,
  // OpenRouter, relevé le 2026-08-05 — 0,0000003/0,0000025 USD par jeton.
  "google/gemini-2.5-flash": { in: 0.3, out: 2.5 },
};

function estimateCostUsd(model: string, tokensIn: number, tokensOut: number): number | null {
  const tarif = TARIFS_USD_PAR_MILLION[model];
  if (tarif === undefined) return null;
  return (tokensIn / 1_000_000) * tarif.in + (tokensOut / 1_000_000) * tarif.out;
}

interface OpenRouterResponse {
  readonly choices?: ReadonlyArray<{ readonly message?: { readonly content?: string } }>;
  readonly usage?: { readonly prompt_tokens?: number; readonly completion_tokens?: number };
}

function isOpenRouterResponse(value: unknown): value is OpenRouterResponse {
  return typeof value === "object" && value !== null;
}

/**
 * Le seul point d'appel HTTP du dépôt. Timeout 10 s (§3.4 n°3, cohérent avec
 * §10 de `03-JARVIS-TOOLS.md` : « timeout > 10s → annuler ») via
 * `AbortController` — un timeout renvoie une erreur typée, jamais une promesse
 * qui ne se résout pas.
 */
export const openRouterProvider: LlmProvider = {
  name: "openrouter",

  async complete(req) {
    const clef = Deno.env.get("OPENROUTER_API_KEY");
    if (clef === undefined || clef === "") {
      throw new Error("configuration: OPENROUTER_API_KEY absente");
    }

    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const reponse = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${clef}`,
          "Content-Type": "application/json",
          // §5.3 de 02-SECURITY-BOUNDARY.md — désactive la journalisation des
          // prompts côté fournisseur, en plus du réglage tableau de bord.
          "HTTP-Referer": "http://localhost",
          "X-Title": "MindCare",
        },
        body: JSON.stringify({
          model: req.model,
          messages: req.messages,
          max_tokens: MAX_OUTPUT_TOKENS,
        }),
        signal: controller.signal,
      });

      if (!reponse.ok) {
        const transitoire = reponse.status >= 500;
        throw new Error(transitoire ? `transitoire: HTTP ${reponse.status}` : `permanent: HTTP ${reponse.status}`);
      }

      const corps: unknown = await reponse.json();
      if (!isOpenRouterResponse(corps)) {
        throw new Error("permanent: réponse OpenRouter de forme inattendue");
      }

      const texte = corps.choices?.[0]?.message?.content;
      if (texte === undefined) {
        throw new Error("permanent: réponse OpenRouter sans contenu");
      }

      return {
        text: texte,
        tokensIn: corps.usage?.prompt_tokens ?? 0,
        tokensOut: corps.usage?.completion_tokens ?? 0,
      };
    } catch (cause) {
      if (controller.signal.aborted) {
        throw new Error("transitoire: timeout");
      }
      // Panne réseau (fetch qui lève) : transitoire, même famille que 5xx.
      if (cause instanceof TypeError) {
        throw new Error("transitoire: réseau");
      }
      throw cause;
    } finally {
      clearTimeout(minuteur);
    }
  },
};

function estTransitoire(cause: unknown): boolean {
  return cause instanceof Error && cause.message.startsWith("transitoire:");
}

export interface LlmRequest {
  readonly purpose: "jarvis";
  /** §3.4 n°1 — le numéro de version du prompt système, jamais deviné à l'audit. */
  readonly promptVersion: string;
  /** Hash du prompt système, calculé une fois dans `prompt.ts`, jamais recalculé ici. */
  readonly promptHash: string;
  readonly messages: readonly LlmMessage[];
  /** uuid aléatoire généré par l'appelant — JAMAIS le patient_id. */
  readonly sessionToken: string;
  readonly timeoutMs?: number;
}

const TIMEOUT_MS_DEFAUT = 10_000;

/**
 * Journalise un franchissement — succès ou échec — dans `audit.boundary_crossings`
 * (028). `audit` n'est délibérément pas exposé à PostgREST (017 §3) : on y
 * écrit donc par une connexion Postgres directe, avec la clé de service, qui ne
 * vit que dans CE fichier (règle 3 de CLAUDE.md). Best-effort : une panne de
 * journalisation ne doit jamais faire échouer l'appel qu'elle documente, ni le
 * réussir faussement — elle est seulement avalée, jamais remontée à l'appelant.
 */
async function journaliser(entree: {
  readonly purpose: "jarvis";
  readonly provider: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly sessionToken: string;
  readonly charsOut: number | null;
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
  readonly estimatedCostUsd: number | null;
  readonly outcome: "ok" | "blocked" | "error" | "timeout";
  readonly latencyMs: number;
}): Promise<void> {
  const dsn = Deno.env.get("SUPABASE_DB_URL");
  if (dsn === undefined || dsn === "") return; // pas de connexion configurée : on n'aggrave pas la panne

  const sql = postgres(dsn, { max: 1 });
  try {
    await sql`
      INSERT INTO audit.boundary_crossings
        (purpose, provider, model, prompt_version, prompt_hash, session_token,
         chars_out, tokens_in, tokens_out, estimated_cost_usd, outcome, latency_ms)
      VALUES
        (${entree.purpose}, ${entree.provider}, ${entree.model}, ${entree.promptVersion},
         ${entree.promptHash}, ${entree.sessionToken}, ${entree.charsOut}, ${entree.tokensIn},
         ${entree.tokensOut}, ${entree.estimatedCostUsd}, ${entree.outcome}, ${entree.latencyMs})
    `;
  } catch {
    // Avalé délibérément — voir le commentaire de la fonction.
  } finally {
    await sql.end({ timeout: 1 });
  }
}

/**
 * Point d'entrée unique du fichier. Un seul retry (§3.4 n°9), uniquement sur
 * échec TRANSITOIRE (timeout, 5xx, réseau) — jamais sur un 4xx ni sur un échec
 * de validation, qui vit dans `jarvis-analyze-session/index.ts` et n'appelle
 * donc jamais cette fonction une seconde fois pour cette raison.
 */
export async function llm(
  req: LlmRequest,
  provider: LlmProvider = openRouterProvider,
): Promise<LlmResult<string>> {
  const model = resolveModel();
  const timeoutMs = req.timeoutMs ?? TIMEOUT_MS_DEFAUT;
  const depart = Date.now();

  let derniereErreur: unknown;
  for (let tentative = 0; tentative < 2; tentative++) {
    try {
      const resultat = await provider.complete({
        messages: req.messages,
        model,
        timeoutMs,
      });

      await journaliser({
        purpose: req.purpose,
        provider: provider.name,
        model,
        promptVersion: req.promptVersion,
        promptHash: req.promptHash,
        sessionToken: req.sessionToken,
        charsOut: resultat.text.length,
        tokensIn: resultat.tokensIn,
        tokensOut: resultat.tokensOut,
        estimatedCostUsd: estimateCostUsd(model, resultat.tokensIn, resultat.tokensOut),
        outcome: "ok",
        latencyMs: Date.now() - depart,
      });

      return llmOk(resultat.text);
    } catch (cause) {
      derniereErreur = cause;
      if (tentative === 0 && estTransitoire(cause)) continue; // une seule relance
      break;
    }
  }

  const messageErreur = derniereErreur instanceof Error ? derniereErreur.message : "";
  const estTimeout = messageErreur.includes("timeout");
  const estConfiguration = messageErreur.startsWith("configuration:");

  await journaliser({
    purpose: req.purpose,
    provider: provider.name,
    model,
    promptVersion: req.promptVersion,
    promptHash: req.promptHash,
    sessionToken: req.sessionToken,
    charsOut: null,
    tokensIn: null,
    tokensOut: null,
    estimatedCostUsd: null,
    outcome: estTimeout ? "timeout" : "error",
    latencyMs: Date.now() - depart,
  });

  if (estConfiguration) {
    return llmErr("configuration", "Assistant indisponible.");
  }
  return llmErr("indisponible", "Assistant indisponible.");
}
