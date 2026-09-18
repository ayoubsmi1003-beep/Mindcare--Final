/**
 * Le gestionnaire de conversation Jarvis — V-JARVIS-CORE.
 *
 * UN SEUL ÉTAT PARTAGÉ entre le panneau latéral et l'écran plein `/jarvis`.
 * Patron : `patient-actif.ts` — module-level store, pub/sub minimal, zéro
 * React dedans. Les deux surfaces s'abonnent ; naviguer de l'une à l'autre ne
 * peut ni perdre un fil en cours ni dupliquer l'état.
 *
 * ═══ CE QUI A CHANGÉ AVEC LA PERSISTANCE ═══
 * L'identifiant de conversation n'est plus fabriqué par le client
 * (`nouvelIdentifiantConversation`) : il vient de la PORTE
 * `start_jarvis_conversation`, qui pose la ligne RLS-protégée sans laquelle la
 * persistance serveur (`append_jarvis_turn`) échouerait en silence —
 * « introuvable ≡ hors périmètre » (ADR-003). Un UUID client-only créait des
 * conversations fantômes : visibles à l'écran, inexistantes en base.
 *
 * Chaque soumission porte un `clientTurnId` généré ICI (côté client, unique)
 * : la contrainte `UNIQUE(client_turn_id, role)` de 058 rend le double-clic
 * ou la resoumission après réseau instable inoffensive — le serveur refuse la
 * seconde ligne, jamais deux.
 */

import { fr } from "@/i18n/fr";

import { getSession } from "./auth";
import { db } from "./db";
import { logFieldsFor } from "./errors";
import { executerTour } from "./jarvis-boucle";
import { capaciteEcriture } from "./jarvis-ecritures";
import {
  adopterPatientActif,
  ancreApplicable,
  besoinDeClarification,
  cibleValide,
  definirCible,
  effacerCible,
  TTL_CONTEXTE_MS,
} from "./jarvis-contexte";
import { classerMultilingue } from "@/shared/jarvis/normalisation";
import type { NomIntention } from "@/shared/jarvis/intentions";
import type { PreuveConnnaissance } from "@/shared/jarvis/preuves";
import type { VerdictResolution } from "@/shared/jarvis/resolution-references";
import {
  activerCaptationLive,
  AnneauLive,
  captationLiveActivee,
  construireRecordApprobation,
  construireRecordLiveV2,
  empreinteAction,
  empreinteExecution,
  exporterAnneauV1,
  exporterAnneauV2,
  hacherFnv1a,
  type EntreeAppelLive,
  type EntreePreuveLive,
  type EntreeResolutionLive,
  type ExportLive,
  type ExportLiveV2,
  type LiveRunRecordV2,
} from "@/shared/jarvis/enregistrement-live";
import { effacerPatientActif } from "./patient-actif";
import { carte as carteIdentite } from "./jarvis-identite";
import {
  confirmerAction,
  estOutilConnu,
  estOutilEcriture,
  outilGetAgenda,
  outilSearchPatients,
  proposerAction,
  refuserAction,
  validerArguments,
  type CarteConfirmation,
  type ToolEcriture,
} from "./jarvis-tools";
import { executerEcritureConfirmee } from "./jarvis-execution";
import { garderPropos } from "./jarvis-garde-lecture";
import { log } from "./log";
import { err, ok, type Result } from "./result";
import type { AppError } from "./errors";
import type { PatientActif } from "./patient-actif";

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAT PUBLIC
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Machine d'état de la conversation — les cinq états affichables :
 *  · vide          rien encore (état vide composé par l'écran)
 *  · composition   saisie libre possible (le repos de cette machine)
 *  · envoi         message parti, aucun fragment reçu
 *  · flux          fragments en cours de réception (Stop disponible)
 *  · erreur        dernier tour terminé en échec nommé
 */
export type EtatConversation =
  | "vide"
  | "composition"
  | "envoi"
  | "flux"
  | "erreur";

export interface TourConversation {
  readonly id: string;
  readonly role: "humain" | "jarvis" | "systeme";
  readonly texte: string;
  /** Registre annoncé par la passerelle sur le chemin connaissance (ADR-023). */
  readonly registre?: "connaissance-generale";
  /**
   * M07 — preuves gouvernées du tour (chemin connaissance seul). Éphémères
   * (le carnet 058 ne les persiste pas) : elles décrivent la réponse
   * affichée, jamais un état à relire.
   */
  readonly preuves?: readonly PreuveConnnaissance[];
  /** La réponse a-t-elle été écrite en base ? false → mention visible. */
  readonly persiste?: boolean;
  /** Interrompu avant fin : ce qui est affiché est ce qui est arrivé. */
  readonly interrompu?: boolean;
  /**
   * ⚠️ LE TEXTE AFFICHÉ NOMME UN DOSSIER. Capturé au moment du RENDU, pas
   * deviné plus tard : une fois les jetons remplacés par les vrais noms, plus
   * rien dans la chaîne ne dit d'où ils viennent. C'est ce booléen qui décide,
   * dans `FilJarvis`, entre synthèse vocale EXTERNE et synthèse LOCALE — et
   * sans lui, le nom de la patiente partirait chez le fournisseur de voix.
   */
  readonly porteUneIdentite?: boolean;
}

export interface EtatConversationPublique {
  readonly etat: EtatConversation;
  readonly conversationId: string | null;
  readonly tours: readonly TourConversation[];
  readonly saisie: string;
  /** Carte de confirmation d'écriture en attente de décision. */
  readonly carteEcriture: CarteConfirmation | null;
  readonly erreur: AppError | null;
  /** true pendant le rechargement initial de l'historique. */
  readonly chargementHistorique: boolean;
}

type Abonne = (etat: EtatConversationPublique) => void;

// ═══════════════════════════════════════════════════════════════════════════
// ÉTAT INTERNE
// ═══════════════════════════════════════════════════════════════════════════

interface EtatInterne {
  etat: EtatConversation;
  conversationId: string | null;
  tours: TourConversation[];
  saisie: string;
  carteEcriture: CarteConfirmation | null;
  erreur: AppError | null;
  chargementHistorique: boolean;
}

const interne: EtatInterne = {
  etat: "vide",
  conversationId: null,
  tours: [],
  saisie: "",
  carteEcriture: null,
  erreur: null,
  chargementHistorique: false,
};

const abonnes = new Set<Abonne>();

function publier(): void {
  console.info("[conversation] publier", interne.etat, "abonnés:", abonnes.size);
  const publique: EtatConversationPublique = {
    etat: interne.etat,
    conversationId: interne.conversationId,
    tours: [...interne.tours],
    saisie: interne.saisie,
    carteEcriture: interne.carteEcriture,
    erreur: interne.erreur,
    chargementHistorique: interne.chargementHistorique,
  };
  for (const a of abonnes) a(publique);
}

/** Retourne la fonction de désabonnement (cleanup React). */
export function abonnerConversation(abonne: Abonne): () => void {
  abonnes.add(abonne);
  console.info("[conversation] abonnement, total:", abonnes.size);
  abonne({
    etat: interne.etat,
    conversationId: interne.conversationId,
    tours: [...interne.tours],
    saisie: interne.saisie,
    carteEcriture: interne.carteEcriture,
    erreur: interne.erreur,
    chargementHistorique: interne.chargementHistorique,
  });
  return () => {
    abonnes.delete(abonne);
  };
}

/**
 * UUID côté client — avec repli mesuré hors contexte sécurisé (voir
 * `PanneauJarvis.tsx` V1.5 : `crypto.randomUUID` manque sur l'adresse réseau
 * HTTP du cabinet ; `getRandomValues`, lui, existe toujours).
 * Sert au `clientTurnId` et aux identifiants de tours affichés.
 */
function nouvelIdentifiant(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const o = new Uint8Array(16);
  crypto.getRandomValues(o);
  o[6] = ((o[6] ?? 0) & 0x0f) | 0x40;
  o[8] = ((o[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(o, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONTEXTE D'OUTIL — identifiants du tour précédent (hérité du panneau V1.5)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⚠️ Ce contexte SORT vers le modèle sur le chemin patient : on n'y met QUE ce
 * qu'un outil réclame (id, nom, numéro). Réduction d'exposition, jamais une
 * frontière — la RLS décide de tout le reste sous le JWT.
 */
let contexteDossiers: readonly { readonly id: string; readonly nom: string; readonly numero: string }[] = [];
let contextePraticienId: string | null = null;

/** Le dossier ouvert à l'écran (Patients V3), joint comme cible pré-résolue. */
let patientActifCourant: PatientActif | null = null;

/**
 * ═══ L'ANCRE DE CONVERSATION ═══
 *
 * Ce qu'un tour a effectivement lu, retenu pour aider à comprendre le tour
 * SUIVANT. « Montre-moi le dossier de Karim Djilali » puis « et ses
 * traitements ? » : sans elle, le second tour ne sait de qui l'on parle et
 * demande. C'est une aide de compréhension, rien d'autre.
 *
 * ⚠️ CE N'EST JAMAIS UNE AUTORISATION, ET TROIS PROPRIÉTÉS L'EN EMPÊCHENT.
 *   1. Elle ne porte qu'un identifiant que le SERVEUR a déjà accepté de lire au
 *      tour précédent — la boucle ne la propose qu'après une exécution réussie.
 *   2. Elle se pose comme une CIBLE ordinaire, donc le tour suivant repasse par
 *      la carte d'identité, Zod, la porte SQL et la RLS. Elle n'injecte aucun
 *      identifiant dans une capacité et ne court-circuite rien.
 *   3. Tout ce qui est plus fort la couvre : l'écran, une cible encore valide,
 *      une désignation explicite, une ambiguïté. Elle ne sert que dans le
 *      silence des autres signaux.
 *
 * ⚠️ ELLE NE SE POSE QU'AU DÉBUT DU TOUR SUIVANT, JAMAIS À LA FIN DU TOUR QUI
 * LA PRODUIT. Poser une cible appelle `definirCible`, qui PURGE la carte
 * d'identité — c'est un invariant de sécurité, pas un détail. La purger à la
 * fin d'un tour reviendrait à démonter la carte pendant que le tour s'en sert
 * encore. Au début du tour suivant, en revanche, `executerTour` s'apprête de
 * toute façon à la réinitialiser (`jarvis-boucle.ts`, « la carte est neuve à
 * chaque tour ») : la purge y est sans effet observable.
 */
let ancreEnAttente: { readonly id: string; readonly libelle: string; readonly poseeA: number } | null =
  null;

/**
 * ═══ M09 slice 3 · ANNEAU LIVE — MÉMOIRE, JAMAIS PERSISTÉ ═══
 *
 * Les records PII-safe des tours (voir `shared/jarvis/enregistrement-live`)
 * s'accumulent ici, bornés, quand la captation est activée (OFF par défaut).
 * Lecture opérateur/debug via `exporterCaptationLive()` ; rien ne survit au
 * rechargement, rien ne part au réseau, rien ne touche aux portes.
 */
const anneauCaptation = new AnneauLive<LiveRunRecordV2>();

/** Exporte la captation live au contrat `m09-live-v1` (gelé, projection des v1). */
export function exporterCaptationLive(): ExportLive {
  return exporterAnneauV1(anneauCaptation);
}

/** Exporte la captation live au contrat `m09-live-v2` (v1 + approbations). */
export function exporterCaptationLiveV2(): ExportLiveV2 {
  return exporterAnneauV2(anneauCaptation);
}

/** Bascule explicite de la captation (tests + affordance future, défaut OFF). */
export { activerCaptationLive };

/** Remise à zéro de l'anneau (tests uniquement — jamais en production). */
export function reinitialiserCaptationLive(): void {
  anneauCaptation.vider();
}

/**
 * M09 slice 3 · capte UN tour vers l'anneau (appelée au seul site post-bilan).
 * OFF → rien (zéro coût observable) ; ON → record PII-safe. Testable sans
 * boucle : le `BilanTour` scripté suffit (jamais de DB, jamais de modèle).
 */
export function capterTour(
  bilan: {
    readonly runId: string;
    readonly chemin: string | null;
    readonly interrompu: boolean;
    readonly persiste: boolean;
    readonly appels: readonly EntreeAppelLive[];
    readonly preuves: readonly EntreePreuveLive[];
    readonly nbSnapshots: number;
    readonly propositionInconnue: { readonly nom: string } | null;
    readonly resolution: EntreeResolutionLive | null;
  },
  dureeMs: number,
): void {
  if (!captationLiveActivee()) return;
  // Enveloppe v2 (outilsFp dérivés de bilan.appels par le constructeur) ;
  // l'export v1 reste projeté sans recalcul (contrat gelé).
  anneauCaptation.pousser(
    construireRecordLiveV2(
      {
        runId: bilan.runId,
        chemin: bilan.chemin,
        interrompu: bilan.interrompu,
        persiste: bilan.persiste,
        dureeMs,
        appels: bilan.appels,
        preuves: bilan.preuves,
        nbSnapshots: bilan.nbSnapshots,
        propositionInconnue: bilan.propositionInconnue,
        resolution: bilan.resolution,
      },
      null,
    ),
  );
}

/**
 * M09 reliquat · capte UNE approbation vers l'anneau (geste humain +
 * constat M06). OFF → rien (zéro coût observable) ; ON → record v2 dont
 * le corps v1 est minimal (`chemin: inconnu`, sans appel ni preuve) et
 * dont `approbation` porte la liaison (actionFp, issue, runFp
 * opportuniste). Testable sans boucle ni base.
 */
export function capterApprobation(
  approbation: {
    readonly runFp: string | null;
    readonly actionFp: string;
    readonly issue: string;
    readonly executionFp?: string | null;
    readonly dureeMs: number;
  },
): void {
  if (!captationLiveActivee()) return;
  anneauCaptation.pousser(construireRecordApprobation(approbation));
}

/**
 * ═══ M02 · CONTEXTE DE TRAVAIL — MIROIR, JAMAIS AUTORITÉ ═══
 *
 * Ce que le tour précédent a retenu (intent prouvé par ses exécutions +
 * patient du verdict), pour chaîner un suivi nu (« Et avant ? »). Trois
 * propriétés l'empêchent de devenir une seconde identité :
 *   1. `patientId` est REVALIDÉ contre le fil vivant à chaque lecture
 *      (cible TTL-valide ou ancre applicable) — divergé = jeté, jamais
 *      deviné ;
 *   2. il ne sert qu'au CHAÎNAGE (choix d'un nom d'intent), jamais à
 *      désigner : la désignation reste cible/ancre/sonde ;
 *   3. même cycle de vie que l'ancre (mémoire module, purge session,
 *      TTL identique), jamais persisté — aucun `patient_id` nouveau en base.
 */
let travailEnCours: {
  readonly conversationId: string;
  readonly intentionPrecedente: NomIntention | null;
  readonly patientId: string | null;
  readonly patientLibelle: string | null;
  readonly poseA: number;
} | null = null;

/**
 * Lit le miroir s'il est utilisable pour chaîner : même conversation, frais,
 * avec un fil, et SURTOUT fil vivant identique au miroir. Tout écart rend
 * `null` — le tour suivant classifie frais ou clarifie.
 *
 * Exportée pour les tests d'isolement (l'isolement inter-conversations est
 * une propriété de SÉCURITÉ — elle s'éprouve, elle ne se relit pas).
 */
export function lireTravailValide(
  conversationId: string,
  maintenantMs: number = Date.now(),
): { readonly conversationId: string; readonly intentionPrecedente: NomIntention | null; readonly patientId: string } | null {
  const t = travailEnCours;
  if (t === null || t.conversationId !== conversationId) return null;
  if (t.patientId === null || maintenantMs - t.poseA >= TTL_CONTEXTE_MS) return null;
  const cible = cibleValide(maintenantMs);
  const filId =
    cible !== null
      ? cible.id
      : ancreEnAttente !== null &&
          ancreApplicable(ancreEnAttente, patientActifCourant !== null, maintenantMs)
        ? ancreEnAttente.id
        : null;
  if (filId === null || filId !== t.patientId) return null;
  return { conversationId: t.conversationId, intentionPrecedente: t.intentionPrecedente, patientId: t.patientId };
}

/**
 * Retient le legs d'un tour — ou l'oublie. Seul un verdict UNIQUE (avec
 * patient) pose un miroir ; tout le reste (ambigu, non résolu, aucun,
 * échec, interruption) EFFACE : après un tour qui n'a rien conclu, le
 * suivant ne chaîne sur rien.
 *
 * Exportée pour les tests (même raison que `lireTravailValide`).
 */
export function retenirTravail(
  conversationId: string,
  resolution:
    | { readonly verdict: VerdictResolution; readonly intentionRetenu: NomIntention | null }
    | undefined,
): void {
  const patient = resolution?.verdict.patient;
  if (patient === undefined) {
    travailEnCours = null;
    return;
  }
  travailEnCours = {
    conversationId,
    intentionPrecedente: resolution?.intentionRetenu ?? null,
    patientId: patient.id,
    patientLibelle: patient.libelle,
    poseA: Date.now(),
  };
}

/**
 * Les arguments VALIDÉS de la carte en attente. Mémorisés parce que la
 * VÉRIFICATION post-exécution en a besoin : sans eux, on saurait qu'une action
 * a eu lieu mais pas à quoi comparer son effet. Purgés en même temps que la
 * carte — une décision prise, ils n'ont plus aucune raison d'exister.
 */
let argumentsCarte: unknown = null;

/**
 * M09 reliquat · empreinte du tour proposant, mémorisée avec la carte.
 * Le `runId` brut ne franchit jamais la projection (même discipline que
 * `log.ts`) : seule voyage l'empreinte, identique au `empreinteRun` du
 * record du tour — la jointure est opportuniste, jamais une donnée.
 * Purgée en même temps que la carte.
 */
let empreinteRunCarte: string | null = null;

/**
 * Appelé par l'abonnement patient-actif des écrans qui montent Jarvis.
 *
 * ⚠️ LA CIBLE EST REMPLACÉE, JAMAIS ACCUMULÉE (§7.1). `adopterPatientActif`
 * rend `true` quand la cible a CHANGÉ ; dans ce cas la carte d'identité est
 * purgée et le contexte d'outil du patient précédent est jeté. Sans cela,
 * `PATIENT_001` continuerait de désigner Nadia pendant qu'on parle de Karim —
 * une erreur d'identité dans un dossier médical, produite par un cache.
 */
export function definirContextePatient(
  patient: PatientActif | null,
  maintenantMs: number = Date.now(),
): void {
  patientActifCourant = patient;
  const change = adopterPatientActif(patient, maintenantMs);
  if (change) {
    contexteDossiers = [];
    contextePraticienId = null;
  }
}

/**
 * Purge TOUT le contexte de la session — Phase 3.
 *
 * Appelée à la déconnexion et par [Changer] : cible, patient-actif et contexte
 * d'outil du tour précédent. Rien ne survit : ni en mémoire module, ni — il
 * n'y en a jamais eu — en base (les tours persistés ne portent aucun
 * `patient_id`, 058).
 */
export function purgerContexteSession(): void {
  patientActifCourant = null;
  // [Changer] et la déconnexion effacent AUSSI l'ancre. Quitter un patient et
  // continuer d'y répondre par pronom au tour suivant serait le contraire de
  // « quitter, c'est quitter ».
  ancreEnAttente = null;
  // M02 : le miroir part avec tout le reste — quitter, c'est quitter.
  travailEnCours = null;
  contexteDossiers = [];
  contextePraticienId = null;
  effacerCible();
  effacerPatientActif();
}

/**
 * [Changer] du bandeau de contexte : quitter explicitement le patient courant.
 * Même purge que la déconnexion — quitter, c'est quitter.
 */
export function quitterContexte(): void {
  purgerContexteSession();
}

// ═══════════════════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════════════════

export function changerSaisie(valeur: string): void {
  interne.saisie = valeur;
  if (interne.etat === "vide") interne.etat = "composition";
  else if (interne.etat === "composition" && valeur.trim() === "") interne.etat = "vide";
  publier();
}

/**
 * Assure qu'une conversation PERSISTANTE existe — par la porte, pas par un
 * UUID local. Idempotent : une seule ligne par session d'écran.
 */
async function assurerConversation(): Promise<Result<string>> {
  if (interne.conversationId !== null) return ok(interne.conversationId);

  const resultat = await db().rpc<string>("start_jarvis_conversation", {});
  if (!resultat.ok) {
    log.error("conversation.demarrage", logFieldsFor(resultat.error));
    return err(resultat.error);
  }
  const id = resultat.data[0];
  if (id === undefined || id === null || id === "") {
    // RLS a refusé sans lever — même traitement que proposerAction : pas de
    // succès rendu sur une conversation qui n'existe pas.
    log.error("conversation.demarrage", { code: "vide" });
    return err({ code: "interdit", message: fr.erreurs.interdit, context: "conversation:start" });
  }
  interne.conversationId = id;
  return ok(id);
}

/**
 * Recharge l'historique persistant (rechargement de page, retour sur /jarvis).
 * La clé de partition est la PORTE : RLS propriétaire-seul, bornée, ordonnée
 * par rang. Les propositions d'outils historiques NE SONT PAS rejouées —
 * exécuter un outil depuis un fil passé contournerait le contexte vivant ;
 * elles apparaissent comme mentions système.
 */
export async function chargerHistorique(): Promise<void> {
  if (interne.chargementHistorique || interne.conversationId === null) return;
  interne.chargementHistorique = true;
  publier();

  const resultat = await db().rpc<{
    conversationId: string;
    messages: readonly {
      id: string;
      rang: number;
      role: "humain" | "jarvis";
      contenu: string;
      outil: Record<string, unknown> | null;
      statut: "complet" | "interrompu";
      creeA: string;
    }[];
  }>("get_jarvis_history", { p_limit: 50 });

  interne.chargementHistorique = false;

  if (!resultat.ok) {
    log.error("conversation.historique", logFieldsFor(resultat.error));
    // L'historique manquant n'empêche pas de parler : erreur nommée, écran
    // utilisable — jamais un mur.
    interne.erreur = resultat.error;
    interne.etat = interne.tours.length === 0 ? "erreur" : "composition";
    publier();
    return;
  }

  const hist = resultat.data[0];
  // ⚠️ PAS de `Array.isArray(hist.messages)` ici : sur un tableau `readonly`,
  // cette garde rétrécit vers `any[]` et fait perdre tout le typage — quinze
  // erreurs eslint à la clé. Le contrat de la porte est typé ci-dessus ; la
  // valeur par défaut couvre le seul cas réel (réponse absente).
  const messages = hist?.messages ?? [];
  if (messages.length > 0) {
    const reconstruits: TourConversation[] = [];
    for (const m of messages) {
      reconstruits.push({
        id: m.id,
        role: m.role,
        texte: m.contenu,
        ...(m.statut === "interrompu" && { interrompu: true }),
      });
      if (m.outil !== null && typeof m.outil === "object" && typeof m.outil["nom"] === "string") {
        reconstruits.push({
          id: `${m.id}-outil`,
          role: "systeme",
          texte: `${fr.jarvis.historique.outil} ${String(m.outil["nom"])}`,
        });
      }
      if (m.role === "jarvis" && m.statut === "interrompu") {
        reconstruits.push({
          id: `${m.id}-coupure`,
          role: "systeme",
          texte: fr.jarvis.historique.interrompue,
        });
      }
    }
    interne.tours = reconstruits;
    interne.etat = reconstruits.length === 0 ? "vide" : "composition";
  }
  publier();
}

// ── Exécution des outils (transférée du panneau — même code, un seul home) ──

function ajouterTour(tour: Omit<TourConversation, "id">): TourConversation {
  const complet: TourConversation = { ...tour, id: nouvelIdentifiant() };
  interne.tours = [...interne.tours, complet];
  return complet;
}

function remplacerTour(id: string, patch: Partial<Omit<TourConversation, "id">>): void {
  interne.tours = interne.tours.map((t) => (t.id === id ? { ...t, ...patch } : t));
}

async function executerLecture(nom: string, args: unknown): Promise<void> {
  if (nom === "search_patients") {
    const valides = validerArguments("search_patients", args);
    if (!valides.ok) {
      ajouterTour({ role: "systeme", texte: valides.error.message });
      return;
    }

    const resultat = await outilSearchPatients(valides.data);
    if (!resultat.ok) {
      ajouterTour({ role: "systeme", texte: resultat.error.message });
      return;
    }

    const r = resultat.data;
    if (r.type === "aucun") {
      contexteDossiers = [];
      contextePraticienId = null;
      ajouterTour({ role: "jarvis", texte: fr.jarvis.aucunPatient });
      return;
    }

    const session = await getSession();
    contextePraticienId = session.ok && session.data !== null ? session.data.userId : null;
    const dossiers = r.type === "unique" ? [r.patient] : r.candidats;
    contexteDossiers = dossiers.map((p) => ({
      id: p.id,
      nom: `${p.lastName} ${p.firstName}`.trim(),
      numero: p.recordNumber,
    }));

    if (r.type === "unique") {
      ajouterTour({
        role: "jarvis",
        texte: `${r.patient.lastName} ${r.patient.firstName} — ${r.patient.recordNumber}`,
      });
      return;
    }
    ajouterTour({
      role: "jarvis",
      texte: `${fr.jarvis.plusieursPatients}\n${dossiers
        .map((c) => `· ${c.lastName} ${c.firstName} — ${c.recordNumber}`)
        .join("\n")}`,
    });
    return;
  }

  if (nom === "get_agenda") {
    const valides = validerArguments("get_agenda", args);
    if (!valides.ok) {
      ajouterTour({ role: "systeme", texte: valides.error.message });
      return;
    }
    const resultat = await outilGetAgenda(valides.data);
    if (!resultat.ok) {
      ajouterTour({ role: "systeme", texte: resultat.error.message });
      return;
    }
    const lignes = resultat.data;
    if (lignes.length === 0) {
      ajouterTour({ role: "jarvis", texte: fr.agenda.aucunVisible });
      return;
    }
    ajouterTour({
      role: "jarvis",
      texte: lignes
        .map((l) => {
          const nomPatient = l.lastName === null ? "—" : `${l.lastName} ${l.firstName ?? ""}`.trim();
          return `· ${new Date(l.startsAt).toLocaleString("fr-DZ")} — ${nomPatient}`;
        })
        .join("\n"),
    });
    return;
  }

  ajouterTour({ role: "systeme", texte: fr.jarvis.argumentsInvalides });
}

/**
 * ═══ LES ÉCRITURES DE 061 — précondition, carte, PUIS proposition ═══
 *
 * ⚠️ LA PRÉCONDITION S'EXÉCUTE AVANT DE POSER LA LIGNE `proposed`. Une carte
 * qui annonce un décalage vers un créneau déjà pris ferait cliquer l'humaine
 * sur un échec — elle porterait alors la responsabilité d'une décision qu'on
 * lui a mal présentée. Refuser AVANT la carte est plus honnête que d'échouer
 * après le clic.
 */
async function proposerEcritureRegistre(
  nom: string,
  args: unknown,
  demande: string,
  runId: string | null = null,
): Promise<boolean> {
  const capacite = capaciteEcriture(nom);
  if (capacite === null) return false;

  // Les jetons redeviennent des identifiants AVANT Zod — refus TOTAL si l'un
  // d'eux est inconnu, jamais une résolution partielle.
  const resolus = carteIdentite().resoudreArguments(args);
  if (resolus === null) {
    ajouterTour({ role: "systeme", texte: fr.jarvis.argumentsInvalides });
    return true;
  }

  const prepare = await capacite.preparer(resolus, carteIdentite());
  if (!prepare.ok) {
    ajouterTour({ role: "systeme", texte: prepare.error.message });
    return true;
  }

  const conversationId = await assurerConversation();
  if (!conversationId.ok) {
    ajouterTour({ role: "systeme", texte: conversationId.error.message });
    return true;
  }

  const propose = await proposerAction({
    conversationId: conversationId.data,
    demandeUtilisateur: demande,
    // La porte 033 n'accepte que les noms de son allowlist ; 063 l'a étendue.
    // Le cast traverse une frontière de nommage, pas une frontière de sécurité :
    // c'est la CONTRAINTE EN BASE qui refuse un nom non admis, pas ce type.
    outil: nom as ToolEcriture,
    args: prepare.data.args as never,
  });
  if (!propose.ok) {
    ajouterTour({ role: "systeme", texte: propose.error.message });
    return true;
  }

  interne.carteEcriture = {
    actionId: propose.data,
    outil: nom,
    titre: prepare.data.titre,
    champs: prepare.data.champs,
    critique: capacite.critique,
  };
  // Mémorisé pour la VÉRIFICATION post-exécution : sans les arguments, on ne
  // saurait pas quoi relire ni à quoi comparer.
  argumentsCarte = prepare.data.args;
  // M09 reliquat · liaison tour→approbation : l'empreinte seule (jamais le
  // runId brut), purgée avec la carte. `null` = carte sans tour d'origine.
  empreinteRunCarte = runId === null ? null : hacherFnv1a(`m09-live-v1:${runId}`);
  publier();
  return true;
}

async function proposerEcriture(
  nom: ToolEcriture,
  args: unknown,
  demande: string,
  runId: string | null = null,
): Promise<void> {
  const valides =
    nom === "create_appointment"
      ? validerArguments("create_appointment", args)
      : validerArguments("set_consultation_price", args);
  if (!valides.ok) {
    ajouterTour({ role: "systeme", texte: valides.error.message });
    return;
  }

  const conversationId = await assurerConversation();
  if (!conversationId.ok) {
    ajouterTour({ role: "systeme", texte: conversationId.error.message });
    return;
  }

  const propose = await proposerAction({
    conversationId: conversationId.data,
    demandeUtilisateur: demande,
    outil: nom,
    args: valides.data,
  });
  if (!propose.ok) {
    ajouterTour({ role: "systeme", texte: propose.error.message });
    return;
  }

  const champs = Object.entries(valides.data).map(([cle, valeur]) => ({
    libelle: cle,
    valeur: valeur === undefined || valeur === null ? "—" : String(valeur),
  }));
  interne.carteEcriture = {
    actionId: propose.data,
    outil: nom,
    titre:
      nom === "create_appointment" ? fr.jarvis.carte.creerRendezVous : fr.jarvis.carte.fixerTarif,
    champs,
  };
  // M09 reliquat · voir `proposerEcritureRegistre` (même liaison, même purge).
  empreinteRunCarte = runId === null ? null : hacherFnv1a(`m09-live-v1:${runId}`);
  publier();
}

/**
 * CONFIRMER → EXÉCUTER → **VÉRIFIER** → GARDER. La confirmation pose
 * `confirmed_at` dans son propre appel (l'ordre reste démontrable) ; puis le
 * chemin d'exécution partagé M06 (`jarvis-execution.ts`) exécute par
 * `actionId`, relit avec les arguments canoniques, et ne rend `ok` que si la
 * garde constate le succès prouvé — la même issue que le tableau de bord.
 *
 * ⚠️ LA VÉRIFICATION EST LE TEMPS QUE V-JARVIS-CORE N'AVAIT PAS, et son absence
 * était un mensonge en puissance. `executerAction` refuse déjà de lire un
 * retour `NULL` comme un succès — c'est nécessaire, ce n'est pas suffisant : la
 * porte peut rendre un identifiant (donc « quelque chose a été touché ») sans
 * que la ligne porte l'heure demandée. Annoncer « c'est fait » sur cette seule
 * base, c'est laisser la praticienne compter sur un rendez-vous déplacé qui ne
 * l'est pas.
 *
 * Quand la relecture ne confirme pas, on ne dit NI « c'est fait » NI « ça a
 * échoué » — les deux seraient faux. On dit ce qu'on sait : l'action a été
 * tentée, l'effet n'a pas pu être vérifié, allez voir à l'écran.
 */
export async function accepterCarte(): Promise<void> {
  const carte = interne.carteEcriture;
  if (carte === null) return;
  const debut = Date.now();
  const actionFp = empreinteAction(carte.actionId);
  const runFp = empreinteRunCarte;

  const confirmation = await confirmerAction(carte.actionId);
  if (!confirmation.ok) {
    // Porte de confirmation en refus : rien n'est exécuté ; le constat est
    // tracé comme bloqué (même honnêteté que M06, jamais « c'est fait »).
    capterApprobation({
      runFp,
      actionFp,
      issue: "bloquee",
      executionFp: null,
      dureeMs: Date.now() - debut,
    });
    ajouterTour({ role: "systeme", texte: confirmation.error.message });
    interne.carteEcriture = null;
    argumentsCarte = null;
    empreinteRunCarte = null;
    publier();
    return;
  }

  // Les arguments PRÉPARÉS qui viennent d'être sérialisés dans `tool_args` :
  // ils disent QUOI RELIRE, jamais quoi autoriser (l'exécution est pilotée
  // par `actionId` seul). `null` (carte historique) = invérifiable = l'issue
  // partagée le dit honnêtement au lieu d'annoncer « enregistré ».
  const args = argumentsCarte;
  const issue = await executerEcritureConfirmee({
    actionId: carte.actionId,
    outil: carte.outil,
    argsCanoniques: args,
  });
  // M09 reliquat · le constat vérifié rejoint l'anneau (liaison action +
  // issue + tour proposant), sans toucher au chemin d'exécution.
  capterApprobation({
    runFp,
    actionFp,
    issue: issue.issue,
    executionFp: empreinteExecution(actionFp, issue.issue),
    dureeMs: issue.dureeMs,
  });
  interne.carteEcriture = null;
  argumentsCarte = null;
  empreinteRunCarte = null;

  ajouterTour(
    issue.ok
      ? { role: "jarvis", texte: `${carte.titre} — ${fr.jarvis.ecriture.verifiee}` }
      : { role: "systeme", texte: issue.message },
  );
  publier();
}

/** Refuser est le défaut : aucune raison demandée. */
export async function refuserCarte(): Promise<void> {
  const carte = interne.carteEcriture;
  if (carte === null) return;
  const debut = Date.now();
  await refuserAction(carte.actionId);
  // Refus humain = terminal (NEG-1) : tracé comme bloqué, rien ne s'exécute
  // par un chemin détourné.
  capterApprobation({
    runFp: empreinteRunCarte,
    actionFp: empreinteAction(carte.actionId),
    issue: "bloquee",
    executionFp: null,
    dureeMs: Date.now() - debut,
  });
  interne.carteEcriture = null;
  argumentsCarte = null;
  empreinteRunCarte = null;
  ajouterTour({ role: "systeme", texte: fr.actions.annuler });
  publier();
}

// ── LE TOUR FLUX ──

let controleurEnCours: AbortController | null = null;

/**
 * Envoie un tour EN FLUX. Résout quand le tour est terminé (fin, interruption
 * ou erreur) ; les fragments arrivent dans l'état partagé au fil de l'eau.
 *
 * Idempotence : le `clientTurnId` est généré AVANT l'appel et transmis tel
 * quel — un rejeu réseau du POST ne peut produire qu'une seule ligne humain.
 */
export async function envoyer(messageBrut: string): Promise<void> {
  const message = messageBrut.trim();
  if (message === "" ) return;
  if (interne.etat === "envoi" || interne.etat === "flux") return;
  // Une carte en attente bloque la saisie : décider d'abord (L2).
  if (interne.carteEcriture !== null) return;

  interne.erreur = null;
  interne.saisie = "";
  ajouterTour({ role: "humain", texte: message });
  // ⚠️ LE REFUS PASSE DEVANT LA CLARIFICATION, ET C'EST UNE QUESTION D'AUDIT.
  //
  // Quatre formulations mesurées le 2026-09-07 sont À LA FOIS classées `refus`
  // par la frontière ADR-023 et reconnues comme référence pronominale :
  // « dois-je augmenter sa posologie ? », « faut-il arrêter son traitement ? »,
  // « nzidlo la dose? », « نزيدلو الدوز؟ ». Les deux premières sont du FRANÇAIS
  // et se comportaient déjà ainsi AVANT la passe multilingue — ce n'est pas une
  // régression de Slice 2, c'est un ordre qui n'avait jamais été tranché.
  //
  // Demander « de quel patient parlez-vous ? » à une question dont la réponse
  // est « non » quelle que soit la personne est doublement fautif : cela laisse
  // croire qu'un nom débloquerait la réponse, et cela INVITE la praticienne à
  // nommer quelqu'un sans nécessité. Surtout, la clarification est un échange
  // purement local : elle ne laisse AUCUNE trace, là où le refus est écrit dans
  // la conversation. L'ordre inverse effaçait donc l'audit précisément sur la
  // classe de demandes la plus sensible — une décision thérapeutique visant une
  // personne.
  //
  // Sauter la clarification ici n'ouvre rien : le chemin `refus` ne consulte
  // aucun contexte, n'appelle aucun outil, ne joint aucun modèle et rend une
  // constante. C'est le verdict le PLUS restrictif du treillis, pas une
  // dérogation.
  // ── L'ANCRE DE CONVERSATION, ÉVALUÉE AVANT LA CLARIFICATION ──
  //
  // Elle n'est utilisable que dans le SILENCE de tout ce qui la domine :
  //   · aucun dossier ouvert à l'écran        → l'écran gagne (rang 2) ;
  //   · aucune cible encore valide            → le fil en cours gagne ;
  //   · elle-même non périmée                 → expiré vaut absent, comme la
  //     cible, et pour la même raison : on ne parle plus du même patient un
  //     quart d'heure plus tard.
  //
  // On la LIT ici sans rien écrire. L'écriture n'a lieu que si le tour part
  // réellement — sinon une clarification refusée laisserait une cible posée
  // par un tour qui n'a jamais eu lieu.
  const ancre = ancreEnAttente;
  const ancreUtilisable = ancreApplicable(ancre, patientActifCourant !== null);

  if (
    !ancreUtilisable &&
    classerMultilingue(message).chemin !== "refus" &&
    besoinDeClarification(message)
  ) {
    // Phase 3 : pronom sans cible TTL-valide — on demande, on ne devine pas.
    // Zéro appel modèle, zéro écriture base : les deux tours restent locaux
    // (aucun `patient_id` n'est donc persisté, il n'y en a d'ailleurs jamais).
    ajouterTour({ role: "jarvis", texte: fr.jarvis.contexte.preciserPatient });
    interne.etat = "composition";
    publier();
    return;
  }

  // Le tour part : l'ancre devient une cible ordinaire. `definirCible` purge la
  // carte, ce qui est sans effet ici — `executerTour` la réinitialise dans sa
  // première instruction. Au-delà de cette ligne, l'ancre n'existe plus en tant
  // que telle : il n'y a qu'une cible, soumise aux mêmes règles que toutes les
  // autres, et le serveur reste seul juge de ce qu'il accepte de lire.
  if (ancreUtilisable && ancre !== null) {
    definirCible({
      id: ancre.id,
      libelle: ancre.libelle,
      // Le jeton ne porte pas le numéro de dossier. `assemblerAmorce` écarte
      // les entrées vides ; on ne fabrique pas un numéro pour combler un trou.
      numeroDossier: "",
      origine: "recherche",
    });
  }

  interne.etat = "envoi";
  publier();

  const demarrage = await assurerConversation();
  if (!demarrage.ok) {
    interne.erreur = demarrage.error;
    interne.etat = "erreur";
    publier();
    return;
  }

  const tourJarvis = ajouterTour({ role: "jarvis", texte: "" });

  const controleur = new AbortController();
  controleurEnCours = controleur;

  // M09 slice 3 · début du tour (durée live ; horodatage seul, jamais clinique).
  const debutTour = Date.now();
  const bilan = await executerTour(
    // M02 : le miroir revalidé (ou `null`) — la boucle chaîne ou ignore.
    { message, conversationId: demarrage.data, travail: lireTravailValide(demarrage.data) },
    {
      onChemin: () => {
        interne.etat = "flux";
        publier();
      },
      onDelta: (fragment) => {
        const courant = interne.tours.find((t) => t.id === tourJarvis.id);
        remplacerTour(tourJarvis.id, { texte: (courant?.texte ?? "") + fragment });
        publier();
      },
      // Mention d'étape pendant qu'une capacité tourne. L'écran ne doit jamais
      // rester muet pendant que Jarvis travaille (05-UX-CONTRACT).
      onCapacite: () => {
        interne.etat = "envoi";
        publier();
      },
    },
    controleur.signal,
  ).finally(() => {
    controleurEnCours = null;
  });

  if (!bilan.ok) {
    // Tour en échec (passerelle, réseau, interruption de transport) : rien n'a
    // été conclu, donc rien n'est ancré — et l'ancre précédente tombe.
    // M02 : le miroir tombe aussi — un échec ne lègue rien.
    retenirTravail(demarrage.data, undefined);
    ancreEnAttente = null;
    console.info("[conversation] tour erreur:", JSON.stringify({
      code: bilan.error.code,
      technical: bilan.error.technical,
      context: bilan.error.context,
    }));
    // Tour raté : la bulle jarvis vide disparaît, l'erreur parle.
    interne.tours = interne.tours.filter((t) => t.id !== tourJarvis.id);
    interne.erreur = bilan.error;
    interne.etat = "erreur";
    publier();
    return;
  }

  const r = bilan.data;

  // M09 slice 3 · couture live : le bilan PII-safe vers l'anneau, rien d'autre.
  // OFF par défaut (`captationLiveActivee`) ; la projection fermée vit dans
  // `shared/jarvis/enregistrement-live` (texte, ancre, args, snapshots,
  // conversationId/patientId : jamais lus, jamais rendus). Les tours en échec
  // (pas de `BilanTour`) ne laissent aucun record — même honnêteté que M06.
  if (captationLiveActivee()) {
    capterTour(
      {
        runId: r.runId,
        chemin: r.chemin,
        interrompu: r.interrompu,
        persiste: r.persiste,
        appels: r.appels,
        preuves: r.preuves,
        nbSnapshots: r.snapshots.length,
        propositionInconnue: r.propositionInconnue,
        resolution:
          r.resolution === undefined
            ? null
            : {
                etat: r.resolution.verdict.etat,
                intentionChainee: r.resolution.intentionChainee,
                intentionRetenu: r.resolution.intentionRetenu,
              },
      },
      Date.now() - debutTour,
    );
  }

  // M02 : le legs du tour (miroir revalidé au tour suivant, ou oubli).
  retenirTravail(demarrage.data, r.resolution);

  // ── L'ancre du tour suivant, posée AVANT tout retour anticipé ──
  //
  // ⚠️ REMPLACEMENT, JAMAIS ACCUMULATION — et `null` EST un remplacement.
  // Un tour ambigu, en échec, interrompu, en attente de confirmation, ou qui a
  // touché plusieurs dossiers rend `null` et EFFACE donc l'ancre précédente.
  // L'ancre ne vaut que pour le tour qui vient de se terminer : un tour qui n'a
  // rien conclu ne laisse pas survivre la conclusion d'un tour plus ancien.
  // Sans cela, une ambiguïté au tour 3 puis « et ses traitements ? » au tour 4
  // seraient silencieusement sauvés par l'ancre du tour 2 — exactement le
  // rattrapage que la porte d'ambiguïté existe pour empêcher.
  //
  // ⚠️ ET ELLE EST POSÉE ICI, PAS EN FIN DE FONCTION. Trois retours anticipés
  // suivent (proposition d'écriture, outil inconnu, arguments invalides) : une
  // affectation placée après eux aurait laissé l'ancre du tour PRÉCÉDENT
  // survivre à un tour qui ne l'a pas reconduite.
  ancreEnAttente =
    r.ancreCandidate === null
      ? null
      : { id: r.ancreCandidate.id, libelle: r.ancreCandidate.libelle, poseeA: Date.now() };

  /**
   * ⚠️ LE RENDU D'IDENTITÉ SE FAIT ICI, ET NULLE PART AILLEURS. Le modèle a
   * écrit `{{PATIENT_001}}` ; la carte — qui n'a jamais quitté le navigateur —
   * le remplace par « BELKACEM Nadia ». Un jeton inconnu devient un marqueur
   * visible, jamais un nom deviné : deviner ici, ce serait fabriquer une
   * identité.
   */
  const rendre = (texte: string): string => carteIdentite().rendre(texte);

  // ── Interruption : ce qui est reçu reste affiché, marqué honnêtement ──
  if (r.interrompu) {
    remplacerTour(tourJarvis.id, {
      texte: rendre(r.texte),
      interrompu: true,
      porteUneIdentite: carteIdentite().porteUneReference(r.texte),
    });
    if (r.texte === "") {
      interne.tours = interne.tours.filter((t) => t.id !== tourJarvis.id);
    }
    interne.etat = "composition";
    publier();
    return;
  }

  // ── Persistance refusée côté serveur : dit, jamais tu (règle 8 de UX) ──
  remplacerTour(tourJarvis.id, {
    texte: rendre(r.texte),
    ...(r.chemin === "connaissance" && { registre: "connaissance-generale" }),
    // M07 — preuves du `fin` canonique (validées par le transport) ; un tour
    // interrompu ou sans champ garde l'absence (jamais d'invention ici).
    ...(r.chemin === "connaissance" && r.preuves.length > 0 && { preuves: r.preuves }),
    persiste: r.persiste,
    porteUneIdentite: carteIdentite().porteUneReference(r.texte),
  });

  /**
   * ── Capacité hors du registre de LECTURE ──
   *
   * La boucle ne l'a pas exécutée et n'a aucun chemin pour le faire. Deux cas :
   *   · un outil d'ÉCRITURE du registre (sept, 063) → carte de confirmation (L2) ;
   *   · un nom inconnu → refus nommé, rien n'est modifié.
   *
   * ⚠️ AUCUNE ÉCRITURE NE S'EXÉCUTE ICI. `proposerEcriture` pose une ligne
   * `proposed` et affiche la carte ; c'est `accepterCarte` — donc un geste
   * humain — qui confirme puis exécute, en deux appels distincts. L'ordre est
   * la preuve, et il n'est pas négociable.
   */
  if (r.propositionInconnue !== null) {
    const { nom, args } = r.propositionInconnue;
    interne.etat = "composition";
    // M06 — garde de lecture : le tour se termine sur une écriture proposée,
    // donc RIEN n'est exécuté. Si le texte du modèle constatait un
    // accomplissement, il est remplacé par la phrase de proposition honnête
    // (jamais « c'est fait » sur du non-vérifié). Sans écriture proposée, le
    // texte est laissé intact (limite M08, voir `jarvis-garde-lecture.ts`).
    const garde = garderPropos({
      texte: rendre(r.texte),
      ecritureProposee: capaciteEcriture(nom) !== null,
    });
    if (garde.verdict === "REFORMULER") {
      log.warn("jarvis.garde.lecture", { code: garde.raison });
      remplacerTour(tourJarvis.id, { texte: fr.jarvis.ecriture.proposee });
    }
    publier();
    // 063 d'abord : les quatre écritures du registre, avec précondition et
    // vérification. Les deux outils historiques de 033 restent en repli.
    if (await proposerEcritureRegistre(nom, args, message, r.runId)) {
      publier();
      return;
    }
    if (estOutilConnu(nom) && estOutilEcriture(nom)) {
      await proposerEcriture(nom, args, message, r.runId);
      publier();
      return;
    }
    ajouterTour({ role: "systeme", texte: fr.jarvis.argumentsInvalides });
    publier();
    return;
  }

  interne.etat = "composition";
  publier();
}

/** Stop — l'utilisateur coupe le flux ; le serveur notera le tour interrompu. */
export function interrompre(): void {
  controleurEnCours?.abort();
}

/** Efface l'erreur affichée (l'état repasse au repos de la machine). */
export function effacerErreur(): void {
  interne.erreur = null;
  if (interne.etat === "erreur") interne.etat = interne.tours.length === 0 ? "vide" : "composition";
  publier();
}
