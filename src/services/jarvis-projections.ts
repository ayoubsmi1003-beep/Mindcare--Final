/**
 * `jarvis-projections.ts` — LES DTO SÛRS.
 *
 * ═══ LA RÈGLE, EN UNE LIGNE ═══
 * Un champ absent des types de ce fichier NE PEUT PAS atteindre le modèle.
 *
 * Ce n'est pas une consigne de revue, c'est une propriété du code : les
 * capacités de lecture (`jarvis-capacites.ts`) ne rendent que des `Safe*`, et
 * aucune projection n'accepte ni ne produit `Record<string, unknown>`. Le
 * chemin `ligne brute → JSON.stringify → modèle` n'existe nulle part.
 *
 * ═══ POURQUOI UNE LISTE BLANCHE ET NON UNE LISTE NOIRE ═══
 * Une liste noire protège de ce qu'on a pensé à interdire. Une liste blanche
 * protège de ce qu'on n'a pas pensé du tout — et c'est précisément le cas
 * dangereux, parce qu'il grandit à chaque colonne ajoutée en base. Le jour où
 * une migration ajoute une colonne identifiante à `app.patients`, une liste
 * noire la laisse sortir en silence ; ici, elle n'entre dans aucun type, donc
 * elle ne sort pas. L'omission échoue du bon côté.
 *
 * ⚠️ CE QUE CE FICHIER NE FAIT PAS, ÉCRIT SANS L'ADOUCIR. Il ne masque RIEN.
 * Il SÉLECTIONNE. Les valeurs qu'il laisse passer — un libellé de diagnostic,
 * une posologie, un motif de séance — sont du texte écrit à la main par une
 * praticienne, et une praticienne peut y avoir glissé un prénom. La deuxième
 * couche (`jarvis-confidentialite.ts`) existe pour ça, et la troisième
 * (`assertSafe`, fail-closed) pour ce qui aurait échappé aux deux premières.
 * Aucune de ces trois n'est un prompt.
 *
 * Aucune E/S ici : types purs et fonctions pures, testables sans base.
 */

import type { AgendaEntry, ConsultationKind } from "./appointments";
import type { Consultation } from "./consultations";
import type { Document, TypeDocument } from "./documents";
import type { Paiement, RecetteDuJour } from "./finance";
import type { Periode } from "./finance-calendrier";
import type { ApercuCaisse } from "./finance-cash";
import type {
  CarteIdentite,
  RefDocument,
  RefPatient,
  RefPraticien,
  RefRendezVous,
} from "./jarvis-identite";
import type {
  PatientListItem,
  PatientWorkspace,
  TimelineEvent,
  TimelineLabelKey,
} from "./patients";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · PROVENANCE — d'où vient chaque fait, et quand
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ LA PROVENANCE N'EST PAS UNE DÉCORATION. Elle nomme la PORTE qui a rendu la
 * donnée et l'INSTANT de la lecture. Sans elle, une réponse de Jarvis est
 * invérifiable : la praticienne ne peut pas savoir si « trois consultations »
 * vient de `get_patient_workspace` d'il y a deux secondes ou d'un contexte
 * périmé rejoué depuis l'historique. Un fait clinique sans source est une
 * opinion présentée comme un fait.
 */
export interface SourceContexte {
  /** Le nom de la porte SQL ou du service — jamais une phrase. */
  readonly porte: string;
  /** ISO 8601 avec fuseau, instant de la lecture. */
  readonly luA: string;
  /**
   * `true` quand la projection a écarté des lignes pour tenir le budget. La
   * troncature est DÉCLARÉE au modèle : une liste coupée en silence lui ferait
   * conclure « il n'y a que trois consultations » sur une lecture partielle.
   */
  readonly tronque: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2 · LES DTO
// ═══════════════════════════════════════════════════════════════════════════

export interface SafeDiagnostic {
  readonly code: string | null;
  readonly systeme: string;
  readonly libelle: string;
  readonly principal: boolean;
  readonly depuis: string | null;
  readonly resoluLe: string | null;
}

export interface SafeEchelle {
  readonly code: string;
  readonly nom: string;
  readonly score: number | null;
  readonly le: string;
  readonly scorePrecedent: number | null;
  readonly delta: number | null;
}

export interface SafeLigneTraitement {
  readonly designation: string | null;
  readonly dose: string | null;
  readonly frequenceParJour: number | null;
  readonly dureeJours: number | null;
}

export interface SafeConsultationResume {
  readonly le: string;
  readonly type: string | null;
  readonly close: boolean;
}

export interface SafeCreneau {
  readonly ref: RefRendezVous;
  /** Le patient du créneau — absent quand le créneau n'en porte pas. */
  readonly patient?: RefPatient;
  readonly praticien?: RefPraticien;
  readonly debut: string;
  readonly fin: string;
  readonly dureeMinutes: number;
  readonly statut: string;
  readonly type: ConsultationKind | null;
  readonly arriveA: string | null;
}

/**
 * Le patient tel que le modèle a le droit de le connaître.
 *
 * ⚠️ NI `birthDate`, NI `phone`, NI `address`, NI `emergencyContact`, NI
 * `idDocumentNumber`, NI `notesAdmin`. L'ÂGE remplace la date de naissance :
 * une date de naissance est un quasi-identifiant réutilisable hors du cabinet,
 * un âge ne l'est pas, et aucune question clinique légitime n'a besoin du jour
 * exact. `notesAdmin` est du texte libre saisi à l'accueil — il n'entre pas.
 */
export interface SafePatientContext {
  readonly ref: RefPatient;
  readonly age: number | null;
  readonly sexe: "M" | "F" | null;
  readonly actif: boolean;
  /** `null` = le domaine est HORS DROIT pour ce rôle (la RLS a tranché). */
  readonly clinique: {
    readonly diagnostics: readonly SafeDiagnostic[];
    readonly echelles: readonly SafeEchelle[];
    readonly derniereConsultation: SafeConsultationResume | null;
    readonly nombreConsultations: number;
  } | null;
  readonly traitements: {
    readonly dernierePrescriptionLe: string | null;
    readonly lignes: readonly SafeLigneTraitement[];
    readonly nombrePrescriptions: number;
    /**
     * ⚠️ TOUJOURS `true` DANS CETTE PASSE. `get_patient_workspace` ne rend que la
     * DERNIÈRE prescription ; aucune porte n'expose l'historique complet. Le
     * modèle doit le savoir pour ne pas répondre « il n'a jamais pris autre
     * chose » — une absence de donnée n'est pas une absence de fait.
     */
    readonly historiqueIncomplet: boolean;
  } | null;
  readonly agenda: {
    readonly prochainRendezVous: SafeCreneau | null;
    readonly dernierRendezVous: SafeCreneau | null;
    readonly nombreRendezVous: number;
  };
  readonly documents: { readonly nombre: number; readonly dernierEmisLe: string | null };
  readonly provenance: readonly SourceContexte[];
}

export interface SafeAgendaContext {
  readonly creneaux: readonly SafeCreneau[];
  readonly provenance: readonly SourceContexte[];
}

/**
 * ⚠️ `encaisseDzd` ET `enAttenteDzd` SONT DEUX CHIFFRES, JAMAIS UN SEUL. La base
 * les distingue (`collected_at` nul ou non) et l'interface aussi. Les fusionner
 * ici ferait dire à Jarvis « vous avez fait 40 000 DA aujourd'hui » alors que
 * 15 000 n'ont pas été encaissés — une phrase fausse sur de l'argent, produite
 * par une projection paresseuse. Le mot « encaissé » est choisi, pas subi.
 */
export interface SafeFinanceContext {
  readonly periode: Periode;
  readonly encaisseDzd: number;
  readonly enAttenteDzd: number;
  readonly enAttenteNombre: number;
  readonly seances: number;
  readonly chargesDzd: number | null;
  readonly resultatNetDzd: number | null;
  readonly perimetre: "cabinet" | "praticienne";
  readonly provenance: readonly SourceContexte[];
}

export interface SafeDocumentContext {
  readonly documents: readonly {
    readonly ref: RefDocument;
    readonly type: TypeDocument;
    readonly emisLe: string;
    readonly nombreImpressions: number;
  }[];
  readonly provenance: readonly SourceContexte[];
}

export interface SafeEvenementTimeline {
  readonly le: string;
  readonly genre: TimelineLabelKey;
  /**
   * Détail SCALAIRE, par liste blanche selon `genre`. Le `detail` de
   * `list_patient_timeline` est un `Record<string, unknown>` — un sac ouvert —
   * et un sac ouvert recopié vers le modèle serait exactement le chemin
   * `ligne brute → JSON.stringify` que ce fichier interdit.
   */
  readonly detail: Readonly<Record<string, string | number | boolean>>;
}

export interface SafeTimelineContext {
  readonly patient: RefPatient;
  readonly evenements: readonly SafeEvenementTimeline[];
  readonly provenance: readonly SourceContexte[];
}

export interface SafeConsultationContext {
  readonly patient: RefPatient | null;
  readonly le: string;
  readonly close: boolean;
  readonly type: ConsultationKind | null;
  readonly note: {
    readonly signee: boolean;
    /**
     * Les quatre champs SOAP — pseudonymisés par la couche suivante.
     * `null` = champ jamais rempli, et il reste `null` : le remplacer par une
     * chaîne vide ferait lire au modèle « champ vide » là où la vérité est
     * « champ non abordé ». Deux états différents, deux lectures cliniques
     * différentes.
     */
    readonly soap: {
      readonly subjective: string | null;
      readonly objective: string | null;
      readonly assessment: string | null;
      readonly plan: string | null;
    };
  } | null;
  readonly provenance: readonly SourceContexte[];
}

/** Ce qu'une capacité rend à la boucle, et donc au modèle. */
export interface SafeToolResult<T> {
  /**
   * Les clés que le schéma de la capacité accepte. Renseigné UNIQUEMENT sur un
   * échec de validation, pour que le modèle puisse se corriger au tour suivant
   * au lieu d'annoncer un outil en panne.
   *
   * ⚠️ CE CHAMP NE PEUT PAS PORTER DE DONNÉE PATIENT, ET C'EST STRUCTUREL : il
   * est calculé à l'enregistrement à partir des clés du schéma que nous avons
   * écrites, sans jamais regarder les arguments reçus.
   */
  readonly champsAttendus?: string;
  readonly capacite: string;
  readonly ok: boolean;
  readonly donnees: T | null;
  /** Code d'erreur classé, jamais un message brut de la base. */
  readonly motifEchec?: string;
}

export interface SafeJarvisContext {
  readonly patient?: SafePatientContext;
  readonly timeline?: SafeTimelineContext;
  readonly agenda?: SafeAgendaContext;
  readonly finance?: SafeFinanceContext;
  readonly documents?: SafeDocumentContext;
  readonly consultation?: SafeConsultationContext;
  /** Taille sérialisée réelle, mesurée — pas estimée (§6.1 du plan). */
  readonly octets: number;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · LES PROJECTIONS
// ═══════════════════════════════════════════════════════════════════════════

function source(porte: string, tronque = false): SourceContexte {
  return { porte, luA: new Date().toISOString(), tronque };
}

/**
 * Le libellé d'affichage d'un patient — CÔTÉ APPLICATION UNIQUEMENT. Il entre
 * dans la carte d'identité (qui ne franchit jamais) et dans aucun DTO.
 */
function libellePatient(nom: string | null, prenom: string | null): string {
  return `${nom ?? ""} ${prenom ?? ""}`.trim();
}

/**
 * Les valeurs à masquer dans les textes libres du même dossier. Le nom ET le
 * prénom SÉPARÉMENT en plus du libellé complet : une note écrit « Nadia va
 * mieux », pas « BELKACEM Nadia va mieux ». Masquer le seul libellé complet
 * laisserait le prénom en clair — une fuite qui passe la revue parce qu'on a
 * regardé le mauvais objet.
 */
function identitesPatient(
  nom: string | null,
  prenom: string | null,
  numeroDossier: string | null,
): readonly string[] {
  return [nom, prenom, numeroDossier, libellePatient(nom, prenom)].filter(
    (v): v is string => v !== null && v.trim().length >= 2,
  );
}

export function projeterPatientListItem(
  p: PatientListItem,
  carte: CarteIdentite,
): RefPatient {
  return carte.patient(
    p.id,
    libellePatient(p.lastName, p.firstName),
    identitesPatient(p.lastName, p.firstName, p.recordNumber),
  );
}

/**
 * La forme COMMUNE aux trois sources de créneau du dépôt : `AgendaEntry`
 * (`list_agenda`), `CreneauDuJour` (`dashboard_today`) et `RdvAccueil`
 * (`reception_board`).
 *
 * ⚠️ UNE SEULE PROJECTION POUR LES TROIS, ET C'EST LE POINT. Trois projections
 * quasi identiques divergeraient au premier champ ajouté — et la divergence se
 * ferait du mauvais côté : celle qu'on oublie de mettre à jour est celle qui
 * laisse passer. Les différences entre les trois sources sont toutes des champs
 * FACULTATIFS ici ; aucune n'a besoin de son propre chemin.
 */
export interface SourceCreneau {
  readonly id: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly durationMinutes?: number;
  readonly status: string;
  readonly kind: ConsultationKind | null;
  readonly arrivedAt: string | null;
  readonly patientId: string | null;
  readonly recordNumber: string | null;
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly practitionerId?: string;
  readonly practitionerName?: string | null;
}

/** Durée en minutes — lue si la source la porte, calculée sinon. */
function dureeMinutes(e: SourceCreneau): number {
  if (typeof e.durationMinutes === "number") return e.durationMinutes;
  return Math.max(0, Math.round((Date.parse(e.endsAt) - Date.parse(e.startsAt)) / 60_000));
}

export function projeterCreneau(e: SourceCreneau, carte: CarteIdentite): SafeCreneau {
  const patient =
    e.patientId === null
      ? undefined
      : carte.patient(
          e.patientId,
          libellePatient(e.lastName, e.firstName),
          identitesPatient(e.lastName, e.firstName, e.recordNumber),
        );
  const praticien =
    e.practitionerId === undefined ||
    e.practitionerName === undefined ||
    e.practitionerName === null
      ? undefined
      : carte.praticien(e.practitionerId, e.practitionerName);

  // `notesAdmin` est ABSENT, et c'est délibéré : texte libre saisi à l'accueil.
  // 047 l'exclut déjà de la chronologie pour la même raison — on ne le
  // réintroduit pas par une autre porte.
  return {
    ref: carte.rendezVous(e.id, e.startsAt),
    ...(patient === undefined ? {} : { patient }),
    ...(praticien === undefined ? {} : { praticien }),
    debut: e.startsAt,
    fin: e.endsAt,
    dureeMinutes: dureeMinutes(e),
    statut: e.status,
    type: e.kind,
    arriveA: e.arrivedAt,
  };
}

export function projeterAgenda(
  entrees: readonly SourceCreneau[],
  carte: CarteIdentite,
  porte: string,
  tronque = false,
): SafeAgendaContext {
  return {
    creneaux: entrees.map((e) => projeterCreneau(e, carte)),
    provenance: [source(porte, tronque)],
  };
}

export function projeterWorkspace(
  w: PatientWorkspace,
  carte: CarteIdentite,
): SafePatientContext {
  const ref = carte.patient(
    w.identite.id,
    libellePatient(w.identite.lastName, w.identite.firstName),
    identitesPatient(w.identite.lastName, w.identite.firstName, w.identite.recordNumber),
  );

  const creneauResume = (
    r: PatientWorkspace["agenda"]["prochainRendezVous"],
  ): SafeCreneau | null => {
    if (r === null) return null;
    return {
      ref: carte.rendezVous(r.id, r.startsAt),
      patient: ref,
      debut: r.startsAt,
      fin: r.endsAt,
      dureeMinutes: Math.max(
        0,
        Math.round((Date.parse(r.endsAt) - Date.parse(r.startsAt)) / 60_000),
      ),
      statut: r.status,
      type: null,
      arriveA: null,
    };
  };

  return {
    ref,
    age: w.identite.age,
    sexe: w.identite.sex,
    actif: w.identite.isActive,
    clinique:
      w.clinique === null
        ? null
        : {
            diagnostics: w.clinique.diagnostics.map((d) => ({
              code: d.code,
              systeme: d.codeSystem,
              libelle: d.label,
              principal: d.isPrimary,
              depuis: d.onsetDate,
              resoluLe: d.resolvedAt,
            })),
            echelles: w.clinique.echelles.map((e) => ({
              code: e.scaleCode,
              nom: e.scaleName,
              score: e.dernier.score,
              le: e.dernier.date,
              scorePrecedent: e.precedent?.score ?? null,
              delta: e.delta,
            })),
            derniereConsultation:
              w.clinique.derniereConsultation === null
                ? null
                : {
                    le: w.clinique.derniereConsultation.startedAt,
                    type: w.clinique.derniereConsultation.kind,
                    close: w.clinique.derniereConsultation.status === "closed",
                  },
            nombreConsultations: w.clinique.nombreConsultations,
          },
    traitements:
      w.traitements === null
        ? null
        : {
            dernierePrescriptionLe: w.traitements.dernierePrescription?.prescribedAt ?? null,
            // `instructions` et `brandName` sont ÉCARTÉS : texte libre, et une
            // marque commerciale n'ajoute rien à un raisonnement clinique.
            lignes: (w.traitements.dernierePrescription?.lignes ?? []).map((l) => ({
              designation: l.designation,
              dose: l.dose,
              frequenceParJour: l.frequencyPerDay,
              dureeJours: l.durationDays,
            })),
            nombrePrescriptions: w.traitements.nombrePrescriptions,
            historiqueIncomplet: true,
          },
    agenda: {
      prochainRendezVous: creneauResume(w.agenda.prochainRendezVous),
      dernierRendezVous: creneauResume(w.agenda.dernierRendezVous),
      nombreRendezVous: w.agenda.nombreRendezVous,
    },
    documents: { nombre: w.documents.nombre, dernierEmisLe: w.documents.dernierEmisLe },
    provenance: [source("app.get_patient_workspace")],
  };
}

/**
 * Liste blanche du `detail` de la chronologie, PAR GENRE d'événement.
 *
 * ⚠️ 047 rend déjà un `detail` de métadonnées bornées — jamais le SOAP, jamais
 * `notes_admin`, jamais le contenu d'une prescription. On ne s'appuie pas sur
 * cette bonne propriété : elle est vraie AUJOURD'HUI, et une migration future
 * pourrait ajouter une clé au `jsonb_build_object` sans que personne ne relise
 * ce fichier. La liste blanche rend cette évolution inoffensive par défaut.
 */
const CLES_DETAIL: Readonly<Record<TimelineLabelKey, readonly string[]>> = {
  consultation_ouverte: ["status", "kind"],
  consultation_close: ["status", "kind"],
  note_signee: [],
  diagnostic_pose: ["label", "code", "code_system", "is_primary", "onset_date"],
  diagnostic_resolu: ["label", "code", "code_system"],
  prescription: ["is_handwritten", "nombre_lignes"],
  echelle: ["scale_code", "scale_name", "score"],
  rdv: ["status", "kind", "source"],
  // `doc_number` est ÉCARTÉ : un numéro de document est une métadonnée
  // identifiante et citable hors du cabinet. Le type suffit au raisonnement.
  document: ["doc_type"],
};

export function projeterTimeline(
  patient: RefPatient,
  evenements: readonly TimelineEvent[],
  tronque = false,
): SafeTimelineContext {
  return {
    patient,
    evenements: evenements.map((e) => {
      const autorisees = CLES_DETAIL[e.labelKey];
      const detail: Record<string, string | number | boolean> = {};
      for (const cle of autorisees) {
        const v = e.detail[cle];
        // Scalaires SEULEMENT. Un objet ou un tableau imbriqué serait un sac
        // ouvert par un autre chemin ; on ne le recopie pas, on l'ignore.
        if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
          detail[cle] = v;
        }
      }
      return { le: e.occurredAt, genre: e.labelKey, detail };
    }),
    provenance: [source("app.list_patient_timeline", tronque)],
  };
}

export function projeterRecetteDuJour(
  r: RecetteDuJour,
  periode: Periode,
): SafeFinanceContext {
  return {
    periode,
    encaisseDzd: r.totalDzd,
    enAttenteDzd: r.attenteDzd,
    enAttenteNombre: r.attenteNombre,
    seances: r.seances,
    chargesDzd: null,
    resultatNetDzd: null,
    perimetre: r.perimetre,
    provenance: [source("app.day_revenue")],
  };
}

export function projeterApercuCaisse(
  a: ApercuCaisse,
  periode: Periode,
  perimetre: "cabinet" | "praticienne",
): SafeFinanceContext {
  return {
    periode,
    encaisseDzd: a.pulse.revenu_periode,
    enAttenteDzd: a.pulse.impayes_total,
    enAttenteNombre: a.pulse.impayes_count,
    seances: a.pulse.nb_seances_periode,
    chargesDzd: a.pulse.charges_periode,
    resultatNetDzd: a.pulse.resultat_net_periode,
    perimetre,
    provenance: [source("app.get_finance_overview")],
  };
}

export interface SafePaiementEnAttente {
  readonly patient: RefPatient | null;
  readonly montantDzd: number;
  readonly creeLe: string;
}

/**
 * Les paiements EN ATTENTE, réduits à ce qui permet d'en parler : un patient
 * (par jeton), un montant, une ancienneté. Ni numéro de reçu — métadonnée
 * identifiante — ni nom.
 */
export function projeterPaiementsEnAttente(
  paiements: readonly Paiement[],
  carte: CarteIdentite,
): readonly SafePaiementEnAttente[] {
  return paiements
    .filter((p) => p.collectedAt === null)
    .map((p) => {
      const libelle = libellePatient(p.patientNom, p.patientPrenom);
      return {
        // `list_day_payments` ne rend pas `patient_id` : on jetonne sur le
        // numéro de dossier, stable et suffisant pour désigner la ligne.
        patient:
          p.recordNumber === null
            ? null
            : carte.patient(
                p.recordNumber,
                libelle,
                identitesPatient(p.patientNom, p.patientPrenom, p.recordNumber),
              ),
        montantDzd: p.montantDzd,
        creeLe: p.createdAt,
      };
    });
}

export function projeterDocuments(
  documents: readonly Document[],
  carte: CarteIdentite,
): SafeDocumentContext {
  return {
    documents: documents.map((d) => ({
      // `renderedHtml` et `variables` ne sont JAMAIS projetés : le rendu porte
      // le nom, l'adresse et la date de naissance imprimés sur le papier.
      ref: carte.document(d.id, d.docNumber, [d.docNumber]),
      type: d.docType,
      emisLe: d.issuedAt,
      nombreImpressions: d.printedCount,
    })),
    provenance: [source("app.list_patient_documents")],
  };
}

export function projeterConsultation(
  c: Consultation,
  carte: CarteIdentite,
): SafeConsultationContext {
  const patient =
    c.patientId === null
      ? null
      : carte.patient(
          c.patientId,
          libellePatient(c.lastName, c.firstName),
          identitesPatient(c.lastName, c.firstName, c.recordNumber),
        );

  // `rawNotes` est ÉCARTÉ : c'est la dictée brute de la séance, le texte le
  // moins structuré et le plus susceptible de nommer des tiers. Le SOAP signé
  // est ce sur quoi la praticienne s'est engagée ; c'est lui qui sort, et il
  // traverse la pseudonymisation à la couche suivante.
  return {
    patient,
    le: c.startedAt,
    close: c.status === "closed",
    type: c.appointmentKind,
    note:
      c.note === null
        ? null
        : {
            signee: c.note.status === "signed",
            soap: {
              subjective: c.note.soap.subjective,
              objective: c.note.soap.objective,
              assessment: c.note.soap.assessment,
              plan: c.note.soap.plan,
            },
          },
    provenance: [source("app.get_consultation")],
  };
}

/**
 * Mesure la taille RÉELLE d'un contexte, pour les budgets du §6.1 du plan.
 * Sérialisation exacte plutôt qu'une estimation par nombre de champs : c'est
 * la charge sérialisée qui part, c'est donc elle qu'on borne.
 */
export function mesurerOctets(contexte: unknown): number {
  return new TextEncoder().encode(JSON.stringify(contexte ?? null)).length;
}
