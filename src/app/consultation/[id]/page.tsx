/**
 * Consultation — l'espace de travail clinique.
 *
 * ⚠️ CET ÉCRAN NE PROTÈGE RIEN, ET C'EST LE POINT LE PLUS IMPORTANT À GARDER EN
 * TÊTE EN LE MODIFIANT. Il grise un bouton quand la fenêtre de 15 minutes est
 * passée ; ce qui EMPÊCHE la réécriture d'une note signée est
 * `trg_note_immutable` (migration 008), en base, hors de portée de tout
 * appelant. Si l'horloge de ce poste dérive de deux minutes, cet écran se
 * trompe et le déclencheur, non. Il doit donc savoir encaisser un refus sur un
 * bouton qu'il croyait actif — c'est ce que fait `signalerErreur`.
 *
 * Ne jamais présenter le grisage comme la protection d'I15. Ne jamais ajouter
 * de chemin qui « réessaie » une écriture refusée.
 *
 * ⚠️ INTROUVABLE ET HORS PÉRIMÈTRE SONT INDISCERNABLES. `app.get_consultation`
 * rend zéro ligne dans les deux cas. Afficher « cette séance ne vous est pas
 * accessible » confirmerait à une praticienne l'existence d'une consultation
 * chez sa consœur — une fuite par le message d'erreur, sans qu'aucune donnée
 * n'ait été lue (cloison ADR-003). Un seul message pour les deux.
 *
 * ═══ POURQUOI LA PAGE A CETTE FORME, ET PAS UNE AUTRE ══════════════════════
 *
 * Deux colonnes : LE TRAVAIL et SON CONTEXTE. C'est la disposition définitive
 * de l'espace clinique, pas celle de S5. La transcription (semaine 2),
 * l'analyse de séance (S6), les ordonnances et les documents (S7) s'ajoutent
 * comme des `SectionPliable` supplémentaires — dans la colonne de contexte pour
 * ce qui informe, dans la colonne de travail pour ce qui se rédige. Aucun de
 * ces ajouts ne redécoupe la page.
 *
 * LES DEUX PANNEAUX À VENIR SONT DÉJÀ LÀ, ET ILS SONT HONNÊTEMENT VIDES (I19).
 * « Fil de séance » et « Aide à la décision » disent ce qui n'existe pas encore
 * plutôt que d'afficher une transcription inventée ou une suggestion
 * fabriquée. Un panneau vide qui annonce son absence est une information ; un
 * panneau rempli de faux est un mensonge qu'on découvre devant un patient.
 *
 * ⚠️ S6 — `analyze_session` EST LE SEUL APPEL LLM DE CE FICHIER, ET IL NE FAIT
 * QUE PROPOSER. `analyzeSession()` (`src/services/jarvis.ts`) n'appelle qu'une
 * Edge Function, qui pseudonymise avant tout envoi (02-SECURITY-BOUNDARY.md
 * §3) et ne renvoie qu'un BROUILLON en lecture seule — rien ici n'écrit dans
 * `soap`, n'appelle `saveNote`, ni ne pose de ligne `jarvis_actions`
 * (`write: false`, `03-JARVIS-TOOLS.md` §3). La praticienne reprend ce qu'elle
 * veut À LA MAIN dans l'éditeur SOAP ci-contre — c'est ce qui la fait décider
 * (I6). Le disclaimer d'I7 reste affiché AVANT le bouton, pas seulement après
 * un résultat.
 */

"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { heure, jourComplet, nomPatient } from "@/components/AgendaPieces";
import { BlocTarif } from "@/components/BlocTarif";
import {
  Badge,
  BandeauHorsLigne,
  BarreActions,
  BlocErreur,
  Bouton,
  Carte,
  Champ,
  ChampTexte,
  ChampZoneTexte,
  EtatVide,
  GrilleChamps,
  IndicateurEnregistrement,
  LienBouton,
  Onglets,
  PanneauInfo,
  PanneauOnglet,
  SectionPliable,
  Squelette,
} from "@/components/ui";
import { PanneauHistorique } from "@/components/consultation/PanneauHistorique";
import { BarreConsultation } from "@/components/consultation/cockpit/BarreConsultation";
import { CockpitHeader } from "@/components/consultation/cockpit/CockpitHeader";
import { ColonnePatient } from "@/components/consultation/cockpit/ColonnePatient";
import { DepuisDerniere } from "@/components/consultation/cockpit/DepuisDerniere";
import { EtatClinique } from "@/components/consultation/cockpit/EtatClinique";
import { FocusSeance } from "@/components/consultation/cockpit/FocusSeance";
import { MesuresSeance } from "@/components/consultation/cockpit/MesuresSeance";
import { NotesStructurees } from "@/components/consultation/cockpit/NotesStructurees";
import { RailContexte } from "@/components/consultation/cockpit/RailContexte";
import { ajouterPiste, appliquerFocus } from "@/components/consultation/cockpit/modele-cockpit";
import { CarteIdentite } from "@/components/patients/CarteIdentite";
import {
  ListeSignaux,
  PointDeSituation,
  SectionDepuisDerniere,
} from "@/components/patients/SectionsDeterministes";
import { PanneauTraitements } from "@/components/patients/PanneauTraitements";
import { PanneauRendezVous } from "@/components/patients/PanneauRendezVous";
import { SectionDocumentsPatient } from "@/components/documents/SectionDocumentsPatient";
import { getPatientWorkspace, type PatientWorkspace } from "@/services/patients";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";
import {
  amendNote,
  closeConsultation,
  CHAMPS_SOAP,
  getConsultation,
  listAmendments,
  noteEstVerrouillee,
  noteEstVide,
  saveNote,
  saveRawNotes,
  signNote,
  tempsRestantAvantVerrou,
  type Amendment,
  type ChampSoap,
  type Consultation,
} from "@/services/consultations";
import { cleConfirmationApresSeance, enchainerApresSeance } from "@/services/apres-seance";
import {
  BoutonDictee,
  useDicteeChamps,
} from "@/components/consultation/DicteeChamp";
import { insererDictee } from "@/services/insertion-dictee";
import { analyzeSession, chargerAnalyse, type AnalyseSeance } from "@/services/jarvis";

/**
 * Délai d'inactivité avant enregistrement d'une saisie longue.
 *
 * Deux secondes, et c'est un compromis assumé : plus court, on écrit une ligne
 * d'audit à chaque mot ; plus long, une coupure réseau emporte davantage de
 * texte. Ce n'est PAS une garantie de sauvegarde — rien n'est conservé
 * localement dans ce dépôt, et `IndicateurEnregistrement` le dit à l'écran
 * plutôt que de laisser croire le contraire.
 */
const DELAI_ENREGISTREMENT_MS = 2000;

/**
 * V1.5 — plafond de LECTURE de la séance. Au-delà, l'écran bascule en ERREUR
 * avec le mot « délai » (05-UX-CONTRACT.md §2), jamais un squelette perpétuel.
 *
 * Distinct de `DELAI_ENREGISTREMENT_MS` ci-dessus, qui est une fenêtre
 * d'inactivité avant d'écrire — les deux nombres n'ont rien à voir, et les
 * confondre ferait enregistrer une note toutes les dix secondes.
 */
const DELAI_LECTURE_MS = 10_000;

/** Une seconde : le pas du chronomètre et du décompte de verrouillage. */
const PAS_HORLOGE_MS = 1000;

/** Préférence d'affichage du rail — pas une donnée clinique. */
const CLE_RAIL = "mindcare.cockpit.rail";

type EtatEnregistrement = "repos" | "encours" | "enregistre" | "echec";

/**
 * Durée écoulée, en `hh:mm:ss`.
 *
 * Chasse fixe et `tabular-nums` à l'affichage : un chronomètre dont les
 * chiffres changent de largeur bouge en permanence dans le coin de l'œil, et
 * cet écran reste ouvert pendant toute la séance.
 */
function chrono(depuisIso: string, jusqua: number): string {
  const debut = Date.parse(depuisIso);
  if (Number.isNaN(debut)) return "";
  const secondes = Math.max(0, Math.floor((jusqua - debut) / 1000));
  const h = Math.floor(secondes / 3600);
  const m = Math.floor((secondes % 3600) / 60);
  const s = secondes % 60;
  const pad = (v: number): string => String(v).padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/**
 * Ce que le bandeau de durée affiche pour une séance.
 *
 * V1.3 — une séance `status==='closed'` FIGE TOUJOURS son affichage, qu'elle
 * porte ou non un `endedAt`. Avant cette fonction, seul `endedAt===null`
 * décidait si l'horloge tournait : une clôture administrative d'une séance
 * orpheline (migration 032, option C — `ended_at` reste `NULL` plutôt que
 * d'inventer une durée) aurait donc laissé le chronomètre courir
 * indéfiniment sur une séance déjà fermée — exactement le symptôme
 * `125:44:26` du 09/08 que cette session corrige. Une durée manquante se dit,
 * elle ne se déguise pas en horloge qui tourne encore.
 */
function dureeAffichee(
  close: boolean,
  startedAt: string,
  endedAt: string | null,
  maintenant: number,
): string {
  if (!close) return chrono(startedAt, maintenant);
  if (endedAt === null) return fr.consultation.dureeInconnue;
  return chrono(startedAt, Date.parse(endedAt));
}

/**
 * Date ET heure, pour ce qui est horodaté au dossier.
 *
 * `jourComplet` seul rend « mardi 4 août 2026 » : suffisant pour un rendez-vous,
 * insuffisant pour une SIGNATURE. L'heure exacte est ce qui situe une note par
 * rapport à la consultation qu'elle documente, et c'est elle qu'un dossier
 * oppose devant un juge. Les deux formats existants sont composés plutôt que
 * réécrits.
 */
function dateHeure(iso: string): string | null {
  const j = jourComplet(iso);
  const h = heure(iso);
  return j === null ? null : h === null ? j : `${j} — ${h}`;
}

/** Décompte `mm:ss` de la fenêtre de correction. */
function decompte(restantMs: number): string {
  const secondes = Math.max(0, Math.ceil(restantMs / 1000));
  const m = Math.floor(secondes / 60);
  const s = secondes % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/**
 * Accord du pluriel. Le français accorde À PARTIR DE DEUX : « 0 amendement »
 * reste au singulier, et « 1 séances » de S4 ne se rejoue pas ici.
 */
function amendementsLibelle(n: number): string {
  return `${n} ${n >= 2 ? fr.consultation.amendementPluriel : fr.consultation.amendementSingulier}`;
}

/**
 * SA-03 — la portée longitudinale en une phrase. Zéro note antérieure : dit
 * explicitement « jour seul ». Au-delà : le compte et l'accord qui va avec.
 * Un nombre, jamais une promesse sur le contenu de ces notes.
 */
function libelleSourcesAnalyse(historiqueNotes: number): string {
  if (historiqueNotes <= 0) return fr.consultation.analyseSansHistorique;
  return `${historiqueNotes} ${
    historiqueNotes >= 2
      ? fr.consultation.noteAnterieurePluriel
      : fr.consultation.noteAnterieureSingulier
  }`;
}

/**
 * Les destinations possibles d'une dictée. `brut` = les notes de séance ; les
 * quatre autres sont les rubriques de la note clinique. Le type EXISTE pour
 * qu'aucune cinquième destination ne puisse apparaître par inadvertance.
 */
type CibleDictee = ChampSoap | "brut";

/**
 * Repose le curseur après l'insertion, pour que la praticienne continue à
 * écrire là où le texte vient d'arriver plutôt qu'en fin de champ.
 *
 * Le report au tour suivant n'est pas une précaution de style : React réécrit
 * la valeur du `textarea` au rendu, et poser la sélection avant ce rendu la
 * ferait perdre. Un échec ici est SANS CONSÉQUENCE sur le texte — seul le
 * confort du curseur en dépend, jamais le contenu.
 */
function replacerCurseur(zone: HTMLTextAreaElement | null, position: number): void {
  if (zone === null) return;
  requestAnimationFrame(() => {
    zone.focus();
    zone.setSelectionRange(position, position);
  });
}

const LIBELLES_SOAP: Readonly<Record<ChampSoap, { titre: string; indication: string }>> = {
  subjective: {
    titre: fr.consultation.subjective,
    indication: fr.consultation.subjectiveIndication,
  },
  objective: {
    titre: fr.consultation.objective,
    indication: fr.consultation.objectiveIndication,
  },
  assessment: {
    titre: fr.consultation.assessment,
    indication: fr.consultation.assessmentIndication,
  },
  plan: { titre: fr.consultation.plan, indication: fr.consultation.planIndication },
};

/**
 * Chronomètre isolé — possède son propre `setInterval(1000)` afin que le
 * parent `PageConsultation` ne re-render pas 3600×/h.
 *
 * Perf pass P1: avant, `const [maintenant,setMaintenant]` vivait au sommet
 * et forçait tout `EspaceTravail` (SOAP + Fil + Assistance + BlocTarif) à
 * re-rendre chaque seconde. Mesure attendue: 0 re-render parent/s vs 1
 * leaf/s. La durée figée (closed) ne tick pas.
 */
function ChronoSeance({
  close,
  startedAt,
  endedAt,
  className,
}: {
  readonly close: boolean;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly className?: string;
}): React.JSX.Element {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (close && endedAt !== null) return;
    if (close && endedAt === null) return;
    const id = setInterval(() => setMaintenant(Date.now()), PAS_HORLOGE_MS);
    return () => clearInterval(id);
  }, [close, endedAt]);
  return <span className={className}>{dureeAffichee(close, startedAt, endedAt, maintenant)}</span>;
}

/**
 * Compte à rebours de la fenêtre de correction (15 min après signature).
 * Isolé pour la même raison que `ChronoSeance` : évite de propager le tick
 * au parent qui porte les 4 éditeurs SOAP.
 */
function CompteReboursVerrou({
  note,
}: {
  readonly note: import("@/services/consultations").Note | null;
}): React.JSX.Element | null {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    // Ne tick que pendant la fenêtre de 15 min (sinon 1 tick/s inutile pendant
    // des heures de brouillon). Le parent ne tick plus du tout.
    const e0 = noteEstVerrouillee(note, Date.now());
    if (e0 !== "fenetre-correction") return;
    const id = setInterval(() => setMaintenant(Date.now()), PAS_HORLOGE_MS);
    return () => clearInterval(id);
  }, [note]);
  const verrou = noteEstVerrouillee(note, maintenant);
  const restant = tempsRestantAvantVerrou(note, maintenant);
  if (verrou === "fenetre-correction" && restant !== null) {
    return (
      <PanneauInfo ton="attention" titre={fr.consultation.fenetreCorrection}>
        <span className="font-num tabular-nums">{decompte(restant)}</span>
        {" — "}
        {fr.consultation.fenetreIndication}
      </PanneauInfo>
    );
  }
  if (verrou === "verrouillee") {
    return (
      <PanneauInfo titre={fr.consultation.verrouillee}>{fr.consultation.verrouParLaBase}</PanneauInfo>
    );
  }
  return null;
}

export default function PageConsultation(): React.JSX.Element {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const {
    utilisateur,
    sessionTranchee,
    horsLigne: horsLigneSession,
    deconnecter,
  } = useSessionEcran();

  const [seance, setSeance] = useState<Consultation | null | undefined>(undefined);
  const [amendements, setAmendements] = useState<readonly Amendment[]>([]);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const [envoi, setEnvoi] = useState(false);

  /**
   * Un tarif existe-t-il pour cette séance ? `undefined` = on ne sait pas
   * encore (ou la lecture a échoué). `BlocTarif` le renseigne — l'écran ne
   * relit pas la finance de son côté, l'argent reste dans un seul bloc.
   * Sert UNIQUEMENT à ne pas proposer une clôture que 037 refusera.
   */
  const [tarifPresent, setTarifPresent] = useState<boolean | undefined>(undefined);

  /**
   * V9 — LA SOUS-NAVIGATION, ET LA SEULE LECTURE QU'ELLE AJOUTE.
   *
   * ⚠️ LE BUDGET D'OUVERTURE NE BOUGE PAS (06-PERF-BUDGET). `dossier` reste
   * `undefined` tant qu'aucun onglet de contexte n'a été ouvert : une séance
   * menée de bout en bout dans l'onglet « Séance » ne déclenche AUCUN appel
   * supplémentaire. La lecture part à la première ouverture, une seule fois,
   * et sert ensuite les trois onglets — c'est le patron déjà éprouvé sur
   * l'écran Patient, où chronologie et documents lisent à la demande.
   *
   * `get_patient_workspace` (047) journalise sa lecture comme partout ailleurs.
   */
  const [onglet, setOnglet] = useState<string>("seance");
  const [dossier, setDossier] = useState<PatientWorkspace | null | undefined>(undefined);
  const [erreurDossier, setErreurDossier] = useState<string | undefined>(undefined);
  /**
   * V1.4 — ÉCHEC DE LECTURE ≠ séance introuvable. Avant cette distinction,
   * `charger` posait `seance = null` sur TOUT échec (réseau, délai, serveur),
   * ce qui affichait « Cette séance est introuvable » sur une simple coupure
   * réseau — un mensonge, et sur un rechargement en cours de séance, une
   * régression pire : une séance réellement ouverte disparaissait de l'écran.
   * `seance === null` reste réservé au SEUL cas légitime d'ADR-003
   * (introuvable et hors périmètre, volontairement indiscernables) ; un échec
   * de transport passe par `echecLecture` et REMPLACE le contenu par
   * `BlocErreur` (05-UX-CONTRACT.md §1), sans jamais toucher `seance`.
   */
  const [echecLecture, setEchecLecture] = useState(false);

  // Saisies. Elles vivent dans l'état de l'écran et NON dans `seance` : un
  // rechargement de la séance pendant la frappe écraserait ce qui est en train
  // d'être tapé, ce qui est la façon la plus sûre de perdre une note.
  const [brut, setBrut] = useState("");

  // Les zones réelles, pour SAVOIR où insérer une dictée. Jamais pour y
  // écrire : la valeur passe par `onChange`, donc par l'enregistrement
  // automatique existant — la voix n'a pas de chemin de sauvegarde à elle.
  const refBrut = useRef<HTMLTextAreaElement | null>(null);
  const refSubjective = useRef<HTMLTextAreaElement | null>(null);
  const refObjective = useRef<HTMLTextAreaElement | null>(null);
  const refAssessment = useRef<HTMLTextAreaElement | null>(null);
  const refPlan = useRef<HTMLTextAreaElement | null>(null);
  const refsSoap: Readonly<Record<ChampSoap, React.RefObject<HTMLTextAreaElement | null>>> = {
    subjective: refSubjective,
    objective: refObjective,
    assessment: refAssessment,
    plan: refPlan,
  };

  const [soap, setSoap] = useState<Record<ChampSoap, string>>({
    subjective: "",
    objective: "",
    assessment: "",
    plan: "",
  });

  const [etatBrut, setEtatBrut] = useState<EtatEnregistrement>("repos");
  const [etatSoap, setEtatSoap] = useState<EtatEnregistrement>("repos");
  const [heureBrut, setHeureBrut] = useState<string | undefined>(undefined);
  const [heureSoap, setHeureSoap] = useState<string | undefined>(undefined);

  const [amendementOuvert, setAmendementOuvert] = useState(false);
  const [motif, setMotif] = useState("");
  const [corps, setCorps] = useState("");

  // ── S6 — analyse de séance (Jarvis, `analyze_session`) ──────────────────
  const [analyse, setAnalyse] = useState<AnalyseSeance | null>(null);
  const [enAnalyse, setEnAnalyse] = useState(false);
  const [erreurAnalyse, setErreurAnalyse] = useState<string | undefined>(undefined);
  // Compteur de génération (§3.4 n°8, plan S6 approuvé) : la même logique que
  // le drapeau `annule` des pages de liste, adaptée à un appel déclenché par
  // clic plutôt qu'un effet. Un second clic avant la première réponse — ou un
  // démontage pendant l'appel — fait jeter silencieusement la réponse devenue
  // obsolète au lieu d'écraser un état plus récent.
  //
  // `controleurAnalyse` porte l'annulation RÉELLE (le compteur seul ignorait
  // la réponse sans couper l'appel) : timeout dur, annulation explicite,
  // run supersédé, changement de séance, démontage. L'abandon remonte par
  // `analyzeSession` jusqu'au fournisseur — la génération tardive ne coûte
  // plus rien et ne touche à aucun état.
  const generationAnalyse = useRef(0);
  const controleurAnalyse = useRef<AbortController | null>(null);
  const seanceAnalyse = useRef(id);
  seanceAnalyse.current = id;
  const demonte = useRef(false);

  // Perf: horloge isolée dans ChronoSeance/CompteReboursVerrou.
  // Plus de `maintenant` au sommet : évite 3600 re-renders/h de tout
  // EspaceTravail. Le vrai garde-fou est `trg_note_immutable` en base.

  const minuteurBrut = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const minuteurSoap = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * V1.5 — compteur de génération sur la LECTURE de la séance, même motif que
   * `generationAnalyse` et que l'écran Finances. Il sert au plafond de délai :
   * une réponse arrivée APRÈS la bascule en « délai » ne doit pas ressusciter
   * silencieusement l'écran par-dessus l'erreur affichée.
   */
  const generationLecture = useRef(0);

  const charger = useCallback(
    (avecSaisies: boolean): void => {
      const gen = (generationLecture.current += 1);

      // Aucune attente n'est infinie (05-UX-CONTRACT.md §2). Au-delà du
      // plafond, on bascule en ERREUR avec le mot « délai ». `seance` n'est
      // PAS touché : sur un rechargement en cours de séance, une lenteur
      // réseau ne fait pas disparaître une séance déjà lue — c'est la
      // distinction V1.4 entre échec de lecture et séance introuvable.
      const minuteur = setTimeout(() => {
        if (generationLecture.current !== gen) return;
        setHorsLigne(false);
        setMessageErreur(fr.delaiDepasse);
        setEchecLecture(true);
      }, DELAI_LECTURE_MS);

      void getConsultation(id).then((result) => {
        clearTimeout(minuteur);
        if (generationLecture.current !== gen) return;
        if (!result.ok) {
          setHorsLigne(result.error.code === "hors-ligne");
          setMessageErreur(result.error.message);
          setEchecLecture(true);
          // `seance` N'EST PAS TOUCHÉ : un échec de transport ne doit ni
          // fabriquer un « introuvable » (ADR-003 reste réservée au cas où la
          // porte a réellement répondu zéro ligne) ni faire disparaître une
          // séance déjà chargée pendant un rechargement en cours de travail.
          return;
        }
        setHorsLigne(false);
        setEchecLecture(false);
        setMessageErreur(undefined);
        setSeance(result.data);
        if (result.data === null) return;

        // Les saisies ne sont réinitialisées qu'au PREMIER chargement. Après une
        // signature ou un amendement, on recharge la séance sans toucher aux
        // champs : la praticienne peut avoir continué à écrire entre-temps.
        if (avecSaisies) {
          setBrut(result.data.rawNotes ?? "");
          // ⚠️ L'ANALYSE SE RELIT, ELLE NE SE REFAIT PAS. Avant 067 elle ne
          // vivait que dans cet état : rouvrir la consultation ne montrait
          // plus rien, et rien ne disait qu'elle avait existé. On la recharge
          // SANS rappeler le modèle — relancer une génération payante à chaque
          // ouverture d'écran serait une dépense que personne n'a demandée.
          // Un échec de relecture n'est pas signalé : ne pas avoir d'analyse
          // est l'état normal d'une séance en cours.
          void chargerAnalyse(id).then((relue) => {
            if (relue.ok && relue.data !== null) setAnalyse(relue.data);
          });
          const note = result.data.note;
          setSoap({
            subjective: note?.soap.subjective ?? "",
            objective: note?.soap.objective ?? "",
            assessment: note?.soap.assessment ?? "",
            plan: note?.soap.plan ?? "",
          });
        }

        const noteId = result.data.note?.id;
        if (noteId === undefined) {
          setAmendements([]);
          return;
        }
        void listAmendments(noteId).then((r) => {
          if (r.ok) setAmendements(r.data);
        });
      });
    },
    [id],
  );

  // Attend que la session soit tranchée : `app.get_consultation` journalise une
  // ouverture de dossier À CHAQUE APPEL, et interroger pour un visiteur qu'on
  // redirige écrirait une trace `fiche` pour une consultation qui n'a pas eu
  // lieu. La preuve I4 de S3 doit rester vraie.
  //
  // V1.5 — le garde est `sessionTranchee`, PAS `utilisateur` : c'est
  // `getSession()` qui tranche la session, et la trace `fiche` reste
  // conditionnée à une session existante. Le profil (I12) part en parallèle.
  useEffect(() => {
    if (sessionTranchee !== true) return;
    charger(true);
  }, [sessionTranchee, charger]);

  // Perf: intervalle global supprimé — voir ChronoSeance/CompteReboursVerrou.
  // Le parent ne tick plus : seule la feuille chrono tick (1/s) et le bandeau
  // de verrou tick pendant la fenêtre de 15 min.

  // Les minuteurs d'enregistrement sont annulés au démontage : sans ça, quitter
  // l'écran pendant la fenêtre d'inactivité déclencherait une écriture sur un
  // composant démonté, et le résultat serait perdu sans rien afficher.
  useEffect(
    () => () => {
      if (minuteurBrut.current !== undefined) clearTimeout(minuteurBrut.current);
      if (minuteurSoap.current !== undefined) clearTimeout(minuteurSoap.current);
    },
    [],
  );

  useEffect(
    () => () => {
      demonte.current = true;
      // Écran abandonné : couper le run éventuel plutôt que de le laisser
      // finir dans le vide — sa réponse tardive serait jetée de toute façon.
      controleurAnalyse.current?.abort();
      controleurAnalyse.current = null;
    },
    [],
  );

  const note = seance?.note ?? null;
  // Perf: évalué à l'instant du render, sans tick parent. Le tick fin (1s)
  // vit dans ChronoSeance/CompteReboursVerrou. Le vrai verrou est
  // `trg_note_immutable` en base — l'écran encaisse un refus.
  const etatVerrou = noteEstVerrouillee(note, Date.now());
  const seanceClose = seance?.status === "closed";
  // La note se rédige tant qu'elle n'est pas verrouillée — y compris pendant la
  // fenêtre de 15 minutes qui SUIT la signature. Ce n'est pas une tolérance :
  // c'est le dispositif d'I15, et le retirer ferait passer par un amendement une
  // correction faite dans la minute.
  const noteModifiable = etatVerrou !== "verrouillee";

  function signalerErreur(message: string): void {
    setMessageErreur(message);
    // La base a refusé : on relit ce qu'elle dit vraiment plutôt que de garder
    // à l'écran un état que l'écran avait supposé.
    charger(false);
  }

  function enregistrerBrut(texte: string): void {
    setBrut(texte);
    if (seanceClose) return;
    setEtatBrut("encours");
    if (minuteurBrut.current !== undefined) clearTimeout(minuteurBrut.current);
    minuteurBrut.current = setTimeout(() => {
      void saveRawNotes(id, texte).then((result) => {
        if (!result.ok || !result.data) {
          setEtatBrut("echec");
          return;
        }
        setEtatBrut("enregistre");
        setHeureBrut(heure(new Date().toISOString()) ?? undefined);
      });
    }, DELAI_ENREGISTREMENT_MS);
  }

  // ═══ LA DICTÉE — UNE VOIX, CINQ DESTINATIONS NOMMÉES ═══
  //
  // Cinq micros, cinq cibles explicites : les notes de séance, et chacune des
  // quatre rubriques de la note clinique. Le micro posé à côté de « Subjectif »
  // écrit dans Subjectif — sa POSITION est son contrat.
  //
  // ⚠️ DEUX USAGES DISTINCTS, JAMAIS FONDUS L'UN DANS L'AUTRE.
  //   · Notes de séance  = le fil de l'entretien, brouillon de travail.
  //   · Note clinique    = ce que la praticienne documente et signera.
  // Rien ne migre automatiquement de l'un vers l'autre : ce serait décider à sa
  // place de ce qui entre au dossier.
  //
  // ⚠️ AUCUN CLASSEMENT AUTOMATIQUE. Le texte dicté n'est ni reformulé, ni
  // ponctué, ni redistribué vers « la bonne rubrique » par un modèle. Ce qui a
  // été dit arrive tel quel, là où elle l'a demandé, et lui appartient.
  //
  // Le micro passe par le même courtier partagé que le mot de réveil
  // (`micro-partage.ts`) : pas de second `getUserMedia`, donc pas de permission
  // redemandée en pleine consultation.
  const dictee = useDicteeChamps<CibleDictee>(
    (cible, texte) => {
      if (cible === "brut") {
        const zone = refBrut.current;
        const { texte: suivant, curseur } = insererDictee(
          brut,
          texte,
          zone?.selectionStart ?? null,
        );
        enregistrerBrut(suivant);
        replacerCurseur(zone, curseur);
        return;
      }
      const zone = refsSoap[cible].current;
      const { texte: suivant, curseur } = insererDictee(
        soap[cible],
        texte,
        zone?.selectionStart ?? null,
      );
      enregistrerSoap(cible, suivant);
      replacerCurseur(zone, curseur);
    },
    // ⚠️ PAS `signalerErreur` ICI. Celui-là RELIT la séance, ce qui est juste
    // quand la BASE a refusé une écriture — mais une permission micro refusée
    // ne dit rien de l'état du dossier, et recharger l'écran à ce moment ferait
    // clignoter une note en cours de frappe pour rien.
    setMessageErreur,
  );

  function enregistrerSoap(champ: ChampSoap, texte: string): void {
    const suivant = { ...soap, [champ]: texte };
    setSoap(suivant);
    if (!noteModifiable) return;
    setEtatSoap("encours");
    if (minuteurSoap.current !== undefined) clearTimeout(minuteurSoap.current);
    minuteurSoap.current = setTimeout(() => {
      void saveNote(id, { [champ]: texte }).then((result) => {
        if (!result.ok || result.data === null) {
          setEtatSoap("echec");
          // Un refus ici est significatif : c'est le verrou qui s'est fermé
          // pendant la frappe. On relit l'état réel pour que l'écran cesse de
          // proposer une édition que la base ne veut plus.
          if (!result.ok) charger(false);
          return;
        }
        setEtatSoap("enregistre");
        setHeureSoap(heure(new Date().toISOString()) ?? undefined);
        // Première écriture : la note vient d'être créée en base. On recharge
        // pour obtenir son identifiant, sans quoi la signature n'aurait pas de
        // cible.
        if (note === null) charger(false);
      });
    }, DELAI_ENREGISTREMENT_MS);
  }

  /**
   * Envoie tout de suite ce qui attendait dans un minuteur.
   *
   * Sans ça, signer une note deux secondes après la dernière frappe signerait
   * la version PRÉCÉDENTE : le texte affiché à l'écran ne serait pas celui qui
   * entre au dossier. Sur une pièce juridique, c'est inadmissible.
   */
  async function viderLesAttentes(): Promise<boolean> {
    // Perf: save brut + soap en parallèle quand les deux sont en attente
    // (touches différentes, pas de dépendance transactionnelle).
    const brutEnAttente = minuteurBrut.current !== undefined;
    if (minuteurSoap.current !== undefined) {
      clearTimeout(minuteurSoap.current);
      minuteurSoap.current = undefined;
    }
    if (minuteurBrut.current !== undefined) {
      clearTimeout(minuteurBrut.current);
      minuteurBrut.current = undefined;
    }

    const complet: Partial<Record<ChampSoap, string>> = {};
    for (const champ of CHAMPS_SOAP) complet[champ] = soap[champ];

    if (brutEnAttente) {
      const [rBrut, rSoap] = await Promise.all([saveRawNotes(id, brut), saveNote(id, complet)]);
      if (!rBrut.ok) {
        setEtatBrut("echec");
        // Soap peut avoir réussi : on le signale quand même
        if (rSoap.ok) setEtatSoap("enregistre");
        else {
          setEtatSoap("echec");
          signalerErreur(rSoap.error.message);
        }
        return false;
      }
      setEtatBrut("enregistre");
      if (!rSoap.ok) {
        setEtatSoap("echec");
        signalerErreur(rSoap.error.message);
        return false;
      }
      setEtatSoap("enregistre");
      return true;
    }

    const r = await saveNote(id, complet);
    if (!r.ok) {
      setEtatSoap("echec");
      signalerErreur(r.error.message);
      return false;
    }
    setEtatSoap("enregistre");
    return true;
  }

  function signer(): void {
    setMessageErreur(undefined);
    setConfirmation(undefined);

    if (noteEstVide({ ...soap })) {
      // Le même refus existe en base (`app.sign_note`). On le dit avant plutôt
      // que de faire faire un aller-retour pour une phrase moins claire.
      setMessageErreur(fr.consultation.noteVide);
      return;
    }
    if (!window.confirm(fr.consultation.confirmerSignature)) return;

    setEnvoi(true);
    void viderLesAttentes().then((pret) => {
      if (!pret) {
        setEnvoi(false);
        return;
      }
      // Perf: réutilise `seance.note.id` si déjà connu (cas majoritaire).
      // Seule une première note (jamais créée) nécessite une relecture.
      const cibleConnue = seance?.note?.id ?? null;
      if (cibleConnue !== null) {
        void signNote(cibleConnue).then((result) => {
          setEnvoi(false);
          if (!result.ok) {
            setHorsLigne(result.error.code === "hors-ligne");
            signalerErreur(result.error.message);
            return;
          }
          if (!result.data) {
            signalerErreur(fr.consultation.introuvable);
            return;
          }
          setConfirmation(fr.feedback.noteSignee);
          charger(false);
        });
        return;
      }
      void getConsultation(id).then((lecture) => {
        const cible = lecture.ok ? (lecture.data?.note?.id ?? null) : null;
        if (cible === null) {
          setEnvoi(false);
          signalerErreur(fr.consultation.introuvable);
          return;
        }
        void signNote(cible).then((result) => {
          setEnvoi(false);
          if (!result.ok) {
            setHorsLigne(result.error.code === "hors-ligne");
            signalerErreur(result.error.message);
            return;
          }
          if (!result.data) {
            signalerErreur(fr.consultation.introuvable);
            return;
          }
          setConfirmation(fr.feedback.noteSignee);
          charger(false);
        });
      });
    });
  }

  function clore(): void {
    setMessageErreur(undefined);
    setConfirmation(undefined);
    if (!window.confirm(fr.consultation.confirmerCloture)) return;

    setEnvoi(true);
    void viderLesAttentes().then((pret) => {
      if (!pret) {
        setEnvoi(false);
        return;
      }
      void closeConsultation(id).then((result) => {
        setEnvoi(false);
        if (!result.ok) {
          setHorsLigne(result.error.code === "hors-ligne");
          signalerErreur(result.error.message);
          return;
        }
        if (!result.data) {
          signalerErreur(fr.consultation.introuvable);
          return;
        }
        setConfirmation(fr.feedback.seanceTerminee);
        charger(false);

        // ═══ L'ENCHAÎNEMENT D'APRÈS-SÉANCE ═══
        //
        // ⚠️ APRÈS, ET JAMAIS PENDANT. La clôture a DÉJÀ rendu son verdict :
        // rien de ce qui suit ne peut la défaire ni la faire paraître en
        // échec. `void` est délibéré — un `await` ici bloquerait l'écran sur
        // un appel de modèle, et une panne de fournisseur ressemblerait à une
        // consultation qui refuse de se fermer.
        //
        // Le message de confirmation s'enrichit au fil des étapes ; en cas
        // d'échec il dit CE QUI a échoué et rappelle que la séance, elle, est
        // enregistrée. Voir `src/services/apres-seance.ts`.
        void enchainerApresSeance(id, seance?.patientId ?? null, (suivi) => {
          // La correspondance état → message vit dans `cleConfirmationApresSeance`
          // (testée) ; `tsc` vérifie chaque clé contre `fr.feedback.apresSeance`.
          // `null` = garder le message courant (cas `patientId === null`, où le
          // « Séance terminée. » posé avant l'enchaînement doit survivre).
          const cle = cleConfirmationApresSeance(suivi);
          if (cle !== null) setConfirmation(fr.feedback.apresSeance[cle]);
          // L'analyse vient d'être écrite : on la remonte à l'écran plutôt
          // que d'obliger à rouvrir la consultation pour la voir. Inutile
          // quand elle est `ignoree` (`chargerAnalyse` rendrait `ok(null)`).
          if (suivi.resume === "faite" && suivi.analyse !== "ignoree") {
            void chargerAnalyse(id).then((relue) => {
              if (relue.ok && relue.data !== null) setAnalyse(relue.data);
            });
          }
        });
      });
    });
  }

  function amender(): void {
    setMessageErreur(undefined);
    setConfirmation(undefined);

    if (motif.trim() === "" || corps.trim() === "") {
      setMessageErreur(fr.consultation.amendementIncomplet);
      return;
    }
    const cible = note?.id;
    if (cible === undefined) {
      setMessageErreur(fr.consultation.introuvable);
      return;
    }

    setEnvoi(true);
    void amendNote(cible, motif.trim(), corps.trim()).then((result) => {
      setEnvoi(false);
      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        signalerErreur(result.error.message);
        return;
      }
      if (!result.data) {
        signalerErreur(fr.consultation.introuvable);
        return;
      }
      setAmendementOuvert(false);
      setMotif("");
      setCorps("");
      setConfirmation(fr.consultation.amendementEnregistre);
      charger(false);
    });
  }

  /**
   * `analyze_session` — S6, `write: false`. Ne pose aucune ligne
   * `jarvis_actions`, n'écrit rien dans la note SOAP : c'est un BROUILLON en
   * lecture seule, que la praticienne reprend à la main si elle le souhaite.
   *
   * Chaque déclenchement est un NOUVEAU run : le contrôleur précédent est
   * aborté (run supersédé, terminal, sans effet), la génération protège des
   * réponses tardives, et la couche d'exécution (`analyzeSession`, vol unique
   * par séance) garantit qu'un seul appel fournisseur est actif. `Réessayer`
   * après un terminal repart donc toujours d'un état sain.
   *
   * Idempotence (§3.4 n°7) : le bouton se désactive DÈS le premier clic, via
   * `enAnalyse`, avant même que la promesse ne se résolve — un second clic
   * rapide ne peut pas déclencher un second appel tant que le premier est en
   * cours.
   */
  function analyserSeance(): void {
    setErreurAnalyse(undefined);
    setEnAnalyse(true);
    // Run supersédé : l'ancien ne doit ni finir ni coûter — il est aborté
    // AVANT que le nouveau prenne la main.
    controleurAnalyse.current?.abort();
    const controleur = new AbortController();
    controleurAnalyse.current = controleur;
    generationAnalyse.current += 1;
    const generation = generationAnalyse.current;
    const seanceDemande = id;

    void analyzeSession(id, controleur.signal).then((result) => {
      // Réponse tardive ignorée (§3.4 n°8) : la page a démonté, la séance a
      // changé, ou un appel plus récent a déjà pris la main. On ne touche à
      // AUCUN état — un run obsolète n'écrase jamais le run actif.
      if (
        demonte.current ||
        generation !== generationAnalyse.current ||
        seanceDemande !== seanceAnalyse.current
      )
        return;

      controleurAnalyse.current = null;
      setEnAnalyse(false);
      if (!result.ok) {
        // `annule` = abandon explicite ou run supersédé : la praticienne a
        // déjà agi, on revient au repos avec un constat, pas une panne.
        if (result.error.technical === "annule") {
          setErreurAnalyse(fr.consultation.analyseAnnulee);
          return;
        }
        // `delai-depasse` = timeout dur : le mot « délai » bascule l'écran en
        // ERREUR terminale avec réessai, jamais un chargement perpétuel.
        if (result.error.technical === "delai-depasse") {
          setErreurAnalyse(fr.delaiDepasse);
          return;
        }
        // Message dédié (T6, §10 de 03-JARVIS-TOOLS.md) plutôt que le message
        // générique « service de données indisponible » : celui-ci dirait la
        // même chose pour une panne Jarvis que pour une panne de la base, et
        // laisserait croire que le dossier lui-même est en cause. Exception
        // pour `regle-metier` (aucune note à analyser) : son message est déjà
        // précis, pas la peine de le remplacer.
        setErreurAnalyse(
          result.error.code === "regle-metier"
            ? result.error.message
            : fr.consultation.analyseIndisponible,
        );
        return;
      }
      setAnalyse(result.data);
    });
  }

  /**
   * Annulation explicite : terminale, sans mutation. Le run aborté est jeté
   * par la garde de génération même si sa réponse arrivait quand même ; un
   * `Réessayer` ultérieur créera un nouveau run.
   */
  function annulerAnalyse(): void {
    controleurAnalyse.current?.abort();
    controleurAnalyse.current = null;
    generationAnalyse.current += 1;
    setEnAnalyse(false);
    setErreurAnalyse(fr.consultation.analyseAnnulee);
  }

  /**
   * La lecture du dossier, déclenchée par l'onglet et par lui seul.
   *
   * `dossier === undefined` est l'état « jamais demandé » ; il sert aussi de
   * geste de réessai (`reessayerDossier` le remet à `undefined`), ce qui évite
   * un compteur de rechargement dont la seule fonction serait de relancer un
   * effet que la donnée décrit déjà.
   */
  const patientId = seance?.patientId ?? null;
  const ongletContexte =
    onglet === "resume" || onglet === "traitement" || onglet === "rendezVous";

  /**
   * Une séance sans dossier rattaché n'expose QUE « Séance ».
   *
   * Le `LEFT JOIN` de `get_consultation` (026) laisse exister une consultation
   * dont le rendez-vous n'a pas de patient. Lui proposer « Traitement » ou
   * « Documents » afficherait quatre onglets vides : l'écran promettrait un
   * dossier qu'il n'a pas.
   */
  const ongletsConsultation =
    patientId === null
      ? [{ cle: "seance", libelle: fr.consultation.onglets.seance }]
      : [
          { cle: "seance", libelle: fr.consultation.onglets.seance },
          { cle: "resume", libelle: fr.consultation.onglets.resume },
          { cle: "historique", libelle: fr.consultation.onglets.historique },
          { cle: "traitement", libelle: fr.consultation.onglets.traitement },
          { cle: "documents", libelle: fr.consultation.onglets.documents },
          { cle: "rendezVous", libelle: fr.consultation.onglets.rendezVous },
        ];

  useEffect(() => {
    if (patientId === null || !ongletContexte || dossier !== undefined) return;
    let annule = false;
    void getPatientWorkspace(patientId).then((r) => {
      if (annule) return;
      if (!r.ok) {
        setErreurDossier(r.error.message);
        // `null` ferme l'état « en cours » : sans lui, le squelette tournerait
        // indéfiniment sous un message d'erreur — les deux états à la fois,
        // ce que la règle d'exclusivité d'UX_CONTRACT interdit.
        setDossier(null);
        return;
      }
      setErreurDossier(undefined);
      setDossier(r.data);
    });
    return () => {
      annule = true;
    };
  }, [patientId, ongletContexte, dossier]);

  function reessayerDossier(): void {
    setErreurDossier(undefined);
    setDossier(undefined);
  }

  // ── COCKPIT — état local, aucune lecture ─────────────────────────────────
  //
  // `focusSelection`/`focusLibre` meurent avec l'écran : ce sont des aides de
  // saisie, pas du dossier. Seule la préférence du rail survit (préférence
  // d'affichage, comme un tiroir).
  const [focusSelection, setFocusSelection] = useState<readonly string[]>([]);
  const [focusLibre, setFocusLibre] = useState("");
  // V10 — mesures 1-10 : aides de saisie comme le focus, meurent avec l'écran.
  // Chaque choix inscrit « Libellé : X/10 » dans Subjectif via `saveNote`.
  const [mesures, setMesures] = useState<{ anxiete: number | null; sommeil: number | null; humeur: number | null }>({
    anxiete: null,
    sommeil: null,
    humeur: null,
  });
  const [railOuvert, setRailOuvert] = useState<boolean>(() => lirePreferenceRail());

  function lirePreferenceRail(): boolean {
    if (typeof window === "undefined") return true;
    try {
      const v = window.localStorage.getItem(CLE_RAIL);
      if (v === "ferme") return false;
      if (v === "ouvert") return true;
    } catch {
      // Stockage indisponible : repli par défaut ci-dessous.
    }
    return (
      typeof window.matchMedia === "function" &&
      window.matchMedia("(min-width: 1280px)").matches
    );
  }

  function basculerRail(): void {
    setRailOuvert((ouvert) => {
      const suivant = !ouvert;
      try {
        window.localStorage.setItem(CLE_RAIL, suivant ? "ouvert" : "ferme");
      } catch {
        // Préférence non conservée : le rail bascule quand même.
      }
      return suivant;
    });
  }

  /**
   * Charge le dossier sur GESTE explicite (bouton du rail ou du centre).
   * Même porte auditée que les onglets, même état partagé : ouvrir ensuite
   * un onglet de contexte ne relit rien. Jamais appelée au montage — le
   * budget d'ouverture (e2e O5) ne bouge pas.
   */
  function chargerContexte(): void {
    if (patientId === null || dossier !== undefined) return;
    setErreurDossier(undefined);
    void getPatientWorkspace(patientId).then((r) => {
      if (!r.ok) {
        setErreurDossier(r.error.message);
        setDossier(null);
        return;
      }
      setErreurDossier(undefined);
      setDossier(r.data);
    });
  }

  function insererPiste(champ: ChampSoap, texte: string): void {
    if (!noteModifiable || seanceClose) return;
    enregistrerSoap(champ, ajouterPiste(soap[champ], texte));
  }

  function appliquerFocusSelection(): void {
    if (!noteModifiable || seanceClose) return;
    const libre = focusLibre.trim();
    const ajouts = libre === "" ? focusSelection : [...focusSelection, libre];
    if (ajouts.length === 0) return;
    enregistrerSoap("subjective", appliquerFocus(soap.subjective, ajouts));
  }

  const LIBELLES_MESURE = { anxiete: "Anxiété", sommeil: "Sommeil", humeur: "Humeur" } as const;

  function appliquerMesure(cle: keyof typeof LIBELLES_MESURE, valeur: number): void {
    if (!noteModifiable || seanceClose) return;
    setMesures((m) => ({ ...m, [cle]: valeur }));
    const phrase = `${LIBELLES_MESURE[cle]} : ${String(valeur)}/10`;
    enregistrerSoap("subjective", ajouterPiste(soap.subjective, phrase));
  }

  function enregistrerMaintenant(): void {
    void viderLesAttentes().then((pret) => {
      if (pret) setConfirmation(fr.feedback.enregistre);
    });
  }

  function voirTarif(): void {
    const bloc = document.getElementById("bloc-tarif");
    if (bloc === null) return;
    const reduit =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    bloc.scrollIntoView({ behavior: reduit ? "auto" : "smooth", block: "start" });
  }

  // ── Rendu ────────────────────────────────────────────────────────────────

  if (utilisateur === undefined) {
    return (
      <main className="p-8">
        <Squelette lignes={4} />
      </main>
    );
  }

  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={
            <Bouton onClick={() => router.replace("/connexion")}>{fr.actions.reessayer}</Bouton>
          }
        />
      </main>
    );
  }

  const contenu = ((): React.JSX.Element => {
    // V1.4 — ERREUR remplace le contenu, elle ne se superpose ni à VIDE ni à
    // CHARGEMENT (05-UX-CONTRACT.md §1). Testé avant `seance === undefined` :
    // un rechargement qui échoue en cours de séance doit basculer en erreur,
    // pas revenir à un squelette qui ne se résoudra jamais.
    if (echecLecture) {
      return (
        <BlocErreur
          message={messageErreur ?? fr.erreurs.indisponible}
          action={<Bouton onClick={() => charger(false)}>{fr.actions.reessayer}</Bouton>}
        />
      );
    }

    if (seance === undefined) return <Squelette lignes={6} />;

    if (seance === null) {
      // SEUL cas légitime de VIDE ici : la porte a répondu zéro ligne.
      // ADR-003 impose que « introuvable » et « hors périmètre » restent
      // indiscernables — mais un échec de transport n'est PLUS mélangé à ce
      // message depuis la branche `echecLecture` ci-dessus.
      return (
        <EtatVide
          message={fr.consultation.introuvable}
          icone="documents"
          action={<LienBouton href="/agenda">{fr.agenda.retourALAgenda}</LienBouton>}
        />
      );
    }

    return (
      <div className="grid grid-cols-1 items-start gap-4 desktop:grid-cols-cockpit-consultation">
        {/*
          LE COCKPIT — trois volets : patient / travail / contexte. La colonne
          patient existe AVANT tout chargement du dossier (chargeur + même geste
          que le rail, état partagé, zéro appel supplémentaire) : aucune
          redistribution à l'arrivée des données.
        */}
        <div className="min-w-0 desktop:sticky desktop:top-6">
          {erreurDossier !== undefined ? (
            <BlocErreur
              message={erreurDossier}
              action={<Bouton onClick={reessayerDossier}>{fr.actions.reessayer}</Bouton>}
            />
          ) : dossier === undefined ? (
            <div className="flex flex-col gap-3 rounded-2xl border border-rule bg-card p-5 shadow-carte">
              <Squelette lignes={2} />
              <div>
                <Bouton rang="secondaire" onClick={chargerContexte}>
                  {fr.consultation.cockpit.railCharger}
                </Bouton>
              </div>
            </div>
          ) : dossier === null ? (
            <EtatVide
              message={fr.consultation.cockpit.contexteInaccessible}
              icone="patients"
            />
          ) : (
            <ColonnePatient espace={dossier} />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <>
            {dossier === undefined || dossier === null ? null : (
              <>
                <EtatClinique
                  echelles={dossier.clinique?.echelles ?? []}
                  modifiable={noteModifiable && !seanceClose}
                  onInserer={insererPiste}
                />
                <DepuisDerniere espace={dossier} />
              </>
            )}

            {noteModifiable && !seanceClose ? (
              <>
                <MesuresSeance valeurs={mesures} onMesurer={appliquerMesure} modifiable={noteModifiable && !seanceClose} />
                <FocusSeance
                  options={fr.consultation.cockpit.focusOptions.filter(
                    (o) => o !== "Anxiété" && o !== "Sommeil" && o !== "Humeur",
                  )}
                  selection={focusSelection}
                  onChanger={setFocusSelection}
                  libre={focusLibre}
                  onLibre={setFocusLibre}
                  onAppliquer={appliquerFocusSelection}
                  peutAppliquer={focusSelection.length > 0 || focusLibre.trim() !== ""}
                />
              </>
            ) : null}

            <SectionPliable
              titre={fr.consultation.cockpit.brutTitre}
              action={
                <span className="flex items-center gap-3">
                  {/* La dictée n'apparaît QUE si ce navigateur sait enregistrer,
                      et QUE si la séance est encore ouverte. Un bouton présent
                      mais inerte ferait croire à une panne. */}
                  <BoutonDictee
                    champ="brut"
                    libelleChamp={fr.consultation.notesBrutes}
                    dictee={dictee}
                    disabled={seanceClose}
                  />
                  <IndicateurEnregistrement
                    etat={etatBrut}
                    {...(heureBrut === undefined ? {} : { horodatage: heureBrut })}
                  />
                </span>
              }
            >
              <div className="flex flex-col gap-3">
                <ChampZoneTexte
                  libelle={fr.consultation.notesBrutes}
                  valeur={brut}
                  onChange={enregistrerBrut}
                  zoneRef={refBrut}
                  lignes={4}
                  clinique
                  disabled={seanceClose}
                  placeholder={fr.consultation.cockpit.notesPlaceholder}
                  indication={
                    seanceClose
                      ? fr.consultation.notesBrutesFigees
                      : dictee.cible === "brut"
                        ? fr.consultation.dicterIndication
                        : fr.consultation.notesBrutesIndication
                  }
                />
                {etatBrut === "echec" ? (
                  <PanneauInfo ton="attention">
                    {fr.consultation.nonEnregistreIndication}
                  </PanneauInfo>
                ) : null}
              </div>
            </SectionPliable>

            <div className="flex flex-col gap-4">
              {/* L'ÉTAT DU VERROU, DIT EXPLICITEMENT. Une note qu'on ne peut
                  plus modifier sans que l'écran l'explique se lit comme une
                  panne, et la praticienne cherche à contourner. */}
              <CompteReboursVerrou note={note} />

              {noteModifiable ? (
                  <NotesStructurees
                    soap={soap}
                    onChanger={enregistrerSoap}
                    refs={refsSoap}
                    micro={(champ) => (
                      <BoutonDictee
                        champ={champ}
                        libelleChamp={LIBELLES_SOAP[champ].titre}
                        dictee={dictee}
                      />
                    )}
                    modifiable={noteModifiable && !seanceClose}
                    libelles={{
                      subjective: {
                        titre: LIBELLES_SOAP.subjective.titre,
                        indication:
                          dictee.cible === "subjective"
                            ? fr.consultation.dicterChampIndication
                            : LIBELLES_SOAP.subjective.indication,
                      },
                      objective: {
                        titre: LIBELLES_SOAP.objective.titre,
                        indication:
                          dictee.cible === "objective"
                            ? fr.consultation.dicterChampIndication
                            : LIBELLES_SOAP.objective.indication,
                      },
                      assessment: {
                        titre: LIBELLES_SOAP.assessment.titre,
                        indication:
                          dictee.cible === "assessment"
                            ? fr.consultation.dicterChampIndication
                            : LIBELLES_SOAP.assessment.indication,
                      },
                      plan: {
                        titre: LIBELLES_SOAP.plan.titre,
                        indication:
                          dictee.cible === "plan"
                            ? fr.consultation.dicterChampIndication
                            : LIBELLES_SOAP.plan.indication,
                      },
                    }}
                    action={
                      <span className="flex items-center gap-3">
                        <IndicateurEnregistrement
                          etat={etatSoap}
                          {...(heureSoap === undefined ? {} : { horodatage: heureSoap })}
                        />
                        {/* La signature vit à côté de la note qu'elle fige, pas sous
                            le pli : un geste juridique se cherche, il ne se devine
                            pas. La clôture, elle, n'existe qu'en barre collante. */}
                        {!seanceClose && (note === null || note.status === "draft") ? (
                          <Bouton rang="principal" onClick={signer} disabled={envoi}>
                            {fr.actions.signerLaNote}
                          </Bouton>
                        ) : null}
                      </span>
                    }
                  />
                ) : (
                  <section
                    aria-label={fr.consultation.note}
                    className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="font-ui text-heading font-bold text-ink-900">
                        {fr.consultation.note}
                      </h2>
                      {note?.status === "signed" ? (
                        <span className="font-ui text-label text-ink-500">
                          {fr.feedback.noteSignee}
                        </span>
                      ) : null}
                    </div>
                    <div className="flex flex-col gap-6">
                      {CHAMPS_SOAP.map((champ) => (
                        <Champ
                          key={champ}
                          libelle={LIBELLES_SOAP[champ].titre}
                          valeur={note?.soap[champ] ?? null}
                        />
                      ))}
                    </div>
                  </section>
                )}

                {note?.signedAt == null ? null : (
                  <Carte niveau="clinique">
                    <div className="p-4">
                      <GrilleChamps>
                        <Champ
                          libelle={fr.consultation.signeePar}
                          valeur={note.signerName}
                        />
                        <Champ
                          libelle={fr.consultation.signeeLe}
                          valeur={dateHeure(note.signedAt)}
                        />
                      </GrilleChamps>
                    </div>
                  </Carte>
                )}
            </div>

            {/* Les amendements n'apparaissent qu'une fois la note signée : sur
                un brouillon, la section n'aurait aucun contenu possible. */}
            {note?.status === "signed" ? (
              <SectionPliable
                titre={fr.consultation.amendements}
                annotation={amendementsLibelle(amendements.length)}
                action={
                  amendementOuvert ? null : (
                    <Bouton onClick={() => setAmendementOuvert(true)}>
                      {fr.consultation.redigerAmendement}
                    </Bouton>
                  )
                }
              >
                <div className="flex flex-col gap-6">
                  {amendements.length === 0 && !amendementOuvert ? (
                    <EtatVide message={fr.consultation.amendementsAucun} />
                  ) : null}

                  {/* Les amendements sont VISIBLES et SÉPARÉS, jamais fondus
                      dans le texte de la note : c'est ce qui distingue une
                      correction traçable d'une réécriture (ADR-004). */}
                  {amendements.map((a) => (
                    <Carte key={a.id} niveau="clinique">
                      <div className="flex flex-col gap-3 p-4">
                        <div className="flex flex-wrap items-center gap-3">
                          <Badge>{a.reason}</Badge>
                          <span className="font-ui text-label text-ink-500">
                            {fr.consultation.amendementPar}{" "}
                            {a.authorName ?? fr.etats.texteAbsent} —{" "}
                            <span className="font-num tabular-nums">
                              {dateHeure(a.createdAt) ?? ""}
                            </span>
                          </span>
                        </div>
                        <p className="whitespace-pre-wrap break-words font-ui text-notes text-ink-900">
                          {a.body}
                        </p>
                      </div>
                    </Carte>
                  ))}

                  {amendementOuvert ? (
                    <div className="flex flex-col gap-4">
                      <ChampTexte
                        libelle={fr.consultation.amendementMotif}
                        indication={fr.consultation.amendementMotifIndication}
                        valeur={motif}
                        onChange={setMotif}
                        requis
                      />
                      <ChampZoneTexte
                        libelle={fr.consultation.amendementCorps}
                        valeur={corps}
                        onChange={setCorps}
                        lignes={5}
                        clinique
                      />
                      <BarreActions>
                        <Bouton rang="principal" onClick={amender} disabled={envoi}>
                          {fr.consultation.redigerAmendement}
                        </Bouton>
                        <Bouton
                          rang="discret"
                          onClick={() => {
                            setAmendementOuvert(false);
                            setMotif("");
                            setCorps("");
                          }}
                        >
                          {fr.actions.annuler}
                        </Bouton>
                      </BarreActions>
                    </div>
                  ) : null}
                </div>
              </SectionPliable>
            ) : null}
          </>
        </div>
        <div className="min-w-0">
          <RailContexte
            ouvert={railOuvert}
            onBasculer={basculerRail}
            dossier={dossier}
            erreurDossier={erreurDossier}
            onCharger={chargerContexte}
            onReessayer={reessayerDossier}
            patientId={patientId}
            consultationActuelleId={seance.id}
            jarvis={
              <>
                {/* LES DEUX EMPLACEMENTS DES MODULES À VENIR. Ils sont posés
                    maintenant pour que la transcription (semaine 2) et l'analyse de
                    séance (S6) s'ajoutent sans redécouper la page — et ils disent
                    honnêtement qu'ils sont vides (I19). Repliés dans le rail :
                    un vide honnête ne prend pas la place du travail. */}
                <SectionPliable titre={fr.consultation.filSeance} replieParDefaut>
                  <EtatVide message={fr.consultation.filSeanceIndisponible} />
                </SectionPliable>

            <SectionPliable titre={fr.consultation.assistance}>
              <div className="flex flex-col gap-4">
                {/* I7 — mention permanente, jamais masquée, sur toute surface
                    d'aide à la décision. AVANT le bouton, pas seulement après
                    un résultat : elle est déjà là pour la fonctionnalité vide,
                    elle ne bouge pas pour la fonctionnalité pleine. */}
                <p className="font-ui text-label text-ink-500">{fr.disclaimer}</p>

                <div>
                  <Bouton
                    rang="secondaire"
                    onClick={analyserSeance}
                    disabled={enAnalyse || brut.trim() === ""}
                  >
                    {fr.consultation.analyserLaSeance}
                  </Bouton>
                </div>

                {brut.trim() === "" && !enAnalyse && analyse === null ? (
                  <EtatVide message={fr.consultation.analyseAucuneNote} />
                ) : null}

                {/* État de chargement HONNÊTE : un texte qui dit ce qui se
                    passe, jamais un squelette qui imiterait un contenu que
                    personne n'a encore produit. Annulable : l'attente n'est
                    jamais un état sans sortie. */}
                {enAnalyse ? (
                  <div className="flex flex-col gap-2">
                    <PanneauInfo>{fr.consultation.analyseEnCours}</PanneauInfo>
                    <div>
                      <Bouton rang="secondaire" onClick={annulerAnalyse}>
                        {fr.actions.annuler}
                      </Bouton>
                    </div>
                  </div>
                ) : null}

                {/* État terminal : chaque échec nomme son issue et propose
                    `Réessayer` — un nouveau run, jamais une résurrection. */}
                {erreurAnalyse === undefined ? null : (
                  <div className="flex flex-col gap-2">
                    <PanneauInfo ton="attention">{erreurAnalyse}</PanneauInfo>
                    <div>
                      <Bouton rang="secondaire" onClick={analyserSeance}>
                        {fr.actions.reessayer}
                      </Bouton>
                    </div>
                  </div>
                )}

                {/* Trois blocs, dans l'ordre exact du démo-spec (§2 bis),
                    entièrement en LECTURE SEULE — aucun champ ici n'écrit dans
                    `soap` ni n'appelle `saveNote`. Reprendre un fragment dans
                    l'éditeur SOAP ci-contre reste un geste manuel de la
                    praticienne (I6) ; `draft_clinical_note`, un outil distinct
                    et hors périmètre de cette passe, est ce qui préremplirait
                    un jour l'éditeur lui-même. */}
                {analyse === null ? null : (
                  <div className="flex flex-col gap-6">
                    {/* SA-03 — la portée, dite avant le contenu : sur les
                        seules notes du jour, ou avec N notes antérieures. */}
                    <PanneauInfo>{libelleSourcesAnalyse(analyse.sources.historiqueNotes)}</PanneauInfo>
                    <div className="flex flex-col gap-3">
                      <p className="font-ui text-label font-medium uppercase tracking-label text-ink-500">
                        {fr.consultation.noteStructureeTitre}
                      </p>
                      <div className="flex flex-col gap-4">
                        {CHAMPS_SOAP.map((champ) => (
                          <Champ
                            key={champ}
                            libelle={LIBELLES_SOAP[champ].titre}
                            valeur={analyse.noteStructuree[champ]}
                          />
                        ))}
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <p className="font-ui text-label font-medium uppercase tracking-label text-ink-500">
                        {fr.consultation.evolutionTitre}
                      </p>
                      {analyse.evolution.length === 0 ? (
                        <EtatVide message={fr.consultation.evolutionAucune} />
                      ) : (
                        <ul className="flex list-disc flex-col gap-2 pl-5 font-ui text-body text-ink-900">
                          {/* `key={ligne}` : ces entrées sont dédoublonnées côté
                              passerelle (index.ts, §3.4 n°6) — le texte lui-même
                              est une clé stable, pas un index de position. */}
                          {analyse.evolution.map((ligne) => (
                            <li key={ligne}>{ligne}</li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="flex flex-col gap-3">
                      <p className="font-ui text-label font-medium uppercase tracking-label text-ink-500">
                        {fr.consultation.pointsNonExploresTitre}
                      </p>
                      {analyse.pointsNonExplores.length === 0 ? (
                        <EtatVide message={fr.consultation.pointsNonExploresAucun} />
                      ) : (
                        <ul className="flex list-disc flex-col gap-2 pl-5 font-ui text-body text-ink-900">
                          {analyse.pointsNonExplores.map((ligne) => (
                            <li key={ligne}>{ligne}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </SectionPliable>
              </>
            }
          />
        </div>
      </div>
    );
  })();

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      titre={
        seance == null
          ? fr.consultation.titre
          : // Un rendez-vous sans dossier visible garde sa séance et perd
            // seulement son nom : faire disparaître l'écran masquerait une
            // consultation réelle (même raison que le LEFT JOIN en base).
            (nomPatient(seance.firstName, seance.lastName) ?? fr.agenda.patientNonRattache)
      }
      {...(seance?.practitionerName == null ? {} : { sousTitre: seance.practitionerName })}
      actions={
        // Chargé, le cockpit porte son propre chrono et sa propre sortie
        // (`CockpitHeader`) : les répéter dans la barre ferait deux chronos
        // et deux retours pour un écran. Déchargé, on garde la sortie.
        seance == null ? (
          <LienBouton href="/agenda">{fr.agenda.retourALAgenda}</LienBouton>
        ) : undefined
      }
    >
      <div className="mx-auto flex w-full flex-col gap-4">
        {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}

        {/*
          L'EN-TÊTE COCKPIT — compact, toujours clair. L'identité est portée
          une fois ici (et dans la barre supérieure) : nom, type et date se
          lisent en une ligne, le chrono reste modeste à l'autre bout.
        */}
        {seance == null ? null : (
          <CockpitHeader
            titre={nomPatient(seance.firstName, seance.lastName) ?? fr.agenda.patientNonRattache}
            meta={
              [
                seance.appointmentKind === null
                  ? null
                  : fr.agenda.types[seance.appointmentKind],
                jourComplet(seance.startedAt),
              ]
                .filter((m): m is string => m !== null)
                .join(" · ") || null
            }
            chrono={
              <ChronoSeance
                close={seanceClose}
                startedAt={seance.startedAt}
                endedAt={seance.endedAt}
              />
            }
            retour={
              <LienBouton href="/agenda" rang="discret">
                {fr.agenda.retourALAgenda}
              </LienBouton>
            }
          />
        )}

        {confirmation === undefined ? null : (
          <PanneauInfo ton="positif">{confirmation}</PanneauInfo>
        )}

        {/* V1.4 — un échec de LECTURE (chargement/rechargement de la séance)
            est rendu par `contenu` lui-même, qui REMPLACE l'espace de travail
            (05-UX-CONTRACT.md §1). Ce bloc-ci ne reste que pour une erreur
            D'ACTION (enregistrement, signature, amendement) sur une séance
            déjà chargée et affichée — un cas légitimement différent, où le
            travail clinique visible ne doit pas disparaître pour un
            enregistrement qui a échoué. */}
        {messageErreur === undefined || seance === null || echecLecture ? null : (
          <BlocErreur
            message={messageErreur}
            action={<Bouton onClick={() => charger(false)}>{fr.actions.reessayer}</Bouton>}
          />
        )}

        {/*
          LA SOUS-NAVIGATION. Elle n'apparaît que lorsqu'il y a une séance à
          naviguer : sur un écran en erreur ou introuvable, une barre d'onglets
          proposerait des sections qui ne mènent nulle part.
        */}
        {seance == null ? null : (
          <Onglets
            onglets={ongletsConsultation}
            actif={onglet}
            onChanger={setOnglet}
            etiquette={fr.consultation.onglets.etiquette}
          />
        )}

        {/* V10 — barre haute sticky : nav + secondaire + primaire, sous les
            onglets, jamais en bas qui masquait la note. Même logique métier. */}
        {seance == null || onglet !== "seance" ? null : (
          <BarreConsultation
            etatBrut={etatBrut}
            etatSoap={etatSoap}
            heureBrut={heureBrut}
            heureSoap={heureSoap}
            notesRenseignees={brut.trim() !== "" || !noteEstVide({ ...soap })}
            evaluationRenseignee={soap.assessment.trim() !== ""}
            conduiteRenseignee={soap.plan.trim() !== ""}
            tarifFixe={tarifPresent}
            peutClore={!seanceClose && tarifPresent === true}
            envoi={envoi}
            enregistrer={enregistrerMaintenant}
            clore={clore}
            voirTarif={voirTarif}
          />
        )}

        {/*
          ⚠️ LA SÉANCE RESTE MONTÉE, MÊME QUAND UN AUTRE ONGLET EST ACTIF, ET
          CE N'EST PAS UNE OPTIMISATION — C'EST UNE PROTECTION DU TRAVAIL.

          Le texte SOAP vit dans l'état de cette page et survivrait au démontage.
          Ce qui n'y survivrait PAS : les `ref` des zones de texte, dont dépend
          l'insertion de la dictée (`insererDictee`). Démonter l'éditeur pendant
          qu'une dictée est en vol ferait écrire dans une référence nulle — la
          phrase dictée serait perdue en silence, au pire moment.

          `hidden` plutôt qu'un démontage conditionnel : le DOM reste, la dictée
          garde sa cible, et le compte à rebours du verrou continue de courir.
        */}
        <div hidden={onglet !== "seance"}>
          {/* `PanneauOnglet` porte l'`id="panneau-seance"` que l'onglet
              designe par `aria-controls`. Sans lui, la barre pointerait vers
              un element inexistant : un lecteur d'ecran annoncerait un onglet
              dont il ne peut pas atteindre le panneau. */}
          <PanneauOnglet cle="seance">
          {contenu}

        {/* ADR-010 : le tarif se saisit EN FIN DE SÉANCE, donc juste au-dessus
            de la barre qui la termine. Le bloc reste visible après la clôture —
            une séance close dont le tarif n'a pas été fixé est précisément le
            cas où l'oubli coûte. Aucune décision de rôle ici : la porte 029
            refuse la séance d'une consœur, et c'est elle qui a raison. */}
        {seance == null ? null : (
          <div id="bloc-tarif" className="scroll-mt-6">
            <BlocTarif consultationId={seance.id} onEtatTarif={setTarifPresent} />
          </div>
        )}

        {/* 037 : sans ligne de paiement, la clôture est REFUSÉE. Le refus
            arrivait en P0001, donc en message générique — la praticienne
            relançait le même bouton sans savoir quoi corriger. On dit la règle
            ici, et on retire le bouton plutôt que de le proposer pour le
            refuser : le geste à faire est juste au-dessus.
            S1 tri-state : `tarifPresent === undefined` (chargement ou lecture
            en échec) n'autorise jamais Terminer et n'affiche jamais le rappel
            « sans tarif » — seul `true` autorise, seul `false` bloque. */}
        {seance == null || seanceClose || tarifPresent !== false ? null : (
          <PanneauInfo titre={fr.consultation.clotureSansTarifTitre} ton="attention">
            <p className="font-ui text-body">{fr.consultation.clotureSansTarif}</p>
          </PanneauInfo>
        )}
          </PanneauOnglet>
        </div>

        {/*
          LES ONGLETS DE CONTEXTE — montés à la demande, démontés en sortant.
          Aucun d'eux ne porte de saisie en cours : les démonter ne coûte rien
          et évite de garder en mémoire trois panneaux que personne ne regarde.
        */}
        {seance != null && patientId !== null && onglet === "historique" ? (
          <PanneauOnglet cle="historique">
            <PanneauHistorique patientId={patientId} consultationActuelleId={seance.id} />
          </PanneauOnglet>
        ) : null}

        {seance != null && patientId !== null && ongletContexte ? (
          <PanneauOnglet cle={onglet}>
            {erreurDossier !== undefined ? (
              <BlocErreur
                message={erreurDossier}
                action={<Bouton onClick={reessayerDossier}>{fr.actions.reessayer}</Bouton>}
              />
            ) : dossier == null ? (
              <Squelette lignes={6} />
            ) : onglet === "resume" ? (
              /*
                LE RÉSUMÉ D'AVANT-SÉANCE — DÉTERMINISTE, ZÉRO IA.

                Les trois sections viennent telles quelles de l'écran Patient.
                Aucune n'appelle de modèle : « Depuis la dernière fois » est un
                DIFF FACTUEL calculé sur les seules données du dossier
                (prescription, document émis, échelle passée), et « Point de
                situation » est le repli honnête qui ne s'appelle jamais
                « résumé ». Ce qui s'affiche ici est donc vrai même quand la
                passerelle est tombée — I20, et la règle 8 sur le fictif.

                Elles sont réemployées SANS COPIE : la même règle de calcul sert
                les deux écrans, donc les deux ne peuvent pas diverger.
              */
              <div className="mx-auto flex w-full max-w-lecture flex-col gap-8">
                <PointDeSituation espace={dossier} />
                <SectionDepuisDerniere espace={dossier} />
                <ListeSignaux espace={dossier} />
                {/* L'IDENTITÉ EN DERNIER, ET C'EST VOULU. Ce que la praticienne
                    cherche avant de recevoir, c'est ce qui a CHANGÉ ; l'âge et
                    le téléphone se consultent, ils ne s'annoncent pas. Les
                    placer en tête repousserait le seul contenu daté sous la
                    ligne de flottaison. C'est aussi la SEULE carte d'identité
                    de cet écran — l'en-tête porte déjà le nom, et le redire en
                    grand ferait deux titres pour un patient. */}
                <CarteIdentite espace={dossier} />
              </div>
            ) : onglet === "traitement" ? (
              <PanneauTraitements
                traitements={dossier.traitements}
                traitementsV2={dossier.traitementsV2}
                patientId={patientId}
                onRefresh={reessayerDossier}
              />
            ) : (
              <PanneauRendezVous agenda={dossier.agenda} />
            )}
          </PanneauOnglet>
        ) : null}

        {/* Les documents lisent seuls, comme dans l'écran Patient : ils n'ont
            pas besoin du dossier complet, seulement de l'identifiant. */}
        {seance != null && patientId !== null && onglet === "documents" ? (
          <PanneauOnglet cle="documents">
            <SectionDocumentsPatient patientId={patientId} />
          </PanneauOnglet>
        ) : null}
      </div>
    </AppShell>
  );
}
