/**
 * `jarvis-ecritures.ts` — LE REGISTRE DES CAPACITÉS D'ÉCRITURE.
 *
 * ═══ UN FICHIER SÉPARÉ, PAS UN DRAPEAU ═══
 * Les écritures ne sont pas des lectures avec `write: true`. Un booléen se
 * teste, et un test s'oublie. Deux registres distincts rendent l'erreur
 * impossible à commettre : `jarvis-boucle.ts` n'importe QUE le registre de
 * lecture, et n'a donc aucune référence — donc aucun chemin d'appel — vers quoi
 * que ce soit d'ici. Une écriture ne peut pas être exécutée par la boucle même
 * si le modèle la propose : la boucle la rend à l'appelant sans y toucher.
 *
 * ═══ LE CYCLE, ET POURQUOI IL EST EN CINQ TEMPS ═══
 *
 *   PROPOSE ──► [attente humaine] ──► CONFIRM ──► EXECUTE ──► VERIFY ──► LOG
 *
 * `proposerAction`, `confirmerAction`, `executerAction` vivent déjà dans
 * `jarvis-tools.ts` et appellent les trois portes de 033 en TROIS APPELS
 * DISTINCTS. Ce fichier ne les remplace pas : il ajoute les deux temps que
 * V-JARVIS-CORE n'avait pas — la PRÉCONDITION, qui évite de proposer une action
 * vouée à échouer, et la VÉRIFICATION, qui relit l'état après coup.
 *
 * ⚠️ POURQUOI LA VÉRIFICATION EST OBLIGATOIRE ET NON RECOMMANDÉE. Le type
 * `CapaciteEcriture` n'a pas de `verifier` facultatif : on ne peut pas déclarer
 * une écriture sans dire comment on relit son effet. Sans cela, la seule preuve
 * de succès serait « la porte n'a pas levé » — et une porte qui rend `NULL`
 * parce que la cible est hors périmètre n'a pas levé non plus. C'est
 * exactement ce que `executerAction` refuse déjà de traiter comme un succès ;
 * la relecture pousse la même exigence d'un cran plus loin : non seulement
 * quelque chose a été touché, mais c'est bien CE QUI ÉTAIT DEMANDÉ.
 */

import { z } from "zod";

import { getAppointment } from "./appointments";
import { getCurrentUser } from "./authz";
import { getConsultation } from "./consultations";
import { db } from "./db";
import { formaterDzd, getConsultationPayment } from "./finance";
import type { CarteIdentite } from "./jarvis-identite";
import { log } from "./log";
import { err, ok, type Result } from "./result";
import { fr } from "@/i18n/fr";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LE CONTRAT
// ═══════════════════════════════════════════════════════════════════════════

/** Ce que l'humaine lit AVANT d'accepter. Chaque champ modifié y figure (L2). */
export interface ChampCarte {
  readonly libelle: string;
  /** Déjà rendu en identité locale si besoin — jamais un jeton brut à l'écran. */
  readonly valeur: string;
}

export interface CapaciteEcriture<A> {
  readonly nom: string;
  readonly description: string;
  readonly entree: z.ZodType<A>;
  /**
   * Vérifie ce qui peut l'être AVANT de poser une proposition. Une carte de
   * confirmation qui annonce un décalage vers un créneau déjà pris fait cliquer
   * l'humaine sur un échec — elle porte alors la responsabilité d'une décision
   * qu'on lui a mal présentée.
   */
  readonly precondition: (args: A, carte: CarteIdentite) => Promise<Result<void>>;
  /**
   * Complète les arguments que le modèle ne peut pas connaître SANS LES
   * INVENTER — au premier chef l'identifiant de la praticienne connectée.
   *
   * ⚠️ CE N'EST PAS UNE ÉLÉVATION DE PRIVILÈGE. On ne remplit ici que ce que
   * la session porte DÉJÀ ; la RLS décide ensuite si l'écriture passe, et elle
   * décidera exactement pareil que le champ ait été rempli ici ou fourni par
   * le modèle. L'alternative — laisser le modèle produire un UUID de
   * praticienne — serait soit une invention (règle 8), soit un refus permanent.
   */
  readonly completer?: (args: A) => Promise<Result<A>>;
  /** Le titre et les champs de la carte. Composés à partir des ARGUMENTS validés. */
  readonly carte: (args: A, carte: CarteIdentite) => { titre: string; champs: readonly ChampCarte[] };
  /**
   * RELIT l'état après exécution et confirme qu'il correspond à la demande.
   * Obligatoire. `affecte` est l'identifiant rendu par la porte.
   */
  readonly verifier: (args: A, affecte: string) => Promise<Result<void>>;
  /**
   * Un acte dont l'effet est visible du patient (annulation) ou irréversible.
   * L'interface le signale ; la base ne fait pas la différence, et c'est
   * normal — la gravité est une notion d'écran, pas de contrainte.
   */
  readonly critique: boolean;
}

export interface CapaciteEcritureEnregistree {
  readonly nom: string;
  readonly description: string;
  readonly critique: boolean;
  /** Valide, vérifie la précondition, compose la carte. N'écrit RIEN. */
  readonly preparer: (
    argsBruts: unknown,
    carte: CarteIdentite,
  ) => Promise<Result<{ args: unknown; titre: string; champs: readonly ChampCarte[] }>>;
  /** Relit l'état réel. Appelée APRÈS `executerAction`, jamais à sa place. */
  readonly verifier: (args: unknown, affecte: string) => Promise<Result<void>>;
}

function enregistrer<A>(capacite: CapaciteEcriture<A>): CapaciteEcritureEnregistree {
  return {
    nom: capacite.nom,
    description: capacite.description,
    critique: capacite.critique,
    preparer: async (argsBruts, carte) => {
      const analyse = capacite.entree.safeParse(argsBruts);
      if (!analyse.success) {
        log.error("jarvis.ecriture.arguments", {
          code: "regle-metier",
          context: `capacite:${capacite.nom}:${analyse.error.issues
            .map((i) => i.path.join("."))
            .join(",")}`,
        });
        return err({ code: "regle-metier", message: fr.jarvis.argumentsInvalides });
      }
      // La complétion précède la précondition : vérifier la disponibilité d'un
      // créneau exige de savoir DE QUI il s'agit.
      let args = analyse.data;
      if (capacite.completer !== undefined) {
        const complet = await capacite.completer(args);
        if (!complet.ok) return err(complet.error);
        args = complet.data;
      }
      const pre = await capacite.precondition(args, carte);
      if (!pre.ok) return err(pre.error);
      const vue = capacite.carte(args, carte);
      return ok({ args, titre: vue.titre, champs: vue.champs });
    },
    verifier: async (args, affecte) => capacite.verifier(args as A, affecte),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · SCHÉMAS
// ═══════════════════════════════════════════════════════════════════════════

/** `z.guid()` et non `z.uuid()` — voir `jarvis-capacites.ts` §3. */
const Guid = z.guid();
const InstantIso = z.iso.datetime({ offset: true });

// ═══════════════════════════════════════════════════════════════════════════
// 3 · LA PORTE DE DISPONIBILITÉ (063)
// ═══════════════════════════════════════════════════════════════════════════

interface LigneDisponibilite {
  readonly disponible: boolean;
  readonly motif: string | null;
}

async function creneauDisponible(
  practitionerId: string,
  debut: string,
  dureeMinutes: number,
  exclure: string | null,
): Promise<Result<LigneDisponibilite>> {
  const r = await db().rpc<LigneDisponibilite>("check_slot_available", {
    p_practitioner_id: practitionerId,
    p_starts_at: debut,
    p_duration_minutes: dureeMinutes,
    p_exclude_id: exclure,
  });
  if (!r.ok) return err(r.error);
  const ligne = r.data[0];
  if (ligne === undefined) {
    return err({ code: "indisponible", message: fr.erreurs["indisponible"] });
  }
  return ok(ligne);
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LES CAPACITÉS
// ═══════════════════════════════════════════════════════════════════════════

interface ArgsDecaler {
  readonly appointmentId: string;
  readonly nouveauDebut: string;
  readonly dureeMinutes?: number | undefined;
}

const decalerRendezVous: CapaciteEcriture<ArgsDecaler> = {
  nom: "reschedule_appointment",
  description:
    "Déplace un rendez-vous à une nouvelle date et heure. Vérifie d'abord que " +
    "le créneau est libre. Ne change ni le patient, ni la praticienne.",
  entree: z.strictObject({
    appointmentId: Guid,
    nouveauDebut: InstantIso,
    dureeMinutes: z.number().int().min(5).max(240).optional(),
  }),
  critique: false,
  precondition: async (args) => {
    const rdv = await getAppointment(args.appointmentId);
    if (!rdv.ok) return err(rdv.error);
    // `null` = introuvable OU hors périmètre. Les deux rendent la même chose,
    // sinon on aurait fabriqué un oracle d'existence (ADR-003).
    if (rdv.data === null) {
      return err({ code: "introuvable", message: fr.erreurs.introuvable });
    }
    const duree = args.dureeMinutes ?? rdv.data.durationMinutes;
    const dispo = await creneauDisponible(
      rdv.data.practitionerId,
      args.nouveauDebut,
      duree,
      // On S'EXCLUT soi-même : sans cela, tout décalage à l'intérieur de sa
      // propre plage se déclarerait en conflit avec lui-même.
      args.appointmentId,
    );
    if (!dispo.ok) return err(dispo.error);
    if (!dispo.data.disponible) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.creneauOccupe });
    }
    return ok(undefined);
  },
  carte: (args) => ({
    titre: fr.jarvis.carte.decalerRendezVous,
    champs: [
      { libelle: fr.jarvis.carte.champNouvelleDate, valeur: formaterInstant(args.nouveauDebut) },
      ...(args.dureeMinutes === undefined
        ? []
        : [{ libelle: fr.jarvis.carte.champDuree, valeur: `${args.dureeMinutes} min` }]),
    ],
  }),
  verifier: async (args, affecte) => {
    // ⚠️ RELECTURE, PAS CONFIANCE. La porte a rendu un identifiant ; cela dit
    // qu'une ligne a été touchée, pas qu'elle porte l'heure demandée.
    const rdv = await getAppointment(affecte);
    if (!rdv.ok) return err(rdv.error);
    if (rdv.data === null) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    // Comparaison en INSTANTS, pas en chaînes : `14:00+01:00` et `13:00Z` sont
    // le même moment, et deux fuseaux écrits différemment ne sont pas un échec.
    if (Date.parse(rdv.data.startsAt) !== Date.parse(args.nouveauDebut)) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    return ok(undefined);
  },
};

interface ArgsAnnuler {
  readonly appointmentId: string;
  readonly motif: string;
}

const annulerRendezVous: CapaciteEcriture<ArgsAnnuler> = {
  nom: "cancel_appointment",
  description:
    "Annule un rendez-vous. Un motif est exigé. Acte visible du patient : " +
    "n'annule jamais sans que la praticienne l'ait explicitement demandé.",
  entree: z.strictObject({
    appointmentId: Guid,
    // Le motif n'est pas facultatif : une annulation sans raison est une
    // annulation qu'on ne saura pas expliquer au patient qui rappelle.
    motif: z.string().trim().min(3).max(300),
  }),
  critique: true,
  precondition: async (args) => {
    const rdv = await getAppointment(args.appointmentId);
    if (!rdv.ok) return err(rdv.error);
    if (rdv.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    if (rdv.data.status === "cancelled") {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.dejaAnnule });
    }
    return ok(undefined);
  },
  carte: (args) => ({
    titre: fr.jarvis.carte.annulerRendezVous,
    champs: [{ libelle: fr.jarvis.carte.champMotif, valeur: args.motif }],
  }),
  verifier: async (_args, affecte) => {
    const rdv = await getAppointment(affecte);
    if (!rdv.ok) return err(rdv.error);
    if (rdv.data === null || rdv.data.status !== "cancelled") {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    return ok(undefined);
  },
};

interface ArgsArrivee {
  readonly appointmentId: string;
}

const marquerArrivee: CapaciteEcriture<ArgsArrivee> = {
  nom: "mark_patient_arrived",
  description: "Marque un patient comme arrivé en salle d'attente.",
  entree: z.strictObject({ appointmentId: Guid }),
  critique: false,
  precondition: async (args) => {
    const rdv = await getAppointment(args.appointmentId);
    if (!rdv.ok) return err(rdv.error);
    if (rdv.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    if (rdv.data.arrivedAt !== null) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.dejaArrive });
    }
    return ok(undefined);
  },
  carte: () => ({
    titre: fr.jarvis.carte.marquerArrivee,
    champs: [],
  }),
  verifier: async (_args, affecte) => {
    const rdv = await getAppointment(affecte);
    if (!rdv.ok) return err(rdv.error);
    if (rdv.data === null || rdv.data.arrivedAt === null) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    return ok(undefined);
  },
};

interface ArgsEncaisser {
  readonly paymentId: string;
  readonly consultationId: string;
}

const encaisserPaiement: CapaciteEcriture<ArgsEncaisser> = {
  nom: "record_payment_collected",
  description:
    "Enregistre qu'un paiement a été encaissé. Le montant n'est pas modifié " +
    "par cette action : il a été fixé au moment de la tarification.",
  entree: z.strictObject({ paymentId: Guid, consultationId: Guid }),
  critique: true,
  precondition: async (args) => {
    const p = await getConsultationPayment(args.consultationId);
    if (!p.ok) return err(p.error);
    if (p.data === null) return err({ code: "introuvable", message: fr.erreurs.introuvable });
    if (p.data.collectedAt !== null) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.dejaEncaisse });
    }
    return ok(undefined);
  },
  carte: (args, carte) => ({
    titre: fr.jarvis.carte.encaisserPaiement,
    champs: [{ libelle: fr.jarvis.carte.champSeance, valeur: carte.rendre(args.consultationId) }],
  }),
  verifier: async (args) => {
    // ⚠️ ON RELIT PAR LA CONSULTATION, PAS PAR `affecte`. La porte rend
    // l'identifiant du PAIEMENT ; `getConsultationPayment` est la seule lecture
    // dont on dispose, et c'est elle qui porte `collectedAt`. Vérifier avec ce
    // qu'on a plutôt que déclarer vérifié ce qu'on n'a pas relu.
    const p = await getConsultationPayment(args.consultationId);
    if (!p.ok) return err(p.error);
    if (p.data === null || p.data.collectedAt === null) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    return ok(undefined);
  },
};

// ---------------------------------------------------------------------------
// LES TROIS QUE LA BASE ADMETTAIT DEJA, SANS QUE L'ASSISTANT LES OFFRE
//
// CET ECART ETAIT REEL ET SILENCIEUX. `063_jarvis_capacites.sql` autorise SEPT
// outils d'ecriture ; ce registre n'en exposait que QUATRE. La base aurait
// accepte `create_appointment`, `set_consultation_price` et
// `create_document_draft` -- l'assistant, lui, ne savait pas les demander. Une
// capacite autorisee mais inatteignable ne se voit dans aucun test : elle se
// voit quand la praticienne demande quelque chose de parfaitement legitime et
// s'entend repondre non.
// ---------------------------------------------------------------------------

interface ArgsCreerRdv {
  readonly patientId: string;
  readonly practitionerId?: string | undefined;
  readonly startsAt: string;
  readonly durationMinutes: number;
  readonly kind?: string | undefined;
  readonly notesAdmin?: string | undefined;
}

const creerRendezVous: CapaciteEcriture<ArgsCreerRdv> = {
  nom: "create_appointment",
  description:
    "Cree un rendez-vous pour un patient existant. Verifie d'abord que le " +
    "creneau est libre. Ne cree jamais le patient : s'il n'existe pas, dites-le.",
  entree: z.strictObject({
    patientId: Guid,
    // Facultatif : rempli par `completer` avec la praticienne connectee. Le
    // modele n'a aucun moyen de connaitre cet identifiant sans l'inventer.
    practitionerId: Guid.optional(),
    startsAt: InstantIso,
    durationMinutes: z.number().int().min(5).max(240),
    kind: z.string().trim().min(1).max(40).optional(),
    notesAdmin: z.string().trim().max(500).optional(),
  }),
  critique: false,
  completer: async (args) => {
    if (args.practitionerId !== undefined) return ok(args);
    const moi = await getCurrentUser();
    if (!moi.ok) return err(moi.error);
    if (moi.data === null) {
      return err({ code: "non-authentifie", message: fr.erreurs["non-authentifie"] });
    }
    return ok({ ...args, practitionerId: moi.data.id });
  },
  precondition: async (args) => {
    if (args.practitionerId === undefined) {
      return err({ code: "regle-metier", message: fr.jarvis.argumentsInvalides });
    }
    const dispo = await creneauDisponible(
      args.practitionerId,
      args.startsAt,
      args.durationMinutes,
      null,
    );
    if (!dispo.ok) return err(dispo.error);
    if (!dispo.data.disponible) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.creneauOccupe });
    }
    return ok(undefined);
  },
  carte: (args, carte) => ({
    titre: fr.jarvis.carte.creerRendezVous,
    champs: [
      // `carte.rendre` remet l'identite LOCALE : la praticienne lit un nom,
      // jamais le jeton qui a voyage jusqu'au modele.
      { libelle: fr.jarvis.carte.champPatient, valeur: carte.rendre(args.patientId) },
      { libelle: fr.jarvis.carte.champDate, valeur: formaterInstant(args.startsAt) },
      { libelle: fr.jarvis.carte.champDuree, valeur: `${args.durationMinutes} min` },
      ...(args.kind === undefined
        ? []
        : [{ libelle: fr.jarvis.carte.champNature, valeur: args.kind }]),
    ],
  }),
  verifier: async (args, affecte) => {
    const rdv = await getAppointment(affecte);
    if (!rdv.ok) return err(rdv.error);
    if (rdv.data === null) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    // Instants compares, pas chaines : deux fuseaux ecrits differemment
    // designent le meme moment.
    if (Date.parse(rdv.data.startsAt) !== Date.parse(args.startsAt)) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    if (rdv.data.patientId !== args.patientId) {
      // LE CONTROLE QUI COMPTE VRAIMENT. Un rendez-vous cree a la bonne heure
      // POUR LE MAUVAIS PATIENT est pire qu'un echec : personne ne le
      // remarquerait avant la salle d'attente.
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    return ok(undefined);
  },
};

interface ArgsTarif {
  readonly consultationId: string;
  readonly amountDzd: number;
}

const fixerTarif: CapaciteEcriture<ArgsTarif> = {
  nom: "set_consultation_price",
  description:
    "Fixe le tarif d'une seance, en dinars entiers. Impossible si la seance " +
    "est deja encaissee.",
  entree: z.strictObject({
    consultationId: Guid,
    // Dinars ENTIERS. Aucun centime, aucun flottant (ADR-018) : `z.number()`
    // seul accepterait 1500.5, que la base tronquerait en silence.
    amountDzd: z.number().int().min(0).max(1000000),
  }),
  critique: true,
  precondition: async (args) => {
    const p = await getConsultationPayment(args.consultationId);
    if (!p.ok) return err(p.error);
    // `null` = pas encore de ligne de paiement : c'est le cas NORMAL d'une
    // premiere tarification, pas une erreur.
    if (p.data !== null && p.data.collectedAt !== null) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.tarifFige });
    }
    return ok(undefined);
  },
  carte: (args, carte) => ({
    titre: fr.jarvis.carte.fixerTarif,
    champs: [
      { libelle: fr.jarvis.carte.champSeance, valeur: carte.rendre(args.consultationId) },
      { libelle: fr.jarvis.carte.champMontant, valeur: formaterDzd(args.amountDzd) },
    ],
  }),
  verifier: async (args) => {
    const p = await getConsultationPayment(args.consultationId);
    if (!p.ok) return err(p.error);
    if (p.data === null || p.data.montantDzd !== args.amountDzd) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    return ok(undefined);
  },
};

interface ArgsBrouillon {
  readonly consultationId: string;
  readonly documentType: string;
}

/**
 * CETTE CAPACITE N'EMET AUCUN DOCUMENT, ET C'EST TOUT SON INTERET.
 *
 * La branche SQL de 063 ne compose aucun contenu : elle enregistre que la
 * praticienne a DEMANDE et CONFIRME un brouillon, et pointe la consultation.
 * L'emission reelle reste un geste separe, a l'ecran des documents.
 *
 * C'est ce qui leve l'objection qui l'avait tenue hors du registre jusqu'ici :
 * Jarvis ne sait pas composer les variables d'un certificat sans risquer d'en
 * inventer (regle 8) -- alors il n'en compose aucune. Il note une intention.
 */
const preparerBrouillonDocument: CapaciteEcriture<ArgsBrouillon> = {
  nom: "create_document_draft",
  description:
    "Note une demande de brouillon de document pour une seance. N'EMET RIEN : " +
    "aucun contenu n'est redige, aucun numero n'est consomme. L'emission reste " +
    "un geste separe a l'ecran des documents.",
  entree: z.strictObject({
    consultationId: Guid,
    documentType: z.string().trim().min(1).max(40),
  }),
  critique: true,
  precondition: async (args) => {
    const c = await getConsultation(args.consultationId);
    if (!c.ok) return err(c.error);
    if (c.data === null) {
      return err({ code: "introuvable", message: fr.jarvis.ecriture.seanceIntrouvable });
    }
    return ok(undefined);
  },
  carte: (args, carte) => ({
    titre: fr.jarvis.carte.creerBrouillonDocument,
    champs: [
      { libelle: fr.jarvis.carte.champSeance, valeur: carte.rendre(args.consultationId) },
      { libelle: fr.jarvis.carte.champTypeDocument, valeur: args.documentType },
    ],
  }),
  verifier: async (args, affecte) => {
    // La porte rend l'identifiant de la CONSULTATION visee. Le seul fait
    // verifiable est donc que c'est bien celle qui etait demandee -- et on ne
    // pretend rien verifier de plus, faute de document a relire.
    if (affecte !== args.consultationId) {
      return err({ code: "regle-metier", message: fr.jarvis.ecriture.nonVerifiee });
    }
    return ok(undefined);
  },
};


// ═══════════════════════════════════════════════════════════════════════════
// 5 · LE REGISTRE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * LES SEPT ECRITURES, alignees sur l'allowlist de `063_jarvis_capacites.sql`.
 *
 * LA CONTRAINTE SQL RESTE L'AUTORITE. Ce registre borne ce qui est OFFERT ; la
 * contrainte en base borne ce qui est POSSIBLE. Ajouter un nom ici sans
 * l'ajouter la ne donne aucun pouvoir nouveau -- la porte refusera. C'est le
 * bon sens de la dependance, et il ne s'inverse jamais.
 *
 * AUCUNE SUPPRESSION, ET CE N'EST PAS UN OUBLI. Le depot SAIT supprimer
 * (`deleteCharge`, `app.delete_charge`) ; cette absence est donc une decision,
 * pas une lacune. `scripts/eval-registre-sans-suppression.mjs` echoue si un nom
 * de suppression apparait ici.
 */
const ECRITURES: readonly CapaciteEcritureEnregistree[] = [
  enregistrer(creerRendezVous),
  enregistrer(decalerRendezVous),
  enregistrer(annulerRendezVous),
  enregistrer(marquerArrivee),
  enregistrer(fixerTarif),
  enregistrer(encaisserPaiement),
  enregistrer(preparerBrouillonDocument),
];

const PAR_NOM: ReadonlyMap<string, CapaciteEcritureEnregistree> = new Map(
  ECRITURES.map((c) => [c.nom, c]),
);

export function capaciteEcriture(nom: string): CapaciteEcritureEnregistree | null {
  return PAR_NOM.get(nom) ?? null;
}

export function nomsDEcriture(): readonly string[] {
  return ECRITURES.map((c) => c.nom);
}

/** La description que le modèle reçoit, composée depuis le registre. */
export function descriptionDesEcritures(): string {
  return ECRITURES.map((c) => `- ${c.nom} : ${c.description}`).join("\n");
}

/**
 * Formate un instant pour la CARTE, en heure d'Alger.
 *
 * ⚠️ C'est la seule chaîne de ce fichier qui s'affiche telle quelle à l'humaine
 * avant qu'elle ne clique. Une heure fausse ici, et la confirmation porte sur
 * autre chose que ce qui sera écrit.
 */
function formaterInstant(iso: string): string {
  return new Date(iso).toLocaleString("fr-DZ", {
    timeZone: "Africa/Algiers",
    dateStyle: "full",
    timeStyle: "short",
    // ⚠️ `hourCycle: "h23"` EXPLICITE, ET C'EST UN DÉFAUT TROUVÉ PAR EXÉCUTION,
    // PAS PAR RELECTURE. Sans lui, `fr-DZ` rend « jeudi 3 septembre 2026 à
    // 3:00 PM » : la date se localise en français, l'heure reste sur un cycle
    // de 12 heures. Sur la carte de confirmation — le seul écran que la
    // praticienne lit AVANT d'engager une écriture — « 3:00 » se lit aussi bien
    // 3 h que 15 h. Elle confirmerait alors un déplacement vers une heure
    // qu'elle n'a pas voulue, et la faute serait dans le formatage, pas dans sa
    // lecture.
    //
    // Le cycle dépend de la base ICU embarquée : il varie d'un navigateur et
    // d'une version de Node à l'autre. Une horloge d'hôpital ne se négocie pas
    // par environnement — on la fixe.
    hourCycle: "h23",
  });
}
