/**
 * `jarvis-assembleur.ts` - L'ASSEMBLEUR DE CONTEXTE (M03).
 *
 * === CE QUE CE FICHIER FAIT, ET CE QU'IL NE FAIT PAS ===
 * Il assemble, pour UN appel modele d'un tour, la contribution de contexte
 * M03 : le bloc de portee (scope) + les resultats d'outils ventiles en
 * sections explicites, bornes semantiquement, mesures - et le cliche
 * (`ContextSnapshot`) qui atteste EXACTEMENT cette contribution.
 *
 * Il ne resout personne (M02), ne requiert rien (ni base, ni reseau, ni
 * modele), n'autorise rien (les portes restent Zod + RLS + confirmation),
 * ne reclasse rien (aucun score de pertinence, aucun reranker - M07),
 * ne touche pas a l'egress (M05) ni aux run records (M09).
 *
 * === LE CLICHE ATTESTE LA CONTRIBUTION M03, PAS LE PROMPT FINAL ===
 * La charge qui part vers le modele recoit encore, cote passerelle,
 * `PROMPT_PATIENT`, le bloc d'intention, la date, le contexte Tier0
 * historique, les enveloppes et le message (`route.ts`, chemin patient).
 * Aucun hachage calcule ici ne peut donc pretendre couvrir le prompt
 * complet - et il ne le pretend pas. L'invariant garanti est :
 *
 *     snapshot.contributionHash === hash(jsonCanonique(returned.contribution))
 *
 * recalcule sur l'objet EXACTEMENT retourne, jamais reconstruit.
 *
 * === SECTIONS DIFFERENTES DES CAPACITES ===
 * Les sections (`NomSection`) sont un vocabulaire de TACHE : l'intention
 * validee dit quelles sections sont requises, et les capacites FOURNISSENT
 * des donnees que des projecteurs EXPLICITES, un par capacite, decoupent en
 * sections. Un fournisseur qui rend quatre domaines (ex. `get_patient_context`)
 * ne fait jamais voyager que les sections requises - jamais le DTO entier
 * sous pretexte qu'il est eligible. La table capacite->sections est
 * informative et controlee ; la PROJECTION par section est normative.
 *
 * === TRONCATURE SEMANTIQUE UNIQUEMENT ===
 * Un item clinique (evenement de chronologie, seance SOAP entiere, ligne de
 * traitement, creneau, ligne financiere, document) voyage entier ou ne voyage
 * pas. Les victimes sont TOUJOURS des fins de listes (l'ordre fournisseur,
 * deterministe, met le plus pertinent en tete - chronologie et seances :
 * plus recent d'abord), les resultats les plus anciens d'abord, le resultat
 * le plus recent (porteur de la reponse) jamais omis, la portee jamais
 * tronquee. Aucun nouvel ordre de pertinence clinique n'est invente ici.
 *
 * === POURQUOI CE FICHIER VIT DANS `services/` ET NON DANS `shared/` ===
 * L'assembleur consomme les DTO `Safe*` et `BUDGETS`, qui vivent dans
 * `services/` ; les couches ESLint interdisent a `shared/` d'importer
 * `services/`. Dupliquer les formes des DTO dans `shared/` creerait deux
 * verites sur "ce qui peut voyager" - exactement la derive que la liste
 * blanche des projections existe pour empecher. Zero E/S malgre
 * l'emplacement : fonctions pures, testables hors ligne comme la resolution
 * M02 (le harnais d'eval compile deja ce repertoire).
 *
 * NOTE D'ENCODAGE : ce fichier est volontairement ASCII-only (francais sans
 * accents), a l'image des harnais `scripts/eval-jarvis-*.mjs`.
 */

import type { NomIntention } from "@/shared/jarvis/intentions";
import type { VerdictResolution } from "@/shared/jarvis/resolution-references";
import { BUDGETS, type FaitsTemporels } from "./jarvis-contexte";
import type { RefPatient } from "./jarvis-identite";
import type { ValeurSafe } from "./jarvis-capacites";
import { mesurerOctets, type SafeToolResult } from "./jarvis-projections";

// ===========================================================================
// 1 - LE VOCABULAIRE FERME - sept sections, pas une de plus sans decision
// ===========================================================================

/**
 * Le vocabulaire de tache de M03. Ferme : ajouter une section exige une
 * decision humaine (condition d'arret M03 n.4). Chaque section porte des
 * items entiers d'un seul domaine ; `scope` porte les faits d'appel
 * (temporels, cible, drapeaux systeme) - jamais de donnees patient
 * au-dela de la reference jeton.
 */
export type NomSection =
  | "scope"
  | "patient"
  | "seances"
  | "traitements"
  | "agenda"
  | "finance"
  | "documents";

/** Ordre deterministe d'ecriture des sections (JSON stable -> hachage stable). */
const ORDRE_SECTIONS: readonly NomSection[] = [
  "patient",
  "seances",
  "traitements",
  "agenda",
  "finance",
  "documents",
  "scope",
];

// ===========================================================================
// 2 - LA PORTEE - union discriminee, l'invalide est irrepresentable
// ===========================================================================

/** D'ou vient une portee resolue - le vocabulaire M02 (`SourceFil` + explicite). */
export type SourcePortee = "explicite" | "ecran" | "conversation" | "ancre";

/**
 * LA PORTEE M03. `resolu` porte une reference JETON (`PATIENT_001`), jamais
 * un UUID, jamais un `CiblePatient`, jamais un `TravailPrecedent`. Les quatre
 * autres etats N'ONT PAS de champ patient : `ambigu + patient` ne compile
 * pas - ce n'est pas une discipline d'ecriture, c'est le type.
 */
export type ScopeAssemblage =
  | { readonly etat: "resolu"; readonly patientRef: RefPatient; readonly source: SourcePortee }
  | { readonly etat: "ambigu" | "nonResolu" | "aucun" | "expire" };

/**
 * Porte le verdict M02 et l'amorce vers `ScopeAssemblage`. Pur.
 *
 * Regles (tout ecart fail-safe vers l'absence de reference) :
 *   - ambiguite constatee en cours de tour, ou verdict `ambigu` -> `ambigu` ;
 *   - verdict `nonResolu` (M02-I1 : mention non resolue, bloquant) -> `nonResolu` ;
 *   - verdict `unique` + jeton d'amorce + identifiant concordant -> `resolu` ;
 *   - verdict `aucun` (dont M02 coupe) + jeton d'amorce -> `resolu`, source
 *     derivee de l'origine d'ecran (repli comportement historique) ;
 *   - sinon : `expire` si la cible a expire, `aucun`.
 *
 * `patientRef` vient de l'amorce (frappee par `assemblerAmorce`, qui tient
 * la liste de masquage) - cette fonction ne frappe rien, ne resout rien.
 */
export function porterScopeAssemblage(entree: {
  readonly verdict: VerdictResolution;
  readonly patientRef: RefPatient | null;
  readonly cibleId: string | null;
  readonly cibleOrigine: "ecran" | "recherche" | "agenda" | "consultation" | null;
  readonly ambiguiteConstatee: boolean;
  readonly expire: boolean;
}): ScopeAssemblage {
  if (entree.ambiguiteConstatee || entree.verdict.etat === "ambigu") {
    return { etat: "ambigu" };
  }
  if (entree.verdict.etat === "nonResolu") {
    return { etat: "nonResolu" };
  }
  if (entree.verdict.etat === "unique" && entree.verdict.patient !== undefined) {
    if (
      entree.patientRef !== null &&
      entree.cibleId !== null &&
      entree.cibleId === entree.verdict.patient.id
    ) {
      // `source` est toujours pose sur `unique` par construction M02 ; le
      // repli `?? "conversation"` ne sert qu'au type (jamais observe).
      return { etat: "resolu", patientRef: entree.patientRef, source: entree.verdict.source ?? "conversation" };
    }
    // Fil prouve mais jeton divergent ou absent : on ne devine pas.
    return { etat: "aucun" };
  }
  // Verdict `aucun` (tour sans mention, ou M02 coupe) : l'amorce - cible
  // TTL-valide posee hors verdict (ecran, ancre promue) - reste l'autorite,
  // comme avant M03. Sans jeton : expire vaut signale, sinon absence.
  if (entree.patientRef !== null) {
    const source: SourcePortee =
      entree.cibleOrigine === "ecran" ? "ecran" : "explicite";
    return { etat: "resolu", patientRef: entree.patientRef, source };
  }
  return { etat: entree.expire ? "expire" : "aucun" };
}

// ===========================================================================
// 3 - INTENTION -> SECTIONS REQUISES - la tache dit quoi, jamais comment
// ===========================================================================

/**
 * LA TABLE NORMATIVE M03. Chaque intention validee liste les sections que sa
 * tache exige. Les capacites ne figurent PAS ici : elles fournissent, via
 * les projecteurs du paragraphe 4, et ne decident de rien.
 *
 * `scope` est requis partout : les faits temporels et la cible ne sont pas
 * une option, ce sont le cadre de toute reponse.
 */
export const SECTIONS_REQUISES: Readonly<Record<NomIntention, readonly NomSection[]>> = {
  SEARCH_PATIENT: ["scope", "patient"],
  GET_PATIENT_CONTEXT: ["scope", "patient"],
  GET_PATIENT_TIMELINE: ["scope", "seances"],
  GET_CONSULTATION_HISTORY: ["scope", "seances"],
  GET_CURRENT_MEDICATIONS: ["scope", "traitements"],
  GET_PATIENT_DOCUMENTS: ["scope", "documents"],
  GET_PATIENT_FINANCIAL_SUMMARY: ["scope", "finance"],
  GET_CONSULTATION: ["scope", "seances"],
  GET_NEXT_PATIENT: ["scope", "agenda"],
  GET_TODAY_AGENDA: ["scope", "agenda"],
  GET_AGENDA_RANGE: ["scope", "agenda"],
  GET_WAITING_ROOM: ["scope", "agenda"],
  GET_APPOINTMENT_DETAIL: ["scope", "agenda"],
  GET_DAY_REVENUE: ["scope", "finance"],
  GET_PERIOD_REVENUE: ["scope", "finance"],
  GET_OUTSTANDING_PAYMENTS: ["scope", "finance"],
  GET_NOTIFICATIONS: ["scope"],
  GET_SYSTEM_STATUS: ["scope"],
  BRIEF_MATINAL: ["scope", "agenda", "finance"],
  BRIEF_PROCHAIN_PATIENT: ["scope", "patient", "seances", "traitements", "agenda"],
  BRIEF_FINANCE: ["scope", "finance"],
  DRAFT_MESSAGE: ["scope", "patient", "agenda", "documents"],
  CREATE_APPOINTMENT: ["scope", "patient", "agenda"],
  RESCHEDULE_APPOINTMENT: ["scope", "patient", "agenda"],
  CANCEL_APPOINTMENT: ["scope", "patient", "agenda"],
  MARK_PATIENT_ARRIVED: ["scope", "patient", "agenda"],
  RECORD_PAYMENT_COLLECTED: ["scope", "patient", "finance"],
  SET_CONSULTATION_PRICE: ["scope", "patient", "finance"],
  CREATE_DOCUMENT_DRAFT: ["scope", "patient", "documents"],
  GENERAL_KNOWLEDGE: ["scope"],
  ASK_CLARIFICATION: ["scope"],
  UNKNOWN: ["scope"],
};

/** Toutes les sections, dans l'ordre canonique - le repli intention inconnue. */
const TOUTES_SECTIONS: readonly NomSection[] = ORDRE_SECTIONS;

// ===========================================================================
// 4 - VENTILATION - un projecteur explicite par capacite, jamais de passage
// ===========================================================================

/**
 * Une piece de contribution : le contenu EXPLICITEMENT projete pour UNE
 * section, plus les chemins de ses files tronquables (tableaux d'items
 * entiers, vides par la FIN en cas de pression budgetaire, dans l'ordre).
 * `files` vide = piece atomique (jamais decoupee).
 */
interface PieceTravail {
  readonly section: NomSection;
  readonly contenu: Record<string, unknown>;
  /** Chemins a un ou deux niveaux vers des `unknown[]` tronquables par la fin. */
  readonly files: ReadonlyArray<readonly [string] | readonly [string, string]>;
  tronque: boolean;
}

function estObjet(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Clone profond d'un DTO JSON-pur (chaines, nombres, booleens, null, listes, objets). */
function clonerDonnees<T>(valeur: T): T {
  return structuredClone(valeur);
}

/** Copie les cles presentes - jamais de transformation, jamais d'invention. */
function choisir(
  source: Record<string, unknown>,
  cles: readonly string[],
): Record<string, unknown> {
  const sortie: Record<string, unknown> = {};
  for (const cle of cles) {
    if (cle in source) sortie[cle] = source[cle];
  }
  return sortie;
}

/**
 * LE REGISTRE DES PROJECTEURS. Un par capacite du registre de lecture, qui
 * declare CE QUI VOYAGE pour chaque section - et rien d'autre. Toute
 * capacite reelle absente d'ici est une erreur de programmation detectee
 * par test (`CAPACITES_VENTILEES` ci-dessous) ; toute capacite inconnue
 * (faux de test) tombe sur le repli atomique documente.
 */
function ventilerResultat(
  capacite: string,
  donnees: unknown,
): Array<{ readonly section: NomSection; readonly piece: PieceTravail }> {
  const morceaux: Array<{ readonly section: NomSection; readonly piece: PieceTravail }> = [];
  const emettre = (
    section: NomSection,
    contenu: Record<string, unknown>,
    files: PieceTravail["files"] = [],
  ): void => {
    // Clone profond : les tableaux tronquables sont coupes par `pop()` et la
    // contribution est gelee en sortie - sans clone, l'assembleur muterait ou
    // gelerait les `SafeToolResult` de l'appelant. Les DTO sont JSON purs
    // (ils sont serialises tels quels vers le transport), le clone est sur.
    morceaux.push({
      section,
      piece: { section, contenu: clonerDonnees(contenu), files, tronque: false },
    });
  };
  if (!estObjet(donnees)) return morceaux;
  const prov = (o: Record<string, unknown>): Record<string, unknown> =>
    choisir(o, ["provenance"]);

  switch (capacite) {
    // -- Le cas d'ecole du garde-fou n.2 : UNE porte, QUATRE domaines.
    // Seule la section demandee voyage ; les autres restent au sol.
    case "get_patient_context": {
      if ("clinique" in donnees || "age" in donnees || "sexe" in donnees || "actif" in donnees) {
        emettre("patient", {
          ...choisir(donnees, ["ref", "age", "sexe", "actif", "clinique"]),
          ...prov(donnees),
        });
      }
      if ("traitements" in donnees) {
        emettre("traitements", {
          ...choisir(donnees, ["ref", "traitements"]),
          ...prov(donnees),
        });
      }
      if ("agenda" in donnees) {
        emettre("agenda", {
          ...choisir(donnees, ["ref", "agenda"]),
          ...prov(donnees),
        });
      }
      if ("documents" in donnees) {
        emettre("documents", {
          ...choisir(donnees, ["ref", "documents"]),
          ...prov(donnees),
        });
      }
      return morceaux;
    }
    case "get_patient_timeline": {
      emettre(
        "seances",
        { ...choisir(donnees, ["patient", "evenements"]), ...prov(donnees) },
        [["evenements"]],
      );
      return morceaux;
    }
    case "get_consultation_history": {
      emettre(
        "seances",
        {
          ...choisir(donnees, ["patient", "seances"]),
          ...("tronque" in donnees ? { tronqueAmont: donnees["tronque"] } : {}),
          ...prov(donnees),
        },
        [["seances"]],
      );
      return morceaux;
    }
    case "get_consultation": {
      // Une consultation seule, normalisee en liste d'UNE seance : le meme
      // traitement par la fin s'applique uniformement (la vider = l'omettre).
      emettre(
        "seances",
        {
          ...("patient" in donnees ? choisir(donnees, ["patient"]) : {}),
          seances: [donnees],
          ...prov(donnees),
        },
        [["seances"]],
      );
      return morceaux;
    }
    case "get_current_medications": {
      // L'en-cours est protege (repondre "que prend-il ?" l'exige) ;
      // seuls les arretes recents sont eligibles a la coupe, par la fin.
      emettre(
        "traitements",
        { ...choisir(donnees, ["patient", "enCours", "historique"]), ...prov(donnees) },
        [["historique", "arretesRecents"]],
      );
      return morceaux;
    }
    case "get_today_agenda":
    case "get_agenda_range":
    case "get_next_patient":
    case "get_appointment":
    case "get_waiting_room": {
      // L'ordre fournisseur est l'ordre d'affichage (chronologique / arrivee) :
      // la coupe par la fin garde le plus proche / le plus ancien arrive.
      emettre(
        "agenda",
        { ...choisir(donnees, ["creneaux"]), ...prov(donnees) },
        [["creneaux"]],
      );
      return morceaux;
    }
    case "get_day_revenue":
    case "get_period_revenue": {
      // Agregats calcules localement, atomiques : les scinder serait inventer
      // une comptabilite partielle. Ils sont petits par construction.
      emettre("finance", { ...donnees });
      return morceaux;
    }
    case "get_outstanding_payments": {
      emettre(
        "finance",
        { ...choisir(donnees, ["totalDzd", "enAttente"]) },
        [["enAttente"]],
      );
      return morceaux;
    }
    case "get_patient_financial_summary": {
      // Totaux atomiques + lignes de seances (plus recentes d'abord, la
      // finance-patient se construit sur la chronologie) coupees par la fin.
      emettre(
        "finance",
        {
          ...choisir(donnees, [
            "patient",
            "totalEncaisseDzd",
            "totalEnAttenteDzd",
            "nombreEnAttente",
            "sansTarifNombre",
            "complet",
            "seances",
          ]),
          ...prov(donnees),
        },
        [["seances"]],
      );
      return morceaux;
    }
    case "get_patient_documents": {
      emettre(
        "documents",
        { ...choisir(donnees, ["documents"]), ...prov(donnees) },
        [["documents"]],
      );
      return morceaux;
    }
    case "search_patients": {
      // References jetons + comptage - atomique, minuscule, et c'est la
      // matiere de la clarification : la couper serait empecher "lequel ?".
      emettre("patient", { ...choisir(donnees, ["resultats", "total", "ambigu"]) });
      return morceaux;
    }
    case "get_notifications":
    case "get_system_status": {
      // Zero donnee patient, zero chiffre financier (contrats des capacites) :
      // metadonnees d'appel, portees par la section `scope`, atomiques.
      emettre("scope", { ...donnees });
      return morceaux;
    }
    case "brief_matinal":
    case "brief_prochain_patient":
    case "brief_finance": {
      // Composes de phrases deja vraies : les scinder par domaine serait
      // inventer une pertinence. Section determinee par le SUJET declare.
      const sujet = donnees["sujet"];
      const section: NomSection =
        sujet === "matin" ? "agenda" : sujet === "finance" ? "finance" : "patient";
      emettre(section, { ...donnees });
      return morceaux;
    }
    case "draft_patient_message": {
      if ("refus" in donnees) {
        // Refus nomme, sans donnee : metadonnee d'appel, section `scope`.
        emettre("scope", { ...choisir(donnees, ["refus"]) });
        return morceaux;
      }
      // Brouillon : corps unique, insecable. Section par MOTIF declare.
      const type = donnees["type"];
      const section: NomSection = type === "document_pret" ? "documents" : "agenda";
      emettre(section, { ...donnees });
      return morceaux;
    }
    default: {
      // REPLI - capacites inconnues (faux de test uniquement : le registre
      // reel est ferme et couvert par le test de completude). Traite par
      // l'appelant en piece atomique entiere, mesuree et bornee.
      return morceaux;
    }
  }
}

/**
 * Les 22 capacites de lecture du registre, TOUTES ventilees ci-dessus.
 * Le test de completude exige cette liste close : ajouter une capacite sans
 * son projecteur fait rougir le test - l'omission echoue du bon cote.
 */
export const CAPACITES_VENTILEES: ReadonlySet<string> = new Set([
  "search_patients",
  "get_patient_context",
  "get_patient_timeline",
  "get_patient_documents",
  "get_next_patient",
  "get_today_agenda",
  "get_agenda_range",
  "get_appointment",
  "get_waiting_room",
  "get_consultation",
  "get_day_revenue",
  "get_period_revenue",
  "get_outstanding_payments",
  "get_notifications",
  "get_system_status",
  "get_current_medications",
  "get_consultation_history",
  "get_patient_financial_summary",
  "brief_prochain_patient",
  "brief_matinal",
  "brief_finance",
  "draft_patient_message",
]);

// ===========================================================================
// 5 - LE CLICHE - metadonnees PII-safe sur la contribution exacte
// ===========================================================================

/** Ce qu'une section portee a coute - des comptes, jamais du contenu. */
export interface ResumeSection {
  /** La capacite d'origine : metadonnee de controle, jamais une donnee. */
  readonly capacite: string;
  readonly section: NomSection;
  readonly octets: number;
  /** Items cliniques entiers portes (lignes de listes, ou 1 si atomique). */
  readonly items: number;
  /** Des items ont-ils ete coupes par la fin sous pression budgetaire ? */
  readonly tronque: boolean;
}

/**
 * LE CLICHE M03. Attestation de ce que l'assembleur a fourni a UN appel
 * modele : identifiants de correlation, intention, portee, sections portees
 * (comptes et tailles), compteurs d'exclusion, budget applique, hachage de
 * la contribution exacte. AUCUN contenu clinique, AUCUNE identite, AUCUN
 * montant, AUCUN texte libre - le test de confidentialite le scanne.
 */
export interface ContextSnapshot {
  /** Un tour logique Jarvis - genere cote client, opaque, jamais une identite. */
  readonly runId: string;
  readonly conversationId: string;
  /** Cet appel passerelle precis. */
  readonly clientTurnId: string;
  /** Iteration ReAct-lite dans le tour (0-based ; l'appel final = dernier). */
  readonly tourIndex: number;
  /** Intention validee connue du client (chainee M02), ou `null` = repli. */
  readonly intention: NomIntention | null;
  readonly scope: ScopeAssemblage;
  readonly sectionsRequises: readonly NomSection[];
  readonly sections: readonly ResumeSection[];
  /** Succes d'une portee perimee, ecartes (compte seul, aucun contenu). */
  readonly resultatsEcartesPortee: number;
  /** Resultats entiers omis sous pression budgetaire (le plus recent jamais). */
  readonly resultatsOmisBudget: number;
  /** Pieces hors sections requises, restees au sol (compte seul). */
  readonly piecesOmisesNonRequises: number;
  readonly octetsContribution: number;
  /** Le budget total applique - `BUDGETS.MAX_OCTETS_CONTEXTE`, rien d'autre. */
  readonly budgetOctetsTotal: number;
  /** `hash(jsonCanonique(contribution))` - paragraphe 1, jamais un mecanisme de privacy. */
  readonly contributionHash: string;
  /** `true` = pathologique (atomiques seuls > budget) : porte quand meme + signale. */
  readonly depassementBudget: boolean;
}

// ===========================================================================
// 6 - LA CONTRIBUTION - ce qui voyage, et sa forme transportee
// ===========================================================================

/**
 * Le bloc de portee transporte. Volontairement amorce-compatible
 * (`temps`, `patientCible?`, `consultationOuverte`, `octets`) : les harnais
 * existants lisent `contexte.temps.aujourdHui`, et cette compatibilite est
 * un contrat, pas un hasard.
 */
export interface BlocScopeTransporte {
  readonly temps: FaitsTemporels;
  readonly patientCible?: RefPatient;
  readonly consultationOuverte: boolean;
  readonly octets: number;
}

/**
 * Un resultat d'outil sectionne. Enveloppe preservee (le modele doit voir
 * les echecs) ; `donnees: null` preserve tel quel pour les echecs.
 */
export interface ResultatSectionne {
  readonly capacite: string;
  readonly ok: boolean;
  readonly donnees: { readonly sections: Partial<Record<NomSection, Record<string, unknown>>> } | null;
  readonly motifEchec?: string;
  readonly champsAttendus?: string;
}

export interface ContributionAssemblee {
  readonly contexte: BlocScopeTransporte;
  readonly resultats: readonly ResultatSectionne[];
}

/** LE RETOUR ATOMIQUE (garde-fou n.1) : contribution ET cliche du meme geste. */
export interface Assemblage {
  readonly contribution: ContributionAssemblee;
  readonly snapshot: ContextSnapshot;
}

/** Un resultat horodate de sa portee : la boucle tamponne a l'execution. */
export interface ResultatEpoque {
  readonly resultat: SafeToolResult<ValeurSafe>;
  readonly epoque: number;
}

export interface EntreeAssemblage {
  readonly runId: string;
  readonly conversationId: string;
  readonly clientTurnId: string;
  readonly tourIndex: number;
  readonly intention: NomIntention | null;
  readonly scope: ScopeAssemblage;
  readonly amorce: {
    readonly temps: FaitsTemporels;
    readonly patientCible?: RefPatient;
    readonly consultationOuverte: boolean;
  };
  readonly resultats: readonly ResultatEpoque[];
  readonly epoqueCourante: number;
}

// ===========================================================================
// 7 - OUTILLAGE DETERMINISTE - canonique, hachage, gel
// ===========================================================================

/** JSON a cles triees, recursif - la forme hachee et la forme mesuree. */
export function jsonCanonique(valeur: unknown): string {
  if (Array.isArray(valeur)) {
    return `[${valeur.map((v) => jsonCanonique(v)).join(",")}]`;
  }
  if (estObjet(valeur)) {
    const cles = Object.keys(valeur).sort();
    return `{${cles.map((c) => `${JSON.stringify(c)}:${jsonCanonique(valeur[c])}`).join(",")}}`;
  }
  return JSON.stringify(valeur) ?? "null";
}

/**
 * FNV-1a 32 bits, hexadecimal. Synchrone, deterministe, hors ligne.
 * Ce n'est PAS un mecanisme de confidentialite : c'est une cheville de
 * correspondance cliche-contribution, rien de plus.
 */
export function hacherContribution(canonique: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < canonique.length; i++) {
    h ^= canonique.charCodeAt(i) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Gel profond : la contribution retournee ne mute plus apres assemblage. */
function gelerProfond(valeur: unknown): void {
  if (Array.isArray(valeur)) {
    for (const v of valeur) gelerProfond(v);
    Object.freeze(valeur);
    return;
  }
  if (estObjet(valeur)) {
    for (const v of Object.values(valeur)) gelerProfond(v);
    Object.freeze(valeur);
  }
}

// ===========================================================================
// 8 - L'ASSEMBLAGE
// ===========================================================================

/** octets d'une piece de travail, forme transportee. */
function octetsPiece(piece: PieceTravail): number {
  return mesurerOctets(piece.contenu);
}

function itemsPiece(piece: PieceTravail): number {
  let total = 0;
  let liste = false;
  for (const chemin of piece.files) {
    const tableau = lireFile(piece.contenu, chemin);
    if (tableau !== null) {
      liste = true;
      total += tableau.length;
    }
  }
  // Atomique (aucune file) = 1 item porte ; liste vide = 0.
  if (!liste) return Object.keys(piece.contenu).length === 0 ? 0 : 1;
  return total;
}

function lireFile(
  contenu: Record<string, unknown>,
  chemin: readonly [string] | readonly [string, string],
): readonly unknown[] | null {
  const premier = contenu[chemin[0]];
  if (chemin.length === 1) return Array.isArray(premier) ? premier : null;
  const secondCle = chemin[1];
  if (secondCle === undefined) return null;
  if (!estObjet(premier)) return null;
  const second = premier[secondCle];
  return Array.isArray(second) ? second : null;
}

/** Retire UN item en fin de la premiere file non vide (ordre victime). */
function couperUneFile(piece: PieceTravail): boolean {
  for (const chemin of piece.files) {
    const premierCle = chemin[0];
    if (premierCle === undefined) continue;
    if (chemin.length === 1) {
      const tableau = contenuTableau(piece.contenu, premierCle);
      if (tableau !== null && tableau.length > 0) {
        tableau.pop();
        piece.tronque = true;
        return true;
      }
      continue;
    }
    const secondCle = chemin[1];
    if (secondCle === undefined) continue;
    const parent = piece.contenu[premierCle];
    if (!estObjet(parent)) continue;
    const tableau = contenuTableau(parent, secondCle);
    if (tableau !== null && tableau.length > 0) {
      tableau.pop();
      piece.tronque = true;
      return true;
    }
  }
  return false;
}

function contenuTableau(
  holder: Record<string, unknown>,
  cle: string,
): unknown[] | null {
  const v = holder[cle];
  return Array.isArray(v) ? (v as unknown[]) : null;
}

interface LigneResultat {
  readonly capacite: string;
  readonly ok: boolean;
  readonly motifEchec?: string;
  readonly champsAttendus?: string;
  readonly pieces: PieceTravail[];
  readonly estNouveauSucces: boolean;
}

interface FormeLigneMesure {
  readonly capacite: string;
  readonly ok: boolean;
  readonly pieces: readonly PieceTravail[];
}

/** Taille de la forme transportee - la mesure qui fait foi pour le budget. */
function tailleContribution(
  contexteBrut: { temps: FaitsTemporels; patientCible?: RefPatient; consultationOuverte: boolean },
  lignes: ReadonlyArray<FormeLigneMesure>,
  omises: ReadonlySet<LigneResultat>,
): number {
  const resultats = lignes
    .filter((l) => !omises.has(l as LigneResultat))
    .map((l) => {
      if (!l.ok) return { capacite: l.capacite, ok: l.ok, donnees: null };
      const sections: Partial<Record<NomSection, Record<string, unknown>>> = {};
      for (const section of ORDRE_SECTIONS) {
        const morceaux = l.pieces.filter((p) => p.section === section);
        for (const m of morceaux) sections[section] = m.contenu;
      }
      return { capacite: l.capacite, ok: l.ok, donnees: { sections } };
    });
  const contexte = { ...contexteBrut, octets: mesurerOctets(contexteBrut) };
  return mesurerOctets({ contexte, resultats });
}

/**
 * L'ASSEMBLAGE. Pur : memes entrees -> memes octets de sortie.
 *
 * 1. Portee -> bloc transporte (reference jeton ou absence).
 * 2. Resultats : garde de portee (epoque - mission paragraphe 6 : les succes
 *    d'une portee perimee ne survivent pas ; les echecs, sans donnee, et les
 *    recherches ambigues, matiere de clarification, survivent).
 * 3. Ventilation en sections explicites, filtree aux sections requises
 *    (`intention: null` = repli comportement historique : tout ce qui est
 *    ventile voyage - l'intention est constante par tour, donc ce repli ne
 *    peut jamais masquer un resultat deja observe dans le meme tour).
 * 4. Budget total : coupes par la fin, resultats les plus anciens d'abord,
 *    le plus recent succes jamais omis, la portee jamais tronquee.
 * 5. Cliche calcule sur la contribution EXACTE retournee + gel profond.
 */
export function assembler(entree: EntreeAssemblage): Assemblage {
  const budgetTotal = BUDGETS.MAX_OCTETS_CONTEXTE;
  const requises: ReadonlySet<NomSection> = new Set(
    entree.intention === null ? TOUTES_SECTIONS : (SECTIONS_REQUISES[entree.intention] ?? TOUTES_SECTIONS),
  );

  // -- 1 - Le bloc de portee --
  const contexteBrut: {
    temps: FaitsTemporels;
    patientCible?: RefPatient;
    consultationOuverte: boolean;
  } =
    entree.scope.etat === "resolu"
      ? {
          temps: entree.amorce.temps,
          patientCible: entree.scope.patientRef,
          consultationOuverte: entree.amorce.consultationOuverte,
        }
      : {
          temps: entree.amorce.temps,
          consultationOuverte: entree.amorce.consultationOuverte,
        };

  // -- 2+3 - Ventiler les resultats gardes --
  const lignes: LigneResultat[] = [];
  let resultatsEcartesPortee = 0;
  let piecesOmisesNonRequises = 0;

  const gardes = entree.resultats.filter(({ resultat, epoque }) => {
    if (epoque === entree.epoqueCourante) return true;
    if (!resultat.ok) return true; // echec : sans donnee, le modele en a besoin.
    const donnees = resultat.donnees;
    // Recherche ambigue d'une portee perimee : matiere de clarification.
    if (estObjet(donnees) && donnees["ambigu"] === true) return true;
    resultatsEcartesPortee += 1;
    return false;
  });
  let dernierSuccesGarde: (typeof gardes)[number] | null = null;
  for (let i = gardes.length - 1; i >= 0; i--) {
    const g = gardes[i];
    if (g !== undefined && g.resultat.ok) {
      dernierSuccesGarde = g;
      break;
    }
  }

  for (const { resultat } of gardes) {
    if (!resultat.ok || resultat.donnees === null) {
      lignes.push({
        capacite: resultat.capacite,
        ok: resultat.ok,
        ...(resultat.motifEchec === undefined ? {} : { motifEchec: resultat.motifEchec }),
        ...(resultat.champsAttendus === undefined ? {} : { champsAttendus: resultat.champsAttendus }),
        pieces: [],
        estNouveauSucces: false,
      });
      continue;
    }
    const estNouveauSucces = dernierSuccesGarde !== null && resultat === dernierSuccesGarde.resultat;
    const ventilees = ventilerResultat(resultat.capacite, resultat.donnees);
    const pieces: PieceTravail[] = [];
    if (ventilees.length === 0 && CAPACITES_VENTILEES.has(resultat.capacite) === false) {
      // Repli capacites inconnues (faux de test) : donnees portees entieres,
      // UN item atomique, section = premiere requise sinon `scope` - trace.
      const sectionRepli: NomSection =
        entree.intention === null
          ? "scope"
          : ((SECTIONS_REQUISES[entree.intention] ?? TOUTES_SECTIONS).find((s) => s !== "scope") ?? "scope");
      pieces.push({
        section: sectionRepli,
        contenu: clonerDonnees(
          estObjet(resultat.donnees) ? { ...resultat.donnees } : { valeur: resultat.donnees },
        ),
        files: [],
        tronque: false,
      });
    } else {
      for (const { section, piece } of ventilees) {
        if (!requises.has(section)) {
          piecesOmisesNonRequises += 1;
          continue;
        }
        pieces.push(piece);
      }
    }
    lignes.push({
      capacite: resultat.capacite,
      ok: true,
      ...(resultat.motifEchec === undefined ? {} : { motifEchec: resultat.motifEchec }),
      pieces,
      estNouveauSucces,
    });
  }

  // -- 4 - Budget total : coupes par la fin, anciens resultats d'abord --
  // Victimes d'omission : succes non-nouveaux encore portes, plus anciens
  // d'abord. Les echecs (enveloppes seules, ~100 octets) ne sont jamais des
  // victimes : le modele en a besoin pour ne pas re-proposer.
  const omises = new Set<LigneResultat>();
  let resultatsOmisBudget = 0;
  const victimesOmission = (): LigneResultat[] =>
    lignes.filter((l) => l.ok && !l.estNouveauSucces && !omises.has(l));
  const toutesFiles = (): PieceTravail[] => {
    const ordre: PieceTravail[] = [];
    for (const l of lignes) {
      if (!l.ok || omises.has(l)) continue;
      // Anciens d'abord : les lignes sont en ordre de tour et le nouveau
      // succes est en dernier - ses files ne sont touchees qu'en dernier.
      if (l.estNouveauSucces) continue;
      ordre.push(...l.pieces);
    }
    for (const l of lignes) {
      if (l.ok && l.estNouveauSucces && !omises.has(l)) ordre.push(...l.pieces);
    }
    return ordre;
  };

  let depassementBudget = false;
  for (;;) {
    if (tailleContribution(contexteBrut, lignes, omises) <= budgetTotal) break;
    // 4a - couper une fin de file, anciens resultats d'abord.
    let coupe = false;
    for (const piece of toutesFiles()) {
      if (piece.files.length === 0) continue;
      if (couperUneFile(piece)) {
        coupe = true;
        break;
      }
    }
    if (coupe) continue;
    // 4b - omettre un resultat entier, le plus ancien non-nouveau d'abord.
    const victime = victimesOmission()[0];
    if (victime === undefined) {
      depassementBudget = true; // atomiques seuls > budget : pathologique, porte + signale.
      break;
    }
    omises.add(victime);
    resultatsOmisBudget += 1;
  }

  // -- 5 - Forme transportee --
  const resultatsTransportes: ResultatSectionne[] = [];
  for (const l of lignes) {
    if (omises.has(l)) continue;
    if (!l.ok) {
      resultatsTransportes.push({
        capacite: l.capacite,
        ok: false,
        donnees: null,
        ...(l.motifEchec === undefined ? {} : { motifEchec: l.motifEchec }),
        ...(l.champsAttendus === undefined ? {} : { champsAttendus: l.champsAttendus }),
      });
      continue;
    }
    const sections: Partial<Record<NomSection, Record<string, unknown>>> = {};
    for (const section of ORDRE_SECTIONS) {
      const morceaux = l.pieces.filter((p) => p.section === section);
      if (morceaux.length === 0) continue;
      // Une piece par (resultat, section) en pratique ; en cas de doublon
      // (jamais en production - un projecteur par capacite), la derniere
      // ecrite gagne, determinisme preserve par l'ordre d'emission.
      for (const m of morceaux) sections[section] = m.contenu;
    }
    resultatsTransportes.push({
      capacite: l.capacite,
      ok: true,
      donnees: { sections },
      ...(l.motifEchec === undefined ? {} : { motifEchec: l.motifEchec }),
    });
  }

  const contexteFin = { ...contexteBrut, octets: 0 };
  const contributionBrute: ContributionAssemblee = {
    contexte: { ...contexteFin, octets: mesurerOctets(contexteFin) },
    resultats: resultatsTransportes,
  };

  // -- 6 - Cliche sur la contribution EXACTE + gel --
  const sectionsResume: ResumeSection[] = [];
  for (const l of lignes) {
    if (omises.has(l)) continue;
    for (const p of l.pieces) {
      sectionsResume.push({
        capacite: l.capacite,
        section: p.section,
        octets: octetsPiece(p),
        items: itemsPiece(p),
        tronque: p.tronque,
      });
    }
  }
  const octetsContribution = mesurerOctets({
    contexte: contributionBrute.contexte,
    resultats: contributionBrute.resultats,
  });
  const snapshotBrut: ContextSnapshot = {
    runId: entree.runId,
    conversationId: entree.conversationId,
    clientTurnId: entree.clientTurnId,
    tourIndex: entree.tourIndex,
    intention: entree.intention,
    scope: entree.scope,
    sectionsRequises:
      entree.intention === null ? [...TOUTES_SECTIONS] : [...(SECTIONS_REQUISES[entree.intention] ?? TOUTES_SECTIONS)],
    sections: sectionsResume,
    resultatsEcartesPortee,
    resultatsOmisBudget,
    piecesOmisesNonRequises,
    octetsContribution,
    budgetOctetsTotal: budgetTotal,
    contributionHash: hacherContribution(
      jsonCanonique({ contexte: contributionBrute.contexte, resultats: contributionBrute.resultats }),
    ),
    depassementBudget,
  };

  gelerProfond(contributionBrute);
  gelerProfond(snapshotBrut);
  return { contribution: contributionBrute, snapshot: snapshotBrut };
}
