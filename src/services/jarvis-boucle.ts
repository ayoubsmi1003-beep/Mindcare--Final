/**
 * `jarvis-boucle.ts` — LA BOUCLE AGENTIQUE, ET SA MACHINE À ÉTATS.
 *
 * ═══ CE QUI N'EXISTAIT PAS, ET QUI EST LE CŒUR DE CETTE PASSE ═══
 * Avant ce fichier, quand le modèle proposait un outil, `conversation.ts`
 * l'exécutait, collait les lignes brutes dans le fil, et LE TOUR S'ARRÊTAIT. Le
 * résultat ne retournait jamais au modèle. Il n'existait donc aucun chemin par
 * lequel Jarvis pouvait répondre EN LANGUE NATURELLE sur une donnée réelle :
 * « parle-moi du prochain patient » était inatteignable par construction, quelle
 * que soit la qualité du modèle. Ce fichier ferme la boucle.
 *
 * ═══ LA MACHINE À ÉTATS — LE RUNTIME PORTE LA POLITIQUE, PAS LE MODÈLE ═══
 *
 *   MODELE ──┬─ réponse texte ─────────────────────────► RENDU
 *            ├─ capacité LECTURE ─► EXECUTION ─► PROJECTION ─┐
 *            │                                               └─► (reboucle)
 *            └─ capacité ÉCRITURE ─► PROPOSE ─► [attente humaine]
 *
 * ⚠️ LE MODÈLE NE PEUT PAS « OUBLIER » DE DEMANDER CONFIRMATION. La branche
 * écriture n'a physiquement aucun chemin vers l'exécution qui ne passe pas par
 * une décision humaine — c'est déjà vrai en base (contrainte `jarvis_must_confirm`
 * de 033), et ce fichier le rend vrai aussi dans le déroulement. La sécurité par
 * le prompt n'existe pas ; celle-ci se lit dans le flot de contrôle.
 *
 * ═══ POURQUOI DES BUDGETS INDÉPENDANTS ═══
 * Un plafond unique laisserait un tour brûler sa totalité en un appel, ou
 * boucler indéfiniment sur des appels minuscules. Chacun des six borne une
 * dimension différente de la dérive (voir `BUDGETS` dans `jarvis-contexte.ts`).
 * À l'épuisement, Jarvis AVOUE — il ne fabrique jamais une réponse pour donner
 * l'illusion d'avoir abouti.
 */

import { fr } from "@/i18n/fr";
import {
  clarificationHomonymes,
  clarificationNonTrouve,
  clarificationSondeIndisponible,
} from "@/i18n/resolution";

import {
  aujourdHui,
  canoniserAppel,
  capaciteLecture,
  descriptionCompacteDesCapacites,
  descriptionDesCapacites,
  descriptionSyntheseSeule,
  estPatientSpecifique,
  type ContexteExecution,
  type ValeurSafe,
} from "./jarvis-capacites";
import { preparerPourLeModele, FuiteDetectee } from "./jarvis-confidentialite";
import {
  adopterResolution,
  assemblerAmorce,
  BUDGETS,
  cibleValide,
  contexteExpire,
  extraireMentionExplicite,
  signalerAmbiguite,
  type ContexteAmorce,
  type SaisieCible,
} from "./jarvis-contexte";
import {
  assembler,
  porterScopeAssemblage,
  type ContextSnapshot,
  type ResultatEpoque,
  type ScopeAssemblage,
} from "./jarvis-assembleur";
import { carte as carteCourante, reinitialiserCarte } from "./jarvis-identite";
import { demanderAJarvisEnFlux, type CheminJarvis } from "./jarvis";
import { classerMultilingue } from "@/shared/jarvis/normalisation";
import type { SafeToolResult } from "./jarvis-projections";
import {
  construireIntentionChainee,
  evaluerVerdictTour,
  intentRetenuDesAppels,
  resolutionM02Active,
  type CandidatSonde,
  type FilPatient,
  type ResultatSonde,
  type VerdictResolution,
} from "@/shared/jarvis/resolution-references";
import {
  intentionValideeDe,
  propositionAutorisee,
} from "./jarvis-routage-intentions";
import type { NomIntention } from "@/shared/jarvis/intentions";
import { log } from "./log";
import { err, ok, type Result } from "./result";
import type { AppError } from "./errors";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CE QU'UN TOUR LAISSE DERRIÈRE LUI
// ═══════════════════════════════════════════════════════════════════════════

/**
 * La trace d'un appel de capacité. PII-SAFE PAR CONSTRUCTION (§12) : un nom de
 * capacité, une durée, un booléen, un code classé. Jamais un argument, jamais
 * une valeur de retour — la télémétrie ne doit pas devenir le second entrepôt
 * de données sensibles que toute cette architecture existe pour éviter.
 */
export interface TraceAppel {
  readonly capacite: string;
  readonly ms: number;
  readonly ok: boolean;
  readonly code?: string;
  /** L'appel a-t-il été servi par le cache de déduplication ? */
  readonly deduplique: boolean;
  /**
   * M04 — un identifiant opaque par INVOCATION REELLE de capacite (UUID).
   * Absent quand rien n'a ete invoque : sonde pre-boucle, rejet de porte
   * (ambiguite, fil, intention), dedup servi par le cache, echec
   * pre-invocation (jeton inconnu). Ne porte ni patient, ni clinique, ni
   * autorisation : c'est la couture que M09 joindra aux run records.
   */
  readonly toolCallId?: string;
}

export interface BilanTour {
  /** Le texte final, JETONS NON RENDUS — le rendu d'identité est l'affaire de l'écran. */
  readonly texte: string;
  readonly chemin: CheminJarvis | null;
  readonly interrompu: boolean;
  readonly persiste: boolean;
  readonly appels: readonly TraceAppel[];
  /** Un tour logique Jarvis (M03) - opaque, jamais un identifiant metier. */
  readonly runId: string;
  /**
   * M07 — preuves gouvernées du chemin connaissance, venues du `fin`
   * canonique via le transport. Toujours un tableau (vide = sans source) :
   * la boucle transporte, jamais elle n'invente.
   */
  readonly preuves: readonly import("@/shared/jarvis/preuves").PreuveConnnaissance[];
  /**
   * M03 - un cliche de contexte par appel modele du tour, en ordre d'appel.
   * Vide quand aucun appel n'a eu lieu (clarification sans modele).
   */
  readonly snapshots: readonly ContextSnapshot[];
  /**
   * Le modèle a proposé une capacité que la boucle ne connaît pas comme
   * lecture. En phase 2, c'est le point d'entrée du registre d'ÉCRITURE ; pour
   * l'instant, c'est une proposition refusée proprement.
   */
  readonly propositionInconnue: { readonly nom: string; readonly args: unknown } | null;
  /**
   * L'ANCRE DE CONVERSATION proposée par ce tour — jamais posée par lui.
   *
   * ⚠️ CE N'EST PAS UNE AUTORISATION, ET LE MOT « candidat » EST LÀ POUR ÇA.
   * La boucle constate qu'un tour a lu UN patient et UN SEUL, avec succès, sans
   * ambiguïté. Elle le RAPPORTE. C'est `conversation.ts` qui décide, au tour
   * SUIVANT, si cette information mérite de servir à comprendre un pronom — et
   * le tour suivant repasse par la résolution, les portes SQL et la RLS comme
   * si l'ancre n'existait pas. Elle aide à comprendre « ses » ; elle n'ouvre
   * aucun dossier.
   *
   * `null` dès que le tour n'est pas concluant : ambiguïté, échec, interruption,
   * budget épuisé, aucun patient atteint, ou PLUSIEURS patients atteints.
   */
  readonly ancreCandidate: { readonly id: string; readonly libelle: string } | null;
  /**
   * M02 — ce que la résolution a décidé pour ce tour. Additif (M01 :
   * `ancreCandidate`) : les lecteurs historiques l'ignorent sans dommage.
   * Le verdict ne franchit jamais vers le modèle — seuls le nom de
   * l'intention chaînée (contrainte comme toute intention) et les jetons
   * frappés voyagent.
   */
  readonly resolution?: ResolutionBilan;
}

/**
 * M02 — le bilan de résolution d'un tour : verdict + chaînage + legs.
 * `intentionRetenu` est un NOM (inverse-compat des outils exécutés), jamais
 * un UUID : l'identité reste dans la cible, pas dans ce bilan.
 */
export interface ResolutionBilan {
  readonly verdict: VerdictResolution;
  /** Nom de l'intention chaînée envoyée au serveur, le cas échéant. */
  readonly intentionChainee: NomIntention | null;
  /** Nom à retenir pour le tour suivant (`null` = classifier frais). */
  readonly intentionRetenu: NomIntention | null;
}

/**
 * M02 — le contexte de travail du tour précédent, miroir NON autoritaire.
 * `conversationId` borne l'usage à la conversation qui l'a posé ; `patientId`
 * est revalidé contre le fil vivant avant tout chaînage (divergé = jeté).
 */
export interface TravailPrecedent {
  readonly conversationId: string;
  readonly intentionPrecedente: NomIntention | null;
  readonly patientId: string | null;
}

export interface RappelsTour {
  readonly onChemin?: (chemin: CheminJarvis) => void;
  readonly onDelta?: (fragment: string) => void;
  /** Une capacité démarre — l'écran peut montrer « je consulte l'agenda… ». */
  readonly onCapacite?: (nom: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · DÉDUPLICATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Canonise `(capacité, arguments)` pour repérer un appel déjà servi.
 *
 * Les clés sont TRIÉES : `{a:1,b:2}` et `{b:2,a:1}` sont le même appel, et un
 * modèle qui réordonne ses champs entre deux itérations — ils le font — ne doit
 * pas échapper à la déduplication pour si peu.
 */
function cleAppel(nom: string, args: unknown): string {
  const canonique = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canonique);
    if (typeof v === "object" && v !== null) {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([c, x]) => [c, canonique(x)]),
      );
    }
    return v;
  };
  return `${nom}:${JSON.stringify(canonique(args))}`;
}

/**
 * L'identifiant de patient porté par une structure d'arguments DÉJÀ RÉSOLUE.
 *
 * Garde typée plutôt qu'un accès en ligne : les arguments arrivent en `unknown`,
 * et une déstructuration optimiste ferait rentrer un `any` exactement là où l'on
 * décide de qui l'on parle. On ne lit que `patientId`, à la racine, et
 * uniquement si c'est une chaîne — tout le reste rend `null`.
 */
function identifiantPatientDe(argsResolus: unknown): string | null {
  if (typeof argsResolus !== "object" || argsResolus === null) return null;
  const v = (argsResolus as { readonly patientId?: unknown }).patientId;
  return typeof v === "string" && v.trim() !== "" ? v : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// M02 · LA SONDE — compter les candidats AVANT tout modèle, tout outil
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Sonde `search_patients` sur une mention explicite, par le REGISTRE —
 * jamais un second chemin de données (`jarvis-contexte.ts` s'interdit de
 * requêter lui-même, et la boucle ne le fait que par `lancer`, donc Zod +
 * RLS + audit `log_read` s'appliquent comme à tout appel modèle).
 *
 * La preuve rendue est le COMPTAGE (`total_count` CROSS JOIN, RLS-scopé),
 * pas les lignes : `total` survit au bornage, `candidats` sert aux libellés
 * de clarification et au pont jeton→UUID via la carte PRÉ-TOUR (jetée juste
 * après — `reinitialiserCarte` suit l'adoption).
 *
 * `ok:false` = preuve manquante (panne, capacité absente, total absent) :
 * fail-closed, le tour clarifie « indisponible », jamais de devinette.
 */
async function sonderCandidats(
  mention: string,
  registre: typeof capaciteLecture,
  ctx: ContexteExecution,
): Promise<
  | {
      readonly ok: true;
      readonly total: number;
      readonly candidats: CandidatSonde[];
      readonly ms: number;
      readonly depasse: boolean;
    }
  | { readonly ok: false; readonly ms: number }
> {
  const debut = Date.now();
  const capacite = registre("search_patients");
  if (capacite === null) return { ok: false, ms: Date.now() - debut };
  const r = await capacite.lancer({ query: mention }, ctx);
  const ms = Date.now() - debut;
  if (!r.ok) return { ok: false, ms };
  const donnees = r.data as { readonly resultats?: readonly unknown[]; readonly total?: unknown };
  if (!Array.isArray(donnees.resultats) || typeof donnees.total !== "number") {
    return { ok: false, ms };
  }
  const candidats: CandidatSonde[] = [];
  for (const ref of donnees.resultats) {
    if (typeof ref !== "string") continue;
    // Même carte que les projections viennent de frapper : les clés
    // correspondent par construction, aucun format supposé.
    const id = ctx.carte.resoudre(ref);
    if (id === null) continue;
    candidats.push({ id, libelle: ctx.carte.libellePourIdentifiant(id) ?? mention });
  }
  return { ok: true, total: donnees.total, candidats, ms, depasse: donnees.total > candidats.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · EXÉCUTION D'UNE CAPACITÉ
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Résout les jetons, valide, exécute, borne. Rend TOUJOURS un `SafeToolResult` —
 * y compris en échec, parce que le modèle a besoin de SAVOIR qu'un appel a
 * échoué pour le dire à la praticienne. Un échec avalé produirait une réponse
 * confiante fondée sur rien.
 */
async function executerCapacite(
  nom: string,
  argsBruts: unknown,
  ctxBase: Omit<ContexteExecution, "signal">,
  signalTour: AbortSignal,
  registre: typeof capaciteLecture,
): Promise<{ resultat: SafeToolResult<ValeurSafe>; trace: TraceAppel }> {
  const debut = Date.now();
  const echec = (code: string): { resultat: SafeToolResult<ValeurSafe>; trace: TraceAppel } => ({
    resultat: { capacite: nom, ok: false, donnees: null, motifEchec: code },
    trace: { capacite: nom, ms: Date.now() - debut, ok: false, code, deduplique: false },
  });

  const capacite = registre(nom);
  if (capacite === null) return echec("capacite-inconnue");

  // ── M04 · UNE INVOCATION REELLE = UN tool_call_id ──
  // Pose AVANT `lancer`, porte par la trace quel que soit l'issue (succes,
  // echec metier, delai). Les sorties SANS invocation (ci-dessus, jeton
  // inconnu ci-dessous, portes, dedup) n'en portent pas - par construction.
  const toolCallId = nouvelIdentifiant();

  // ── 1 · Les jetons redeviennent des identifiants, AVANT Zod ──
  // Un jeton non résolu invalide la structure ENTIÈRE (jamais partiellement) :
  // résoudre à moitié produirait un appel visant le bon rendez-vous avec le
  // mauvais patient.
  const resolus = carteCourante().resoudreArguments(argsBruts);
  if (resolus === null) return echec("reference-inconnue");

  // ── 2 · Exécution bornée dans le temps ──
  // La validation Zod n'est PAS faite ici : elle vit dans `lancer`, à
  // l'intérieur du registre. La boucle ne détient jamais la capacité typée,
  // donc elle n'a aucun moyen d'appeler `executer` sans passer par le schéma —
  // le trou par lequel un appelant distrait aurait pu sauter Zod n'existe pas.
  // Une porte qui pend ne doit pas immobiliser Jarvis. Le signal du TOUR est
  // chaîné : un Stop de l'utilisatrice coupe aussi la capacité en cours.
  const minuteur = new AbortController();
  const relais = () => minuteur.abort();
  signalTour.addEventListener("abort", relais, { once: true });
  const echeance = setTimeout(() => minuteur.abort(), BUDGETS.MAX_MS_CAPACITE);

  try {
    const r = await capacite.lancer(resolus, { ...ctxBase, signal: minuteur.signal });
    if (!r.ok) {
      return {
        // ⚠️ `motifEchec` RESTE UN CODE CLASSÉ, JAMAIS UN MESSAGE DE BASE — un
        // contrôle du checkpoint l'exige, et il a raison : un message de porte
        // peut porter une valeur. L'AIDE au modèle voyage donc dans un champ
        // séparé, `champsAttendus`, calculé à l'ENREGISTREMENT à partir des
        // clés du schéma que nous avons écrites. Il ne peut structurellement
        // pas contenir de donnée patient : il ne lit jamais les arguments.
        resultat: {
          capacite: nom,
          ok: false,
          donnees: null,
          motifEchec: r.error.code,
          champsAttendus: capacite.champsAttendus,
        },
        trace: {
          capacite: nom,
          ms: Date.now() - debut,
          ok: false,
          code: r.error.code,
          deduplique: false,
          toolCallId,
        },
      };
    }

    // ── 4 · Le budget de taille, DÉCLARÉ et jamais silencieux ──
    // Une liste coupée sans le dire ferait conclure au modèle « il n'y a que
    // ces trois consultations » sur une lecture partielle.
    const taille = JSON.stringify(r.data).length;
    if (taille > capacite.budgetOctets) {
      log.warn("jarvis.capacite.volumineux", {
        count: taille,
        context: `capacite:${nom}`,
      });
    }

    return {
      resultat: { capacite: nom, ok: true, donnees: r.data },
      trace: { capacite: nom, ms: Date.now() - debut, ok: true, deduplique: false, toolCallId },
    };
  } catch {
    // `lancer` a ete invoquee (puis a leve) : l'invocation porte son ID.
    const code = minuteur.signal.aborted ? "delai-depasse" : "indisponible";
    return {
      resultat: { capacite: nom, ok: false, donnees: null, motifEchec: code },
      trace: { capacite: nom, ms: Date.now() - debut, ok: false, code, deduplique: false, toolCallId },
    };
  } finally {
    clearTimeout(echeance);
    signalTour.removeEventListener("abort", relais);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LA BOUCLE
// ═══════════════════════════════════════════════════════════════════════════

function nouvelIdentifiant(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const o = new Uint8Array(16);
  crypto.getRandomValues(o);
  o[6] = ((o[6] ?? 0) & 0x0f) | 0x40;
  o[8] = ((o[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(o, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * ═══ LA COUTURE D'INJECTION — ET POURQUOI ELLE EXISTE ═══
 *
 * Le transport et le registre sont injectables, avec les vrais en défaut. Ce
 * n'est pas de l'abstraction gratuite : sans cette couture, la boucle ne peut
 * être éprouvée QU'avec un fournisseur joignable, une clé valide et une base
 * peuplée — c'est-à-dire jamais dans un checkpoint, et jamais de façon
 * reproductible.
 *
 * Or c'est exactement la leçon déjà payée dans ce dépôt : quinze contrôles
 * verts recouvraient une chaîne qui n'avait jamais tourné. Un budget, une
 * déduplication, un fail-closed se prouvent en les FAISANT SE DÉCLENCHER, pas en
 * relisant leur code.
 *
 * Elle sert aussi la bascule du mois 2 : le modèle changera, cette couture non,
 * et la suite d'évaluation restera comparable de part et d'autre.
 */
export interface DependancesBoucle {
  readonly transport: typeof demanderAJarvisEnFlux;
  readonly registre: typeof capaciteLecture;
  readonly description: () => string;
  /**
   * Le catalogue COURT, envoyé une fois qu'une capacité a réussi. Facultatif :
   * absent, on retombe sur `description`, ce qui rend le comportement d'avant
   * le 2026-09-06 — aucun faux de test existant n'est cassé par cet ajout.
   */
  readonly descriptionCompacte?: () => string;
  /**
   * Le catalogue VIDE de l'appel final — celui qui n'annonce aucune capacité
   * parce qu'aucune ne sera plus exécutée. Facultatif, même raison que
   * `descriptionCompacte` : ne casser aucun faux de test existant.
   */
  readonly descriptionSynthese?: () => string;
}

const DEPENDANCES_REELLES: DependancesBoucle = {
  transport: demanderAJarvisEnFlux,
  registre: capaciteLecture,
  description: descriptionDesCapacites,
  descriptionCompacte: descriptionCompacteDesCapacites,
  descriptionSynthese: descriptionSyntheseSeule,
};

export async function executerTour(
  params: {
    readonly message: string;
    readonly conversationId: string;
    /**
     * M02 — miroir du tour précédent (NON autoritaire, revalidé avant usage).
     * Absent = comportement historique : ni chaînage, ni fil supposé.
     */
    readonly travail?: TravailPrecedent | null;
  },
  rappels: RappelsTour,
  signal: AbortSignal,
  deps: DependancesBoucle = DEPENDANCES_REELLES,
): Promise<Result<BilanTour>> {
  const runId = nouvelIdentifiant();
  const debutTour = Date.now();
  // M03 - un cliche par appel modele, en ordre d'appel ; epoque de portee
  // (voir `ResultatEpoque` : les succes d'une portee perimee ne survivent pas).
  const snapshots: ContextSnapshot[] = [];
  let epoque = 0;

  /**
   * M02 — traces antérieures à la boucle (la sonde). `appels` est initialisé
   * PLUS BAS à partir de ce tableau : la sonde compte dans les budgets comme
   * tout appel réel — parce qu'elle en est un.
   */
  const tracesSonde: TraceAppel[] = [];
  let verdict: VerdictResolution = { etat: "aucun" };
  let intentionChaineeEnvoi: { readonly nom: NomIntention; readonly conversationId: string } | null =
    null;

  /** Clarification M02 SANS modèle ni capacité patient-spécifique. */
  const bilanClarificationM02 = (
    texte: string,
    verdictFinal: VerdictResolution,
    trace: TraceAppel | null,
  ): Result<BilanTour> =>
    ok({
      texte,
      chemin: "patient",
      interrompu: false,
      persiste: false,
      appels: trace === null ? [] : [trace],
      runId,
      snapshots: [],
      preuves: [],
      propositionInconnue: null,
      ancreCandidate: null,
      resolution: { verdict: verdictFinal, intentionChainee: null, intentionRetenu: null },
    });

  /** Le fil vivant à cet instant : cible TTL-valide (écran, fil ou ancre promue). */
  const filVivant = (): FilPatient | null => {
    const cible = cibleValide();
    if (cible === null) return null;
    return {
      id: cible.id,
      libelle: cible.libelle,
      source: cible.origine === "ecran" ? "ecran" : "conversation",
    };
  };

  // ── M02 · RÉSOLUTION EXPLICITE — sonder AVANT carte, amorce, modèle ──
  //
  // L'ordre est la sécurité : la sonde frappe la carte PRÉ-TOUR (jetée
  // aussitôt), l'adoption purge (sans effet — `reinitialiserCarte` suit),
  // et l'amorce frappe la cible ADOPTÉE. Adopter APRÈS l'amorce casserait
  // les jetons du tour (passe du 2026-09-07, `boucle:613-629`) ; sonder
  // après le premier transport laisserait le modèle deviner en premier.
  //
  // ⚠️ SONDE SUR CHEMIN PATIENT UNIQUEMENT (regex partagée, zéro LLM).
  // Un refus nommé ne fonde aucun fil (la cible d'un tour refusé serait
  // une pollution) ; une question de savoir (« C'est quoi Parkinson ? »)
  // ne sonde jamais — sinon chaque éponyme partirait en clarification.
  // Le verdict reste descriptif sur les autres chemins (fil vivant lu,
  // jamais d'adoption, jamais de chaînage) : M02 s'abstient, il ne bloque
  // pas.
  const cheminM02 = resolutionM02Active() ? classerMultilingue(params.message).chemin : null;
  if (cheminM02 !== null) {
    const mention =
      cheminM02 === "patient" ? extraireMentionExplicite(params.message) : null;
    if (mention !== null && mention.trim().length >= 2) {
      const sonde = await sonderCandidats(mention, deps.registre, {
        carte: carteCourante(),
        signal,
        aujourdHui: aujourdHui(),
      });
      if (!sonde.ok) {
        log.warn("jarvis.resolution.sonde", { code: "indisponible" });
        return bilanClarificationM02(
          clarificationSondeIndisponible(),
          { etat: "nonResolu", mention },
          { capacite: "search_patients", ms: sonde.ms, ok: false, code: "sonde-indisponible", deduplique: false },
        );
      }
      const traceSonde: TraceAppel = {
        capacite: "search_patients",
        ms: sonde.ms,
        ok: true,
        deduplique: false,
      };
      tracesSonde.push(traceSonde);
      const resultatSonde: ResultatSonde = {
        total: sonde.total,
        candidats: sonde.candidats,
        depasse: sonde.depasse,
      };
      verdict = evaluerVerdictTour({ mention, sonde: resultatSonde, fil: filVivant() });
      if (verdict.etat === "unique" && verdict.source === "explicite" && verdict.patient !== undefined) {
        const cible: SaisieCible = {
          id: verdict.patient.id,
          libelle: verdict.patient.libelle,
          numeroDossier: "",
          origine: "recherche",
        };
        adopterResolution({ etat: "explicite", cible }, Date.now());
      } else if (verdict.etat === "ambigu") {
        // M02-I1 : pas de purge — l'ambiguïté porte sur la MENTION, pas sur
        // le fil (qui peut être un Karim valide pendant qu'on cherche un
        // Mohamed). Le tour clarifie en listant ; l'état est préservé.
        return bilanClarificationM02(
          clarificationHomonymes(mention, verdict.libelles ?? [], verdict.total ?? 0),
          verdict,
          traceSonde,
        );
      } else {
        // `nonResolu` : `adopterResolution` serait un no-op par construction —
        // on ne l'appelle même pas. L'état reste ce qu'il était ; le tour
        // clarifie en nommant la mention, sans toucher aux données de Karim.
        return bilanClarificationM02(clarificationNonTrouve(mention), verdict, traceSonde);
      }
    } else {
      verdict = evaluerVerdictTour({ mention: null, sonde: null, fil: filVivant() });
      // ── M02 · CHAÎNAGE — le fil prouvé porte l'intent précédent ──
      // Envoyé quel que soit le chemin local : c'est le SERVEUR qui décide
      // (remplit panne/UNKNOWN, escalade un savoir incertain, respecte un
      // savoir décidé, un ASK et tout refus). Un repli ignoré est inerte —
      // jamais un contournement.
      const travail = params.travail ?? null;
      if (
        travail !== null &&
        travail.conversationId === params.conversationId &&
        travail.intentionPrecedente !== null &&
        travail.patientId !== null &&
        verdict.etat === "unique" &&
        verdict.patient !== undefined &&
        verdict.patient.id === travail.patientId
      ) {
        const chainee = construireIntentionChainee({
          intentionPrecedente: travail.intentionPrecedente,
          mention: null,
          verdict,
          filPrecedentId: travail.patientId,
        });
        if (chainee !== null) {
          intentionChaineeEnvoi = { nom: chainee.name, conversationId: params.conversationId };
        }
      }
    }
  }

  /**
   * L'ancre que ce tour propose — ou `null`, qui est le cas par défaut.
   *
   * Les conditions se lisent comme la définition de « on sait de qui on parle » :
   * aucune ambiguïté constatée, et EXACTEMENT un patient atteint. Zéro veut dire
   * qu'on n'a lu aucun dossier ; deux ou plus veut dire que la conversation a
   * balayé plusieurs personnes, et rien n'autorise à parier sur l'une d'elles.
   */
  const ancre = (): BilanTour["ancreCandidate"] => {
    if (ambiguiteConstatee) return null;
    if (patientsAtteints.size !== 1) return null;
    const [id] = [...patientsAtteints];
    if (id === undefined) return null;
    const libelle = carteCourante().libellePourIdentifiant(id);
    // Sans libellé, pas d'ancre : une cible que l'écran ne peut pas nommer ne
    // pourrait ni s'afficher dans la puce de contexte, ni alimenter le masquage.
    if (libelle === null || libelle.trim() === "") return null;
    return { id, libelle };
  };

  // ⚠️ LA CARTE EST NEUVE À CHAQUE TOUR. C'est la première ligne de défense
  // contre la contamination A→B→A : aucun jeton d'un tour précédent ne peut
  // désigner quoi que ce soit dans celui-ci.
  const carte = reinitialiserCarte();

  const amorce = await assemblerAmorce(carte);
  const capacites = deps.description();
  const ctxBase = { carte, aujourdHui: aujourdHui() };

  // M03 - la portee d'assemblage, relue FRAICHE a chaque appel (la purge
  // d'ambiguite en cours de tour y est visible des l'iteration suivante ;
  // le jeton stale de l'amorce ne passe jamais sans fil vivant concordant).
  const scopeAssemblageCourant = (amorceLocale: ContexteAmorce): ScopeAssemblage =>
    porterScopeAssemblage({
      verdict,
      patientRef: amorceLocale.patientCible ?? null,
      cibleId: cibleValide()?.id ?? null,
      cibleOrigine: cibleValide()?.origine ?? null,
      ambiguiteConstatee,
      expire: contexteExpire(),
    });

  // M03 - UN appel modele = UN assemblage + UN cliche, meme geste atomique.
  // Le cliche est calcule sur la contribution EXACTEMENT retournee.
  const assemblerAppel = (
    appelId: string,
    tourIndex: number,
    amorceLocale: ContexteAmorce,
  ): { contexte: unknown; resultatsOutils: readonly unknown[] } => {
    const { contribution, snapshot } = assembler({
      runId,
      conversationId: params.conversationId,
      clientTurnId: appelId,
      tourIndex,
      intention: intentionChaineeEnvoi?.nom ?? null,
      scope: scopeAssemblageCourant(amorceLocale),
      amorce: amorceLocale,
      resultats,
      epoqueCourante: epoque,
    });
    snapshots.push(snapshot);
    return { contexte: contribution.contexte, resultatsOutils: contribution.resultats };
  };

  /**
   * ═══ LE CATALOGUE RÉTRÉCIT DÈS QU'UNE CAPACITÉ A RÉUSSI ═══
   *
   * ⚠️ DÉFAUT MESURÉ LE 2026-09-06, ET C'ÉTAIT LE NÔTRE, PAS CELUI DU MODÈLE.
   * Le catalogue complet (7 782 car., au plafond des 8 000) repartait à CHAQUE
   * itération, y compris avec un résultat correct déjà en main. Le modèle
   * rappelait la capacité qu'il venait d'appeler ; la déduplication rendait le
   * même résultat ; le garde de répétition rompait le tour. Quatre questions
   * d'agenda sur cinq échouaient ainsi.
   *
   * Expérience contrôlée (même modèle, même résultat d'outil, seule la
   * longueur du catalogue variant) : à 2 000 caractères le modèle répond, à
   * 4 000 il rappelle l'outil. Le correctif tient donc en une phrase — cesser
   * d'inonder une fois la donnée obtenue — et NON en un assouplissement du
   * garde, qui a fait exactement son travail.
   *
   * ⚠️ « A RÉUSSI » ET NON « A ÉTÉ APPELÉE ». Un échec doit laisser le
   * catalogue ENTIER : le modèle a besoin des descriptions complètes pour
   * choisir une AUTRE capacité, et c'est précisément le cas où il tâtonne.
   */
  const catalogueDuTour = (): string => {
    /**
     * ⚠️ LE MODÈLE S'EST DÉJÀ RÉPÉTÉ UNE FOIS : ON CESSE DE LUI TENDRE DES
     * OUTILS. Mesuré sur « Qu'ai-je demain matin ? » le 2026-09-06.
     *
     * Après le correctif d'alias, la déduplication VOIT bien la répétition —
     * mais la boucle continuait à réoffrir un catalogue, le modèle reproposait,
     * et le garde finissait par rompre le tour à la deuxième répétition. La
     * donnée, elle, était complète depuis le premier appel.
     *
     * Une répétition est le signal le plus clair qu'il puisse émettre : « je
     * n'ai plus rien à chercher ». On lui répond en lui retirant la tentation,
     * pas en desserrant le garde — qui reste en place, inchangé, et qui
     * mordra toujours si la répétition persiste.
     */
    if (repetitions > 0) {
      return (deps.descriptionSynthese ?? deps.descriptionCompacte ?? deps.description)();
    }
    return resultats.some((r) => r.resultat.ok)
      ? (deps.descriptionCompacte ?? deps.description)()
      : capacites;
  };

  // M03 - chaque resultat est tamponne de son epoque de portee.
  const resultats: ResultatEpoque[] = [];
  // M02 : la sonde pré-boucle compte dans les budgets comme tout appel réel.
  const appels: TraceAppel[] = tracesSonde;
  const dejaVu = new Map<string, SafeToolResult<ValeurSafe>>();
  let repetitions = 0;
  // Une ambiguïté constatée arme la porte pour tout le reste du tour.
  let ambiguiteConstatee = false;
  /**
   * Les patients que ce tour a RÉELLEMENT lus, avec succès.
   *
   * ⚠️ CE QUI N'ENTRE PAS ICI EST AUSSI IMPORTANT QUE CE QUI Y ENTRE. Pas une
   * proposition du modèle, pas un candidat de recherche, pas un nom prononcé,
   * pas un appel en échec, pas un appel refusé par la RLS. Uniquement un
   * identifiant qui a franchi la carte d'identité, Zod, la porte SQL et la RLS,
   * et dont la capacité a rendu `ok`. C'est ce qui rend l'ancre du tour suivant
   * indiscutable : elle ne peut désigner que quelqu'un dont le serveur a
   * effectivement accepté de parler.
   */
  const patientsAtteints = new Set<string>();

  /**
   * M02 — l'intent à léguer au tour suivant, depuis les NOMS de capacités
   * exécutées avec succès (aucune donnée, aucun argument). `null` = le tour
   * suivant classifie frais. L'inverse-compat ne retient ni méta ni écriture
   * (`intentRetenuDesAppels`) ; une proposition en attente de confirmation
   * casse la chaîne (appelant : `null` explicite sur ce chemin).
   */
  const intentionRetenue = (): NomIntention | null =>
    intentRetenuDesAppels(appels.filter((a) => a.ok).map((a) => a.capacite));

  /** M02 — le bilan de résolution joint à chaque sortie du tour. */
  const bilanResolution = (intentionRetenu: NomIntention | null): ResolutionBilan => ({
    verdict,
    intentionChainee: intentionChaineeEnvoi === null ? null : intentionChaineeEnvoi.nom,
    intentionRetenu,
  });

  for (let iteration = 0; iteration < BUDGETS.MAX_TOURS_OUTIL; iteration++) {
    if (Date.now() - debutTour > BUDGETS.MAX_MS_TOUR) {
      return ok(bilanAveu(fr.jarvis.boucle.tropLong, runId, appels, snapshots, bilanResolution(null)));
    }

    // M03 - l'assemblage precede la frontiere : la contribution sectionnee
    // et bornee est ce qui est assaini, verifie, envoye - et cliche.
    // L'identifiant d'appel est pose AVANT pour que le cliche porte
    // exactement l'appel qui part.
    const appelId = nouvelIdentifiant();
    const assemble = assemblerAppel(appelId, iteration, amorce);

    // ── LA FRONTIÈRE — assainir puis vérifier, dans cet ordre ──
    // Vérifier avant d'assainir lèverait sur du contenu qu'on s'apprêtait
    // justement à masquer ; assainir sans vérifier laisserait passer ce que la
    // substitution n'a pas couvert.
    let charge: { contexte: unknown; resultatsOutils: readonly unknown[]; message: string };
    try {
      charge = preparerPourLeModele(
        { contexte: assemble.contexte, resultatsOutils: assemble.resultatsOutils, message: params.message },
        carte,
      );
    } catch (cause) {
      if (cause instanceof FuiteDetectee) {
        // ⚠️ FAIL-CLOSED. Un tour qui échoue est un incident mineur : la
        // praticienne reformule, et toute l'application reste accessible. Une
        // fuite est irréversible. Le rapport entre les deux coûts n'est pas
        // discutable, donc le sens du défaut non plus.
        log.error("jarvis.frontiere", { code: "interdit", context: `classe:${cause.classe}` });
        return err({
          code: "regle-metier",
          message: fr.jarvis.boucle.frontiere,
          context: "jarvis:frontiere",
        });
      }
      throw cause;
    }

    const bilan = await deps.transport(
      {
        message: charge.message,
        conversationId: params.conversationId,
        clientTurnId: appelId,
        runId,
        contexte: charge.contexte,
        resultatsOutils: charge.resultatsOutils,
        capacites: catalogueDuTour(),
        // M02 : repli chaîné — le serveur ne s'en sert que si son propre
        // classifieur ne rend rien de valide (jamais d'écrasement d'un valide,
        // revalidation + compat serveur inchangées).
        ...(intentionChaineeEnvoi === null ? {} : { intentionChainee: intentionChaineeEnvoi }),
        // La demande n'est écrite qu'une fois : elle n'a été posée qu'une fois.
        persisterDemande: iteration === 0,
      },
      {
        ...(rappels.onChemin === undefined ? {} : { onChemin: rappels.onChemin }),
        ...(rappels.onDelta === undefined ? {} : { onDelta: rappels.onDelta }),
      },
      signal,
    );

    if (!bilan.ok) return err(bilan.error);
    const r = bilan.data;

    if (r.interrompu) {
      return ok({
        texte: r.texte,
        chemin: r.chemin,
        interrompu: true,
        persiste: false,
        appels,
        runId,
        snapshots,
        // Interrompu avant `fin` : texte partiel, preuves absentes.
        preuves: [],
        propositionInconnue: null,
        // Un tour interrompu n'a rien conclu : il n'ancre rien.
        ancreCandidate: null,
        // ...et ne lègue rien : le tour suivant repart de zéro.
        resolution: bilanResolution(null),
      });
    }

    // ── Pas de proposition : c'est la réponse finale ──
    // ⚠️ `=== null` NE SUFFISAIT PAS, ET ÇA PLANTAIT. Une passerelle qui rend
    // un corps incomplet donne `undefined`, pas `null` : la garde ne mordait
    // pas, la déstructuration suivante levait un TypeError, et la boucle
    // mourait au lieu d'avouer. Trouvé par le test « réponse malformée », pas
    // par la relecture. On traite désormais TOUTE absence de proposition comme
    // une réponse finale — ce qui est aussi la lecture prudente : sans
    // proposition exploitable, il n'y a rien à exécuter.
    // Une proposition présente mais sans nom exploitable est traitée comme
    // absente : `registre(undefined)` rendrait « inconnue » avec un nom vide,
    // et l'écran afficherait une carte de confirmation sans objet.
    const nomPropose: unknown = (r.proposition as { nom?: unknown } | null | undefined)?.nom;
    if (r.proposition === null || r.proposition === undefined || typeof nomPropose !== "string") {
      return ok({
        texte: r.texte ?? "",
        chemin: r.chemin,
        interrompu: false,
        persiste: r.persiste,
        appels,
        runId,
        snapshots,
        // M07 — preuves du `fin` canonique (transport validé).
        preuves: r.preuves,
        propositionInconnue: null,
        // Le tour a abouti : s'il n'a lu qu'un patient, il le propose.
        ancreCandidate: ancre(),
        // ...et il lègue l'intent prouvé par ses exécutions (M02, chaînage).
        resolution: bilanResolution(intentionRetenue()),
      });
    }

    const { nom, args } = r.proposition;

    // ── Capacité hors registre de LECTURE ──
    // Rendue telle quelle à l'appelant : en phase 2, `conversation.ts` la
    // présentera au registre d'ÉCRITURE, qui exigera une carte de confirmation.
    // La boucle, elle, ne l'exécute pas — elle n'a aucun chemin pour le faire.
    if (deps.registre(nom) === null) {
      return ok({
        texte: r.texte,
        chemin: r.chemin,
        interrompu: false,
        persiste: r.persiste,
        appels,
        runId,
        snapshots,
        // Tour de proposition : aucune preuve transportée (le chemin
        // connaissance ne propose jamais d'outil).
        preuves: [],
        propositionInconnue: { nom, args },
        // ⚠️ UNE ÉCRITURE EN ATTENTE N'ANCRE RIEN. Le tour s'arrête sur une
        // carte de confirmation ; rien n'a été exécuté, et l'humaine n'a pas
        // encore décidé. Ancrer ici ferait d'une proposition non confirmée un
        // contexte de conversation — exactement l'inversion que L2 interdit.
        ancreCandidate: null,
        // M02 : une écriture en attente CASSE la chaîne — le tour suivant
        // (après décision humaine) reclassifie frais, jamais sur un legs.
        resolution: bilanResolution(null),
      });
    }

    if (appels.length >= BUDGETS.MAX_APPELS_OUTIL) {
      return ok(bilanAveu(fr.jarvis.boucle.tropDAppels, runId, appels, snapshots, bilanResolution(null)));
    }

    rappels.onCapacite?.(nom);

    // ── Déduplication ──
    // ⚠️ SUR LE NOM CANONIQUE, PAS SUR LE NOM PROPOSÉ. `get_agenda` est un
    // ALIAS de `get_agenda_range` : proposés l'un après l'autre, ils sont le
    // même appel et rendaient la même chose, mais formaient deux clés
    // distinctes. Mesuré sur « Qu'ai-je demain matin ? » le 2026-09-06 — deux
    // exécutions identiques (1 457 octets chacune), budget épuisé, tour rompu.
    // La TRACE, elle, conserve le nom proposé : elle doit dire ce que le
    // modèle a réellement demandé.
    const canonique = canoniserAppel(nom, args);
    const cle = cleAppel(canonique.nom, canonique.args);

    // ── M04 · FILTRE D'INTENTION : la proposition appartient-elle a la
    // famille de l'intention validee en force ? ──
    //
    // Le signal est EXCLUSIVEMENT l'echo serveur `intent` qui accompagne la
    // proposition (revalide par `intentionValideeDe` - jamais cru sur parole).
    // Sans echo : AUCUN filtre (comportement historique permissif).
    //
    // En particulier, l'intention chainee du tour NE SERT PAS de signal :
    // le serveur l'ignore des qu'il classifie frais (cas nominal du suivi
    // "Montre-moi Karim" -> "Sa derniere consultation ?"), et la boucle qui
    // filtrerait sur l'intent du tour PRECEDENT casserait ce suivi legitime
    // en le jugeant sur la mauvaise famille. La compat serveur
    // (`cheminPatientPayload`, sur l'intent decide) reste l'autorite ; ici,
    // c'est le second avis par iteration, jamais une devinette.
    //
    // Refuse = echec nomme `intention-incompatible`, ZERO EXECUTION, tour
    // continue (meme geste que les portes d'ambiguite et de fil : le modele
    // recoit l'echec et clarifie ou repond). Avant la dedup : un resultat en
    // cache ne doit jamais servir une proposition desormais incompatible.
    const intentSignal = intentionValideeDe(r.proposition.intent);
    if (!propositionAutorisee(intentSignal, canonique.nom)) {
      resultats.push({
        resultat: {
          capacite: nom,
          ok: false,
          donnees: null,
          motifEchec: "intention-incompatible",
        },
        epoque,
      });
      appels.push({ capacite: nom, ms: 0, ok: false, code: "intention-incompatible", deduplique: false });
      continue;
    }

    const enCache = dejaVu.get(cle);
    if (enCache !== undefined) {
      repetitions++;
      // ⚠️ UNE TROISIÈME OCCURRENCE IDENTIQUE ROMPT LE TOUR. Deux fois, c'est
      // une hésitation du modèle et le cache la couvre ; trois fois, c'est une
      // boucle, et la laisser tourner ne fait que dépenser.
      if (repetitions >= 2) {
        return ok(bilanAveu(fr.jarvis.boucle.enBoucle, runId, appels, snapshots, bilanResolution(null)));
      }
      // Le résultat en cache est RENDU au modèle, avec la mention — sans quoi
      // il redemanderait indéfiniment sans jamais rien recevoir.
      resultats.push({ resultat: { ...enCache, motifEchec: "deja-appele" }, epoque });
      appels.push({ capacite: nom, ms: 0, ok: enCache.ok, deduplique: true });
      continue;
    }

    // ── LA PORTE : après une ambiguïté, on demande, on ne choisit pas ──
    //
    // ⚠️ `signalerAmbiguite()` PURGEAIT LA CIBLE SANS ARRÊTER L'APPEL. Deux
    // dossiers au même nom : `search_patients` rendait `ambigu:true`, la cible
    // était bien purgée — et le modèle gardait les DEUX jetons en main. Rien ne
    // l'empêchait d'enchaîner `get_patient_context({{PATIENT_001}})` et de
    // répondre avec assurance sur un dossier choisi par défaut. Purger la cible
    // sans fermer le chemin, c'est ranger l'arme en laissant la porte ouverte :
    // « ne jamais deviner » était affirmé à un endroit et contredit au suivant.
    //
    // La porte ne ferme QUE les capacités patient-spécifiques (schéma acceptant
    // `patientId`, dérivé — jamais une liste de noms), et seulement APRÈS une
    // ambiguïté constatée dans CE tour. Le flux légitime « agenda → détail d'un
    // dossier listé » n'est pas touché : le patient y est déterministe, son
    // jeton vient d'un résultat réel, et aucune ambiguïté n'a été signalée.
    const capaciteProposee = deps.registre(canonique.nom);
    if (ambiguiteConstatee && capaciteProposee !== null && estPatientSpecifique(capaciteProposee)) {
      resultats.push({
        resultat: {
          capacite: nom,
          ok: false,
          donnees: null,
          motifEchec: "cible-ambigue",
        },
        epoque,
      });
      appels.push({ capacite: nom, ms: 0, ok: false, code: "cible-ambigue", deduplique: false });
      continue;
    }

    // ── M02 · PORTE DE FIL : un tour résolu n'exécute pas sur un autre patient ──
    //
    // Le modèle a en main des jetons frappés ce tour (cible adoptée, résultats
    // de recherche qu'il a lui-même demandés) : rien ne l'empêche structurellement
    // d'en proposer un hors du fil résolu — « Karim » désigné, puis lecture sur
    // un jeton Mohamed croisé en route. La porte compare l'identifiant RÉSOLU
    // de la proposition au fil vivant : différent = on ne choisit pas, on rend
    // l'échec nommé au modèle (qui clarifiera), zéro exécution.
    //
    // Elle ne mord QUE sur fil vivant : sans fil (agenda → détail d'un dossier
    // listé), le flux légitime passe comme avant — l'ambiguïté, elle, reste
    // couverte par la porte ci-dessus.
    if (resolutionM02Active() && capaciteProposee !== null && estPatientSpecifique(capaciteProposee)) {
      const filActuel = cibleValide();
      if (filActuel !== null) {
        const propose = identifiantPatientDe(carteCourante().resoudreArguments(args));
        if (propose !== null && propose !== filActuel.id) {
          log.warn("jarvis.resolution.hors-fil", { code: "patient-hors-fil" });
          resultats.push({
            resultat: {
              capacite: nom,
              ok: false,
              donnees: null,
              motifEchec: "patient-hors-fil",
            },
            epoque,
          });
          appels.push({ capacite: nom, ms: 0, ok: false, code: "patient-hors-fil", deduplique: false });
          continue;
        }
      }
    }

    const { resultat, trace } = await executerCapacite(nom, args, ctxBase, signal, deps.registre);
    dejaVu.set(cle, resultat);

    // ── Ce tour a-t-il VRAIMENT lu un patient ? ──
    // On relit les arguments à travers la carte — la même résolution que celle
    // qu'`executerCapacite` vient de faire, en lecture seule. Un jeton non
    // frappé rend `null` et n'enregistre donc rien : on ne peut pas ancrer sur
    // un patient que la carte de ce tour ne connaît pas.
    if (resultat.ok && capaciteProposee !== null && estPatientSpecifique(capaciteProposee)) {
      const id = identifiantPatientDe(carteCourante().resoudreArguments(args));
      if (id !== null) patientsAtteints.add(id);
    }
    resultats.push({ resultat, epoque });
    appels.push(trace);
    // ── Ambiguïté : ne jamais deviner ──
    // Un résultat `ambigu:true` (homonymes) purge la cible : poursuivre le
    // tour sur un dossier choisi par défaut serait une erreur d'identité. La
    // boucle continue — c'est au modèle de demander lequel, avec les
    // références rendues — mais sans cible pré-résolue.
    if (
      resultat.ok &&
      resultat.donnees !== null &&
      "ambigu" in resultat.donnees &&
      resultat.donnees.ambigu === true
    ) {
      signalerAmbiguite();
      // Le drapeau vit le TOUR, pas l'appel : c'est ce qui arme la porte
      // ci-dessus pour toutes les itérations suivantes du même tour.
      ambiguiteConstatee = true;
      // M03 - la portee change : les succes de l'epoque close ne voyagent
      // plus (l'assembleur les ecarte, echecs et recherche ambigue exceptes).
      epoque += 1;
    }

    // ── POURQUOI LE RANG 1 N'EST PAS POSÉ ICI, ET CE QUE ÇA COÛTE ──
    //
    // Tentative faite, puis retirée le 2026-09-07 : poser la cible sur une
    // recherche à candidat unique, pour que l'amorce du tour suivant cesse
    // d'annoncer le patient de l'écran quand la praticienne vient d'en nommer
    // un autre. MESURÉ : cassait `jarvis-boucle-verbalisation` (3 appels au
    // lieu de 4). `definirCible` voit un CHANGEMENT de cible et réinitialise
    // la carte d'identité — c'est sa raison d'être — donc le jeton
    // `PATIENT_001` que le modèle s'apprêtait à passer à
    // `get_current_medications` devenait « reference-inconnue ». Le flux le
    // plus courant du produit, chercher puis lire, tombait.
    //
    // Affaiblir la purge pour faire passer la pose aurait échangé une gêne
    // d'indice de contexte contre le bogue de contamination que cette purge
    // existe pour empêcher. La pose de rang 1 demande donc un point d'ancrage
    // en FIN de tour, hors du cycle de vie de la carte — hors périmètre de
    // cette tranche, noté dans STATE.md.
  }

  // ── Budget d'itérations épuisé, MAIS dernier succès frais ──
  // Mesuré en live (carnet serveur, 2026-09-04) : `search_patients` →
  // `get_current_medications` (donnée RENDUE) → `get_patient_context`, trois
  // succès, puis l'aveu — la donnée n'a jamais été verbalisée parce que le
  // modèle ne revoit plus les résultats après sa 3ᵉ exécution. Un premier
  // tour gaspillé + un budget de 3 = réponse tuée alors que tout a fonctionné.
  //
  // On accorde donc UN appel final pour répondre en langue. AUCUNE proposition
  // n'y est exécutée : le budget d'outils reste épuisé, et si le dernier
  // résultat est un ÉCHEC, l'aveu reste immédiat — on ne demande jamais au
  // modèle de broder sur des erreurs (fail-closed inchangé).
  const dernier = resultats[resultats.length - 1];
  if (
    dernier !== undefined &&
    dernier.resultat.ok &&
    Date.now() - debutTour <= BUDGETS.MAX_MS_TOUR
  ) {
    // M03 - l'appel final de synthese est un appel modele comme les autres :
    // assemble (meme epoque, meme portee relue fraiche) + cliche.
    const appelFinalId = nouvelIdentifiant();
    const assembleFinal = assemblerAppel(appelFinalId, BUDGETS.MAX_TOURS_OUTIL, amorce);
    let chargeFinale: {
      contexte: unknown;
      resultatsOutils: readonly unknown[];
      message: string;
    };
    try {
      chargeFinale = preparerPourLeModele(
        { contexte: assembleFinal.contexte, resultatsOutils: assembleFinal.resultatsOutils, message: params.message },
        carte,
      );
    } catch (cause) {
      if (cause instanceof FuiteDetectee) {
        log.error("jarvis.frontiere", { code: "interdit", context: `classe:${cause.classe}` });
        return err({
          code: "regle-metier",
          message: fr.jarvis.boucle.frontiere,
          context: "jarvis:frontiere",
        });
      }
      throw cause;
    }
    const final = await deps.transport(
      {
        message: chargeFinale.message,
        conversationId: params.conversationId,
        clientTurnId: appelFinalId,
        runId,
        contexte: chargeFinale.contexte,
        resultatsOutils: chargeFinale.resultatsOutils,
        // M02 : même repli que l'appel principal (chaque appel passerelle
        // reclassifie côté serveur).
        ...(intentionChaineeEnvoi === null ? {} : { intentionChainee: intentionChaineeEnvoi }),
        /**
         * ⚠️ AUCUNE CAPACITÉ ICI, ET C'EST LE CORRECTIF DU 2026-09-06.
         *
         * Ce dernier appel existe pour VERBALISER : le budget d'outils est
         * épuisé, et une proposition émise à ce stade ne sera jamais exécutée
         * (voir juste en dessous — elle rend `tropDIterations`). Lui renvoyer
         * un catalogue, c'était l'inviter à faire la seule chose qui ne peut
         * plus aboutir.
         *
         * Mesuré sur « Qui vient demain ? » : deux capacités appelées, toutes
         * deux réussies, donnée complète en main — et un aveu d'échec rendu à
         * la praticienne parce que le modèle proposait un troisième outil au
         * lieu de répondre.
         */
        capacites: (deps.descriptionSynthese ?? deps.descriptionCompacte ?? deps.description)(),
        // La demande n'a été posée qu'une fois : cet appel ne la récrit pas.
        persisterDemande: false,
      },
      {
        ...(rappels.onChemin === undefined ? {} : { onChemin: rappels.onChemin }),
        ...(rappels.onDelta === undefined ? {} : { onDelta: rappels.onDelta }),
      },
      signal,
    );
    if (!final.ok) return ok(bilanAveu(fr.jarvis.boucle.tropDIterations, runId, appels, snapshots, bilanResolution(null)));
    const f = final.data;
    if (f.interrompu) {
      return ok({
        texte: f.texte,
        chemin: f.chemin,
        interrompu: true,
        persiste: false,
        appels,
        runId,
        snapshots,
        preuves: [],
        propositionInconnue: null,
        ancreCandidate: null,
        resolution: bilanResolution(null),
      });
    }
    const nomFinal: unknown = (f.proposition as { nom?: unknown } | null | undefined)?.nom;
    if (f.proposition === null || f.proposition === undefined || typeof nomFinal !== "string") {
      return ok({
        texte: f.texte ?? "",
        chemin: f.chemin,
        interrompu: false,
        persiste: f.persiste,
        appels,
        runId,
        snapshots,
        preuves: f.preuves,
        propositionInconnue: null,
        // Le budget d'outils était épuisé, mais la lecture, elle, a réussi.
        ancreCandidate: ancre(),
        resolution: bilanResolution(intentionRetenue()),
      });
    }
    // Une proposition à ce stade ne sera jamais exécutée : le budget d'outils
    // est épuisé, et l'exécuter rouvrirait la boucle qu'on vient de fermer.
    return ok(bilanAveu(fr.jarvis.boucle.tropDIterations, runId, appels, snapshots, bilanResolution(null)));
  }

  // ── Budget d'itérations épuisé ──
  // Jarvis AVOUE. Fabriquer une réponse ici serait exactement l'hallucination
  // que toute cette architecture existe pour rendre impossible.
  return ok(bilanAveu(fr.jarvis.boucle.tropDIterations, runId, appels, snapshots, bilanResolution(null)));
}

function bilanAveu(
  texte: string,
  runId: string,
  appels: readonly TraceAppel[],
  snapshots: readonly ContextSnapshot[],
  resolution?: ResolutionBilan,
): BilanTour {
  log.warn("jarvis.boucle.budget", { count: appels.length, context: `trace:${runId}` });
  return {
    texte,
    chemin: "patient",
    interrompu: false,
    persiste: false,
    appels,
    runId,
    snapshots,
    preuves: [],
    propositionInconnue: null,
    // ⚠️ UN AVEU N'ANCRE JAMAIS. Jarvis dit ici qu'il n'a pas abouti ; en tirer
    // un contexte de conversation reviendrait à retenir une conclusion d'un
    // tour qui déclare n'en avoir aucune.
    ancreCandidate: null,
    // M02 : même règle pour le legs — un aveu ne lègue rien.
    ...(resolution === undefined ? {} : { resolution }),
  };
}
