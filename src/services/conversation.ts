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
import { adopterPatientActif } from "./jarvis-contexte";
import { carte as carteIdentite } from "./jarvis-identite";
import {
  confirmerAction,
  estOutilConnu,
  estOutilEcriture,
  executerAction,
  outilGetAgenda,
  outilSearchPatients,
  proposerAction,
  refuserAction,
  validerArguments,
  type CarteConfirmation,
  type ToolEcriture,
} from "./jarvis-tools";
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
 * Les arguments VALIDÉS de la carte en attente. Mémorisés parce que la
 * VÉRIFICATION post-exécution en a besoin : sans eux, on saurait qu'une action
 * a eu lieu mais pas à quoi comparer son effet. Purgés en même temps que la
 * carte — une décision prise, ils n'ont plus aucune raison d'exister.
 */
let argumentsCarte: unknown = null;

/**
 * Appelé par l'abonnement patient-actif des écrans qui montent Jarvis.
 *
 * ⚠️ LA CIBLE EST REMPLACÉE, JAMAIS ACCUMULÉE (§7.1). `adopterPatientActif`
 * rend `true` quand la cible a CHANGÉ ; dans ce cas la carte d'identité est
 * purgée et le contexte d'outil du patient précédent est jeté. Sans cela,
 * `PATIENT_001` continuerait de désigner Nadia pendant qu'on parle de Karim —
 * une erreur d'identité dans un dossier médical, produite par un cache.
 */
export function definirContextePatient(patient: PatientActif | null): void {
  patientActifCourant = patient;
  const change = adopterPatientActif(patient);
  if (change) {
    contexteDossiers = [];
    contextePraticienId = null;
  }
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
  publier();
  return true;
}

async function proposerEcriture(
  nom: ToolEcriture,
  args: unknown,
  demande: string,
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
  publier();
}

/**
 * CONFIRMER → EXÉCUTER → **VÉRIFIER**. Trois temps, trois appels distincts.
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

  const confirmation = await confirmerAction(carte.actionId);
  if (!confirmation.ok) {
    ajouterTour({ role: "systeme", texte: confirmation.error.message });
    interne.carteEcriture = null;
    argumentsCarte = null;
    publier();
    return;
  }

  const execution = await executerAction(carte.actionId);
  const args = argumentsCarte;
  interne.carteEcriture = null;
  argumentsCarte = null;

  if (!execution.ok) {
    ajouterTour({ role: "systeme", texte: execution.error.message });
    publier();
    return;
  }

  // ── LE TROISIÈME TEMPS ──
  const capacite = capaciteEcriture(carte.outil);

  // ⚠️ UNE CAPACITÉ QUI EXIGE UNE RELECTURE ET DONT LES ARGUMENTS MANQUENT NE
  // TOMBE PAS DANS LA BRANCHE HISTORIQUE. Sans ce test, un défaut interne
  // (arguments perdus entre la proposition et la confirmation) ferait annoncer
  // « enregistré » pour une écriture dont on n'a rien relu — c'est-à-dire
  // exactement le « c'est fait » non prouvé que §9 interdit. L'écriture a bien
  // eu lieu, la porte l'atteste ; ce qu'on ne sait pas, c'est son RÉSULTAT, et
  // c'est ça qu'il faut dire.
  if (capacite !== null && args === null) {
    ajouterTour({ role: "systeme", texte: fr.jarvis.ecriture.nonVerifiee });
    publier();
    return;
  }

  if (capacite !== null && args !== null) {
    const verifie = await capacite.verifier(args, execution.data);
    ajouterTour(
      verifie.ok
        ? { role: "jarvis", texte: `${carte.titre} — ${fr.jarvis.ecriture.verifiee}` }
        : { role: "systeme", texte: verifie.error.message },
    );
    publier();
    return;
  }

  // Les deux outils historiques de 033 n'ont pas de relecture déclarée. On dit
  // « enregistré » — ce que la porte garantit — et pas « vérifié », qu'on n'a
  // pas fait. La nuance est le contraire d'un détail.
  ajouterTour({ role: "jarvis", texte: `${carte.titre} — ${fr.feedback.enregistre}` });
  publier();
}

/** Refuser est le défaut : aucune raison demandée. */
export async function refuserCarte(): Promise<void> {
  const carte = interne.carteEcriture;
  if (carte === null) return;
  await refuserAction(carte.actionId);
  interne.carteEcriture = null;
  argumentsCarte = null;
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

  const bilan = await executerTour(
    { message, conversationId: demarrage.data },
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
    persiste: r.persiste,
    porteUneIdentite: carteIdentite().porteUneReference(r.texte),
  });

  /**
   * ── Capacité hors du registre de LECTURE ──
   *
   * La boucle ne l'a pas exécutée et n'a aucun chemin pour le faire. Deux cas :
   *   · un outil d'ÉCRITURE des cinq historiques → carte de confirmation (L2) ;
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
    publier();
    // 063 d'abord : les quatre écritures du registre, avec précondition et
    // vérification. Les deux outils historiques de 033 restent en repli.
    if (await proposerEcritureRegistre(nom, args, message)) {
      publier();
      return;
    }
    if (estOutilConnu(nom) && estOutilEcriture(nom)) {
      await proposerEcriture(nom, args, message);
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
