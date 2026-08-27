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
import { getDayRevenue, listDayPayments } from "./finance";
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
  projeterPaiementsEnAttente,
  projeterPatientListItem,
  projeterRecetteDuJour,
  projeterApercuCaisse,
  projeterTimeline,
  projeterWorkspace,
  type SafeAgendaContext,
  type SafeConsultationContext,
  type SafeDocumentContext,
  type SafeFinanceContext,
  type SafePaiementEnAttente,
  type SafePatientContext,
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
  /** Valide PUIS exécute. Il n'existe aucun autre chemin vers `executer`. */
  readonly lancer: (
    argsBruts: unknown,
    ctx: ContexteExecution,
  ) => Promise<Result<ValeurSafe>>;
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

function enregistrer<A, S extends ValeurSafe>(
  capacite: CapaciteLecture<A, S>,
): CapaciteEnregistree {
  return {
    nom: capacite.nom,
    description: capacite.description,
    budgetOctets: capacite.budgetOctets,
    champsAttendus: champsAttendus(capacite.entree),
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
    const agenda = projeterAgenda(tb.data?.journee ?? [], ctx.carte, "app.dashboard_today");
    const caisse = tb.data?.encaisse ?? null;
    const periode: Periode = { nom: "jour", du: ctx.aujourdHui, au: ctx.aujourdHui };
    // `null` = HORS PÉRIMÈTRE financier (ADR-005), pas « zéro ». Le brief tait
    // alors la finance au lieu d'annoncer une recette nulle.
    const finance: SafeFinanceContext | null =
      caisse === null
        ? null
        : {
            periode,
            encaisseDzd: caisse.montantDzd,
            enAttenteDzd: 0,
            enAttenteNombre: 0,
            seances: caisse.seances,
            chargesDzd: null,
            resultatNetDzd: null,
            perimetre: caisse.perimetre,
            provenance: [{ porte: "app.dashboard_today", luA: new Date().toISOString(), tronque: false }],
          };
    return ok(
      composerBriefMatinal({
        agenda,
        finance,
        enAttente: tb.data?.attenteNombre ?? 0,
      }),
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
  enregistrer(briefProchainPatient),
  enregistrer(briefMatinal),
  enregistrer(briefFinance),
  enregistrer(brouillonMessage),
];

const PAR_NOM: ReadonlyMap<string, CapaciteEnregistree> = new Map(
  LECTURES.map((c) => [c.nom, c]),
);

export function capaciteLecture(nom: string): CapaciteEnregistree | null {
  return PAR_NOM.get(nom) ?? null;
}

export function estCapaciteLecture(nom: string): boolean {
  return PAR_NOM.has(nom);
}

export function nomsDeLecture(): readonly string[] {
  return LECTURES.map((c) => c.nom);
}

/**
 * La description que le MODÈLE reçoit. Composée depuis le registre, jamais
 * recopiée à la main dans le prompt : une liste écrite deux fois finit par
 * décrire des outils qui n'existent plus, et le modèle propose alors des appels
 * que rien ne peut satisfaire.
 */
export function descriptionDesCapacites(): string {
  return LECTURES.map((c) => `- ${c.nom} : ${c.description}`).join("\n");
}

/** Le jour courant dans le calendrier du cabinet — `Africa/Algiers`. */
export function aujourdHui(): string {
  return aujourdHuiCabinet();
}
