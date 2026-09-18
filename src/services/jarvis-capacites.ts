/**
 * `jarvis-capacites.ts` — LE REGISTRE DES CAPACITÉS DE LECTURE.
 *
 * ═══ CE FICHIER N'EST PAS UN SECOND CHEMIN D'ACCÈS AUX DONNÉES ═══
 * Exactement la phrase d'en-tête de `jarvis-tools.ts`, et pour la même raison.
 * Chaque capacité DÉLÈGUE à un service existant — `getPatientWorkspace`,
 * `listAgenda`, `getDashboardToday` — sans réécrire une requête. Une capacité
 * qui refabriquerait la sienne divergerait le jour où la porte SQL change de
 * signature, et c'est le défaut qui a déjà coûté une session sur `list_agenda`
 * (024 → 025).
 *
 * ═══ POURQUOI LA PROJECTION EST IMPOSÉE PAR LE TYPE DE RETOUR ═══
 * Le plan décrivait deux fonctions séparées — `executer()` puis `projeter()`.
 * À l'écriture, cette forme s'est révélée PLUS FAIBLE : elle impose un
 * `unknown` intermédiaire entre les deux, c'est-à-dire précisément le trou par
 * lequel une ligne brute pourrait passer sans que le compilateur bronche.
 *
 * La forme retenue contraint le TYPE DE RETOUR à `ValeurSafe` — l'union fermée
 * des DTO de `jarvis-projections.ts`. Une capacité qui rendrait un
 * `PatientWorkspace` brut NE COMPILE PAS. C'est la même garantie, obtenue par
 * le vérificateur de types plutôt que par la discipline d'écriture, et sans
 * ménager de `unknown` au milieu du chemin.
 *
 * ═══ CE REGISTRE NE CONTIENT AUCUNE ÉCRITURE ═══
 * Les écritures vivent dans un registre SÉPARÉ (phase 2), pas derrière un
 * drapeau booléen de celui-ci. Un booléen se teste — et un test s'oublie. Deux
 * registres distincts rendent l'erreur impossible à commettre : le chemin qui
 * exécute les lectures n'a pas de référence vers les écritures.
 */

import { z } from "zod";

import { getAppointment, listAgenda } from "./appointments";
import { getConsultation } from "./consultations";
import { listPatientDocuments } from "./documents";
import { getDashboardToday } from "./dashboard";
import { preparerEntreeBriefMatinal } from "./brief-matinal";
import { getDeploymentEnvironment } from "./deployment";
import { getDayRevenue, getConsultationPayment, listDayPayments } from "./finance";
import { listNotifications } from "./notifications";
import {
  aujourdHuiCabinet,
  bornesDePeriode,
  type NomPeriode,
  type Periode,
} from "./finance-calendrier";
import { getFinanceOverview } from "./finance-cash";
import type { CarteIdentite } from "./jarvis-identite";
import {
  projeterAgenda,
  projeterConsultation,
  projeterDocuments,
  projeterFinancePatient,
  projeterHistoriqueSeances,
  projeterMedicaments,
  projeterPaiementsEnAttente,
  projeterPatientListItem,
  projeterRecetteDuJour,
  projeterApercuCaisse,
  projeterSysteme,
  projeterTimeline,
  projeterWorkspace,
  sansNotesNonSignees,
  type SafeAgendaContext,
  type SafeConsultationContext,
  type SafeDocumentContext,
  type SafeFinanceContext,
  type SafeFinancePatient,
  type SafeHistoriqueSeances,
  type SafeMedicamentsContext,
  type SafePaiementEnAttente,
  type SafePatientContext,
  type SafeSystemContext,
  type SafeTimelineContext,
} from "./jarvis-projections";
import {
  composerBriefFinance,
  composerBriefMatinal,
  composerBriefProchainPatient,
  type SafeBrief,
} from "./jarvis-briefs";
import {
  composerDocumentPret,
  composerRappelRendezVous,
  type RefusBrouillon,
  type SafeBrouillonMessage,
} from "./jarvis-messages";
import { getPatientWorkspace, listPatientTimeline, searchPatients } from "./patients";
import { getPatientTreatments } from "./patient-treatments";
import { ALIAS_CAPACITES } from "./jarvis-alias";
import { log } from "./log";
import { getReceptionBoard } from "./reception";
import { err, ok, type Result } from "./result";
import { fr } from "@/i18n/fr";
import type { RefPatient } from "./jarvis-identite";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · CE QU'UNE CAPACITÉ A LE DROIT DE RENDRE
// ═══════════════════════════════════════════════════════════════════════════

/** Résultat d'une recherche — des RÉFÉRENCES, jamais des noms (§1 de la frontière). */
export interface SafeRechercheContext {
  readonly resultats: readonly RefPatient[];
  /**
   * ⚠️ AUCUNE VARIANTE « LE PLUS PROBABLE ». Le type ne comporte pas de champ
   * « meilleur résultat », et c'est la même décision que `ResultatRecherche`
   * dans `jarvis-tools.ts` : la désambiguïsation n'est pas une politesse
   * d'interface, c'est l'absence de tout chemin de code par lequel un homonyme
   * pourrait être choisi sans l'humaine.
   */
  readonly ambigu: boolean;
  readonly total: number;
}

export interface SafePaiementsContext {
  readonly enAttente: readonly SafePaiementEnAttente[];
  readonly totalDzd: number;
}

/**
 * L'UNION FERMÉE. Tout ce qu'une capacité peut rendre au modèle, et rien
 * d'autre. Ajouter un membre ici est un acte délibéré, revu, documenté — pas la
 * conséquence d'un `...spread` distrait.
 */
/**
 * Ce qu'une notification laisse passer : sa NATURE et son NOMBRE. Jamais son
 * `payload`, qui est un `Record<string, unknown>` non borné et porte selon le
 * type un nom de patient ou un montant.
 */
export interface SafeNotificationsContext {
  readonly parNature: readonly { readonly nature: string; readonly nombre: number }[];
  readonly nonLues: number;
  readonly total: number;
}

export type ValeurSafe =
  | SafeNotificationsContext
  | SafePatientContext
  | SafeTimelineContext
  | SafeAgendaContext
  | SafeFinanceContext
  | SafeDocumentContext
  | SafeConsultationContext
  | SafeRechercheContext
  | SafePaiementsContext
  | SafeSystemContext
  | SafeMedicamentsContext
  | SafeHistoriqueSeances
  | SafeFinancePatient
  | SafeBrief
  | SafeBrouillonMessage
  | RefusBrouillon;

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LE CONTRAT
// ═══════════════════════════════════════════════════════════════════════════

export interface ContexteExecution {
  /** La carte du tour — les jetons frappés par les projections y atterrissent. */
  readonly carte: CarteIdentite;
  /**
   * Coupe une capacité qui pend. Une porte lente ne doit pas immobiliser Jarvis
   * (§6.1 : `MAX_EXECUTION_TIME`).
   */
  readonly signal: AbortSignal;
  /** `YYYY-MM-DD` en calendrier du CABINET — jamais recalculé par le modèle. */
  readonly aujourdHui: string;
}

export interface CapaciteLecture<A, S extends ValeurSafe> {
  readonly nom: string;
  /** Ce que le MODÈLE lit pour décider s'il appelle. En français, sans jargon. */
  readonly description: string;
  readonly entree: z.ZodType<A>;
  /** Plafond de sérialisation du résultat (§6.1 : `MAX_RESULT_BYTES`). */
  readonly budgetOctets: number;
  readonly executer: (args: A, ctx: ContexteExecution) => Promise<Result<S>>;
}

/**
 * La capacité telle que le REGISTRE la range et telle que la boucle l'appelle :
 * paramètres de type effacés, entrée en `unknown`.
 *
 * ⚠️ CETTE FORME EST UN GAIN, PAS UN CONTOURNEMENT. Un `CapaciteLecture<any, …>`
 * aurait effacé le type par un `any` — que `noInlineConfig` interdit de faire
 * taire, et à raison. En passant par un ADAPTATEUR (`enregistrer`), la
 * validation Zod devient une étape que la boucle ne peut plus omettre : elle ne
 * détient jamais la capacité typée, seulement `lancer`, qui valide avant
 * d'exécuter. Le trou par lequel un appelant distrait aurait pu sauter Zod
 * n'existe plus.
 */
export interface CapaciteEnregistree {
  readonly nom: string;
  readonly description: string;
  readonly budgetOctets: number;
  /** Les clés que le schéma accepte — rendues au modèle quand il se trompe. */
  readonly champsAttendus: string;
  /**
   * La forme exacte des arguments, dérivée du schéma (`formeArguments`) —
   * rendue au modèle AVANT qu'il ne se trompe. Facultative pour ne casser
   * aucun faux de test existant : absente, la description reste nom + phrase.
   */
  readonly usageArguments?: string;
  /** Valide PUIS exécute. Il n'existe aucun autre chemin vers `executer`. */
  readonly lancer: (
    argsBruts: unknown,
    ctx: ContexteExecution,
  ) => Promise<Result<ValeurSafe>>;
}

/**
 * `true` si la capacité porte sur UN patient désigné — c'est-à-dire si son
 * schéma accepte `patientId`.
 *
 * ⚠️ DÉRIVÉ DU SCHÉMA, JAMAIS D'UNE LISTE TENUE À LA MAIN. Une liste de noms
 * de capacités se serait désynchronisée à la première capacité ajoutée, en
 * silence, et la porte qu'elle garde serait devenue inopérante sans qu'aucun
 * test ne rougisse. Ici, une capacité qui accepte `patientId` est couverte le
 * jour où elle est écrite, sans que personne ait à y penser.
 *
 * `search_patients` en est exclu DE DROIT et non par exception : son schéma
 * accepte `query`, pas `patientId`. C'est le résolveur — l'exclure par une
 * exception nommée aurait été un cas particulier de plus à maintenir.
 */
export function estPatientSpecifique(capacite: CapaciteEnregistree): boolean {
  // ⚠️ SANS DÉCLARATION DE CHAMPS, ON RÉPOND « OUI » — ET C'EST LE SENS SÛR.
  //
  // Le type l'exige, mais un enregistrement écrit à la main (un banc d'essai,
  // un faux) peut l'omettre : `eval-jarvis-boucle` le faisait, et la première
  // version de cette fonction levait une `TypeError` qui rompait le tour
  // entier. Le repli tentant — « pas de champs, donc pas patient-spécifique » —
  // aurait été un défaut OUVERT : la porte d'ambiguïté aurait laissé passer
  // toute capacité mal déclarée, c'est-à-dire précisément celles dont on ne
  // sait rien. On répond donc « oui » : on ne peut pas prouver l'innocuité,
  // donc on protège.
  if (typeof capacite.champsAttendus !== "string") return true;
  return capacite.champsAttendus.split(",").some((c) => c.trim() === "patientId");
}

/**
 * Les clés que le schéma accepte, pour les rendre au modèle quand il s'est
 * trompé de nom. Purement structurel : on lit le SCHÉMA, jamais les données.
 */
function champsAttendus(schema: z.ZodType<unknown>): string {
  const forme = (schema as { shape?: Record<string, unknown> }).shape;
  if (forme === undefined) return "aucun argument";
  const cles = Object.keys(forme);
  return cles.length === 0 ? "aucun argument" : cles.join(", ");
}

/**
 * La forme exacte des arguments, pour l'annoncer au modèle AVANT l'appel.
 *
 * ═══ POURQUOI DÉRIVER, PAS ÉCRIRE ═══
 * 2026-09-03 : la description n'annonçait que nom + phrase. Le modèle a
 * deviné `{"recherche":"…"}` au lieu de `{"query":"…"}` ; `strictObject` a
 * refusé (`regle-metier`) ; la boucle a épuisé ses 3 tours sur une donnée
 * qui existait. Une forme ÉCRITE à la main redériverait à chaque renommage —
 * c'est le défaut qu'on vient de payer. Ici, les clés viennent de `.shape`
 * (même mécanisme que `champsAttendus`, éprouvé sur le zod épinglé) et le
 * requis/facultatif d'une sonde d'API publique : les clés manquantes sur
 * `{}` sont les requises. Aucune introspection de version.
 */
function formeArguments(schema: z.ZodType<unknown>): string {
  const forme = (schema as { shape?: Record<string, unknown> }).shape;
  if (forme === undefined) return "aucun argument";
  const cles = Object.keys(forme);
  if (cles.length === 0) return "aucun argument";
  let requises: ReadonlySet<string> | null = null;
  try {
    const essai = schema.safeParse({});
    if (essai.success) {
      requises = new Set();
    } else {
      const manque = new Set<string>();
      for (const p of essai.error.issues) {
        if (p.code === "invalid_type" && p.path.length === 1 && typeof p.path[0] === "string") {
          manque.add(p.path[0]);
        }
      }
      requises = manque;
    }
  } catch {
    requises = null;
  }
  const rendue = cles.map((c) =>
    requises === null ? `"${c}"` : requises.has(c) ? `"${c}"` : `"${c}?"`,
  );
  return `arguments exacts : {${rendue.join(", ")}} ; aucune autre clé`;
}

function enregistrer<A, S extends ValeurSafe>(
  capacite: CapaciteLecture<A, S>,
): CapaciteEnregistree {
  return {
    nom: capacite.nom,
    description: capacite.description,
    budgetOctets: capacite.budgetOctets,
    champsAttendus: champsAttendus(capacite.entree),
    usageArguments: formeArguments(capacite.entree),
    lancer: async (argsBruts, ctx) => {
      const analyse = capacite.entree.safeParse(argsBruts);
      if (!analyse.success) {
        // On journalise le CHEMIN du champ fautif, jamais sa valeur : un
        // argument halluciné peut porter un identifiant de dossier (règle 1).
        // `LogFields` est une interface FERMÉE — elle refuserait à la
        // compilation un champ libre où la valeur pourrait se glisser.
        log.error("jarvis.capacite.arguments", {
          code: "regle-metier",
          context: `capacite:${capacite.nom}:${analyse.error.issues
            .map((i) => i.path.join("."))
            .join(",")}`,
        });
        // ⚠️ LE MODÈLE DOIT POUVOIR SE CORRIGER — TROUVÉ EN PHASE 5.
        // Le message se contentait de « arguments invalides ». Le motif rendu à
        // la boucle était le code nu `regle-metier`, avec lequel le modèle ne
        // peut RIEN faire : il ignore quel champ il a mal nommé, donc il
        // n'essaie pas autrement — il annonce à la praticienne que l'outil a
        // échoué. Mesuré au navigateur sur « Combien ai-je encaissé
        // aujourd'hui ? » : le chiffre existait (4 000 DA), la porte
        // fonctionnait, et Jarvis répondait que l'outil était en erreur.
        //
        // On rend donc les CHEMINS des champs fautifs — jamais leurs valeurs.
        // Un chemin est une clé de schéma que nous avons écrite nous-mêmes ;
        // une valeur pourrait porter un identifiant de dossier (règle 1). La
        // distinction est ce qui rend cette aide inoffensive.
        return err({ code: "regle-metier", message: fr.jarvis.argumentsInvalides });
      }
      return await capacite.executer(analyse.data, ctx);
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · SCHÉMAS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `z.guid()` ET NON `z.uuid()` — même raison que dans `jarvis-tools.ts`, et
 * elle est MESURÉE, pas préférée : Zod 4 fait valider à `z.uuid()` la version et
 * la variante RFC 4122, que les identifiants du jeu de développement n'ont pas.
 * Un schéma plus strict que la base ne protège de rien et casse tout ce qui
 * n'est pas issu de `gen_random_uuid()`.
 *
 * ⚠️ CES SCHÉMAS VALIDENT DES UUID, PAS DES JETONS. Le modèle propose
 * `{{PATIENT_001}}` ; la boucle résout le jeton en identifiant réel AVANT
 * d'appeler Zod (`CarteIdentite.resoudreArguments`). Un jeton non résolu ne
 * franchit donc jamais ce point : il a déjà fait échouer la structure entière.
 */
const Guid = z.guid();

/** `YYYY-MM-DD`, calendrier du cabinet. */
const JourIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const InstantIso = z.iso.datetime({ offset: true });

const PERIODES = ["jour", "semaine", "mois", "annee"] as const satisfies readonly NomPeriode[];

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LES CAPACITÉS
// ═══════════════════════════════════════════════════════════════════════════

const rechercherPatients: CapaciteLecture<{ query: string }, SafeRechercheContext> = {
  nom: "search_patients",
  description:
    "Trouve les dossiers dont le nom, le prénom ou le numéro correspond à la " +
    "recherche. Rend des références, jamais des noms. Si plusieurs dossiers " +
    "correspondent, demande à la praticienne lequel elle vise — ne choisis jamais.",
  entree: z.strictObject({
    // Deux caractères minimum : une requête d'un caractère rendrait le cabinet
    // entier et transformerait un outil de recherche en outil d'export.
    query: z.string().trim().min(2).max(80),
  }),
  budgetOctets: 2_000,
  executer: async (args, ctx) => {
    const r = await searchPatients({ query: args.query, limit: 5 });
    if (!r.ok) return err(r.error);
    return ok({
      resultats: r.data.rows.map((p) => projeterPatientListItem(p, ctx.carte)),
      ambigu: r.data.rows.length > 1,
      total: r.data.total,
    });
  },
};

const contextePatient: CapaciteLecture<{ patientId: string }, SafePatientContext> = {
  nom: "get_patient_context",
  description:
    "Le dossier d'un patient : diagnostics, échelles, traitement en cours, " +
    "nombre de consultations, prochain et dernier rendez-vous. À utiliser dès " +
    "qu'une question porte sur un patient précis.",
  entree: z.strictObject({ patientId: Guid }),
  budgetOctets: 8_000,
  executer: async (args, ctx) => {
    const r = await getPatientWorkspace(args.patientId);
    if (!r.ok) return err(r.error);
    // `null` = introuvable OU hors périmètre. Les deux rendent la même chose,
    // sinon on aurait fabriqué un oracle d'existence (ADR-003).
    if (r.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    return ok(projeterWorkspace(r.data, ctx.carte));
  },
};

const chronologiePatient: CapaciteLecture<
  { patientId: string; limite?: number | undefined },
  SafeTimelineContext
> = {
  nom: "get_patient_timeline",
  description:
    "L'historique longitudinal d'un patient, du plus récent au plus ancien : " +
    "consultations, notes signées, diagnostics, prescriptions, échelles, " +
    "rendez-vous, documents. À utiliser pour « qu'est-ce qui a changé depuis… ».",
  entree: z.strictObject({ patientId: Guid, limite: z.number().int().min(1).max(50).optional() }),
  budgetOctets: 12_000,
  executer: async (args, ctx) => {
    const demandee = args.limite ?? 20;
    const r = await listPatientTimeline(args.patientId, null, demandee);
    if (!r.ok) return err(r.error);
    const ref = ctx.carte.patient(args.patientId, "");
    // `curseurSuivant` non nul = il reste des pages. La troncature est DÉCLARÉE
    // au modèle : sans ça, il conclurait « il n'y a que ces événements ».
    return ok(projeterTimeline(ref, r.data.evenements, r.data.curseurSuivant !== null));
  },
};

const documentsPatient: CapaciteLecture<{ patientId: string }, SafeDocumentContext> = {
  nom: "get_patient_documents",
  description:
    "Les documents déjà émis pour un patient : type, date d'émission, nombre " +
    "d'impressions. Le contenu imprimé n'est jamais rendu.",
  entree: z.strictObject({ patientId: Guid }),
  budgetOctets: 3_000,
  executer: async (args, ctx) => {
    const r = await listPatientDocuments(args.patientId);
    if (!r.ok) return err(r.error);
    return ok(projeterDocuments(r.data, ctx.carte));
  },
};

/**
 * LE PROCHAIN PATIENT — expérience de premier plan (§8 du plan).
 *
 * ⚠️ LE « SUIVANT » EST DÉCIDÉ EN BASE, PAS ICI. `dashboard_today` (060,
 * `dashboard_suivant`) porte la logique de sélection du créneau suivant, y
 * compris ses cas limites — séance déjà ouverte, patient arrivé, créneau
 * dépassé. La recalculer ici donnerait deux réponses à la même question, et
 * celle de Jarvis contredirait l'écran du matin.
 */
const prochainPatient: CapaciteLecture<Record<string, never>, SafeAgendaContext> = {
  nom: "get_next_patient",
  description:
    "Le prochain rendez-vous de la journée : heure, type de séance, référence " +
    "du patient. Rend un agenda vide s'il n'y a plus personne aujourd'hui.",
  entree: z.strictObject({}),
  budgetOctets: 1_500,
  executer: async (_args, ctx) => {
    const r = await getDashboardToday(ctx.aujourdHui);
    if (!r.ok) return err(r.error);
    const suivant = r.data?.suivant ?? null;
    return ok(
      projeterAgenda(suivant === null ? [] : [suivant], ctx.carte, "app.dashboard_today"),
    );
  },
};

const agendaDuJour: CapaciteLecture<{ jour?: string | undefined }, SafeAgendaContext> = {
  nom: "get_today_agenda",
  description:
    "Tous les créneaux d'une journée, dans l'ordre. Sans argument, c'est " +
    "aujourd'hui. Le jour s'écrit AAAA-MM-JJ dans le calendrier du cabinet.",
  entree: z.strictObject({ jour: JourIso.optional() }),
  budgetOctets: 6_000,
  executer: async (args, ctx) => {
    const jour = args.jour ?? ctx.aujourdHui;
    const r = await getDashboardToday(jour);
    if (!r.ok) return err(r.error);
    return ok(projeterAgenda(r.data?.journee ?? [], ctx.carte, "app.dashboard_today"));
  },
};

const agendaPlage: CapaciteLecture<{ du: string; au: string }, SafeAgendaContext> = {
  nom: "get_agenda_range",
  description:
    "Les créneaux entre deux instants (bornes ISO 8601 avec fuseau). À utiliser " +
    "pour « demain matin », « la semaine prochaine ». Les bornes sont fournies " +
    "par l'application, ne les invente pas.",
  entree: z.strictObject({ du: InstantIso, au: InstantIso }),
  budgetOctets: 8_000,
  executer: async (args, ctx) => {
    const r = await listAgenda({ from: args.du, to: args.au });
    if (!r.ok) return err(r.error);
    return ok(projeterAgenda(r.data, ctx.carte, "app.list_agenda"));
  },
};

const detailRendezVous: CapaciteLecture<{ appointmentId: string }, SafeAgendaContext> = {
  nom: "get_appointment",
  description: "Le détail d'un rendez-vous précis, par sa référence.",
  entree: z.strictObject({ appointmentId: Guid }),
  budgetOctets: 1_000,
  executer: async (args, ctx) => {
    const r = await getAppointment(args.appointmentId);
    if (!r.ok) return err(r.error);
    if (r.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    return ok(projeterAgenda([r.data], ctx.carte, "app.get_appointment"));
  },
};

const salleAttente: CapaciteLecture<Record<string, never>, SafeAgendaContext> = {
  nom: "get_waiting_room",
  description: "Les patients arrivés et en attente, dans l'ordre d'arrivée.",
  entree: z.strictObject({}),
  budgetOctets: 3_000,
  executer: async (_args, ctx) => {
    const r = await getReceptionBoard(ctx.aujourdHui);
    if (!r.ok) return err(r.error);
    const arrives = (r.data?.journee ?? []).filter((l) => l.arrivedAt !== null);
    return ok(projeterAgenda(arrives, ctx.carte, "app.reception_board"));
  },
};

const consultation: CapaciteLecture<{ consultationId: string }, SafeConsultationContext> = {
  nom: "get_consultation",
  description:
    "Une consultation et sa note SOAP signée. La dictée brute n'est jamais " +
    "rendue. Sers-t'en pour rappeler ce qui s'est dit lors d'une séance précise.",
  entree: z.strictObject({ consultationId: Guid }),
  budgetOctets: 6_000,
  executer: async (args, ctx) => {
    const r = await getConsultation(args.consultationId);
    if (!r.ok) return err(r.error);
    if (r.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    return ok(projeterConsultation(r.data, ctx.carte));
  },
};

const recetteDuJour: CapaciteLecture<{ jour?: string | undefined }, SafeFinanceContext> = {
  nom: "get_day_revenue",
  description:
    "L'encaissé d'une journée, le nombre de séances, et ce qui reste en " +
    "attente. « Encaissé » et « en attente » sont DEUX chiffres distincts : ne " +
    "les additionne jamais et ne présente jamais l'un pour l'autre.",
  entree: z.strictObject({ jour: JourIso.optional() }),
  budgetOctets: 800,
  executer: async (args, ctx) => {
    const jour = args.jour ?? ctx.aujourdHui;
    const r = await getDayRevenue(jour);
    if (!r.ok) return err(r.error);
    const periode: Periode = { nom: "jour", du: jour, au: jour };
    if (r.data === null) {
      // Hors périmètre financier (ADR-005) — PAS « zéro ». Le distinguer est le
      // seul moyen de ne pas annoncer une recette nulle à qui n'a pas le droit
      // de la voir.
      return err({ code: "interdit", message: fr.erreurs.interdit });
    }
    return ok(projeterRecetteDuJour(r.data, periode));
  },
};

const recettePeriode: CapaciteLecture<
  { periode: (typeof PERIODES)[number] },
  SafeFinanceContext
> = {
  nom: "get_period_revenue",
  description:
    "Le chiffre d'une période nommée — jour, semaine, mois, année : encaissé, " +
    "charges, résultat net, impayés. Les bornes sont calculées par " +
    "l'application dans le calendrier du cabinet.",
  entree: z.strictObject({ periode: z.enum(PERIODES) }),
  budgetOctets: 1_200,
  executer: async (args, ctx) => {
    // ⚠️ LES BORNES SONT CALCULÉES ICI, JAMAIS PAR LE MODÈLE (§7.2). La semaine
    // commence LUNDI, comme `date_trunc('week')` en Postgres, et la période est
    // rendue ENTIÈRE, pas tronquée à aujourd'hui — c'est ce qui rend la
    // comparaison de 036 juste.
    const bornes = bornesDePeriode(args.periode, ctx.aujourdHui);
    const r = await getFinanceOverview(bornes.du, bornes.au);
    if (!r.ok) return err(r.error);
    if (r.data === null) return err({ code: "interdit", message: fr.erreurs.interdit });
    return ok(projeterApercuCaisse(r.data, bornes, "praticienne"));
  },
};

const paiementsEnAttente: CapaciteLecture<{ jour?: string | undefined }, SafePaiementsContext> = {
  nom: "get_outstanding_payments",
  description:
    "Les paiements non encaissés d'une journée : référence du patient, montant, " +
    "ancienneté. Aucun nom, aucun numéro de reçu.",
  entree: z.strictObject({ jour: JourIso.optional() }),
  budgetOctets: 3_000,
  executer: async (args, ctx) => {
    const r = await listDayPayments(args.jour ?? ctx.aujourdHui);
    if (!r.ok) return err(r.error);
    const enAttente = projeterPaiementsEnAttente(r.data, ctx.carte);
    return ok({
      enAttente,
      totalDzd: enAttente.reduce((somme, p) => somme + p.montantDzd, 0),
    });
  },
};

// ═══════════════════════════════════════════════════════════════════════════
/**
 * Ce qui attend la praticienne, SANS le contenu de ce qui attend.
 *
 * ATTENTION -- `payload` EST UN `Record<string, unknown>` NON BORNE, et il
 * porte selon le type de notification un nom de patient, un numero de dossier
 * ou un montant. Le transmettre au modele serait une fuite d'identifiant par
 * un chemin que personne n'aurait pense a regarder : la regle 1 ne tombe pas
 * seulement par un `fetch`, elle tombe aussi par un champ libre qu'on relaie
 * sans le lire.
 *
 * On rend donc la NATURE et le NOMBRE, jamais le contenu. Cela suffit a
 * repondre a « qu'est-ce qui demande mon attention ? » ; pour savoir QUI est
 * concerne, la praticienne ouvre l'ecran, ou Alexa passe par une capacite
 * patient qui, elle, journalise la lecture du dossier.
 */
const notificationsEnAttente: CapaciteLecture<Record<string, never>, SafeNotificationsContext> = {
  nom: "get_notifications",
  description:
    "Ce qui demande l'attention de la praticienne : NATURE et NOMBRE des " +
    "notifications, non lues d'abord. Ne rend AUCUN contenu, aucun nom, aucun " +
    "montant -- pour savoir qui est concerne, ouvrir l'ecran ou demander le dossier.",
  entree: z.strictObject({}),
  budgetOctets: 1_500,
  executer: async () => {
    const r = await listNotifications();
    if (!r.ok) return err(r.error);

    const nonLues = r.data.filter((n) => n.readAt === null);
    const compte = new Map<string, number>();
    for (const n of nonLues) compte.set(n.kind, (compte.get(n.kind) ?? 0) + 1);

    return ok({
      // Ordre deterministe : par nombre decroissant, puis par nature. Sans le
      // second critere, deux natures a egalite s'echangeraient d'un appel a
      // l'autre au gre de l'ordre d'insertion de la Map.
      parNature: [...compte.entries()]
        .map(([nature, nombre]) => ({ nature, nombre }))
        .sort((a, b) => b.nombre - a.nombre || a.nature.localeCompare(b.nature)),
      nonLues: nonLues.length,
      total: r.data.length,
    });
  },
};

/**
 * L'ÉTAT DU SYSTÈME LOCAL — Phase 1 du plan Alexa.
 *
 * ⚠️ DÉLÉGATION SEULE, AUCUNE LECTURE PROPRE. L'environnement vient de
 * `getDeploymentEnvironment` (le même service que le bandeau « données
 * fictives ») ; l'horodatage vient du calendrier du cabinet. Aucune donnée
 * patient, aucun chiffre financier, aucun identifiant : le compte
 * d'entrées de la carte est un NOMBRE, jamais son contenu.
 */
const statutSysteme: CapaciteLecture<Record<string, never>, SafeSystemContext> = {
  nom: "get_system_status",
  description:
    "L'état du système local : environnement de déploiement, date et heure " +
    "du cabinet. Ne rend aucune donnée patient et aucun chiffre financier.",
  entree: z.strictObject({}),
  budgetOctets: 800,
  executer: async (_args, ctx) => {
    const r = await getDeploymentEnvironment();
    if (!r.ok) return err(r.error);
    return ok(
      projeterSysteme({
        environnement: r.data,
        aujourdHui: ctx.aujourdHui,
        maintenant: new Date().toISOString(),
        entreesCarte: ctx.carte.taille,
      }),
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 4 · PHASE 2 ALEXA — médicaments, séances, finance par patient.
// Composition de portes existantes, aucune requête propre, aucun SQL nouveau.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LES MÉDICAMENTS EN COURS — Phase 2.
 *
 * ⚠️ LA SOURCE CANONIQUE EST `get_patient_treatments`, PAS LA DERNIÈRE
 * PRESCRIPTION. `prescription_lines` n'a ni `stopped_at` ni statut : c'est un
 * historique seul, et répondre « elle prend X » depuis lui seul serait
 * répondre l'histoire pour le présent. L'en-cours vient du `status` d'ADR-028 ;
 * la prescription ne donne que le compteur et la date (HISTORIQUE).
 */
const medicamentsActuels: CapaciteLecture<{ patientId: string }, SafeMedicamentsContext> = {
  nom: "get_current_medications",
  description:
    "Les médicaments d'un patient en deux blocs SÉPARÉS : EN COURS " +
    "(traitements actifs et en pause) et HISTORIQUE (arrêtés récents, dernière " +
    "prescription). Ne présente jamais l'historique comme un traitement en cours.",
  entree: z.strictObject({ patientId: Guid }),
  budgetOctets: 6_000,
  executer: async (args, ctx) => {
    // Les deux lectures en PARALLÈLE : indépendantes, et la RLS tranche dans
    // chacune (074/076 : `can_see_clinical` ; 047 : forme `null` hors droit).
    const [t, w] = await Promise.all([
      getPatientTreatments(args.patientId),
      getPatientWorkspace(args.patientId),
    ]);
    if (!w.ok) return err(w.error);
    // `null` = introuvable OU hors périmètre (ADR-003 : même retour).
    if (w.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    if (!t.ok) return err(t.error);
    // `projeterWorkspace` pour la SEULE référence : la frappe est idempotente,
    // le jeton est donc celui du tour, partagé avec les autres capacités.
    const ref = projeterWorkspace(w.data, ctx.carte).ref;
    if (w.data.traitements === null) {
      // Domaine clinique hors droit — la BASE a tranché : `null`, jamais des
      // listes vides qui feraient croire à l'absence de traitement.
      return ok(projeterMedicaments(ref, t.data, null));
    }
    return ok(
      projeterMedicaments(ref, t.data, {
        dernierePrescriptionLe: w.data.traitements.dernierePrescription?.prescribedAt ?? null,
        nombrePrescriptions: w.data.traitements.nombrePrescriptions,
      }),
    );
  },
};

/**
 * L'HISTORIQUE DES SÉANCES — Phase 2.
 *
 * `event_id` des événements `consultation_*` EST l'identifiant de la
 * consultation (076) : on compose `list_patient_timeline` (qui liste) avec
 * `get_consultation` (qui détaille), en parallèle. Aucune porte nouvelle.
 */
const historiqueConsultations: CapaciteLecture<
  { patientId: string; limite?: number | undefined },
  SafeHistoriqueSeances
> = {
  nom: "get_consultation_history",
  description:
    "Les séances passées d'un patient, de la plus récente à la plus ancienne : " +
    "date, type, clôture, et note SOAP quand elle est signée. Une note non " +
    "signée ne rend aucun contenu. La dictée brute n'est jamais rendue.",
  entree: z.strictObject({ patientId: Guid, limite: z.number().int().min(1).max(10).optional() }),
  budgetOctets: 12_000,
  executer: async (args, ctx) => {
    const page = await listPatientTimeline(args.patientId, null, 50);
    if (!page.ok) return err(page.error);
    const seances = page.data.evenements.filter(
      (e) => e.labelKey === "consultation_close" || e.labelKey === "consultation_ouverte",
    );
    const limite = args.limite ?? 5;
    const retenues = seances.slice(0, limite);
    // Troncature DÉCLARÉE : page suivante non vide, ou coupe au-delà de la limite.
    const tronque = page.data.curseurSuivant !== null || seances.length > limite;
    const ref = ctx.carte.patient(args.patientId, "");
    const lectures = await Promise.all(retenues.map((e) => getConsultation(e.eventId)));
    const rendues: SafeConsultationContext[] = [];
    for (const lecture of lectures) {
      if (!lecture.ok) return err(lecture.error);
      // `null` = séance masquée par la RLS : on l'omet, on ne l'invente pas.
      // Timeline et consultation partagent la même racine RLS ; hors course,
      // ce cas ne survient pas (l'assistante ne voit déjà aucun événement
      // `consultation_*`).
      if (lecture.data === null) continue;
      rendues.push(projeterConsultation(lecture.data, ctx.carte));
    }
    return ok(projeterHistoriqueSeances(ref, sansNotesNonSignees(rendues), tronque));
  },
};

/**
 * LE RÉSUMÉ FINANCIER D'UN PATIENT — Phase 2.
 *
 * ⚠️ TOUT EST CALCULÉ ICI, EN ENTIERS, AVANT LE MODÈLE. Totaux, compteurs,
 * distinction encaissé/en attente/sans tarif : le modèle reçoit des Faits et
 * les met en langue, il ne calcule rien. Un `null` de forme (base : pas de
 * droit clinique, donc pas de lecture nominative) rend `interdit` — PAS zéro.
 */
const financePatient: CapaciteLecture<
  { patientId: string; limiteSeances?: number | undefined },
  SafeFinancePatient
> = {
  nom: "get_patient_financial_summary",
  description:
    "Le résumé financier d'un patient sur ses séances récentes : montants " +
    "encaissés et en attente, en dinars entiers, calculés localement. Une " +
    "séance sans tarif fixé est comptée à part, jamais dans les totaux.",
  entree: z.strictObject({
    patientId: Guid,
    limiteSeances: z.number().int().min(1).max(10).optional(),
  }),
  budgetOctets: 3_000,
  executer: async (args, ctx) => {
    const w = await getPatientWorkspace(args.patientId);
    if (!w.ok) return err(w.error);
    if (w.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    if (w.data.clinique === null && w.data.traitements === null) {
      // Hors périmètre : la base a rendu des domaines vides, donc aucune
      // lecture nominative — y compris financière. PAS « zéro ».
      return err({ code: "interdit", message: fr.erreurs.interdit });
    }
    const ref = projeterWorkspace(w.data, ctx.carte).ref;
    const page = await listPatientTimeline(args.patientId, null, 50);
    if (!page.ok) return err(page.error);
    const seances = page.data.evenements.filter(
      (e) => e.labelKey === "consultation_close" || e.labelKey === "consultation_ouverte",
    );
    const limite = args.limiteSeances ?? 10;
    const retenues = seances.slice(0, limite);
    const complet = page.data.curseurSuivant === null && seances.length <= limite;
    const paiements = await Promise.all(retenues.map((e) => getConsultationPayment(e.eventId)));
    const lignes: { le: string; montantDzd: number | null; encaisse: boolean; creeLe: string | null }[] = [];
    for (let i = 0; i < retenues.length; i++) {
      const seance = retenues[i];
      const paiement = paiements[i];
      if (seance === undefined || paiement === undefined) continue;
      if (!paiement.ok) return err(paiement.error);
      lignes.push({
        le: seance.occurredAt,
        // `null` = tarif non fixé OU séance non visible : les deux rendent la
        // même chose, sinon on fabriquerait un oracle (ADR-003).
        montantDzd: paiement.data === null ? null : paiement.data.montantDzd,
        encaisse: paiement.data !== null && paiement.data.collectedAt !== null,
        creeLe: paiement.data?.createdAt ?? null,
      });
    }
    return ok(projeterFinancePatient(ref, lignes, complet));
  },
};

// 4bis · LES BRIEFS — composés en TypeScript, mis en langue par le modèle
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ CES TROIS CAPACITÉS NE RENDENT PAS UN TEXTE, ELLES RENDENT UNE STRUCTURE.
 * Les quatre registres — faits, observations, attention, information manquante
 * — arrivent SÉPARÉS jusqu'au modèle, pour qu'il ne puisse pas présenter une
 * observation dérivée comme un fait relevé. Lui envoyer un paragraphe déjà
 * fondu lui laisserait justement cette liberté.
 */
const briefProchainPatient: CapaciteLecture<Record<string, never>, SafeBrief> = {
  nom: "brief_prochain_patient",
  description:
    "Prépare le prochain patient : rendez-vous, dossier, historique récent, " +
    "traitement, points d'attention. Rend quatre listes SÉPARÉES — faits, " +
    "observations, attention, information manquante. Ne fusionne jamais un " +
    "fait et une observation dans ta réponse, et ne conclus jamais à la place " +
    "de la praticienne.",
  entree: z.strictObject({}),
  budgetOctets: 8_000,
  executer: async (_args, ctx) => {
    const tb = await getDashboardToday(ctx.aujourdHui);
    if (!tb.ok) return err(tb.error);
    const suivant = tb.data?.suivant ?? null;
    const agenda = projeterAgenda(
      suivant === null ? [] : [suivant],
      ctx.carte,
      "app.dashboard_today",
    );
    if (suivant === null || suivant.patientId === null) {
      return ok(composerBriefProchainPatient({ agenda, patient: null, timeline: null }));
    }

    // Les deux lectures en PARALLÈLE : elles sont indépendantes, et le brief est
    // ce que la praticienne attend entre deux patients — pas dans une minute.
    const [w, t] = await Promise.all([
      getPatientWorkspace(suivant.patientId),
      listPatientTimeline(suivant.patientId, null, 20),
    ]);
    if (!w.ok) return err(w.error);

    const patient = w.data === null ? null : projeterWorkspace(w.data, ctx.carte);
    const timeline =
      t.ok && patient !== null
        ? projeterTimeline(patient.ref, t.data.evenements, t.data.curseurSuivant !== null)
        : null;

    return ok(composerBriefProchainPatient({ agenda, patient, timeline }));
  },
};

const briefMatinal: CapaciteLecture<Record<string, never>, SafeBrief> = {
  nom: "brief_matinal",
  description:
    "Le point du matin : nombre de consultations, première et dernière heure, " +
    "salle d'attente, encaissé du jour, paiements en attente. Concis et " +
    "opérationnel — jamais un essai.",
  entree: z.strictObject({}),
  budgetOctets: 3_000,
  executer: async (_args, ctx) => {
    const tb = await getDashboardToday(ctx.aujourdHui);
    if (!tb.ok) return err(tb.error);
    return ok(
      composerBriefMatinal(
        preparerEntreeBriefMatinal(tb.data, ctx.aujourdHui, new Date().toISOString(), ctx.carte),
      ),
    );
  },
};

const briefFinance: CapaciteLecture<{ periode: (typeof PERIODES)[number] }, SafeBrief> = {
  nom: "brief_finance",
  description:
    "Le point financier d'une période : encaissé, en attente, charges, " +
    "résultat net. « Encaissé » et « en attente » sont DEUX chiffres : ne les " +
    "additionne jamais et ne présente jamais l'un pour l'autre.",
  entree: z.strictObject({ periode: z.enum(PERIODES) }),
  budgetOctets: 2_000,
  executer: async (args, ctx) => {
    const bornes = bornesDePeriode(args.periode, ctx.aujourdHui);
    const r = await getFinanceOverview(bornes.du, bornes.au);
    if (!r.ok) return err(r.error);
    if (r.data === null) return err({ code: "interdit", message: fr.erreurs.interdit });
    return ok(
      composerBriefFinance({
        finance: projeterApercuCaisse(r.data, bornes, "praticienne"),
        impayesAnciensJours: r.data.attention.plus_ancien_impaye_jours,
      }),
    );
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 5 · LE REGISTRE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `enregistrer()` EST APPELÉ UNE FOIS PAR CAPACITÉ, PAS VIA `.map()`. Les
 * capacités ont des paramètres de type DIFFÉRENTS ; sur un tableau de leur
 * union, l'inférence de `.map` cherche une signature unique et échoue. L'appel
 * explicite laisse chaque instanciation générique se résoudre séparément —
 * c'est plus verbeux d'une ligne par capacité, et c'est ce qui typecheck.
 */
/**
 * ⚠️ CETTE CAPACITÉ EST EN LECTURE, ET C'EST EXACT. Elle n'écrit rien, ne
 * touche à aucune porte d'écriture, et ne peut rien envoyer : MindCare n'a
 * aucun canal de communication. La ranger en écriture supposerait qu'il existe
 * un acte à confirmer — or il n'y a pas d'acte, seulement un texte à l'écran,
 * que la praticienne copie si elle le décide.
 *
 * Le corps rendu porte `{{PATIENT_00N}}` : le brouillon traverse donc le
 * pare-feu sans identité, et le vrai nom n'apparaît qu'au rendu final.
 */
const brouillonMessage: CapaciteLecture<
  { motif: "rappel_rendez_vous" | "document_pret"; patientId?: string | undefined },
  SafeBrouillonMessage | RefusBrouillon
> = {
  nom: "draft_patient_message",
  description:
    "Rédige un BROUILLON de message pour un patient — rappel du prochain " +
    "rendez-vous, ou mise à disposition d'un document. MindCare N'ENVOIE RIEN : " +
    "le texte s'affiche et la praticienne le copie elle-même. Ne promets jamais " +
    "un envoi, et n'invente ni date ni contenu : tout vient du brouillon rendu.",
  entree: z.strictObject({
    motif: z.enum(["rappel_rendez_vous", "document_pret"]),
    patientId: Guid.optional(),
  }),
  budgetOctets: 3_000,
  executer: async (args, ctx) => {
    if (args.motif === "rappel_rendez_vous") {
      const tb = await getDashboardToday(ctx.aujourdHui);
      if (!tb.ok) return err(tb.error);
      const suivant = tb.data?.suivant ?? null;
      if (suivant === null) {
        return ok({ refus: "Aucun rendez-vous à venir : il n'y a pas de rappel à rédiger." });
      }
      const agenda = projeterAgenda([suivant], ctx.carte, "app.dashboard_today");
      const creneau = agenda.creneaux[0];
      if (creneau === undefined) {
        return ok({ refus: "Aucun rendez-vous à venir : il n'y a pas de rappel à rédiger." });
      }
      return ok(composerRappelRendezVous({ creneau, provenance: agenda.provenance }));
    }

    if (args.patientId === undefined) {
      return ok({ refus: "Précise de quel patient il s'agit pour annoncer un document." });
    }
    // ⚠️ LE DOSSIER EST LU MÊME S'IL N'EST PAS AFFICHÉ. Frapper la carte avec le
    // seul identifiant donnerait une entrée SANS libellé, et le brouillon
    // s'adresserait à « [référence inconnue] ». C'est la projection du dossier
    // qui porte le nom, donc c'est elle qui doit frapper la référence.
    const [w, d] = await Promise.all([
      getPatientWorkspace(args.patientId),
      listPatientDocuments(args.patientId),
    ]);
    if (!w.ok) return err(w.error);
    if (!d.ok) return err(d.error);
    if (w.data === null) {
      return ok({ refus: "Ce dossier est introuvable ou hors de votre périmètre." });
    }
    const patient = projeterWorkspace(w.data, ctx.carte);
    return ok(
      composerDocumentPret({
        patient: patient.ref,
        documents: projeterDocuments(d.data, ctx.carte),
      }),
    );
  },
};

const LECTURES: readonly CapaciteEnregistree[] = [
  enregistrer(rechercherPatients),
  enregistrer(contextePatient),
  enregistrer(chronologiePatient),
  enregistrer(documentsPatient),
  enregistrer(prochainPatient),
  enregistrer(agendaDuJour),
  enregistrer(agendaPlage),
  enregistrer(detailRendezVous),
  enregistrer(salleAttente),
  enregistrer(consultation),
  enregistrer(recetteDuJour),
  enregistrer(recettePeriode),
  enregistrer(paiementsEnAttente),
  enregistrer(notificationsEnAttente),
  enregistrer(statutSysteme),
  enregistrer(medicamentsActuels),
  enregistrer(historiqueConsultations),
  enregistrer(financePatient),
  enregistrer(briefProchainPatient),
  enregistrer(briefMatinal),
  enregistrer(briefFinance),
  enregistrer(brouillonMessage),
];

const PAR_NOM: ReadonlyMap<string, CapaciteEnregistree> = new Map(
  LECTURES.map((c) => [c.nom, c]),
);

/**
 * Phase 1 du plan Alexa — LES ALIAS.
 *
 * Un alias n'est PAS une seconde capacité : c'est le `lancer` de la cible,
 * précédé de la traduction pure d'`ALIAS_CAPACITES`. La validation Zod de la
 * cible s'applique donc telle quelle — un argument traduit mais invalide
 * échoue en `regle-metier` avant toute lecture, exactement comme un appel
 * direct.
 *
 * ⚠️ FAIL-CLOSED : un alias dont la cible n'existe pas rend `null`, comme un
 * nom inconnu. La boucle suit alors son chemin existant de proposition
 * inconnue — aveu, jamais d'invention.
 */
function aliasVersCapacite(nom: string): CapaciteEnregistree | null {
  const alias = ALIAS_CAPACITES[nom];
  if (alias === undefined) return null;
  const cible = PAR_NOM.get(alias.cible);
  if (cible === undefined) return null;
  const traduire = alias.traduire;
  return {
    nom,
    description: `Alias de ${alias.cible}. ${cible.description}`,
    budgetOctets: cible.budgetOctets,
    champsAttendus: cible.champsAttendus,
    lancer: (argsBruts, ctx) => cible.lancer(traduire(argsBruts), ctx),
  };
}

export function capaciteLecture(nom: string): CapaciteEnregistree | null {
  return PAR_NOM.get(nom) ?? aliasVersCapacite(nom);
}

/**
 * ═══ LE MÊME APPEL, SOUS SON VRAI NOM ═══
 *
 * ⚠️ DÉFAUT MESURÉ LE 2026-09-06 SUR « QU'AI-JE DEMAIN MATIN ? ».
 *
 * Le modèle a appelé `get_agenda`, puis `get_agenda_range`. Ce sont LE MÊME
 * appel — le premier est un alias du second (voir `ALIAS_CAPACITES`) — et les
 * deux ont rendu 1 457 octets rigoureusement identiques. La déduplication ne
 * l'a pas vu : sa clé est le nom PROPOSÉ, et « get_agenda » ≠
 * « get_agenda_range » en tant que chaînes. Deux exécutions au lieu d'une, le
 * budget d'itérations épuisé, et le garde de répétition rompant un tour dont
 * la donnée était complète depuis le premier appel.
 *
 * ⚠️ POURQUOI `aliasVersCapacite` NE SUFFISAIT PAS : elle rend l'alias sous
 * SON PROPRE nom (`nom`, ligne 1041), délibérément — la trace doit dire ce que
 * le modèle a réellement proposé. Il fallait donc un second chemin, celui-ci,
 * qui ne sert QU'À la déduplication.
 *
 * Les arguments traversent la même traduction que l'exécution : sans elle,
 * `{date_from, date_to}` et `{du, au}` resteraient deux clés pour un seul
 * appel, et le trou se rouvrirait par les arguments après avoir été fermé par
 * le nom.
 */
export function canoniserAppel(
  nom: string,
  args: unknown,
): { readonly nom: string; readonly args: unknown } {
  const alias = ALIAS_CAPACITES[nom];
  if (alias === undefined) return { nom, args };
  return { nom: alias.cible, args: alias.traduire(args) };
}

export function estCapaciteLecture(nom: string): boolean {
  return PAR_NOM.has(nom) || ALIAS_CAPACITES[nom] !== undefined;
}

export function nomsDeLecture(): readonly string[] {
  return [...LECTURES.map((c) => c.nom), ...Object.keys(ALIAS_CAPACITES)];
}

/**
 * La description que le MODÈLE reçoit. Composée depuis le registre, jamais
 * recopiée à la main dans le prompt : une liste écrite deux fois finit par
 * décrire des outils qui n'existent plus, et le modèle propose alors des appels
 * que rien ne peut satisfaire.
 */
/**
 * Rappel d'usage des références, devant la liste. Mesuré le 2026-09-03 :
 * le modèle recevait des `{{PATIENT_001}}` dans les résultats sans jamais
 * être instruit de les RÉUTILISER en argument — il renvoyait le nom en
 * clair, `Guid` refusait (`regle-metier`), la boucle avouait. Une phrase,
 * pas une section : le mécanisme (frappe, résolution, rendu) vit déjà dans
 * `jarvis-identite.ts` et n'a pas à être réexpliqué ici.
 */
const RAPPEL_REFERENCES =
  "Les personnes se désignent par leurs références {{PATIENT_001}} : " +
  "utilise-les comme patientId dans tes appels, jamais un nom.";

export function descriptionDesCapacites(): string {
  const ligne = (nom: string, description: string, usage: string | undefined): string =>
    usage === undefined || usage === "aucun argument"
      ? `- ${nom} : ${description} — aucun argument.`
      : `- ${nom} : ${description} — ${usage}.`;
  const directes = LECTURES.map((c) => ligne(c.nom, c.description, c.usageArguments));
  const alias: string[] = [];
  for (const nom of Object.keys(ALIAS_CAPACITES)) {
    const entree = ALIAS_CAPACITES[nom];
    if (entree === undefined) continue;
    const cible = PAR_NOM.get(entree.cible);
    if (cible === undefined) continue;
    alias.push(ligne(nom, `Alias de ${entree.cible}. ${cible.description}`, cible.usageArguments));
  }
  return [RAPPEL_REFERENCES, ...directes, ...alias].join("\n");
}

/**
 * ═══ LE CATALOGUE COURT — CELUI QU'ON ENVOIE UNE FOIS LA DONNÉE OBTENUE ═══
 *
 * ⚠️ POURQUOI IL EXISTE : MESURE DU 2026-09-06, PAS UNE INTUITION.
 *
 * `descriptionDesCapacites()` pèse 7 782 caractères — au plafond de
 * `MAX_CAR_CAPACITES` (8 000). Elle est renvoyée À CHAQUE ITÉRATION de la
 * boucle, y compris APRÈS qu'une capacité a rendu la donnée demandée. Le modèle
 * recevait donc, en même temps : un résultat correct, et un catalogue de vingt-
 * deux outils l'invitant à en appeler un. Il rappelait la même capacité, la
 * déduplication rendait le même résultat, et le garde de répétition finissait
 * par rompre le tour.
 *
 * L'expérience contrôlée — MÊME modèle, MÊME message, MÊME résultat d'outil,
 * seule la longueur du catalogue changeant — est sans ambiguïté :
 *
 *     catalogue ~1 000 car. → réponse en langue   1 fois sur 2
 *     catalogue ~2 000 car. → réponse en langue   2 fois sur 2
 *     catalogue  4 000 car. → rappelle l'outil    2 fois sur 2
 *     catalogue  7 782 car. → rappelle l'outil    3 fois sur 3
 *
 * Ce n'était donc PAS une limite du modèle : avec un catalogue court, il
 * synthétise parfaitement le même résultat. C'était notre contrat d'outil qui
 * noyait la consigne de répondre.
 *
 * ⚠️ CE QU'IL GARDE, ET POURQUOI. Il garde les NOMS et la FORME DES ARGUMENTS :
 * une demande légitimement multi-étapes (« qui est le prochain, et quel est son
 * traitement ? ») doit pouvoir appeler une SECONDE capacité. Le supprimer
 * complètement échangerait une panne contre une autre.
 *
 * ⚠️ CE QU'IL LAISSE TOMBER : les phrases de description, et les alias. Les
 * alias restent RÉSOLUS à l'exécution par `capaciteLecture()` — on cesse
 * seulement de les annoncer, ce qui n'ôte aucune capacité.
 */
export function descriptionCompacteDesCapacites(): string {
  const ligne = (c: CapaciteEnregistree): string =>
    c.usageArguments === undefined || c.usageArguments === "aucun argument"
      ? `- ${c.nom} : aucun argument.`
      : `- ${c.nom} : ${c.usageArguments}.`;
  return [
    "Tu as DÉJÀ le résultat d'au moins une capacité pour ce tour. Réponds en " +
      "langue naturelle À PARTIR DE CE RÉSULTAT.",
    "N'appelle une autre capacité que si la réponse exige une information qui " +
      "n'y figure pas. Ne rappelle jamais une capacité déjà appelée.",
    RAPPEL_REFERENCES,
    "Capacités encore disponibles si nécessaire :",
    ...LECTURES.map(ligne),
  ].join("\n");
}

/**
 * ═══ LA SYNTHÈSE SEULE — AUCUNE CAPACITÉ, PARCE QU'IL N'EN RESTE PLUS ═══
 *
 * ⚠️ POURQUOI CE TROISIÈME CATALOGUE EXISTE — MESURE DU 2026-09-06.
 *
 * « Qui vient demain ? » échouait ainsi : le modèle appelait `get_today_agenda`
 * (jour = demain), puis `get_agenda_range` sur le MÊME jour — deux portes qui
 * rendent la même information — puis une troisième proposition, et le budget
 * d'itérations tombait. `bilanAveu` rendait « je n'ai pas réussi à aboutir »
 * alors que la donnée était là, complète et correcte, depuis le premier appel.
 *
 * La boucle accorde déjà UN dernier appel après l'épuisement du budget, pour
 * laisser le modèle verbaliser. Mais elle lui renvoyait ENCORE un catalogue de
 * capacités — donc l'invitation à en appeler une de plus, alors qu'aucune ne
 * sera exécutée. Le modèle proposait, la boucle jetait, et la praticienne
 * recevait un aveu d'échec pour une question à laquelle on savait répondre.
 *
 * Ce catalogue-ci n'annonce AUCUNE capacité : à ce point du tour, la seule
 * action possible est de répondre. Le contrat d'outil dit donc enfin la vérité
 * sur ce qui peut arriver.
 *
 * ⚠️ VALIDÉ AVANT D'ÊTRE ÉCRIT. Expérience contrôlée sur le modèle configuré,
 * même message et même résultat d'outil : avec un catalogue VIDE, il rend une
 * réponse en langue naturelle correcte (2/2) là où le catalogue complet le
 * faisait rappeler l'outil (3/3).
 *
 * ⚠️ CE N'EST PAS UN RELÈVEMENT DE BUDGET. `MAX_TOURS_OUTIL` est inchangé, le
 * garde de répétition est inchangé, et une proposition émise malgré tout à ce
 * stade reste refusée — `tropDIterations` demeure le défaut sûr.
 */
export function descriptionSyntheseSeule(): string {
  return [
    "Tu ne peux plus appeler de capacité pour ce tour : le budget d'appels est " +
      "épuisé et toute proposition d'outil serait ignorée.",
    "Réponds MAINTENANT en langue naturelle, à partir des résultats déjà obtenus.",
    "Si ces résultats ne suffisent pas à répondre, dis-le simplement — n'invente " +
      "jamais un chiffre, une heure ou un nom qui ne s'y trouve pas.",
    RAPPEL_REFERENCES,
  ].join("\n");
}

/** Le jour courant dans le calendrier du cabinet — `Africa/Algiers`. */
export function aujourdHui(): string {
  return aujourdHuiCabinet();
}
