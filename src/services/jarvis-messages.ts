/**
 * `jarvis-messages.ts` — LE BROUILLON DE MESSAGE, ET RIEN QUE LE BROUILLON.
 *
 * ═══ CE QUE CE FICHIER FAIT, ET CE QU'IL NE FERA PAS ═══
 *
 * Il COMPOSE un texte à partir de valeurs déjà vérifiées, et il s'arrête là.
 * Il n'envoie rien, n'ouvre aucun canal, ne connaît aucun numéro et n'écrit
 * aucune ligne en base.
 *
 * ⚠️ CE N'EST PAS UNE ÉTAPE INACHEVÉE, C'EST LE PÉRIMÈTRE DEMANDÉ. MindCare
 * n'a AUCUNE table de communication, aucun canal, aucun journal d'envoi :
 * vérifié dans `01-SCHEMA.md` et dans `src/services/`. Envoyer supposerait
 * d'inventer une messagerie, un consentement, une trace d'envoi et une durée de
 * conservation — dans un cabinet de psychiatrie, sous la loi 18-07, ces quatre
 * choses sont des décisions, pas des détails d'implémentation. Le brouillon
 * s'affiche ; la praticienne le copie où elle veut, sous sa responsabilité.
 *
 * ═══ POURQUOI C'EST COMPOSÉ ICI ET NON PAR LE MODÈLE ═══
 *
 * Même raison que les briefs : une date de rendez-vous produite par un modèle
 * est plausible, pas vraie. Un patient qui se déplace un jeudi parce qu'un
 * rappel inventé le lui a dit ne récupère pas sa matinée. Chaque valeur
 * ci-dessous vient d'un `Safe*` typé — le modèle ne fait que la mise en langue,
 * s'il intervient.
 *
 * ═══ L'IDENTITÉ N'ENTRE PAS DANS LE TEXTE ═══
 *
 * Le corps porte `{{PATIENT_001}}`, pas un nom. Le rendu a lieu à l'AFFICHAGE,
 * côté application (`CarteIdentite.rendre`). Un brouillon qui contiendrait le
 * vrai nom serait un texte identifiant qui traverserait le pare-feu si le
 * modèle devait le reformuler — le jeton évite ce chemin entièrement.
 */

import type { RefPatient, RefRendezVous } from "./jarvis-identite";
import type { SafeCreneau, SafeDocumentContext, SourceContexte } from "./jarvis-projections";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LA FORME
// ═══════════════════════════════════════════════════════════════════════════

export type TypeBrouillon = "rappel_rendez_vous" | "document_pret";

export interface SafeBrouillonMessage {
  readonly type: TypeBrouillon;
  readonly patient: RefPatient;
  readonly rendezVous?: RefRendezVous;
  readonly objet: string;
  /** Le corps, à jetons. JAMAIS un nom, jamais un numéro. */
  readonly corps: string;
  /**
   * `null` PARTOUT, et c'est le point. Le type ne prévoit même pas de valeur
   * non nulle : ajouter un canal exigerait de modifier ce type, donc de le
   * décider explicitement, jamais de le laisser glisser.
   */
  readonly canal: null;
  /** Toujours `false`. Aucun chemin de ce fichier ne peut le rendre vrai. */
  readonly envoye: false;
  readonly faits: readonly string[];
  readonly informationManquante: readonly string[];
  readonly provenance: readonly SourceContexte[];
}

/** Un refus nommé — jamais un brouillon vide, jamais un brouillon faux. */
export interface RefusBrouillon {
  readonly refus: string;
}

export function estRefus(
  v: SafeBrouillonMessage | RefusBrouillon,
): v is RefusBrouillon {
  return "refus" in v;
}

/**
 * Ce qui manque, dit une fois. Cette phrase accompagne CHAQUE brouillon : sans
 * elle, une praticienne pourrait croire le message parti.
 */
const AUCUN_CANAL =
  "MindCare n'envoie aucun message : il n'existe ni canal, ni carnet d'envois, ni trace de réception. Ce texte est un brouillon à copier manuellement.";

// ═══════════════════════════════════════════════════════════════════════════
// 2 · OUTILLAGE — les mêmes règles de date que partout ailleurs
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ `hourCycle: "h23"` EXPLICITE, pour la troisième fois dans cette couche.
 * Selon la base ICU, `fr-DZ` rend « 3:00 PM ». Dans un rappel de rendez-vous
 * destiné à un patient, « 3 heures » pour 15 h fait manquer la consultation —
 * c'est le pire endroit du produit pour ce défaut.
 */
function dateEtHeure(iso: string): string {
  return new Date(iso).toLocaleString("fr-DZ", {
    timeZone: "Africa/Algiers",
    dateStyle: "full",
    timeStyle: "short",
    hourCycle: "h23",
  });
}

function jour(iso: string): string {
  return new Date(iso).toLocaleDateString("fr-DZ", {
    timeZone: "Africa/Algiers",
    dateStyle: "long",
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · RAPPEL DE RENDEZ-VOUS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ REFUSE LES CRÉNEAUX QUI NE SE RAPPELLENT PAS. Un rendez-vous annulé ou en
 * absence constatée n'a rien à rappeler : composer le texte quand même
 * produirait un message juste dans sa forme et faux dans son fond, que la
 * praticienne pourrait envoyer sans le relire. Le refus est nommé.
 */
export function composerRappelRendezVous(entree: {
  readonly creneau: SafeCreneau;
  readonly provenance: readonly SourceContexte[];
}): SafeBrouillonMessage | RefusBrouillon {
  const { creneau } = entree;

  if (creneau.patient === undefined) {
    return { refus: "Ce créneau ne porte aucun patient : il n'y a personne à qui écrire." };
  }

  const statut = creneau.statut.toLowerCase();
  if (statut === "cancelled") {
    return { refus: "Ce rendez-vous est annulé : il n'y a pas de rappel à envoyer." };
  }
  if (statut === "no_show") {
    return {
      refus: "Ce rendez-vous est en absence constatée : un rappel arriverait après coup.",
    };
  }

  const quand = dateEtHeure(creneau.debut);
  const corps = [
    `Bonjour {{${creneau.patient}}},`,
    "",
    `Nous vous rappelons votre rendez-vous du ${quand}, d'une durée prévue de ${String(creneau.dureeMinutes)} minutes.`,
    "",
    "En cas d'empêchement, merci de prévenir le cabinet.",
  ].join("\n");

  return {
    type: "rappel_rendez_vous",
    patient: creneau.patient,
    rendezVous: creneau.ref,
    objet: `Rappel de rendez-vous — ${jour(creneau.debut)}`,
    corps,
    canal: null,
    envoye: false,
    // Les FAITS répètent, isolées, les valeurs sur lesquelles la praticienne
    // doit pouvoir vérifier le brouillon sans le relire en entier.
    faits: [
      `Rendez-vous le ${quand}.`,
      `Durée prévue : ${String(creneau.dureeMinutes)} minutes.`,
      `Statut actuel du rendez-vous : ${creneau.statut}.`,
    ],
    informationManquante: [AUCUN_CANAL],
    provenance: entree.provenance,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · DOCUMENT DISPONIBLE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ NE DÉCRIT PAS LE CONTENU DU DOCUMENT. Le brouillon dit qu'un document
 * d'un TYPE donné, émis à une DATE donnée, est disponible au cabinet. Résumer
 * un certificat ou une ordonnance dans un message reviendrait à faire sortir du
 * contenu clinique par un canal non maîtrisé — et le résumé serait produit sans
 * que personne ne l'ait relu.
 */
export function composerDocumentPret(entree: {
  readonly patient: RefPatient;
  readonly documents: SafeDocumentContext;
}): SafeBrouillonMessage | RefusBrouillon {
  const dernier = entree.documents.documents[0];
  if (dernier === undefined) {
    return { refus: "Aucun document n'a été émis pour ce patient : il n'y a rien à annoncer." };
  }

  const corps = [
    `Bonjour {{${entree.patient}}},`,
    "",
    `Un document (${dernier.type}) établi le ${jour(dernier.emisLe)} est disponible au cabinet.`,
    "",
    "Vous pouvez le retirer aux horaires d'ouverture.",
  ].join("\n");

  return {
    type: "document_pret",
    patient: entree.patient,
    objet: "Document disponible au cabinet",
    corps,
    canal: null,
    envoye: false,
    faits: [`Type de document : ${dernier.type}.`, `Émis le ${jour(dernier.emisLe)}.`],
    informationManquante: [
      AUCUN_CANAL,
      "Le contenu du document n'est pas repris dans le message : il se lit au cabinet.",
    ],
    provenance: entree.documents.provenance,
  };
}
