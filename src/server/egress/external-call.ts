/**
 * `external-call.ts` — LE SEUL FICHIER DU DÉPÔT QUI APPELLE UN SERVICE EXTERNE.
 * (OpenRouter pour le texte ; depuis V2, Groq pour la transcription et
 * ElevenLabs pour la synthèse — voir §VOIX en bas de fichier.)
 *
 * `scripts/preflight.sh` §1 n'exempte que ce chemin LITTÉRAL du grep
 * anti-fetch. Ne pas renommer ce fichier, même si `02-SECURITY-BOUNDARY.md`
 * §5.1 nomme `_shared/llm.ts` pour la même passerelle — l'incohérence de
 * nommage entre les documents est tranchée par le préflight réel (STATE.md,
 * décision de session S6 n°1). Le `fetch()` réel vit ici et nulle part
 * ailleurs.
 *
 * Règle 3 de CLAUDE.md : `OPENROUTER_API_KEY` et la clé `service_role` ne
 * vivent QUE dans l'environnement serveur (`.env`, jamais commité), jamais
 * transmises au client, jamais dans un autre fichier.
 */

// deno-lint-ignore-file no-explicit-any

/**
 * Motif du franchissement de frontière. Fermé, et fermé DEUX FOIS : ici par le
 * type, et en base par `boundary_crossings_purpose_check` (034). Le type seul
 * ne suffirait pas — il disparaît à la compilation, la contrainte non.
 *
 * `voix-entree` et `voix-sortie` ne sont pas une seule valeur `voix` parce que
 * les deux sens ne portent pas le même risque : à l'entrée sort de l'AUDIO, que
 * rien ne sait pseudonymiser ; à la sortie sort du TEXTE déjà composé. 034
 * développe le raisonnement.
 */
import { withEgressGate } from "@/server/db/withCaller";
import { classerCharge, MESSAGE_REFUS_FRONTIERE } from "@/server/egress/classification";
import { env } from "@/server/env";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { alexa } from "@/i18n/alexa";
import { ErreurModele, annulationDemandee, classerErreurHttp, normaliserErreurModele, type CodeErreurModele, type TentativeInference } from "./erreurs-modele";
import { PoolModelesGratuits, type BesoinModele, type QualificationModele, type ModeleGratuit } from "./modeles-gratuits";
import { conduireInference } from "./tentatives-inference";

export type BoundaryPurpose = "jarvis" | "voix-entree" | "voix-sortie" | "resume-cas" | "communication";

/**
 * ⚠️ `"assistant"` AJOUTÉ EN V-JARVIS-CORE — et c'est un changement de
 * contrat, pas un confort. Le replay multi-tours de la conversation exige de
 * rendre au modèle ses réponses antérieures sous LE RÔLE qu'il attend ; les
 * faire passer pour des tours `user` produirait un dialogue que le modèle
 * relit mal. Les trois passerelles existantes n'envoient jamais ce rôle :
 * l'union élargie leur est invisible.
 */
export type LlmRole = "system" | "user" | "assistant";

export interface LlmMessage {
  readonly role: LlmRole;
  readonly content: string;
}

/**
 * Fournisseur abstrait — §3.4 n°2 de la revue Staff Engineer. « OpenRouter »
 * reste un CHOIX DE CONFIGURATION, pas une hypothèse répétée dans la logique
 * métier de `jarvis-analyze-session/index.ts`. `openRouterProvider`, plus bas,
 * est aujourd'hui le seul fournisseur réel.
 *
 * ⚠️ `stream()` — V-JARVIS-CORE. Même contrat que `complete()`, en deltas :
 * le fournisseur rend un flux de fragments texte ET une promesse d'usage qui
 * se résout à la fin du flux (ou se rejette si le flux échoue/est abandonné).
 * La promesse d'usage est LE point de jonction de la journalisation : c'est
 * là que `llmStream()` sait comment le franchissement s'est terminé.
 */
export interface LlmProvider {
  readonly name: string;
  complete(req: {
    readonly messages: readonly LlmMessage[];
    readonly model: string;
    readonly timeoutMs: number;
    readonly signal?: AbortSignal;
    readonly json?: boolean;
    readonly jsonMode?: boolean;
    readonly maxOutputTokens?: number;
  }): Promise<{ readonly text: string; readonly tokensIn: number; readonly tokensOut: number }>;
  stream(req: {
    readonly messages: readonly LlmMessage[];
    readonly model: string;
    readonly timeoutMs: number;
    /** Abandon demandé par l'appelant (client parti, bouton Stop). */
    readonly signal?: AbortSignal;
    readonly json?: boolean;
    readonly jsonMode?: boolean;
    readonly maxOutputTokens?: number;
    readonly idleTimeoutMs?: number;
    /** Absolute total deadline; meaningful deltas never extend it. */
    readonly deadlineMs?: number;
  }): Promise<FluxTexte>;
}

/** Usage tel que le fournisseur l'a rendu — null quand il n'en dit rien. */
export interface UsageJeton {
  readonly tokensIn: number | null;
  readonly tokensOut: number | null;
}

export interface FluxTexte {
  /** Fragments de texte, dans l'ordre d'émission du modèle. */
  readonly deltas: ReadableStream<string>;
  /**
   * Se RÉSOUT quand le flux s'est terminé proprement, SE REJETTE sur erreur
   * réseau, timeout inter-fragments ou abandon. C'est délibérément la même
   * promesse pour les trois issues : le consommateur n'a pas à distinguer
   * ici — `llmStream()` journalise selon son issue, point.
   */
  readonly usage: Promise<UsageJeton>;
}

/**
 * Transcription — audio vers texte. Séparée de `LlmProvider` et non greffée
 * dessus : `complete()` prend des messages et rend du texte, `transcribe()`
 * prend des octets et rend du texte. Les réunir derrière une seule interface
 * obligerait chaque implémentation à porter des champs qui ne la concernent
 * pas, et c'est ainsi qu'un fournisseur de texte finit par recevoir de l'audio.
 *
 * `audio` est un `Uint8Array` EN MÉMOIRE. Il n'existe aucun chemin d'écriture
 * disque dans ce fichier — ni `Deno.writeFile`, ni `Deno.makeTempFile`, ni
 * flux vers `/tmp`. ADR-009 l'exige et c'est vérifiable par lecture : le seul
 * usage d'`audio` est le corps du `fetch`.
 */
export interface SttProvider {
  readonly name: string;
  transcribe(req: {
    readonly audio: Uint8Array;
    readonly mimeType: string;
    readonly language: string;
    readonly model: string;
    readonly timeoutMs: number;
  }): Promise<{ readonly text: string }>;
}

/**
 * Synthèse — texte vers audio. L'audio rendu ne touche pas davantage le disque :
 * il remonte à l'appelant, qui le renvoie au navigateur et l'oublie.
 */
export interface TtsProvider {
  readonly name: string;
  synthesize(req: {
    readonly text: string;
    readonly voiceId: string;
    readonly model: string;
    readonly timeoutMs: number;
  }): Promise<{ readonly audio: Uint8Array; readonly mimeType: string }>;
}

export type LlmResult<T> =
  | { readonly ok: true; readonly data: T; readonly inference?: { readonly model: string; readonly tentatives: readonly TentativeInference[] } }
  | { readonly ok: false; readonly error: { readonly code: LlmErrorCode; readonly message: string; readonly diagnostic?: CodeErreurModele; readonly tentatives?: readonly TentativeInference[] } };

export type LlmErrorCode =
  | "hors-ligne"
  | "indisponible"
  | "configuration"
  | "frontiere"
  /**
   * Refus explicite du PROVIDER (Meta), distingué de « indisponible » parce
   * qu'il n'est ni transitoire niazi de configuration locale : c'est une
   * décision d'exploitation côté Meta (app Live, business verification,
   * fenêtre 24 h, destinataire). Le message joint dit laquelle — rejouer
   * sans rien changer ne servirait à rien.
   */
  | "refus-provider";

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
 * correct, coût de l'ordre de 0,0002 USD par appel.
 *
 * Audit Slice 1 (2026-09-30) — le repli passe à `google/gemini-3.8-flash`
 * (GA 2026-09-02, vérifié au registre OpenRouter : slug exact, tarif
 * 0,75/3,75 USD par million de jetons). L'ancien 2.5 reste valide si
 * quelqu'un l'épingle explicitement via `OPENROUTER_MODEL`.
 *
 * ⚠️ CE COMMENTAIRE A DIT LE CONTRAIRE, ET C'ÉTAIT FAUX. Il annonçait que
 * `02-SECURITY-BOUNDARY.md` §5.2 nommait `anthropic/claude-sonnet-4.5` pour
 * l'usage `jarvis`, et réclamait sa correction. Vérification faite le
 * 2026-08-16 : §5.2 attribue déjà `google/gemini-2.5-flash` à `jarvis`, avec
 * le même arbitrage du 2026-08-05. Sonnet 4.5 y est associé à `note_draft`,
 * un *purpose* non implémenté dont l'entrée reste indicative. Les deux sources
 * concordent ; il n'y a rien à arbitrer. Une contradiction annoncée qui
 * n'existe pas coûte la relecture de celui qui vient la vérifier.
 *
 * Le choix reste un réglage de configuration, pas un changement de code :
 * `OPENROUTER_MODEL` prime toujours sur cette constante.
 */
const DEFAULT_MODEL = "google/gemini-3.8-flash";

/**
 * ⚠️ EXPORTÉE PARCE QUE DEUX APPELANTS LA RECOPIAIENT, ET MAL.
 *
 * `jarvis-analyze-session` et `jarvis-resume-cas` réécrivaient cette chaîne à
 * la main pour renseigner `p_model` dans leur trace d'audit. Le modèle
 * réellement APPELÉ était déjà le bon — `llm()` résout ici, et lui seul — mais
 * la valeur ENREGISTRÉE venait d'une copie. Deux façons de rater :
 *
 *   · `resume-cas` omettait `LLM_MODEL` de sa chaîne. Avec `LLM_MODEL` seul
 *     posé, l'appel partait sur ce modèle et l'audit inscrivait
 *     « google/gemini-2.5-flash ». Une trace d'audit qui nomme un modèle qui
 *     n'a pas été utilisé est pire qu'une trace absente.
 *   · toute évolution de `DEFAULT_MODEL` ici laissait les deux copies derrière,
 *     silencieusement.
 *
 * L'exporter ne relâche rien : elle ne lit que la configuration, n'ouvre aucune
 * connexion et ne porte aucun secret. La passerelle reste le SEUL point de
 * sortie réseau ; c'est le point de sortie qui est gardé, pas la lecture d'un
 * nom de modèle.
 */
export function resolveModel(purpose?: "jarvis" | "resume-cas"): string {
  // Audit Slice 1 — surcharge par usage AVANT le global : un modèle gratuit
  // de test (`JARVIS_CHAT_MODEL=nvidia/…:free`) n'affecte que la conversation,
  // jamais le résumé — et inversement. L'appel réel (`llm`/`llmStream`
  // ci-dessous) passe TOUJOURS par ici avec le purpose de la requête : le
  // modèle facturé et le modèle audité ne peuvent plus diverger (le défaut
  // `resume-cas`/`LLM_MODEL` de 2026-08 ne peut pas revenir par ce chemin).
  const e = env();
  if (purpose === "resume-cas" && e.JARVIS_RESUME_MODEL !== undefined) {
    return e.JARVIS_RESUME_MODEL;
  }
  if (purpose === "jarvis" && e.JARVIS_CHAT_MODEL !== undefined) {
    return e.JARVIS_CHAT_MODEL;
  }
  return e.OPENROUTER_MODEL ?? e.LLM_MODEL ?? DEFAULT_MODEL;
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
 * Plafond SPÉCIFIQUE AU FLUX conversationnel — V-JARVIS-CORE, trouvé par
 * mesure (`sonde-variantes-nemotron.mjs`), pas supposé. Le modèle courant est
 * un modèle À RAISONNEMENT : ses jetons de réflexion interne comptent DANS la
 * complétion d'OpenRouter — mesuré, 1919 jetons de réflexion pour une réponse
 * de quelques mots. Sous l'ancien plafond unique (2000), il ne restait donc
 * RIEN pour le texte affiché, et la réponse sortait tronquée. Le flux
 * conversationnel réclame une marge où la réflexion ET la réponse tiennent ;
 * 8000 couvre les deux avec largeur, sans toucher au plafond des enveloppes
 * JSON structurées, dont la forme bornée reste exactement ce qu'elle était.
 */
const MAX_OUTPUT_TOKENS_FLUX = 8000;

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
  // Audit Slice 1 — repli courant. Source : page OpenRouter
  // `google/gemini-3.8-flash`, relevé le 2026-09-30 (tarif d'introduction
  // jusqu'au 2026-12-31, puis 1,50/7,50 — à réviser à cette date).
  "google/gemini-3.8-flash": { in: 0.75, out: 3.75 },
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
/** A single network transport. Retries belong to the pool, never the provider. */
export const openRouterProvider: LlmProvider = {
  name: "openrouter",
  async complete(req) {
    const c = new AbortController();
    const cancel = () => c.abort(req.signal?.reason);
    if (req.signal?.aborted) throw normaliserErreurModele(req.signal.reason, annulationDemandee(req.signal));
    req.signal?.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(() => c.abort(), req.timeoutMs);
    try {
      const response = await envoyerChatOpenRouter(req, false, c.signal);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) throw classerErreurHttp(response.status, body, response.headers);
      if (!isOpenRouterResponse(body)) throw new ErreurModele("MALFORMED_RESPONSE", true);
      const text = body.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim() === "") throw new ErreurModele("MALFORMED_RESPONSE", true);
      if (req.json) { try { JSON.parse(text); } catch { throw new ErreurModele("MALFORMED_RESPONSE", true); } }
      return { text, tokensIn: body.usage?.prompt_tokens ?? 0, tokensOut: body.usage?.completion_tokens ?? 0 };
    } catch (cause) {
      if (c.signal.aborted && !req.signal?.aborted) throw new ErreurModele("MODEL_TIMEOUT", true);
      throw normaliserErreurModele(req.signal?.aborted ? req.signal.reason : cause, annulationDemandee(req.signal));
    } finally { clearTimeout(timer); req.signal?.removeEventListener("abort", cancel); }
  },
  async stream(req) {
    if (req.signal?.aborted) throw normaliserErreurModele(req.signal.reason, annulationDemandee(req.signal));
    const c = new AbortController();
    const cancel = () => c.abort(req.signal?.reason);
    req.signal?.addEventListener("abort", cancel, { once: true });
    let timer = setTimeout(() => c.abort(), req.timeoutMs);
    let resolveUsage!: (usage: UsageJeton) => void;
    let rejectUsage!: (cause: unknown) => void;
    const usage = new Promise<UsageJeton>((resolve, reject) => { resolveUsage = resolve; rejectUsage = reject; });
    void usage.catch(() => {}); // The caller attaches after the first content; never an unhandled rejection.
    let firstResolve!: () => void;
    let firstReject!: (cause: unknown) => void;
    const first = new Promise<void>((resolve, reject) => { firstResolve = resolve; firstReject = reject; });
    let delivered = false;
    let cancelled = false;
    let out!: ReadableStreamDefaultController<string>;
    const deltas = new ReadableStream<string>({
      start(controller) { out = controller; },
      cancel() { cancelled = true; c.abort(); rejectUsage(new ErreurModele("CANCELLED", false, "request")); },
    });
    try {
      const response = await envoyerChatOpenRouter(req, true, c.signal);
      if (!response.ok) throw classerErreurHttp(response.status, await response.json().catch(() => null), response.headers);
      if (!response.body) throw new ErreurModele("MALFORMED_RESPONSE", true, "model", 0, "empty-content");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      void (async () => {
        let buffer = "";
        let ended = false;
        let finish = false;
        let bytes = 0;
        let finalUsage: UsageJeton = { tokensIn: null, tokensOut: null };
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            if (buffer.length > 1_000_000) throw new ErreurModele("MALFORMED_RESPONSE", true, "model", 0, "size-limit");
            const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
            for (const line of lines) {
              const t = line.trim();
              if (!t.startsWith("data:")) continue;
              const data = t.slice(5).trim();
              if (data === "[DONE]") { ended = true; continue; }
              let raw: unknown;
              try { raw = JSON.parse(data); } catch { throw new ErreurModele("MALFORMED_RESPONSE", true, "model", 0, "invalid-json"); }
              if (typeof raw !== "object" || raw === null) throw new ErreurModele("MALFORMED_RESPONSE", true, "model", 0, "invalid-event");
              const event = raw as {
                error?: { code?: number };
                choices?: { delta?: { content?: unknown }; finish_reason?: string | null }[];
                usage?: { prompt_tokens?: number; completion_tokens?: number };
              };
              if (event.error) throw classerErreurHttp(event.error.code ?? 502, raw, response.headers);
              const choice = event.choices?.[0];
              if (choice?.finish_reason === "error") throw new ErreurModele("PROVIDER_UNAVAILABLE", true);
              if (choice?.finish_reason === "length") throw new ErreurModele("MALFORMED_RESPONSE", true, "model", 0, "truncated");
              if (choice?.finish_reason === "stop") finish = true;
              const content = choice?.delta?.content;
              if (typeof content === "string" && content.length > 0) {
                bytes += content.length;
                if (bytes > 40_000) throw new ErreurModele("MALFORMED_RESPONSE", true, "model", 0, "size-limit");
                out.enqueue(content);
                if (!delivered) { delivered = true; firstResolve(); }
                clearTimeout(timer);
                timer = setTimeout(() => c.abort(), Math.max(1, Math.min(req.idleTimeoutMs ?? 10_000, (req.deadlineMs ?? Infinity) - Date.now())));
              }
              // Reasoning/keepalives never extend the first meaningful-token deadline.
              if (event.usage) finalUsage = { tokensIn: event.usage.prompt_tokens ?? null, tokensOut: event.usage.completion_tokens ?? null };
            }
            if (ended) break;
          }
          if (!delivered || (!ended && !finish)) throw new ErreurModele("MALFORMED_RESPONSE", true, "model", 0, delivered ? "premature-end" : "empty-content");
          if (!cancelled) out.close(); resolveUsage(finalUsage);
        } catch (cause) {
          const error = c.signal.aborted && !req.signal?.aborted && !cancelled
            ? new ErreurModele("MODEL_TIMEOUT", true) : normaliserErreurModele(req.signal?.aborted ? req.signal.reason : cause, annulationDemandee(req.signal) || cancelled);
          if (!delivered) firstReject(error);
          if (!cancelled) out.error(error);
          rejectUsage(error);
        } finally {
          clearTimeout(timer); req.signal?.removeEventListener("abort", cancel);
          await reader.cancel().catch(() => {}); reader.releaseLock();
        }
      })();
      await first;
      return { deltas, usage };
    } catch (cause) {
      clearTimeout(timer); c.abort(); req.signal?.removeEventListener("abort", cancel);
      const error = normaliserErreurModele(req.signal?.aborted ? req.signal.reason : cause, annulationDemandee(req.signal));
      rejectUsage(error);
      // Consume a stream rejected before exposure so it cannot leave an unobserved failure.
      await deltas.cancel().catch(() => {});
      throw error;
    }
  },
};

interface RequeteTransport {
  readonly messages: readonly LlmMessage[];
  readonly model: string;
  readonly json?: boolean;
  readonly jsonMode?: boolean;
  readonly maxOutputTokens?: number;
}
async function envoyerChatOpenRouter(req: RequeteTransport, stream: boolean, signal: AbortSignal): Promise<Response> {
  const key = env().OPENROUTER_API_KEY;
  if (!key) throw new ErreurModele("CONFIGURATION", false, "account");
  if (!req.model.endsWith(":free")) throw new ErreurModele("CONFIGURATION", false, "request");
  return fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST", signal,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "HTTP-Referer": "http://localhost", "X-Title": "MindCare" },
    body: JSON.stringify({ model: req.model, messages: req.messages,
      max_tokens: req.maxOutputTokens ?? (stream ? MAX_OUTPUT_TOKENS_FLUX : MAX_OUTPUT_TOKENS),
      provider: { data_collection: "deny", max_price: { prompt: 0, completion: 0 } },
      ...(req.jsonMode ? { response_format: { type: "json_object" } } : {}),
      ...(stream ? { stream: true, usage: { include: true } } : {}),
    }),
  });
}

export function resolveLlmProvider(_model: string): LlmProvider {
  return openRouterProvider;
}

function estTransitoire(cause: unknown): boolean {
  return cause instanceof Error && cause.message.startsWith("transitoire:");
}

export interface LlmRequest {
  /**
   * Motif du franchissement, pour `audit.boundary_crossings`.
   *
   * ⚠️ CORRIGÉ AU PORTAGE — L'ANCIENNE DÉCLARATION ÉTAIT FAUSSE, ET PERSONNE
   * NE POUVAIT LE VOIR. Elle disait `Extract<BoundaryPurpose, "jarvis">`, avec
   * le commentaire « toujours `jarvis` pour un appel de texte ». Or
   * `jarvis-resume-cas` passe `"resume-cas"` depuis la migration 054, qui a
   * élargi la contrainte de 028 précisément pour l'accueillir.
   *
   * Le code déployé violait donc sa propre déclaration de type. Il tournait
   * quand même — les types s'effacent à l'exécution, et la base acceptait la
   * valeur — mais rien ne le signalait : `tsconfig.json` EXCLUT
   * `supabase/functions/`, et Deno ne type-vérifie pas au déploiement.
   *
   * C'est le portage vers Node qui l'a révélé, au premier `tsc`. L'autorité
   * est la contrainte SQL de 054, pas ce commentaire : on élargit donc le type
   * pour qu'il dise la vérité. Les motifs de VOIX restent exclus ici — ils
   * passent par `stt()` / `tts()`, qui ont leur propre signature.
   */
  readonly purpose: Extract<BoundaryPurpose, "jarvis" | "resume-cas">;
  /** §3.4 n°1 — le numéro de version du prompt système, jamais deviné à l'audit. */
  readonly promptVersion: string;
  /** Hash du prompt système, calculé une fois dans `prompt.ts`, jamais recalculé ici. */
  readonly promptHash: string;
  readonly messages: readonly LlmMessage[];
  /** uuid aléatoire généré par l'appelant — JAMAIS le patient_id. */
  readonly sessionToken: string;
  readonly timeoutMs?: number;
  /**
   * M05 — recu de transformation approuvee (C3). Absent par defaut : sans
   * recu, un agregat reste bloque. Le recu n'autorise jamais un C1/C2 : les
   * octets gagnent toujours contre le recu (voir `classification.ts`).
   */
  readonly egress?: { readonly transformId?: string };
  readonly besoin?: Partial<BesoinModele>;
  /**
   * V-JARVIS-CORE — abandon demandé en aval (client parti, bouton Stop).
   * Remonte jusqu'au fetch fournisseur : la génération s'arrête vraiment.
   */
  readonly signal?: AbortSignal;
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
  readonly purpose: BoundaryPurpose;
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
  // ⚠️ PLUS AUCUNE CONNEXION PRIVILÉGIÉE ICI — c'est le changement de fond du
  // portage. Ce code ouvrait auparavant une connexion Postgres DIRECTE avec la
  // clé de service, parce que le schéma `audit` n'est pas exposé à PostgREST.
  // Cette connexion contournait la RLS : elle pouvait lire n'importe quelle
  // table du cabinet, et seule la discipline (« ce code vit exclusivement dans
  // external-call.ts ») garantissait qu'elle ne le faisait pas.
  //
  // Elle est remplacée par `audit.log_boundary_crossing` (migration 071), une
  // porte qui ne sait faire qu'INSÉRER dans `audit.boundary_crossings`. La
  // garantie devient structurelle au lieu d'être une promesse.
  //
  // `withEgressGate` n'endosse aucun rôle : la transaction reste sous
  // `mindcare_app`, seul titulaire de l'EXECUTE. Une requête servie pour une
  // utilisatrice (donc sous `authenticated`) ne peut pas écrire ici — le
  // journal n'est pas forgeable depuis le réseau.
  try {
    await withEgressGate(async (q) => {
      await q.query(
        "SELECT audit.log_boundary_crossing($1,$2,$3,$4,$5,$6::uuid,$7,$8,$9,$10,$11,$12)",
        [
          entree.purpose,
          entree.provider,
          entree.model,
          entree.promptVersion,
          entree.promptHash,
          entree.sessionToken,
          entree.charsOut,
          entree.tokensIn,
          entree.tokensOut,
          entree.estimatedCostUsd,
          entree.outcome,
          entree.latencyMs,
        ],
      );
      return null;
    });
  } catch {
    // Avalé délibérément — voir le commentaire de la fonction. Une panne de
    // journalisation ne doit ni faire échouer l'appel qu'elle documente, ni le
    // faire réussir faussement.
  }
}

/**
 * Point d'entrée unique : trois modèles gratuits distincts au maximum,
 * dans un budget commun. Aucun rejeu après publication d'un delta.
 *
 * M05 — LA FRONTIERE S'APPLIQUE ICI, AVANT TOUT FOURNISSEUR. `classerCharge`
 * tranche sur les octets serialises des messages : C1/C2/INCONNU et C3 sans
 * recu ne donnent JAMAIS lieu a un appel reseau (zero-byte invariant). Le
 * refus est honnete (`frontiere`) et journalise en metadonnees seules.
 */
const poolOpenRouter = new PoolModelesGratuits();
let catalogueDate = 0;
let catalogueEnCours: Promise<void> | null = null;
let qualificationEnCours: Promise<void> | null = null;
let qualificationsChargees = false;
const preuvesQualification = new Map<string, { readonly model: string; readonly code: string; readonly detail?: ErreurModele["detail"]; readonly phase: "transport" | "json" | "langues" | "ok" }>();
const QUALIFICATION_VERSION = "alexa-free-multilingual-v3";

function fichierQualifications(): string {
  return env().OPENROUTER_QUALIFICATION_FILE ?? join(process.cwd(), ".cache", "alexa", "openrouter-free-qualification.json");
}
async function chargerQualifications(): Promise<void> {
  try {
    const document: unknown = JSON.parse(await readFile(fichierQualifications(), "utf8"));
    const d = document as { version?: string; at?: number; compte?: { until: number; code: CodeErreurModele | null }; models?: { id: string; qualification: QualificationModele | null; health?: Partial<ModeleGratuit> }[] };
    if (d.version !== QUALIFICATION_VERSION || typeof d.at !== "number" || Date.now() - d.at > 86_400_000 || !Array.isArray(d.models)) return;
    if (d.compte) poolOpenRouter.restaurerCompte(d.compte);
    for (const m of d.models) {
      if (typeof m.id !== "string") continue;
      if (m.health) poolOpenRouter.restaurerSante(m.id, m.health);
      if (!m.qualification || typeof m.qualification.json !== "boolean"
        || typeof m.qualification.streaming !== "boolean" || !Number.isFinite(m.qualification.latenceMs)) continue;
      poolOpenRouter.qualifier(m.id, m.qualification);
      if (m.health) poolOpenRouter.restaurerSante(m.id, m.health);
    }
  } catch { /* A missing/stale local qualification never authorizes a model. */ }
}
async function sauverQualifications(): Promise<void> {
  const path = fichierQualifications();
  const models = poolOpenRouter.instantane().map((m) => ({ id: m.modelId, qualification: m.qualification,
    health: { failureCount: m.failureCount, cooldownUntil: m.cooldownUntil, latencyMs: m.latencyMs, lastFailureCode: m.lastFailureCode } }));
  try {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify({ version: QUALIFICATION_VERSION, at: Date.now(), compte: poolOpenRouter.statutCompte(), models }), { mode: 0o600 });
    await rename(temp, path);
  } catch { /* Memory still works; diagnostics must not interrupt the EMR. */ }
}

async function rafraichirCatalogue(signal?: AbortSignal, timeoutMs = 3000): Promise<void> {
  if (Date.now() - catalogueDate < 300_000) return;
  if (catalogueEnCours !== null) return catalogueEnCours;
  catalogueEnCours = (async () => {
    const response = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(Math.max(1, Math.min(3000, timeoutMs))),
    });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) throw classerErreurHttp(response.status, body, response.headers);
    const models = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(models)) throw new ErreurModele("MALFORMED_RESPONSE", true);
    poolOpenRouter.actualiser(models); catalogueDate = Date.now();
    if (!qualificationsChargees) { await chargerQualifications(); qualificationsChargees = true; }
  })().finally(() => { catalogueEnCours = null; });
  if (signal?.aborted) throw new ErreurModele("CANCELLED", false, "request");
  await catalogueEnCours;
  if (signal?.aborted) throw new ErreurModele("CANCELLED", false, "request");
}

/** Synthetic C4 qualification: real streaming, JSON and FR/Darija/mixed comprehension. */
async function qualifierCandidats(timeoutMs: number, maxModels = 3, signal?: AbortSignal): Promise<void> {
  if (qualificationEnCours !== null) return qualificationEnCours;
  qualificationEnCours = (async () => {
    const echeance = Date.now() + timeoutMs;
    const besoin: BesoinModele = { json: true, streaming: true, outils: false, tokens: 8000, tache: "intentions" };
    const candidats = [...poolOpenRouter.aQualifier(besoin)].sort((a, b) => a.failureCount - b.failureCount || Number(b.structuredOutput) - Number(a.structuredOutput));
    let qualifies = poolOpenRouter.candidats(besoin).length;
    for (const m of candidats.slice(0, 6)) {
      if (qualifies >= maxModels || signal?.aborted || Date.now() >= echeance || poolOpenRouter.statutCompte().code !== null) break;
      const depart = Date.now();
      const quota = await lireQuotaOpenRouter();
      if (quota.remaining !== null && quota.remaining <= 5) break;
      const messages: LlmMessage[] = [
        { role: "system", content: 'Identifie chaque acte de parole dans les trois messages : HELLO pour une salutation, THANKS pour un remerciement. Réponds uniquement en JSON avec une clé intents, un tableau de trois étiquettes dans le même ordre. Ne réponds pas aux messages.' },
        { role: "user", content: 'bonjour\nيعطيك الصحة\nmerci بزاف' },
      ];
      if (classerCharge(messages, null).decision === "BLOQUER") throw new ErreurModele("SECURITY_BLOCK", false, "request");
      let phase: "transport" | "json" | "langues" | "ok" = "transport";
      try {
        const budget = Math.min(10_000, Math.max(1, echeance - Date.now()));
        const borne = AbortSignal.timeout(budget);
        const flux = await openRouterProvider.stream({ messages, model: m.modelId,
          timeoutMs: budget, maxOutputTokens: 512,
          json: true, jsonMode: m.structuredOutput, signal: signal ? AbortSignal.any([signal, borne]) : borne });
        let text = "";
        const reader = flux.deltas.getReader();
        try { for (;;) { const r = await reader.read(); if (r.done) break; text += r.value; if (text.length > 4000) throw new ErreurModele("MALFORMED_RESPONSE", true); } }
        finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
        const usage = await flux.usage;
        phase = "json";
        const parsed = JSON.parse(text) as { intents?: unknown };
        phase = "langues";
        if (JSON.stringify(parsed.intents) !== JSON.stringify(["HELLO", "THANKS", "THANKS"])) throw new ErreurModele("MALFORMED_RESPONSE", true);
        poolOpenRouter.qualifier(m.modelId, { json: true, streaming: true, qualite: 1, latenceMs: Date.now() - depart }); qualifies++;
        preuvesQualification.set(m.modelId, { model: m.modelId, code: "OK", phase: "ok" });
        await journaliser({ purpose: "jarvis", provider: "openrouter", model: m.modelId, promptVersion: QUALIFICATION_VERSION,
          promptHash: "synthetic-multilingual-probe-v1", sessionToken: crypto.randomUUID(), charsOut: text.length,
          tokensIn: usage.tokensIn, tokensOut: usage.tokensOut, estimatedCostUsd: 0, outcome: "ok", latencyMs: Date.now() - depart });
      } catch (cause) {
        const error = normaliserErreurModele(cause, annulationDemandee(signal));
        // A qualification rejected by the provider's policy proves no usable
        // capability. Quarantine this probe; ordinary request policy errors
        // still stop immediately and do not degrade model health.
        poolOpenRouter.echouer(m.modelId, error.code === "POLICY_REJECTION"
          ? new ErreurModele(error.code, false, "model", error.retryAfterMs) : error);
        preuvesQualification.set(m.modelId, { model: m.modelId, code: error.code, detail: error.detail, phase });
        await journaliser({ purpose: "jarvis", provider: "openrouter", model: m.modelId, promptVersion: QUALIFICATION_VERSION,
          promptHash: "synthetic-multilingual-probe-v1", sessionToken: crypto.randomUUID(), charsOut: null,
          tokensIn: null, tokensOut: null, estimatedCostUsd: null, outcome: error.code === "MODEL_TIMEOUT" ? "timeout" : "error", latencyMs: Date.now() - depart });
      }
      if (qualifies < maxModels && Date.now() + 3500 < echeance) await new Promise((r) => setTimeout(r, 3500));
    }
    await sauverQualifications();
  })().finally(() => { qualificationEnCours = null; });
  return qualificationEnCours;
}

export async function lireQuotaOpenRouter(): Promise<{ readonly remaining: number | null; readonly used: number | null; readonly limit: number | null }> {
  const key = env().OPENROUTER_API_KEY;
  if (!key) throw new ErreurModele("CONFIGURATION", false, "account");
  const response = await fetch("https://openrouter.ai/api/v1/key", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(3000) });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw classerErreurHttp(response.status, body, response.headers);
  const quota = (body as { data?: { free_model_daily_requests?: { remaining?: unknown; used?: unknown; limit?: unknown } } } | null)?.data?.free_model_daily_requests;
  const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;
  return { remaining: number(quota?.remaining), used: number(quota?.used), limit: number(quota?.limit) };
}

/** Server-only diagnostics; returns IDs and closed health metadata, never keys or prompts. */
export async function preparerPoolModelesGratuits(opts: { readonly timeoutMs?: number; readonly maxModels?: number; readonly signal?: AbortSignal } = {}) {
  await rafraichirCatalogue(opts.signal);
  const quota = await lireQuotaOpenRouter();
  if (quota.remaining !== null && quota.remaining <= 5) {
    const maintenant = new Date();
    const reprise = Date.UTC(maintenant.getUTCFullYear(), maintenant.getUTCMonth(), maintenant.getUTCDate() + 1) - Date.now();
    poolOpenRouter.echouer("", new ErreurModele("MODEL_QUOTA_EXHAUSTED", false, "account", reprise));
    await sauverQualifications();
  } else {
    await qualifierCandidats(Math.min(60_000, opts.timeoutMs ?? 30_000), Math.min(3, opts.maxModels ?? 3), opts.signal);
  }
  return { quota, compte: poolOpenRouter.statutCompte(), modeles: poolOpenRouter.instantane(), probes: [...preuvesQualification.values()] };
}

function besoinInference(req: LlmRequest, streaming: boolean): BesoinModele {
  return { tache: req.besoin?.tache ?? (req.purpose === "resume-cas" ? "resume" : "conversation"),
    json: req.besoin?.json ?? false, streaming, outils: req.besoin?.outils ?? false,
    tokens: req.besoin?.tokens ?? Math.ceil(req.messages.reduce((n, m) => n + m.content.length, 0) / 2) + (streaming ? MAX_OUTPUT_TOKENS_FLUX : MAX_OUTPUT_TOKENS) };
}

async function candidatsInference(req: LlmRequest, streaming: boolean, provider: LlmProvider | undefined, echeance: number): Promise<readonly string[]> {
  if (provider !== undefined) return [resolveModel(req.purpose)]; // Existing synthetic provider seam: no external network.
  if (!env().OPENROUTER_API_KEY) throw new ErreurModele("CONFIGURATION", false, "account");
  await rafraichirCatalogue(req.signal, echeance - Date.now());
  const besoin = besoinInference(req, streaming);
  if (poolOpenRouter.candidats(besoin).length === 0) await qualifierCandidats(Math.max(0, echeance - Date.now()), 3, req.signal);
  const compte = poolOpenRouter.statutCompte();
  if (compte.code !== null) throw new ErreurModele(compte.code, false, "account", compte.until - Date.now());
  return poolOpenRouter.candidats(besoin, resolveModel(req.purpose)).map((m) => m.modelId);
}

function resultatErreur<T>(cause: unknown, signal?: AbortSignal): LlmResult<T> {
  const error = normaliserErreurModele(cause, signal?.aborted);
  const quota = error.code === "MODEL_QUOTA_EXHAUSTED" || (error.code === "MODEL_RATE_LIMIT" && error.scope === "account");
  return { ok: false, error: { code: error.code === "CONFIGURATION" || error.code === "AUTH_FAILURE" ? "configuration"
    : error.code === "SECURITY_BLOCK" ? "frontiere" : "indisponible",
    message: quota ? alexa.quota : error.code === "CONFIGURATION" || error.code === "AUTH_FAILURE" ? alexa.configuration : alexa.modeleIndisponible,
    diagnostic: error.code, tentatives: error.tentatives } };
}

async function autoriserInference(req: LlmRequest): Promise<boolean> {
  const verdict = classerCharge(req.messages, req.egress?.transformId === undefined ? null : { transformId: req.egress.transformId });
  if (verdict.decision !== "BLOQUER") return true;
  await journaliser({ purpose: req.purpose, provider: "openrouter", model: "free-pool", promptVersion: req.promptVersion,
    promptHash: req.promptHash, sessionToken: req.sessionToken, charsOut: null, tokensIn: null, tokensOut: null,
    estimatedCostUsd: null, outcome: "blocked", latencyMs: 0 });
  return false;
}

export async function llm(req: LlmRequest, provider?: LlmProvider): Promise<LlmResult<string>> {
  const depart = Date.now();
  if (!(await autoriserInference(req))) return llmErr("frontiere", MESSAGE_REFUS_FRONTIERE);
  const budget = req.timeoutMs ?? env().OPENROUTER_MODEL_TIMEOUT_MS ?? TIMEOUT_MS_DEFAUT;
  try {
    const modeles = await candidatsInference(req, false, provider, depart + budget);
    const resultat = await conduireInference(modeles, async (model, timeoutMs, signal) => {
      const m = poolOpenRouter.instantane().find((candidate) => candidate.modelId === model);
      return (provider ?? openRouterProvider).complete({ messages: req.messages, model, timeoutMs,
        signal: req.signal ? AbortSignal.any([signal, req.signal]) : signal,
        json: req.besoin?.json ?? false, jsonMode: (req.besoin?.json ?? false) && (m?.structuredOutput ?? false) });
    }, { timeoutMs: Math.max(0, budget - (Date.now() - depart)), ...(req.signal ? { signal: req.signal } : {}),
      ...(provider === undefined ? { reserver: (m: string) => poolOpenRouter.reserver(m) } : {}),
      surEchec: (m, e) => poolOpenRouter.echouer(m, e),
      surTentative: (t) => t.code === "OK" ? undefined : journaliser({ purpose: req.purpose, provider: (provider ?? openRouterProvider).name,
        model: t.model, promptVersion: req.promptVersion, promptHash: req.promptHash, sessionToken: req.sessionToken,
        charsOut: null, tokensIn: null, tokensOut: null, estimatedCostUsd: null, outcome: t.code === "MODEL_TIMEOUT" ? "timeout" : "error", latencyMs: t.ms }),
    });
    poolOpenRouter.reussir(resultat.model, Date.now() - depart);
    if (provider === undefined) await sauverQualifications();
    await journaliser({ purpose: req.purpose, provider: (provider ?? openRouterProvider).name, model: resultat.model,
      promptVersion: req.promptVersion, promptHash: req.promptHash, sessionToken: req.sessionToken,
      charsOut: resultat.data.text.length, tokensIn: resultat.data.tokensIn, tokensOut: resultat.data.tokensOut,
      estimatedCostUsd: provider === undefined ? 0 : estimateCostUsd(resultat.model, resultat.data.tokensIn, resultat.data.tokensOut),
      outcome: "ok", latencyMs: Date.now() - depart });
    return { ok: true, data: resultat.data.text, inference: { model: resultat.model, tentatives: resultat.tentatives } };
  } catch (cause) { if (provider === undefined) await sauverQualifications(); return resultatErreur(cause, req.signal); }
}

export async function llmStream(req: LlmRequest, provider?: LlmProvider): Promise<LlmResult<FluxTexte>> {
  const depart = Date.now();
  if (!(await autoriserInference(req))) return llmErr("frontiere", MESSAGE_REFUS_FRONTIERE);
  const budget = req.timeoutMs ?? env().OPENROUTER_MODEL_TIMEOUT_MS ?? TIMEOUT_MS_DEFAUT;
  try {
    const modeles = await candidatsInference(req, true, provider, depart + budget);
    const resultat = await conduireInference(modeles, (model, timeoutMs, signal) => (provider ?? openRouterProvider).stream({
      messages: req.messages, model, timeoutMs, idleTimeoutMs: budget,
      deadlineMs: depart + budget, json: req.besoin?.json ?? false,
      jsonMode: (req.besoin?.json ?? false) && (poolOpenRouter.instantane().find((m) => m.modelId === model)?.structuredOutput ?? false),
      signal: req.signal ? AbortSignal.any([signal, req.signal]) : signal,
    }), { timeoutMs: Math.max(0, budget - (Date.now() - depart)), ...(req.signal ? { signal: req.signal } : {}),
      ...(provider === undefined ? { reserver: (m: string) => poolOpenRouter.reserver(m) } : {}),
      surEchec: (m, e) => poolOpenRouter.echouer(m, e),
      surTentative: (t) => t.code === "OK" ? undefined : journaliser({ purpose: req.purpose, provider: (provider ?? openRouterProvider).name,
        model: t.model, promptVersion: req.promptVersion, promptHash: req.promptHash, sessionToken: req.sessionToken,
        charsOut: null, tokensIn: null, tokensOut: null, estimatedCostUsd: null, outcome: t.code === "MODEL_TIMEOUT" ? "timeout" : "error", latencyMs: t.ms }),
    });
    const { model } = resultat; const flux = resultat.data;
    if (provider === undefined) await sauverQualifications();
    let caracteres = 0;
    const deltas = flux.deltas.pipeThrough(new TransformStream<string, string>({ transform(frag, controller) { caracteres += frag.length; controller.enqueue(frag); } }));
    void flux.usage.then(async (usage) => {
      poolOpenRouter.reussir(model, Date.now() - depart);
      if (provider === undefined) await sauverQualifications();
      await journaliser({ purpose: req.purpose, provider: (provider ?? openRouterProvider).name, model, promptVersion: req.promptVersion,
        promptHash: req.promptHash, sessionToken: req.sessionToken, charsOut: caracteres, tokensIn: usage.tokensIn,
        tokensOut: usage.tokensOut, estimatedCostUsd: provider === undefined ? 0 : null, outcome: "ok", latencyMs: Date.now() - depart });
    }).catch(async (cause) => {
      const error = normaliserErreurModele(cause, req.signal?.aborted); poolOpenRouter.echouer(model, error);
      if (provider === undefined) await sauverQualifications();
      await journaliser({ purpose: req.purpose, provider: (provider ?? openRouterProvider).name, model, promptVersion: req.promptVersion,
        promptHash: req.promptHash, sessionToken: req.sessionToken, charsOut: caracteres || null, tokensIn: null,
        tokensOut: null, estimatedCostUsd: null, outcome: error.code === "MODEL_TIMEOUT" ? "timeout" : "error", latencyMs: Date.now() - depart });
    });
    return { ok: true, data: { deltas, usage: flux.usage }, inference: { model, tentatives: resultat.tentatives } };
  } catch (cause) { if (provider === undefined) await sauverQualifications(); return resultatErreur(cause, req.signal); }
}

// ═══════════════════════════════════════════════════════════════════════════
// VOIX — ADR-024. Deux sens, deux motifs, un seul point de sortie.
// ═══════════════════════════════════════════════════════════════════════════
//
// CE QUE CETTE SECTION NE FAIT PAS, ET POURQUOI C'EST LE POINT DÉLICAT.
// Elle ne pseudonymise rien, dans aucun des deux sens, et ce n'est pas un
// oubli — c'est le constat central d'ADR-024 :
//   · à l'ENTRÉE, ce qui sort est du SON. « Ouvre le dossier de Belkacem » part
//     avec le nom dedans. `pseudonymize.ts` traite le texte PRODUIT par la
//     transcription : il arrive une étape trop tard, par construction. Il
//     n'existe aucune façon de pseudonymiser un son.
//   · à la SORTIE, le texte nomme délibérément la patiente — « Karim Belkacem,
//     jeudi 15 h ». Le pseudonymiser ferait dire « P1, jeudi 15 h » à la
//     synthèse : la fonctionnalité disparaîtrait sans que le risque change de
//     nature, puisque c'est précisément ce nom que la praticienne demande à
//     entendre.
//
// LA VOIX CLOUD N'EST DONC PAS SÛRE EN SOI. Elle est légitime à une SEULE
// condition, celle qu'ADR-024 reprend d'ADR-016 : la base ne contient que des
// données synthétiques. Une transcription de données synthétiques ne franchit
// ni R1 ni la loi 18-07, parce qu'il n'y a rien à protéger.
//
// CETTE CONDITION EST DONC VÉRIFIÉE, PAS SUPPOSÉE. `garderVoix()` interroge
// `app.is_cloud_dev()` — la fonction que le déclencheur
// `assert_synthetic_when_cloud` (016) consulte lui-même — avant chaque appel.
// Le jour de la bascule au cabinet, `app.deployment` passe à `self-hosted`, et
// la voix cloud cesse de fonctionner d'elle-même, sans qu'on ait à se souvenir
// de la débrancher. Une checklist qu'on peut oublier n'est pas une frontière ;
// une porte qui refuse en est une.
//
// Deux verrous, donc, et il faut les DEUX :
//   1. `VOICE_PROVIDER=cloud`      — le choix explicite de l'exploitant ;
//   2. `app.is_cloud_dev() = true` — l'état réel de la base.

const TIMEOUT_VOIX_MS_DEFAUT = 15_000;

/** Groq, `whisper-large-v3-turbo` par défaut (ADR-024). Surchargeable. */
const STT_MODEL_DEFAUT = "whisper-large-v3-turbo";
/** ElevenLabs. `multilingual` : la voix française est un CHOIX de voix, pas de modèle. */
const TTS_MODEL_DEFAUT = "eleven_multilingual_v2";

/**
 * Les deux verrous d'ADR-024. Rend `null` si la voix est autorisée, sinon
 * l'erreur typée à renvoyer telle quelle.
 *
 * ⚠️ AUCUN REPLI SILENCIEUX. Si `VOICE_PROVIDER` vaut `local`, cette fonction
 * REFUSE au lieu d'appeler le cloud : le mode local est une INSTALLATION
 * (whisper.cpp + Piper), pas un chemin de code de ce fichier. Se rabattre sur
 * le cloud « en attendant » serait exactement la fuite qu'ADR-024 interdit, et
 * elle serait invisible.
 */
/**
 * Mémoire courte du SECOND verrou, et de lui seul.
 *
 * ⚠️ SEUL UN VERDICT `true` EST MÉMORISÉ. Un refus, lui, est toujours
 * reconstaté : mettre en cache un « non » ferait survivre une panne de
 * connexion passagère à sa cause, et la voix resterait muette une minute après
 * réparation sans que rien ne l'explique. Un « oui » périmé, à l'inverse, est
 * borné par la fenêtre ci-dessous — et la bascule `cloud-dev` → `self-hosted`
 * est une opération humaine délibérée, pas un événement d'une seconde.
 *
 * POURQUOI CE CACHE EXISTE : sans lui, `garderVoix()` ouvrait une connexion
 * Postgres NEUVE à chaque énoncé, dans les deux sens. C'est un aller-retour de
 * plus par tour de parole, et surtout un point de panne supplémentaire dont
 * l'échec se présentait comme `configuration` — indiscernable d'un vrai refus
 * d'exploitation.
 */
const FENETRE_VERDICT_MS = 60_000;
let verdictCloudDev: { expire: number } | null = null;

async function garderVoix(): Promise<LlmResult<never> | null> {
  const mode = env().VOICE_PROVIDER;
  if (mode !== "cloud") {
    return llmErr(
      "configuration",
      "Voix indisponible : le mode vocal cloud n'est pas activé.",
    );
  }

  if (verdictCloudDev !== null && Date.now() < verdictCloudDev.expire) return null;
  verdictCloudDev = null;

  // Le SECOND verrou de la voix (ADR-024), et il reste entier : `VOICE_PROVIDER`
  // ci-dessus est un réglage de fichier, celui-ci est un état de la BASE.
  // Deux verrous indépendants, dont un que l'environnement ne peut pas ouvrir.
  //
  // Ici aussi la connexion privilégiée disparaît : `app.is_cloud_dev()` est
  // exécutable par `mindcare_app`, donc `withEgressGate` suffit.
  try {
    const cloud = await withEgressGate(async (q) => {
      const lignes = await q.query<{ cloud: boolean | null }>(
        "SELECT app.is_cloud_dev() AS cloud",
      );
      return lignes[0]?.cloud ?? null;
    });

    if (cloud === true) {
      verdictCloudDev = { expire: Date.now() + FENETRE_VERDICT_MS };
      return null;
    }
    return llmErr(
      "frontiere",
      "Voix indisponible : la base n'est pas en mode développement synthétique.",
    );
  } catch {
    // FAIL-CLOSED. Impossible de vérifier l'état de la base : on REFUSE. Le
    // défaut sûr est celui dont la conséquence est réparable — un refus se
    // corrige, une fuite ne se rattrape pas.
    return llmErr("configuration", "Voix indisponible : état du déploiement invérifiable.");
  }
}

/**
 * Groq — transcription. Multipart, parce que l'API l'exige ; l'audio ne
 * transite que par ce `FormData`, jamais par un fichier.
 */
/**
 * ⚠️ GROQ VALIDE L'EXTENSION DU NOM DE FICHIER, PAS LE `Content-Type`.
 *
 * DÉFAUT RÉEL, MESURÉ CONTRE L'API LE 2026-08-27, ET IL A RENDU LA DICTÉE
 * IMPOSSIBLE DEPUIS TOUJOURS. Le multipart partait sous le nom `"audio"`, sans
 * extension. Groq répond alors :
 *   HTTP 400 — « file must be one of the following types:
 *               [flac mp3 mp4 mpeg mpga m4a ogg opus wav webm] »
 * Le même octet-pour-octet sous le nom `"audio.wav"` rend HTTP 200 et la
 * transcription. Le `Content-Type` du `Blob` était pourtant correct dans les
 * deux cas : il n'est PAS regardé.
 *
 * La panne était invisible à trois titres — 400 est « permanent », donc aucun
 * réessai ; l'échec durait 38 ms, donc il ressemblait à une panne réseau ; et
 * le message atteignait l'écran repeint en « service de données indisponible ».
 *
 * ⚠️ LE NOM DE BASE RESTE CONSTANT ET ANODIN. C'est la raison d'origine, et
 * elle tient toujours : y mettre un nom de patiente ferait fuir une identité
 * par les métadonnées de la requête — une fuite que personne ne penserait à
 * relire, puisqu'elle ne s'affiche nulle part. Seule l'extension est dérivée,
 * et elle l'est du MIME, pas d'une donnée.
 *
 * ⚠️ AUCUNE EXTENSION DEVINÉE. Un MIME hors table est REFUSÉ ici, avec un code
 * `configuration`, plutôt que relayé sous une extension plausible : une
 * extension fausse produit un 400 chez le fournisseur, c'est-à-dire la panne
 * qu'on vient de corriger, mais rendue à nouveau opaque.
 *
 * CETTE TABLE ET `TYPES_ACCEPTES` DE `jarvis-voice-in` DOIVENT LISTER LES MÊMES
 * TYPES. Une divergence rouvre exactement ce défaut : la passerelle accepte,
 * le fournisseur refuse.
 */
const EXTENSION_PAR_MIME: Readonly<Record<string, string>> = {
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
};

/** Nom de base constant — voir l'encadré. Jamais dérivé d'une donnée. */
const NOM_BASE_AUDIO = "commande";

/**
 * Rend le nom de fichier multipart, ou `null` si le MIME n'est pas connu. Le
 * paramètre peut porter des paramètres (`audio/webm;codecs=opus`) : on ne
 * regarde que le type, comme la passerelle.
 */
function nomFichierPour(mimeType: string): string | null {
  const type = mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
  const extension = EXTENSION_PAR_MIME[type];
  return extension === undefined ? null : `${NOM_BASE_AUDIO}.${extension}`;
}

export const groqSttProvider: SttProvider = {
  name: "groq",

  async transcribe(req) {
    const clef = env().GROQ_API_KEY;
    if (clef === undefined || clef === "") {
      throw new Error("configuration: GROQ_API_KEY absente");
    }

    const nomFichier = nomFichierPour(req.mimeType);
    if (nomFichier === null) {
      // Refus AVANT tout appel payant, et avec la cause : le MIME n'est pas
      // dans la table. On ne relaie pas un type qu'on ne sait pas nommer.
      throw new Error("configuration: type audio non pris en charge");
    }

    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const form = new FormData();
      // Nom CONSTANT + extension dérivée du MIME. Voir l'encadré au-dessus de
      // `EXTENSION_PAR_MIME` : sans l'extension, Groq refuse tout, en 400.
      // ⚠️ `new Blob([req.audio])` ne type-vérifie pas sous les définitions Node :
      // `Uint8Array<ArrayBufferLike>` n'est pas un `BlobPart`, parce que son
      // tampon PEUT être un `SharedArrayBuffer`. Deno l'acceptait, ce qui est
      // exactement le genre de différence que ce portage doit régler plutôt
      // que masquer. On recopie donc dans un `ArrayBuffer` non partagé : le
      // contenu est identique, et le type devient honnête.
      const tampon = new Uint8Array(req.audio.byteLength);
      tampon.set(req.audio);
      form.append("file", new Blob([tampon.buffer], { type: req.mimeType }), nomFichier);
      form.append("model", req.model);
      form.append("language", req.language);
      form.append("response_format", "json");

      const reponse = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${clef}` },
        body: form,
        signal: controller.signal,
      });

      if (!reponse.ok) {
        const transitoire = reponse.status >= 500 || reponse.status === 429;
        throw new Error(transitoire ? `transitoire: HTTP ${reponse.status}` : `permanent: HTTP ${reponse.status}`);
      }

      const corps: unknown = await reponse.json();
      const texte = (corps as { text?: unknown } | null)?.text;
      if (typeof texte !== "string") {
        throw new Error("permanent: réponse Groq sans transcription");
      }

      return { text: texte };
    } catch (cause) {
      if (controller.signal.aborted) throw new Error("transitoire: timeout");
      if (cause instanceof TypeError) throw new Error("transitoire: réseau");
      throw cause;
    } finally {
      clearTimeout(minuteur);
    }
  },
};

/** ElevenLabs — synthèse. Rend les octets audio, qui ne sont jamais persistés. */
export const elevenLabsTtsProvider: TtsProvider = {
  name: "elevenlabs",

  async synthesize(req) {
    const clef = env().ELEVENLABS_API_KEY;
    if (clef === undefined || clef === "") {
      throw new Error("configuration: ELEVENLABS_API_KEY absente");
    }

    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), req.timeoutMs);

    try {
      const reponse = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(req.voiceId)}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": clef,
            "Content-Type": "application/json",
            Accept: "audio/mpeg",
          },
          body: JSON.stringify({ text: req.text, model_id: req.model }),
          signal: controller.signal,
        },
      );

      if (!reponse.ok) {
        const transitoire = reponse.status >= 500 || reponse.status === 429;
        throw new Error(transitoire ? `transitoire: HTTP ${reponse.status}` : `permanent: HTTP ${reponse.status}`);
      }

      const octets = new Uint8Array(await reponse.arrayBuffer());
      if (octets.byteLength === 0) {
        throw new Error("permanent: réponse ElevenLabs vide");
      }

      return { audio: octets, mimeType: "audio/mpeg" };
    } catch (cause) {
      if (controller.signal.aborted) throw new Error("transitoire: timeout");
      if (cause instanceof TypeError) throw new Error("transitoire: réseau");
      throw cause;
    } finally {
      clearTimeout(minuteur);
    }
  },
};

export interface SttRequest {
  readonly audio: Uint8Array;
  readonly mimeType: string;
  /** `fr` par défaut — ADR-024 : la praticienne parle français. */
  readonly language?: string;
  /** uuid aléatoire par appel — JAMAIS le patient_id. Même règle que `LlmRequest`. */
  readonly sessionToken: string;
  readonly timeoutMs?: number;
}

export interface TtsRequest {
  readonly text: string;
  readonly voiceId: string;
  readonly sessionToken: string;
  readonly timeoutMs?: number;
}

/**
 * Transcription — point d'entrée unique. Même patron que `llm()` : deux
 * verrous, un seul retry sur échec transitoire, journalisation best-effort,
 * erreur typée.
 *
 * ⚠️ `charsOut` PORTE LA LONGUEUR DE LA TRANSCRIPTION, JAMAIS SON CONTENU, et
 * `tokensIn`/`tokensOut` restent NULL : Groq ne facture pas au jeton sur ce
 * point de terminaison, et inventer un chiffre serait pire que l'absence. Un
 * compteur documente le franchissement ; un extrait le reproduirait dans la
 * table même qui existe pour l'éviter (028).
 */
export async function stt(
  req: SttRequest,
  provider: SttProvider = groqSttProvider,
): Promise<LlmResult<string>> {
  const refus = await garderVoix();
  if (refus !== null) return refus;

  const model = env().STT_MODEL ?? STT_MODEL_DEFAUT;
  const timeoutMs = req.timeoutMs ?? TIMEOUT_VOIX_MS_DEFAUT;
  const depart = Date.now();

  let derniereErreur: unknown;
  for (let tentative = 0; tentative < 2; tentative++) {
    try {
      const resultat = await provider.transcribe({
        audio: req.audio,
        mimeType: req.mimeType,
        language: req.language ?? "fr",
        model,
        timeoutMs,
      });

      await journaliser({
        purpose: "voix-entree",
        provider: provider.name,
        model,
        promptVersion: "n/a",
        promptHash: "n/a",
        sessionToken: req.sessionToken,
        charsOut: resultat.text.length,
        tokensIn: null,
        tokensOut: null,
        estimatedCostUsd: null,
        outcome: "ok",
        latencyMs: Date.now() - depart,
      });

      return llmOk(resultat.text);
    } catch (cause) {
      derniereErreur = cause;
      if (tentative === 0 && estTransitoire(cause)) continue;
      break;
    }
  }

  return await echecVoix("voix-entree", provider.name, model, req.sessionToken, depart, derniereErreur,
    "Transcription indisponible.");
}

/**
 * Synthèse — point d'entrée unique. `charsOut` compte les caractères ENVOYÉS,
 * ce qui est exactement le chiffre qu'on voudra le jour de la bascule locale :
 * combien de texte nommant des patientes a quitté la machine.
 */
export async function tts(
  req: TtsRequest,
  provider: TtsProvider = elevenLabsTtsProvider,
): Promise<LlmResult<{ readonly audio: Uint8Array; readonly mimeType: string }>> {
  const refus = await garderVoix();
  if (refus !== null) return refus;

  const model = env().TTS_MODEL ?? TTS_MODEL_DEFAUT;
  const timeoutMs = req.timeoutMs ?? TIMEOUT_VOIX_MS_DEFAUT;
  const depart = Date.now();

  let derniereErreur: unknown;
  for (let tentative = 0; tentative < 2; tentative++) {
    try {
      const resultat = await provider.synthesize({
        text: req.text,
        voiceId: req.voiceId,
        model,
        timeoutMs,
      });

      await journaliser({
        purpose: "voix-sortie",
        provider: provider.name,
        model,
        promptVersion: "n/a",
        promptHash: "n/a",
        sessionToken: req.sessionToken,
        charsOut: req.text.length,
        tokensIn: null,
        tokensOut: null,
        estimatedCostUsd: null,
        outcome: "ok",
        latencyMs: Date.now() - depart,
      });

      return llmOk(resultat);
    } catch (cause) {
      derniereErreur = cause;
      if (tentative === 0 && estTransitoire(cause)) continue;
      break;
    }
  }

  return await echecVoix("voix-sortie", provider.name, model, req.sessionToken, depart, derniereErreur,
    "Synthèse vocale indisponible.");
}

/**
 * Journalise un échec de voix et rend l'erreur typée. Factorisé parce que les
 * deux sens échouent de la même façon — pas pour économiser des lignes, mais
 * pour qu'une correction de la classification des pannes n'ait pas à être
 * faite deux fois, ce qui est la façon habituelle de n'en corriger qu'une.
 */
async function echecVoix<T>(
  purpose: Extract<BoundaryPurpose, "voix-entree" | "voix-sortie">,
  provider: string,
  model: string,
  sessionToken: string,
  depart: number,
  cause: unknown,
  message: string,
): Promise<LlmResult<T>> {
  const texte = cause instanceof Error ? cause.message : "";
  const estTimeout = texte.includes("timeout");
  const estConfiguration = texte.startsWith("configuration:");

  await journaliser({
    purpose,
    provider,
    model,
    promptVersion: "n/a",
    promptHash: "n/a",
    sessionToken,
    charsOut: null,
    tokensIn: null,
    tokensOut: null,
    estimatedCostUsd: null,
    outcome: estTimeout ? "timeout" : "error",
    latencyMs: Date.now() - depart,
  });

  return estConfiguration ? llmErr("configuration", message) : llmErr("indisponible", message);
}

// ═══════════════════════════════════════════════════════════════════════════
// COMMUNICATION — Composio via SDK officiel (domaine 112/113).
// ═══════════════════════════════════════════════════════════════════════════
//
// MÊME DISCIPLINE QUE `llm()` : frontière DÉTERMINISTE sur les octets
// (`classerCharge`, zéro-byte invariant — C1/C2/INCONNU et C3 sans reçu ne
// donnent jamais lieu à un appel réseau), un seul retry sur échec
// TRANSITOIRE (timeout, 5xx, 429, réseau), jamais sur 4xx (permission,
// fenêtre de messagerie, gabarit invalide : ce sont des états à surfacer,
// pas à rejouer), journalisation best-effort dans `boundary_crossings`
// (motif `communication`, migration 114).
//
// PREUVE LIVE (2026-09-29) : l'exécution passe par le SDK (`@composio/core`)
// avec `{connectedAccountId, userId: entité, version, arguments}` —
// l'entité est le propriétaire Composio des comptes (dashboard), PAS le
// cabinet (le cloisonnement cabinet reste en base, RLS). Compte et version
// sont RÉSOLUS au runtime (jamais devinés) et cachés en mémoire (slugs,
// pas de données).
//
// `COMPOSIO_ENTITY_ID` manquant → `configuration`, fail-closed.

import { Composio } from "@composio/core";
import {
  classerRefusProvider,
  messageRefusProvider,
  type FamilleRefusProvider,
} from "@/server/communication/diagnostic-refus";

const BASE_COMPOSIO_DEFAUT = "https://backend.composio.dev";
const CHEMIN_LISTE_DEFAUT = "/api/v3/tools";

/**
 * Le point d'exécution Composio, injectable pour les tests (même motif que
 * `LlmProvider` : le défaut parle au réseau, le faux compte les appels).
 */
export interface ComposioProvider {
  readonly name: string;
  /** Compte ACTIVE pour le toolkit, ou null. */
  compteConnecte(toolkit: string, timeoutMs: number): Promise<string | null>;
  /** Version live de l'outil, ou null. */
  versionOutil(slug: string, timeoutMs: number): Promise<string | null>;
  executer(args: {
    readonly slug: string;
    readonly compteId: string;
    readonly entiteId: string;
    readonly version: string;
    readonly params: Readonly<Record<string, unknown>>;
    readonly timeoutMs: number;
  }): Promise<{
    readonly idExterne: string | null;
    readonly refus: import("@/server/communication/diagnostic-refus").FamilleRefusProvider | null;
  }>;
}

function cleComposio(): string | null {
  const clef = env().COMPOSIO_API_KEY;
  return clef === undefined || clef === "" ? null : clef;
}

function avecEcheance<T>(promesse: Promise<T>, ms: number): Promise<T> {
  let minuteur: ReturnType<typeof setTimeout> | undefined;
  const garde = new Promise<never>((_, rejeter) => {
    minuteur = setTimeout(() => rejeter(new Error("transitoire: timeout")), ms);
  });
  return Promise.race([promesse, garde]).finally(() => {
    if (minuteur !== undefined) clearTimeout(minuteur);
  });
}

/** Statut HTTP porté par l'erreur SDK, null si non-HTTP (réseau). */
function statutErreur(cause: unknown): number | null {
  if (typeof cause !== "object" || cause === null) return null;
  const interne = (cause as { cause?: unknown }).cause;
  if (typeof interne !== "object" || interne === null) return null;
  const statut = (interne as { status?: unknown }).status;
  return typeof statut === "number" ? statut : null;
}

/**
 * Corps d'erreur provider, extrait pour CLASSER (jamais journalisé, jamais
 * rendu : il peut porter des identifiants). `null` si absent.
 */
function corpsErreur(cause: unknown): unknown {
  if (typeof cause !== "object" || cause === null) return null;
  const interne = (cause as { cause?: unknown }).cause;
  if (typeof interne !== "object" || interne === null) return null;
  const portee = interne as { error?: unknown; data?: unknown; details?: unknown };
  return portee.error ?? portee.data ?? portee.details ?? null;
}

function classerErreurComposio(cause: unknown): Error {
  if (cause instanceof Error && cause.message.startsWith("transitoire:")) return cause;
  const statut = statutErreur(cause);
  if (statut === null) return new Error("transitoire: réseau");
  return new Error(
    statut >= 500 || statut === 429 ? `transitoire: HTTP ${statut}` : `permanent: HTTP ${statut}`,
  );
}

const cacheComptes = new Map<string, { expire: number; compteId: string }>();
const FENETRE_COMPTES_MS = 300_000;
const cacheVersions = new Map<string, { expire: number; version: string }>();
const FENETRE_VERSIONS_MS = 3_600_000;

export const sdkComposioProvider: ComposioProvider = {
  name: "composio-sdk",

  async compteConnecte(toolkit, timeoutMs) {
    const cache = cacheComptes.get(toolkit);
    if (cache !== undefined && Date.now() < cache.expire) return cache.compteId;
    const clef = cleComposio();
    if (clef === null) throw new Error("configuration: COMPOSIO_API_KEY absente");
    const client = new Composio({ apiKey: clef });
    const reponse = await avecEcheance(client.connectedAccounts.list(), timeoutMs);
    const items = (reponse as { items?: readonly unknown[] }).items ?? [];
    for (const item of items) {
      if (typeof item !== "object" || item === null) continue;
      const o = item as { id?: unknown; status?: unknown; toolkit?: unknown };
      const slug = (o.toolkit as { slug?: unknown } | undefined)?.slug;
      if (typeof o.id === "string" && o.status === "ACTIVE" && slug === toolkit) {
        cacheComptes.set(toolkit, { expire: Date.now() + FENETRE_COMPTES_MS, compteId: o.id });
        return o.id;
      }
    }
    return null;
  },

  async versionOutil(slug, timeoutMs) {
    const cache = cacheVersions.get(slug);
    if (cache !== undefined && Date.now() < cache.expire) return cache.version;
    const clef = cleComposio();
    if (clef === null) throw new Error("configuration: COMPOSIO_API_KEY absente");
    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const reponse = await fetch(
        `${baseComposio()}/api/v3.1/tools/${encodeURIComponent(slug)}`,
        { headers: { "x-api-key": clef }, signal: controller.signal },
      );
      if (!reponse.ok) {
        const transitoire = reponse.status >= 500 || reponse.status === 429;
        throw new Error(transitoire ? `transitoire: HTTP ${reponse.status}` : `permanent: HTTP ${reponse.status}`);
      }
      const corps: unknown = await reponse.json().catch(() => null);
      const version =
        typeof corps === "object" && corps !== null
          ? (corps as { version?: unknown }).version
          : null;
      if (typeof version !== "string" || version === "") {
        throw new Error("permanent: version d'outil illisible");
      }
      cacheVersions.set(slug, { expire: Date.now() + FENETRE_VERSIONS_MS, version });
      return version;
    } catch (cause) {
      if (controller.signal.aborted) throw new Error("transitoire: timeout");
      if (cause instanceof TypeError) throw new Error("transitoire: réseau");
      throw cause;
    } finally {
      clearTimeout(minuteur);
    }
  },

  async executer(args) {
    const clef = cleComposio();
    if (clef === null) throw new Error("configuration: COMPOSIO_API_KEY absente");
    const client = new Composio({ apiKey: clef });
    let reponse: unknown;
    try {
      reponse = await avecEcheance(
        client.tools.execute(args.slug, {
          connectedAccountId: args.compteId,
          userId: args.entiteId,
          version: args.version,
          arguments: { ...args.params },
        }),
        args.timeoutMs,
      );
    } catch (cause) {
      // Le refus est CLASSÉ ici pour que l'appelant sache s'il doit
      // rejouer (transitoire), attendre (fenêtre) ou faire agir un humain
      // (autorisation). Le corps brut ne sort JAMAIS de ce fichier.
      const famille = classerRefusProvider(statutErreur(cause), corpsErreur(cause));
      const classee = classerErreurComposio(cause);
      throw new Error(`${classee.message} [refus:${famille}]`);
    }
    const donnees =
      typeof reponse === "object" && reponse !== null
        ? (reponse as { data?: unknown; error?: unknown }).data
        : null;
    // Un 200 peut porter un refus métier dans le corps (façon Meta/Composio
    // de rendre un échec sans statut HTTP) : on le classe aussi.
    if (
      typeof reponse === "object" &&
      reponse !== null &&
      (reponse as { error?: unknown }).error !== null &&
      (reponse as { error?: unknown }).error !== undefined
    ) {
      const famille = classerRefusProvider(null, reponse);
      throw new Error(`permanent: refus provider [refus:${famille}]`);
    }
    const idExterne =
      typeof donnees === "object" && donnees !== null
        ? ((donnees as { id?: unknown }).id ??
          (donnees as { message_id?: unknown }).message_id ??
          (donnees as { wamid?: unknown }).wamid ??
          (donnees as { mid?: unknown }).mid ??
          null)
        : null;
    return { idExterne: typeof idExterne === "string" ? idExterne : null, refus: null };
  },
};

export interface RequeteComposio {
  /** Slug résolu au runtime (registre + découverte), jamais deviné. */
  readonly outil: string;
  /** Toolkit propriétaire (compte + version résolus pour lui). */
  readonly toolkit: string;
  /** Charge C4 attendue ; la frontière tranche sur ces octets. */
  readonly charge: Readonly<Record<string, unknown>>;
  /** Clé stable `comm:<conversation>:<empreinte>` (idempotence retry). */
  readonly cleIdempotence: string;
  /** uuid aléatoire par appel — JAMAIS le patient_id. */
  readonly sessionToken: string;
  readonly timeoutMs?: number;
}

export interface ResultatComposio {
  /** Identifiant externe rendu par le provider, null si absent. */
  readonly idExterne: string | null;
  /**
   * Famille du refus provider (`fenetre`, `autorisation`, `cible`, …).
   * `null` = succès. Permet à l'écran de dire la VRAIE cause au lieu d'un
   * « indisponible » qui fait perdre des heures (cf. diagnostic-refus.ts).
   */
  readonly refus: import("@/server/communication/diagnostic-refus").FamilleRefusProvider | null;
}

function baseComposio(): string {
  const brute = env().COMPOSIO_BASE_URL ?? BASE_COMPOSIO_DEFAUT;
  return brute.replace(/\/+$/, "");
}

function cheminListe(): string {
  return env().COMPOSIO_LIST_PATH ?? CHEMIN_LISTE_DEFAUT;
}

export async function appelComposio(
  req: RequeteComposio,
  provider: ComposioProvider = sdkComposioProvider,
): Promise<LlmResult<ResultatComposio>> {
  const entite = env().COMPOSIO_ENTITY_ID;
  if (entite === undefined || entite === "") {
    return llmErr("configuration", "Messagerie externe indisponible.");
  }
  const timeoutMs = req.timeoutMs ?? TIMEOUT_MS_DEFAUT;
  const depart = Date.now();
  const modele = "composio-session";

  // La frontière s'applique AVANT tout appel réseau : outil + charge + clé.
  const verdict = classerCharge(
    { outil: req.outil, charge: req.charge, cle: req.cleIdempotence },
    null,
  );
  if (verdict.decision === "BLOQUER") {
    await journaliser({
      purpose: "communication",
      provider: "composio",
      model: modele,
      promptVersion: "n/a",
      promptHash: "n/a",
      sessionToken: req.sessionToken,
      charsOut: null,
      tokensIn: null,
      tokensOut: null,
      estimatedCostUsd: null,
      outcome: "blocked",
      latencyMs: Date.now() - depart,
    });
    return llmErr("frontiere", MESSAGE_REFUS_FRONTIERE);
  }

  const corps = JSON.stringify(req.charge);

  let derniereErreur: unknown;
  for (let tentative = 0; tentative < 2; tentative++) {
    try {
      const compteId = await provider.compteConnecte(req.toolkit, timeoutMs);
      if (compteId === null) {
        throw new Error("permanent: aucun compte connecté");
      }
      const version = await provider.versionOutil(req.outil, timeoutMs);
      if (version === null) {
        throw new Error("permanent: version d'outil inconnue");
      }
      const resultat = await provider.executer({
        slug: req.outil,
        compteId,
        entiteId: entite,
        version,
        params: req.charge,
        timeoutMs,
      });

      await journaliser({
        purpose: "communication",
        provider: provider.name,
        model: modele,
        promptVersion: "n/a",
        promptHash: "n/a",
        sessionToken: req.sessionToken,
        charsOut: corps.length,
        tokensIn: null,
        tokensOut: null,
        estimatedCostUsd: null,
        outcome: "ok",
        latencyMs: Date.now() - depart,
      });

      return llmOk(resultat);
    } catch (cause) {
      derniereErreur = cause;
      if (tentative === 0 && estTransitoire(cause)) continue;
      break;
    }
  }

  const texte = derniereErreur instanceof Error ? derniereErreur.message : "";
  const estConfiguration =
    texte.startsWith("configuration:") || texte.startsWith("permanent: aucun compte");
  // Famille de refus provider, si l'exécution l'a classée (jamais le corps
  // brut : voir `diagnostic-refus.ts`).
  const famille = /\[refus:([a-z]+)\]/.exec(texte)?.[1] ?? null;
  await journaliser({
    purpose: "communication",
    provider: provider.name,
    model: modele,
    promptVersion: "n/a",
    promptHash: "n/a",
    sessionToken: req.sessionToken,
    charsOut: null,
    tokensIn: null,
    tokensOut: null,
    estimatedCostUsd: null,
    outcome: texte.includes("timeout") ? "timeout" : "error",
    latencyMs: Date.now() - depart,
  });
  if (estConfiguration) {
    return llmErr("configuration", "Messagerie externe indisponible.");
  }
  // Un refus d'AUTORISATION provider n'est pas « indisponible » : c'est une
  // décision d'exploitation (app Meta Live + business verification) qui ne
  // se résout ni en réessayant ni en attendant. Le dire honnêtement, avec un
  // code distinct, évite de faire perdre des heures à l'opératrice.
  if (famille === "autorisation" || famille === "fenetre" || famille === "cible") {
    return llmErr("refus-provider", messageRefusProvider(famille as FamilleRefusProvider));
  }
  return llmErr("indisponible", "Messagerie externe indisponible.");
}

/**
 * Liste les slugs d'outils exposés par le compte Composio (découverte).
 *
 * Charge C4 par construction (un nom de toolkit, rien de patient) — la
 * frontière est quand même appliquée, par uniformité : si elle bloque un
 * jour ici, c'est elle qui a raison. Réponse parsée DÉFENSIVEMENT
 * (`data`/`tools`/`items`/tableau nu, champs `slug`/`name`/`tool_slug`) :
 * forme illisible → `indisponible`, jamais de devinette. Un seul retry
 * transitoire, comme `appelComposio`.
 */
export async function listerOutilsComposio(
  toolkit: string,
  sessionToken: string,
  timeoutMs?: number,
): Promise<LlmResult<readonly string[]>> {
  const clef = env().COMPOSIO_API_KEY;
  if (clef === undefined || clef === "") {
    return llmErr("configuration", "Messagerie externe indisponible.");
  }
  const delai = timeoutMs ?? TIMEOUT_MS_DEFAUT;
  const depart = Date.now();
  const modele = "composio-discovery";

  const verdict = classerCharge({ liste: "outils", toolkit }, null);
  if (verdict.decision === "BLOQUER") {
    await journaliser({
      purpose: "communication",
      provider: "composio",
      model: modele,
      promptVersion: "n/a",
      promptHash: "n/a",
      sessionToken,
      charsOut: null,
      tokensIn: null,
      tokensOut: null,
      estimatedCostUsd: null,
      outcome: "blocked",
      latencyMs: Date.now() - depart,
    });
    return llmErr("frontiere", MESSAGE_REFUS_FRONTIERE);
  }

  let derniereErreur: unknown;
  for (let tentative = 0; tentative < 2; tentative++) {
    const controller = new AbortController();
    const minuteur = setTimeout(() => controller.abort(), delai);
    try {
      const reponse = await fetch(
        `${baseComposio()}${cheminListe()}?toolkit_slug=${encodeURIComponent(toolkit)}`,
        {
          method: "GET",
          headers: { Authorization: `Bearer ${clef}` },
          signal: controller.signal,
        },
      );
      clearTimeout(minuteur);

      if (!reponse.ok) {
        const transitoire = reponse.status >= 500 || reponse.status === 429;
        throw new Error(transitoire ? `transitoire: HTTP ${reponse.status}` : `permanent: HTTP ${reponse.status}`);
      }

      const corps: unknown = await reponse.json().catch(() => null);
      const slugs = extraireSlugs(corps);
      if (slugs === null) {
        throw new Error("permanent: liste d'outils illisible");
      }

      await journaliser({
        purpose: "communication",
        provider: "composio",
        model: modele,
        promptVersion: "n/a",
        promptHash: "n/a",
        sessionToken,
        charsOut: null,
        tokensIn: null,
        tokensOut: null,
        estimatedCostUsd: null,
        outcome: "ok",
        latencyMs: Date.now() - depart,
      });
      return llmOk(slugs);
    } catch (cause) {
      clearTimeout(minuteur);
      if (controller.signal.aborted) {
        derniereErreur = new Error("transitoire: timeout");
      } else if (cause instanceof TypeError) {
        derniereErreur = new Error("transitoire: réseau");
      } else {
        derniereErreur = cause;
      }
      if (tentative === 0 && estTransitoire(derniereErreur)) continue;
      break;
    }
  }

  const texte = derniereErreur instanceof Error ? derniereErreur.message : "";
  await journaliser({
    purpose: "communication",
    provider: "composio",
    model: modele,
    promptVersion: "n/a",
    promptHash: "n/a",
    sessionToken,
    charsOut: null,
    tokensIn: null,
    tokensOut: null,
    estimatedCostUsd: null,
    outcome: texte.includes("timeout") ? "timeout" : "error",
    latencyMs: Date.now() - depart,
  });
  return llmErr("indisponible", "Messagerie externe indisponible.");
}

/** Extrait les slugs d'une enveloppe de forme inconnue, ou null. */
function extraireSlugs(corps: unknown): readonly string[] | null {  let candidats: unknown = null;
  if (Array.isArray(corps)) {
    candidats = corps;
  } else if (typeof corps === "object" && corps !== null) {
    const env = corps as Record<string, unknown>;
    for (const cle of ["data", "tools", "items"]) {
      if (Array.isArray(env[cle])) {
        candidats = env[cle];
        break;
      }
    }
  }
  if (!Array.isArray(candidats)) return null;
  const slugs: string[] = [];
  for (const item of candidats) {
    if (typeof item === "string") {
      if (item !== "") slugs.push(item);
      continue;
    }
    if (typeof item === "object" && item !== null) {
      const o = item as Record<string, unknown>;
      for (const cle of ["slug", "tool_slug", "name"]) {
        const v = o[cle];
        if (typeof v === "string" && v !== "") {
          slugs.push(v);
          break;
        }
      }
    }
  }
  return slugs;
}

/* ════════════════════════════════════════════════════════════════════════
 * JEV — MODÈLE DE DÉCISION TYPESAFE VIA L'API DECISIONS (audit Slice 1)
 *
 * `typesafe/jev-1.13` (vérifié au registre OpenRouter le 2026-09-30) N'EST
 * PAS un LLM de conversation : il ne génère aucun texte. Il répond à des
 * questions typées (`noul` probabilité oui/non, `choice` choix parmi des
 * options, `score` position sur rubrique) via
 * `POST https://openrouter.ai/api/alpha/decisions` — PAS via
 * `/api/v1/chat/completions`. Le brancher dans `resolveModel()` enverrait
 * des charges `messages` à un endpoint qui n'en veut pas : échec permanent
 * garanti. D'où cette fonction DÉDIÉE, et rien d'autre.
 *
 * Rôle prévu (spike, `classifieur-jev.ts`) : pré-routage rapide M01 —
 * `choice` sur la route + `noul` sur le signal patient, avec seuil de
 * confiance et repli sur le classifieur LLM existant. Payant (0,042 USD par
 * million de jetons d'entrée, sortie gratuite) : usage OFF par défaut
 * (`JARVIS_JEV_ENABLED`), jamais sur le chemin critique sans repli.
 *
 * Même discipline que `llm()` : timeout 10 s + relais `signal`, un seul
 * retry transitoire (5xx/429/timeout/réseau), journal `boundary_crossings`
 * best-effort (purpose `jarvis`, jamais de contenu — `charsOut: null`,
 * l'état et les questions ne sont pas des octets facturés en sortie).
 * ════════════════════════════════════════════════════════════════════════ */

/** Repli quand `JEV_MODEL` n'est pas posé — slug exact du registre. */
export const JEV_MODEL_DEFAUT = "typesafe/jev-1.13";

export interface QuestionDecision {
  readonly type: "noul" | "choice" | "score";
  readonly instructions: string;
  readonly criteria?: unknown;
}

export type ReponseDecision =
  | { readonly type: "noul"; readonly noul: number }
  | {
    readonly type: "choice";
    readonly choice: string;
    readonly confidence?: number;
    readonly probabilities?: Readonly<Record<string, number>>;
  }
  | {
    readonly type: "score";
    readonly score: number;
    readonly confidence?: number;
    readonly probabilities?: Readonly<Record<string, number>>;
  };

export interface RequeteDecisions {
  readonly purpose: Extract<BoundaryPurpose, "jarvis" | "resume-cas">;
  readonly promptVersion: string;
  readonly promptHash: string;
  readonly sessionToken: string;
  /** État applicatif (jamais d'identifiant : l'appelant a pseudonymisé). */
  readonly state: unknown;
  readonly questions: Readonly<Record<string, QuestionDecision>>;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly modele?: string;
}

function estReponsesDecisions(value: unknown): value is Record<string, ReponseDecision> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value as Record<string, unknown>).every(
    (r) =>
      typeof r === "object" &&
      r !== null &&
      (r as { type?: unknown }).type !== undefined &&
      ["noul", "choice", "score"].includes((r as { type: unknown }).type as string),
  );
}

export async function decisions(
  _req: RequeteDecisions,
): Promise<LlmResult<Readonly<Record<string, ReponseDecision>>>> {
  // No qualified free variant of the alpha Decisions contract: the existing JSON classifier handles routing.
  return llmErr("configuration", alexa.configuration);
}
