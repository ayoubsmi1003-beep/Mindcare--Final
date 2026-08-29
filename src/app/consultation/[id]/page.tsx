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
  EspaceTravail,
  EtatVide,
  GrilleChamps,
  IndicateurEnregistrement,
  LienBouton,
  PanneauInfo,
  SectionPliable,
  Squelette,
} from "@/components/ui";
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
import { analyzeSession, type AnalyseSeance } from "@/services/jarvis";

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
  const generationAnalyse = useRef(0);
  const demonte = useRef(false);

  // L'horloge de l'écran. Un seul intervalle pour le chronomètre ET le décompte
  // de verrouillage : deux horloges pour un même écran finiraient par afficher
  // deux heures différentes, et l'une des deux porte sur une pièce juridique.
  const [maintenant, setMaintenant] = useState(() => Date.now());

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

  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), PAS_HORLOGE_MS);
    return () => clearInterval(t);
  }, []);

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
    },
    [],
  );

  const note = seance?.note ?? null;
  const etatVerrou = noteEstVerrouillee(note, maintenant);
  const restantMs = tempsRestantAvantVerrou(note, maintenant);
  const seanceClose = seance?.status === "closed";
  /**
   * LE MODE SÉANCE ne s'arme que sur une séance OUVERTE. Une consultation
   * close se relit comme un document : elle reprend la coquille normale, avec
   * son rail et sa barre. Se retrouver dans le noir pour relire une note d'il
   * y a trois semaines serait un effet de style, pas une aide.
   */
  const enSeance = seance != null && !seanceClose;
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
    if (minuteurSoap.current !== undefined) {
      clearTimeout(minuteurSoap.current);
      minuteurSoap.current = undefined;
    }
    if (minuteurBrut.current !== undefined) {
      clearTimeout(minuteurBrut.current);
      minuteurBrut.current = undefined;
      const r = await saveRawNotes(id, brut);
      if (!r.ok) {
        setEtatBrut("echec");
        return false;
      }
      setEtatBrut("enregistre");
    }
    const complet: Partial<Record<ChampSoap, string>> = {};
    for (const champ of CHAMPS_SOAP) complet[champ] = soap[champ];
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
      // L'identifiant de note est relu APRÈS l'enregistrement : sur une première
      // note, il n'existait pas avant.
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
   * Idempotence (§3.4 n°7) : le bouton se désactive DÈS le premier clic, via
   * `enAnalyse`, avant même que la promesse ne se résolve — un second clic
   * rapide ne peut pas déclencher un second appel tant que le premier est en
   * cours.
   */
  function analyserSeance(): void {
    setErreurAnalyse(undefined);
    setEnAnalyse(true);
    generationAnalyse.current += 1;
    const generation = generationAnalyse.current;

    void analyzeSession(id).then((result) => {
      // Réponse tardive ignorée (§3.4 n°8) : la page a démonté, ou un appel
      // plus récent a déjà pris la main. On ne touche à AUCUN état.
      if (demonte.current || generation !== generationAnalyse.current) return;

      setEnAnalyse(false);
      if (!result.ok) {
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
      <EspaceTravail
        travail={
          <>
            <SectionPliable
              titre={fr.consultation.notesBrutes}
              action={
                <IndicateurEnregistrement
                  etat={etatBrut}
                  {...(heureBrut === undefined ? {} : { horodatage: heureBrut })}
                />
              }
            >
              <div className="flex flex-col gap-3">
                <ChampZoneTexte
                  libelle={fr.consultation.notesBrutes}
                  valeur={brut}
                  onChange={enregistrerBrut}
                  lignes={8}
                  clinique
                  disabled={seanceClose}
                  indication={
                    seanceClose
                      ? fr.consultation.notesBrutesFigees
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

            <SectionPliable
              titre={fr.consultation.note}
              {...(note?.status === "signed" ? { annotation: fr.feedback.noteSignee } : {})}
              action={
                noteModifiable ? (
                  <IndicateurEnregistrement
                    etat={etatSoap}
                    {...(heureSoap === undefined ? {} : { horodatage: heureSoap })}
                  />
                ) : null
              }
            >
              <div className="flex flex-col gap-6">
                {/* L'ÉTAT DU VERROU, DIT EXPLICITEMENT. Une note qu'on ne peut
                    plus modifier sans que l'écran l'explique se lit comme une
                    panne, et la praticienne cherche à contourner. */}
                {etatVerrou === "fenetre-correction" && restantMs !== null ? (
                  <PanneauInfo ton="attention" titre={fr.consultation.fenetreCorrection}>
                    <span className="font-num tabular-nums">{decompte(restantMs)}</span>
                    {" — "}
                    {fr.consultation.fenetreIndication}
                  </PanneauInfo>
                ) : null}

                {etatVerrou === "verrouillee" ? (
                  <PanneauInfo titre={fr.consultation.verrouillee}>
                    {fr.consultation.verrouParLaBase}
                  </PanneauInfo>
                ) : null}

                {noteModifiable ? (
                  CHAMPS_SOAP.map((champ) => (
                    <ChampZoneTexte
                      key={champ}
                      libelle={LIBELLES_SOAP[champ].titre}
                      indication={LIBELLES_SOAP[champ].indication}
                      valeur={soap[champ]}
                      onChange={(v) => enregistrerSoap(champ, v)}
                      lignes={5}
                      clinique
                    />
                  ))
                ) : (
                  <div className="flex flex-col gap-6">
                    {CHAMPS_SOAP.map((champ) => (
                      <Champ
                        key={champ}
                        libelle={LIBELLES_SOAP[champ].titre}
                        valeur={note?.soap[champ] ?? null}
                      />
                    ))}
                  </div>
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
            </SectionPliable>

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
        }
        contexte={
          <>
            <Carte>
              <div className="p-6">
                <GrilleChamps>
                  <Champ
                    libelle={fr.agenda.patient}
                    valeur={nomPatient(seance.firstName, seance.lastName)}
                  />
                  <Champ libelle={fr.patients.numeroDossier} valeur={seance.recordNumber} />
                  <Champ
                    libelle={fr.consultation.typeConsultation}
                    valeur={
                      seance.appointmentKind === null
                        ? null
                        : fr.agenda.types[seance.appointmentKind]
                    }
                  />
                  <Champ libelle={fr.consultation.debut} valeur={jourComplet(seance.startedAt)} />
                  {seance.endedAt === null ? null : (
                    <Champ libelle={fr.consultation.fin} valeur={jourComplet(seance.endedAt)} />
                  )}
                </GrilleChamps>
              </div>
            </Carte>

            {/* LES DEUX EMPLACEMENTS DES MODULES À VENIR. Ils sont posés
                maintenant pour que la transcription (semaine 2) et l'analyse de
                séance (S6) s'ajoutent sans redécouper la page — et ils disent
                honnêtement qu'ils sont vides (I19). */}
            <SectionPliable titre={fr.consultation.filSeance}>
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
                    personne n'a encore produit. */}
                {enAnalyse ? <PanneauInfo>{fr.consultation.analyseEnCours}</PanneauInfo> : null}

                {erreurAnalyse === undefined ? null : (
                  <PanneauInfo ton="attention">{erreurAnalyse}</PanneauInfo>
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
    );
  })();

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      modeSeance={enSeance}
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
        seance == null ? (
          <LienBouton href="/agenda">{fr.agenda.retourALAgenda}</LienBouton>
        ) : (
          <div className="flex flex-wrap items-center gap-4">
            {/* Le chronomètre s'arrête à la clôture : une séance close affiche
                sa durée réelle si elle est connue, ou le dit honnêtement sinon
                (V1.3) — jamais un compteur qui continue. */}
            <span className="font-num text-num tabular-nums text-ink-900">
              {dureeAffichee(seanceClose, seance.startedAt, seance.endedAt, maintenant)}
            </span>
            <LienBouton href="/agenda" rang="discret">
              {fr.agenda.retourALAgenda}
            </LienBouton>
          </div>
        )
      }
    >
      <div className="mx-auto flex w-full max-w-main flex-col gap-8">
        {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}

        {/*
          L'EN-TÊTE DE SÉANCE — visible UNIQUEMENT dans le mode séance.
          Hors séance, l'identité est portée par la barre supérieure et
          répéter le nom ici ferait deux titres pour un écran.

          Dans la séance, il n'y a plus de barre : ce bloc EST le seul repère.
          Le nom domine, le chrono se lit d'un coup d'œil à l'autre bout de la
          ligne, et la seule sortie reste atteignable sans chercher.
        */}
        {enSeance && seance != null ? (
          <header className="flex flex-wrap items-baseline justify-between gap-4 border-b border-rule pb-5">
            <div className="flex min-w-0 flex-col gap-1">
              <h1 className="truncate font-ui text-display font-bold tracking-display text-ink-900">
                {nomPatient(seance.firstName, seance.lastName) ?? fr.agenda.patientNonRattache}
              </h1>
              {seance.practitionerName == null ? null : (
                <p className="font-ui text-body font-regular text-ink-500">
                  {seance.practitionerName}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-5">
              <span
                /* Le chrono en chiffres tabulaires : sans `tabular-nums`, les
                   secondes font trembler la ligne à chaque seconde. */
                className="font-num text-metric font-semibold tabular-nums tracking-metric text-ink-900"
              >
                {dureeAffichee(seanceClose, seance.startedAt, seance.endedAt, maintenant)}
              </span>
              <LienBouton href="/agenda" rang="discret">
                {fr.agenda.retourALAgenda}
              </LienBouton>
            </div>
          </header>
        ) : null}

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

        {contenu}

        {/* ADR-010 : le tarif se saisit EN FIN DE SÉANCE, donc juste au-dessus
            du bouton qui la termine. Le bloc reste visible après la clôture —
            une séance close dont le tarif n'a pas été fixé est précisément le
            cas où l'oubli coûte. Aucune décision de rôle ici : la porte 029
            refuse la séance d'une consœur, et c'est elle qui a raison. */}
        {seance == null ? null : (
          <BlocTarif consultationId={seance.id} onEtatTarif={setTarifPresent} />
        )}

        {/* 037 : sans ligne de paiement, la clôture est REFUSÉE. Le refus
            arrivait en P0001, donc en message générique — la praticienne
            relançait le même bouton sans savoir quoi corriger. On dit la règle
            ici, et on retire le bouton plutôt que de le proposer pour le
            refuser : le geste à faire est juste au-dessus. */}
        {seance == null || seanceClose || tarifPresent !== false ? null : (
          <PanneauInfo titre={fr.consultation.clotureSansTarifTitre} ton="attention">
            <p className="font-ui text-body">{fr.consultation.clotureSansTarif}</p>
          </PanneauInfo>
        )}

        {seance == null ? null : (
          <BarreActions>
            {/* Le bouton disparaît quand il n'a plus de sens, il ne reste pas
                grisé : une commande grisée en permanence apprend à ne plus la
                regarder. La SIGNATURE, elle, reste visible et grisée pendant la
                fenêtre de correction — c'est une information. */}
            {note === null || note.status === "draft" ? (
              <Bouton rang="principal" onClick={signer} disabled={envoi || seance === null}>
                {fr.actions.signerLaNote}
              </Bouton>
            ) : null}
            {seanceClose || tarifPresent === false ? null : (
              <Bouton onClick={clore} disabled={envoi}>
                {fr.actions.terminerLaSeance}
              </Bouton>
            )}
          </BarreActions>
        )}
      </div>
    </AppShell>
  );
}
