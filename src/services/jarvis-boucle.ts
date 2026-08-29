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
  aujourdHui,
  capaciteLecture,
  descriptionDesCapacites,
  type ContexteExecution,
  type ValeurSafe,
} from "./jarvis-capacites";
import { preparerPourLeModele, FuiteDetectee } from "./jarvis-confidentialite";
import { assemblerAmorce, BUDGETS } from "./jarvis-contexte";
import { carte as carteCourante, reinitialiserCarte } from "./jarvis-identite";
import { demanderAJarvisEnFlux, type CheminJarvis } from "./jarvis";
import type { SafeToolResult } from "./jarvis-projections";
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
}

export interface BilanTour {
  /** Le texte final, JETONS NON RENDUS — le rendu d'identité est l'affaire de l'écran. */
  readonly texte: string;
  readonly chemin: CheminJarvis | null;
  readonly interrompu: boolean;
  readonly persiste: boolean;
  readonly appels: readonly TraceAppel[];
  /** Identifiant de corrélation du tour — sans signification, jamais un identifiant métier. */
  readonly traceId: string;
  /**
   * Le modèle a proposé une capacité que la boucle ne connaît pas comme
   * lecture. En phase 2, c'est le point d'entrée du registre d'ÉCRITURE ; pour
   * l'instant, c'est une proposition refusée proprement.
   */
  readonly propositionInconnue: { readonly nom: string; readonly args: unknown } | null;
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
      trace: { capacite: nom, ms: Date.now() - debut, ok: true, deduplique: false },
    };
  } catch {
    return echec(minuteur.signal.aborted ? "delai-depasse" : "indisponible");
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
}

const DEPENDANCES_REELLES: DependancesBoucle = {
  transport: demanderAJarvisEnFlux,
  registre: capaciteLecture,
  description: descriptionDesCapacites,
};

export async function executerTour(
  params: {
    readonly message: string;
    readonly conversationId: string;
  },
  rappels: RappelsTour,
  signal: AbortSignal,
  deps: DependancesBoucle = DEPENDANCES_REELLES,
): Promise<Result<BilanTour>> {
  const traceId = nouvelIdentifiant();
  const debutTour = Date.now();

  // ⚠️ LA CARTE EST NEUVE À CHAQUE TOUR. C'est la première ligne de défense
  // contre la contamination A→B→A : aucun jeton d'un tour précédent ne peut
  // désigner quoi que ce soit dans celui-ci.
  const carte = reinitialiserCarte();

  const amorce = await assemblerAmorce(carte);
  const capacites = deps.description();
  const ctxBase = { carte, aujourdHui: aujourdHui() };

  const resultats: SafeToolResult<ValeurSafe>[] = [];
  const appels: TraceAppel[] = [];
  const dejaVu = new Map<string, SafeToolResult<ValeurSafe>>();
  let repetitions = 0;

  for (let iteration = 0; iteration < BUDGETS.MAX_TOURS_OUTIL; iteration++) {
    if (Date.now() - debutTour > BUDGETS.MAX_MS_TOUR) {
      return ok(bilanAveu(fr.jarvis.boucle.tropLong, traceId, appels));
    }

    // ── LA FRONTIÈRE — assainir puis vérifier, dans cet ordre ──
    // Vérifier avant d'assainir lèverait sur du contenu qu'on s'apprêtait
    // justement à masquer ; assainir sans vérifier laisserait passer ce que la
    // substitution n'a pas couvert.
    let charge: { contexte: unknown; resultatsOutils: readonly unknown[]; message: string };
    try {
      charge = preparerPourLeModele(
        { contexte: amorce, resultatsOutils: resultats, message: params.message },
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
        clientTurnId: nouvelIdentifiant(),
        contexte: charge.contexte,
        resultatsOutils: charge.resultatsOutils,
        capacites,
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
        traceId,
        propositionInconnue: null,
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
        traceId,
        propositionInconnue: null,
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
        traceId,
        propositionInconnue: { nom, args },
      });
    }

    if (appels.length >= BUDGETS.MAX_APPELS_OUTIL) {
      return ok(bilanAveu(fr.jarvis.boucle.tropDAppels, traceId, appels));
    }

    rappels.onCapacite?.(nom);

    // ── Déduplication ──
    const cle = cleAppel(nom, args);
    const enCache = dejaVu.get(cle);
    if (enCache !== undefined) {
      repetitions++;
      // ⚠️ UNE TROISIÈME OCCURRENCE IDENTIQUE ROMPT LE TOUR. Deux fois, c'est
      // une hésitation du modèle et le cache la couvre ; trois fois, c'est une
      // boucle, et la laisser tourner ne fait que dépenser.
      if (repetitions >= 2) {
        return ok(bilanAveu(fr.jarvis.boucle.enBoucle, traceId, appels));
      }
      // Le résultat en cache est RENDU au modèle, avec la mention — sans quoi
      // il redemanderait indéfiniment sans jamais rien recevoir.
      resultats.push({ ...enCache, motifEchec: "deja-appele" });
      appels.push({ capacite: nom, ms: 0, ok: enCache.ok, deduplique: true });
      continue;
    }

    const { resultat, trace } = await executerCapacite(nom, args, ctxBase, signal, deps.registre);
    dejaVu.set(cle, resultat);
    resultats.push(resultat);
    appels.push(trace);
  }

  // ── Budget d'itérations épuisé ──
  // Jarvis AVOUE. Fabriquer une réponse ici serait exactement l'hallucination
  // que toute cette architecture existe pour rendre impossible.
  return ok(bilanAveu(fr.jarvis.boucle.tropDIterations, traceId, appels));
}

function bilanAveu(texte: string, traceId: string, appels: readonly TraceAppel[]): BilanTour {
  log.warn("jarvis.boucle.budget", { count: appels.length, context: `trace:${traceId}` });
  return {
    texte,
    chemin: "patient",
    interrompu: false,
    persiste: false,
    appels,
    traceId,
    propositionInconnue: null,
  };
}
