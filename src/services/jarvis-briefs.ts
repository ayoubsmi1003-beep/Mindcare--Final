/**
 * `jarvis-briefs.ts` — LES BRIEFS, COMPOSÉS EN TYPESCRIPT.
 *
 * ═══ LE MODÈLE MET EN LANGUE, IL NE PRODUIT AUCUN FAIT ═══
 * Chaque chiffre, chaque heure, chaque compte de ce fichier vient d'un
 * `SafeToolResult` typé. Le modèle reçoit une STRUCTURE déjà vraie et n'a plus
 * qu'à la formuler. C'est la seule façon de tenir §7.2 : « le modèle explique,
 * synthétise, formule ; il ne produit jamais une identité, une heure, un total,
 * une date, un compte ».
 *
 * Si l'on confiait la composition au modèle — « voici le dossier, fais un
 * brief » — il produirait un texte plausible dont AUCUN chiffre ne serait
 * vérifiable. Un chiffre plausible sur un écran médical est un mensonge, pas un
 * ornement (règle 8).
 *
 * ═══ LES QUATRE REGISTRES, ET POURQUOI ILS SONT SÉPARÉS ═══
 *
 *   FAITS                 issus des portes, vérifiables ligne à ligne
 *   OBSERVATIONS          DÉRIVÉES par calcul — marquées comme telles
 *   ATTENTION             des signaux, jamais un verdict (L4)
 *   INFORMATION MANQUANTE ce que MindCare ne sait pas, dit explicitement
 *
 * ⚠️ LE QUATRIÈME REGISTRE EST LE PLUS IMPORTANT, et c'est le moins évident.
 * MindCare n'a NI suivi d'observance, NI humeur, NI sommeil, NI check-ins :
 * aucune table de `01-SCHEMA.md` ne les porte. Une praticienne qui demande
 * « a-t-elle fait ses check-ins ? » doit s'entendre répondre que l'information
 * n'existe pas — pas recevoir une réponse inventée, et pas non plus un silence
 * qu'elle prendrait pour un « non ». Le registre rend cette absence EXPLICITE
 * et la fait remonter jusqu'au modèle.
 */

import type {
  SafePatientContext,
  SafeTimelineContext,
  SourceContexte,
} from "./jarvis-projections";
import type { RefPatient, RefRendezVous } from "./jarvis-identite";
import type { SafeAgendaContext, SafeFinanceContext } from "./jarvis-projections";

// ═══════════════════════════════════════════════════════════════════════════
// 1 · LE TYPE
// ═══════════════════════════════════════════════════════════════════════════

export type SujetBrief = "prochain_patient" | "matin" | "finance";

export interface SafeBrief {
  readonly sujet: SujetBrief;
  /** Le patient concerné, en RÉFÉRENCE — jamais un nom. */
  readonly patient?: RefPatient;
  readonly rendezVous?: RefRendezVous;
  readonly faits: readonly string[];
  readonly observations: readonly string[];
  readonly attention: readonly string[];
  readonly informationManquante: readonly string[];
  readonly provenance: readonly SourceContexte[];
}

/**
 * Ce que MindCare NE SAIT PAS, énuméré une fois et réutilisé.
 *
 * ⚠️ CETTE LISTE EST UN CONSTAT DU SCHÉMA, PAS UNE OPINION. Vérifié dans
 * `01-SCHEMA.md` : aucune table `aftercare`, `check_ins`, `mood`, `sleep`,
 * `adherence`, ni aucun service correspondant dans `src/services/`. Le jour où
 * une migration en ajoute une, cette constante doit rétrécir — et le test qui
 * l'accompagne deviendra rouge, ce qui est exactement l'alerte voulue.
 */
export const DOMAINES_ABSENTS = [
  "Le suivi entre les séances (check-ins, humeur, sommeil, observance) n'existe pas dans MindCare : aucune donnée de ce type n'est enregistrée.",
] as const;

/** L'historique de prescription est un RÉSUMÉ, pas un historique complet. */
const RESERVE_TRAITEMENT =
  "Seule la dernière prescription est consultable : l'historique complet des traitements n'est pas exposé par l'application.";

// ═══════════════════════════════════════════════════════════════════════════
// 2 · OUTILLAGE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * L'heure d'un instant, en calendrier du cabinet et sur 24 heures.
 *
 * ⚠️ `hourCycle: "h23"` EXPLICITE — même défaut que sur la carte de
 * confirmation, et il a été trouvé par exécution : selon la base ICU, `fr-DZ`
 * rend « 3:00 PM ». Dans un brief lu à voix haute avant une consultation,
 * « 3 heures » pour 15 h fait manquer un rendez-vous.
 */
function heure(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    timeZone: "Africa/Algiers",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function joursDepuis(iso: string, maintenant: number): number {
  return Math.floor((maintenant - Date.parse(iso)) / 86_400_000);
}

/** Dinars entiers, séparateur d'espace insécable. Aucun centime (ADR-018). */
function dzd(montant: number): string {
  return `${montant.toLocaleString("fr-FR").replace(/ | /g, " ")} DA`;
}

// ═══════════════════════════════════════════════════════════════════════════
// 3 · LE BRIEF « PROCHAIN PATIENT »
// ═══════════════════════════════════════════════════════════════════════════

/**
 * §8 du plan, les étapes 7 à 10 : la structure sûre à partir de laquelle le
 * modèle formulera. Les étapes 1 à 6 (heure, agenda, patient, contexte,
 * projection, pare-feu) ont déjà eu lieu — c'est ce qui arrive ici en argument.
 *
 * ⚠️ AUCUNE CONCLUSION CLINIQUE. Les entrées d'ATTENTION sont des CONSTATS
 * chiffrés (« le score a augmenté de 6 points ») ou des états administratifs
 * (« la dernière note n'est pas signée »). Jamais « le patient va moins bien » —
 * ce jugement appartient à la praticienne (L4, ADR-023).
 */
export function composerBriefProchainPatient(entree: {
  readonly agenda: SafeAgendaContext;
  readonly patient: SafePatientContext | null;
  readonly timeline: SafeTimelineContext | null;
  readonly maintenant?: number;
}): SafeBrief {
  const maintenant = entree.maintenant ?? Date.now();
  const faits: string[] = [];
  const observations: string[] = [];
  const attention: string[] = [];
  const manquant: string[] = [...DOMAINES_ABSENTS];
  const provenance = [...entree.agenda.provenance];

  const creneau = entree.agenda.creneaux[0];
  if (creneau === undefined) {
    return {
      sujet: "prochain_patient",
      faits: ["Aucun rendez-vous à venir aujourd'hui."],
      observations: [],
      attention: [],
      informationManquante: [],
      provenance,
    };
  }

  faits.push(`Prochain rendez-vous à ${heure(creneau.debut)}, ${creneau.dureeMinutes} minutes.`);
  if (creneau.type !== null) faits.push(`Type de séance : ${creneau.type}.`);
  if (creneau.arriveA !== null) {
    faits.push(`Le patient est arrivé à ${heure(creneau.arriveA)}.`);
  }

  const p = entree.patient;
  if (p !== null) {
    provenance.push(...p.provenance);
    if (p.age !== null) faits.push(`Âge : ${p.age} ans.`);

    if (p.clinique === null) {
      // `null` = domaine HORS DROIT, pas domaine vide. La nuance décide de ce
      // que Jarvis a le droit de dire, et confondre les deux ferait annoncer
      // « aucun diagnostic » à qui n'a simplement pas accès au dossier clinique.
      manquant.push("Le dossier clinique n'est pas accessible avec vos droits sur cet écran.");
    } else {
      faits.push(`${p.clinique.nombreConsultations} consultation(s) au dossier.`);

      const actifs = p.clinique.diagnostics.filter((d) => d.resoluLe === null);
      if (actifs.length > 0) {
        faits.push(
          `Diagnostic(s) en cours : ${actifs.map((d) => d.libelle).join(", ")}.`,
        );
      }

      const derniere = p.clinique.derniereConsultation;
      if (derniere !== null) {
        const jours = joursDepuis(derniere.le, maintenant);
        faits.push(`Dernière consultation il y a ${jours} jour(s).`);
        // OBSERVATION : dérivée d'un calcul, marquée comme telle.
        if (jours > 90) {
          observations.push(
            `L'intervalle depuis la dernière séance dépasse trois mois (${jours} jours).`,
          );
        }
      }

      for (const e of p.clinique.echelles) {
        if (e.score === null) continue;
        faits.push(`${e.code} : ${e.score} (le ${e.le.slice(0, 10)}).`);
        if (e.delta !== null && e.delta !== 0) {
          const sens = e.delta > 0 ? "hausse" : "baisse";
          observations.push(
            `${e.code} en ${sens} de ${Math.abs(e.delta)} point(s) depuis la mesure précédente.`,
          );
          // ⚠️ CONSTAT CHIFFRÉ, PAS INTERPRÉTATION. On ne dit pas « aggravation » :
          // le sens clinique d'une hausse dépend de l'échelle, et le trancher
          // ici serait une conclusion sur une personne (ADR-023).
          if (e.delta > 0) {
            attention.push(`Le score ${e.code} a augmenté de ${e.delta} point(s).`);
          }
        }
      }
    }

    if (p.traitements === null) {
      manquant.push("Les traitements ne sont pas accessibles avec vos droits.");
    } else {
      if (p.traitements.lignes.length > 0) {
        faits.push(
          `Traitement en cours : ${p.traitements.lignes
            .map((l) =>
              [l.designation, l.dose, l.frequenceParJour === null ? null : `${l.frequenceParJour}/j`]
                .filter((x): x is string => x !== null && x !== "")
                .join(" "),
            )
            .join(" · ")}.`,
        );
      } else {
        faits.push("Aucune ligne de traitement dans la dernière prescription.");
      }
      if (p.traitements.historiqueIncomplet) manquant.push(RESERVE_TRAITEMENT);
    }
  }

  const t = entree.timeline;
  if (t !== null) {
    provenance.push(...t.provenance);
    const notesNonSignees = t.evenements.filter((e) => e.genre === "consultation_close").length -
      t.evenements.filter((e) => e.genre === "note_signee").length;
    if (notesNonSignees > 0) {
      attention.push(`${notesNonSignees} consultation(s) close(s) sans note signée.`);
    }
    if (t.provenance.some((s) => s.tronque)) {
      manquant.push("L'historique affiché est partiel : il reste des événements plus anciens.");
    }
  }

  return {
    sujet: "prochain_patient",
    ...(creneau.patient === undefined ? {} : { patient: creneau.patient }),
    rendezVous: creneau.ref,
    faits,
    observations,
    attention,
    informationManquante: manquant,
    provenance,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 4 · LE BRIEF DU MATIN
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Concis et OPÉRATIONNEL, pas un essai. La praticienne l'écoute en ouvrant son
 * cabinet : ce qui n'aide pas à démarrer la journée n'a rien à y faire.
 */
export function composerBriefMatinal(entree: {
  readonly agenda: SafeAgendaContext;
  readonly finance: SafeFinanceContext | null;
  readonly enAttente: number;
}): SafeBrief {
  const faits: string[] = [];
  const observations: string[] = [];
  const attention: string[] = [];
  const provenance = [...entree.agenda.provenance];

  // Les créneaux annulés ne comptent pas dans « la journée » : les inclure
  // annoncerait une charge que la praticienne n'aura pas.
  const actifs = entree.agenda.creneaux.filter(
    (c) => c.statut !== "cancelled" && c.statut !== "no_show",
  );
  faits.push(`${actifs.length} consultation(s) prévue(s) aujourd'hui.`);

  const premier = actifs[0];
  const dernier = actifs[actifs.length - 1];
  if (premier !== undefined) faits.push(`Première à ${heure(premier.debut)}.`);
  if (dernier !== undefined && dernier !== premier) {
    faits.push(`Dernière à ${heure(dernier.debut)}.`);
  }

  if (entree.enAttente > 0) {
    faits.push(`${entree.enAttente} patient(s) en salle d'attente.`);
  }

  if (entree.finance !== null) {
    provenance.push(...entree.finance.provenance);
    // ⚠️ « ENCAISSÉ » ET « EN ATTENTE » RESTENT DEUX CHIFFRES. Les additionner
    // ferait annoncer une recette qui n'est pas dans la caisse.
    faits.push(`Encaissé aujourd'hui : ${dzd(entree.finance.encaisseDzd)}.`);
    if (entree.finance.enAttenteNombre > 0) {
      attention.push(
        `${entree.finance.enAttenteNombre} paiement(s) en attente, ${dzd(entree.finance.enAttenteDzd)}.`,
      );
    }
  }

  const annules = entree.agenda.creneaux.length - actifs.length;
  if (annules > 0) {
    observations.push(`${annules} créneau(x) annulé(s) ou non honoré(s) aujourd'hui.`);
  }

  return {
    sujet: "matin",
    faits,
    observations,
    attention,
    informationManquante: [],
    provenance,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 5 · LE BRIEF FINANCE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ FACTURÉ ≠ ENCAISSÉ, ET LE BRIEF NE LES FUSIONNE JAMAIS. La base distingue
 * les deux par `collected_at` ; l'écran écrit « encaissé » et dit vrai. Un
 * brief qui répondrait « vous avez fait 40 000 DA » alors que 15 000 ne sont
 * pas rentrés serait faux sur de l'argent — et faux d'une façon que la
 * praticienne ne pourrait pas détecter à l'oreille.
 */
export function composerBriefFinance(entree: {
  readonly finance: SafeFinanceContext;
  readonly impayesAnciensJours?: number | undefined;
}): SafeBrief {
  const f = entree.finance;
  const faits: string[] = [
    `Période : du ${f.periode.du} au ${f.periode.au}.`,
    `Encaissé : ${dzd(f.encaisseDzd)}.`,
    `${f.seances} séance(s) sur la période.`,
  ];
  const observations: string[] = [];
  const attention: string[] = [];

  if (f.enAttenteNombre > 0) {
    faits.push(`En attente d'encaissement : ${dzd(f.enAttenteDzd)} sur ${f.enAttenteNombre} séance(s).`);
    attention.push(`${f.enAttenteNombre} paiement(s) restent à encaisser.`);
  } else {
    faits.push("Aucun paiement en attente sur la période.");
  }

  if (f.chargesDzd !== null) faits.push(`Charges : ${dzd(f.chargesDzd)}.`);
  if (f.resultatNetDzd !== null) faits.push(`Résultat net : ${dzd(f.resultatNetDzd)}.`);

  if (f.seances > 0) {
    // Panier moyen sur l'ENCAISSÉ : c'est ce qui est réellement rentré.
    observations.push(
      `Encaissement moyen par séance : ${dzd(Math.round(f.encaisseDzd / f.seances))}.`,
    );
  }

  if (entree.impayesAnciensJours !== undefined && entree.impayesAnciensJours > 30) {
    attention.push(`Le plus ancien impayé date de ${entree.impayesAnciensJours} jours.`);
  }

  return {
    sujet: "finance",
    faits,
    observations,
    attention,
    // Le périmètre financier est décidé par la RLS (ADR-005) : le dire évite
    // qu'un chiffre de praticienne soit lu comme un chiffre de cabinet.
    informationManquante:
      f.perimetre === "praticienne"
        ? ["Ces chiffres couvrent votre seule activité, pas l'ensemble du cabinet."]
        : [],
    provenance: f.provenance,
  };
}
