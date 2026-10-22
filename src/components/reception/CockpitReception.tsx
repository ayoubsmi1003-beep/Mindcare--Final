/**
 * CockpitReception — Reception Console (refonte).
 * 3 colonnes, zéro scroll page à 1440×900, file d'attente première classe,
 * encaissements dédupliqués, recherche en dropdown absolu.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fr } from "@/i18n/fr";
import { plage } from "@/components/AgendaPieces";
import { BandeauHorsLigne, BlocErreur, Squelette } from "@/components/ui/Etats";
import { Bouton, LienBouton } from "@/components/ui/Bouton";

import { getReceptionBoard,
  markAppointmentArrived,
  markAppointmentNoShow,
  type PaiementAccueil,
  type RdvAccueil,
  type TableauAccueil,
} from "@/services/reception";
import { listNotifications, markNotificationRead, type NotificationItem } from "@/services/notifications";
import { confirmAppointment } from "@/services/appointments";
import { acquitterAppel, appelActif, type AppelActif } from "@/services/cabinet-collaboration";

import { useEvenementsCabinet } from "@/components/useEvenementsCabinet";
import { EtatConnexionCabinet } from "@/components/coquille/EtatConnexionCabinet";

import { FriseJour } from "./FriseJour";
import { AgendaCompact } from "./AgendaCompact";
import { ZoneAttention } from "./ZoneAttention";
import { FileArrivees } from "./FileArrivees";
import { PaiementsZone } from "./PaiementsZone";
import { ModalEncaissement } from "./ModalEncaissement";
import { CentreNotifications } from "./CentreNotifications";
import { PreparationJour } from "./PreparationJour";
import { TiroirDeplacement } from "./TiroirDeplacement";
import { ResultatsRecherche } from "./RechercheEclair";
import { TopbarReception } from "./TopbarReception";
import { PulseReception } from "./PulseReception";
import { DockActions } from "./DockActions";
import { BandeauAppelMedecin } from "./BandeauAppelMedecin";

const INTERVALLE_BOARD_MS = 120_000;
const INTERVALLE_NOTIFICATIONS_MS = 30_000;
const INTERVALLE_TICK_MS = 30_000;

/**
 * Le dernier tableau VÉRIFIÉ, conservé pour la session du navigateur.
 *
 * ═══ POURQUOI UN CACHE, ET CE QU'IL N'EST PAS ══════════════════════════════
 *
 * Si le lien tombe pendant que l'accueil travaille, l'écran garde en mémoire ce
 * qu'il affichait — mais un rechargement de page (F5, navigation interne) le
 * perdrait, et le poste se retrouverait devant un squelette alors que la salle
 * d'attente est pleine. `sessionStorage` survit à un rechargement, pas à la
 * fermeture de l'application, et il est effacé avec l'onglet.
 *
 * Ce cache n'est JAMAIS une source de vérité : il n'autorise aucune écriture,
 * il porte l'horodatage de sa capture, et il n'est affiché qu'avec le bandeau
 * « hors ligne ». Aucune donnée n'est rejouée vers le serveur.
 */
const CLE_SNAPSHOT = "mindcare:accueil:";

interface SnapshotAccueil {
  readonly board: TableauAccueil | null;
  readonly horodatage: string;
}

function lireSnapshot(jourIso: string): SnapshotAccueil | null {
  try {
    const brut = window.sessionStorage.getItem(`${CLE_SNAPSHOT}${jourIso}`);
    if (brut === null) return null;
    const valeur: unknown = JSON.parse(brut);
    if (typeof valeur !== "object" || valeur === null) return null;
    const snapshot = valeur as SnapshotAccueil;
    if (typeof snapshot.horodatage !== "string") return null;
    return snapshot;
  } catch {
    return null;
  }
}

function ecrireSnapshot(jourIso: string, board: TableauAccueil | null, horodatage: string): void {
  try {
    window.sessionStorage.setItem(`${CLE_SNAPSHOT}${jourIso}`, JSON.stringify({ board, horodatage }));
  } catch {
    // Quota plein ou navigation privée : le cache est un confort, jamais une
    // condition de fonctionnement.
  }
}

function versJourIso(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const j = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${j}`;
}
function depuisJourIso(iso: string): Date {
  const [y, m, j] = iso.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, j ?? 1);
}
function versSaisieJour(iso: string): string {
  const [y, m, j] = iso.split("-");
  return `${j ?? ""}/${m ?? ""}/${y ?? ""}`;
}

export interface CockpitReceptionProps {
  readonly horsLigneSession: boolean;
}

export function CockpitReception({ horsLigneSession }: CockpitReceptionProps): React.JSX.Element {
  const router = useRouter();

  const [board, setBoard] = useState<TableauAccueil | null | undefined>(undefined);
  const [notifications, setNotifications] = useState<readonly NotificationItem[]>([]);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);

  const [maintenant, setMaintenant] = useState<Date>(() => new Date());
  const [ancre, setAncre] = useState<string>(() => versJourIso(new Date()));
  const [requete, setRequete] = useState("");

  const [selectionId, setSelectionId] = useState<string | null>(null);
  const [encaissementCible, setEncaissementCible] = useState<PaiementAccueil | null>(null);
  const [deplacementOuvert, setDeplacementOuvert] = useState(false);
  const [feedback, setFeedback] = useState<string | undefined>(undefined);
  const [appel, setAppel] = useState<AppelActif | null>(null);
  const [derniereSynchro, setDerniereSynchro] = useState<string | null>(null);
  /**
   * Écart d'horloge entre ce poste et le PC médecin, mesuré sur `genere_a`.
   * Toutes les durées affichées (retards, attente) sont calculées avec cette
   * correction : une montre en avance ne doit pas inventer des retards.
   */
  const decalageRef = useRef(0);

  const rechercheRef = useRef<HTMLInputElement>(null);
  const attenteRef = useRef<HTMLDivElement>(null);
  const encaissementRef = useRef<HTMLDivElement>(null);
  const jourIso = ancre;

  const rechargerBoard = useCallback(async (): Promise<void> => {
    const result = await getReceptionBoard(jourIso);
    if (!result.ok) {
      const coupe = result.error.code === "hors-ligne";
      setHorsLigne(coupe);
      setErreur(coupe ? undefined : result.error.message);
      if (coupe) {
        // Le lien est tombé : on garde ce qui est affiché, sinon on reprend le
        // dernier cliché vérifié de la session, clairement badgé plus bas.
        const snapshot = lireSnapshot(jourIso);
        setBoard((courant) => (courant !== undefined ? courant : (snapshot?.board ?? null)));
        if (snapshot !== null) setDerniereSynchro(snapshot.horodatage);
      }
      return;
    }
    setHorsLigne(false);
    setErreur(undefined);
    setBoard(result.data);
    // Instant d'observation LOCAL de la dernière synchronisation réussie. Ce
    // n'est pas un horodatage clinique : il sert uniquement à dire « voici de
    // quand datent les données que vous regardez » quand le lien tombe.
    const horodatage = new Date().toISOString();
    setDerniereSynchro(horodatage);
    ecrireSnapshot(jourIso, result.data, horodatage);
    const serveur = result.data?.genereA === null || result.data?.genereA === undefined
      ? Number.NaN
      : Date.parse(result.data.genereA);
    if (Number.isFinite(serveur)) {
      decalageRef.current = serveur - Date.now();
      setMaintenant(new Date(serveur));
    }
  }, [jourIso]);

  const rechargerNotifications = useCallback(async (): Promise<void> => {
    const result = await listNotifications();
    if (result.ok) setNotifications(result.data);
  }, []);

  const rechargerAppel = useCallback(async (): Promise<void> => {
    const result = await appelActif();
    if (result.ok) setAppel(result.data);
  }, []);

  useEffect(() => {
    void rechargerBoard();
    void rechargerNotifications();
    void rechargerAppel();
    setMaintenant(new Date(Date.now() + decalageRef.current));
  }, [rechargerBoard, rechargerNotifications, rechargerAppel]);

  useEffect(() => {
    const boardTimer = setInterval(() => {
      if (document.visibilityState === "visible") void rechargerBoard();
    }, INTERVALLE_BOARD_MS);
    const notifsTimer = setInterval(() => {
      if (document.visibilityState === "visible") void rechargerNotifications();
    }, INTERVALLE_NOTIFICATIONS_MS);
    function auRetour(): void {
      if (document.visibilityState !== "visible") return;
      setMaintenant(new Date(Date.now() + decalageRef.current));
      void rechargerBoard();
      void rechargerNotifications();
    }
    document.addEventListener("visibilitychange", auRetour);
    return () => {
      clearInterval(boardTimer);
      clearInterval(notifsTimer);
      document.removeEventListener("visibilitychange", auRetour);
    };
  }, [rechargerBoard, rechargerNotifications]);

  useEffect(() => {
    // Le curseur « maintenant » suit l'horloge du CABINET, pas celle du poste :
    // `decalageRef` est recalé à chaque lecture réussie du tableau.
    const tick = setInterval(() => setMaintenant(new Date(Date.now() + decalageRef.current)), INTERVALLE_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  function apresMutation(): void {
    void rechargerBoard();
    void rechargerNotifications();
  }

  /**
   * Le flux temps réel : il ne transporte aucune donnée, seulement « quelque
   * chose a changé ». Chaque zone redemande par sa porte habituelle, sous
   * l'identité de la session — le flux ne remplace jamais une autorisation.
   *
   * Les rappels sont lus par référence dans le hook : cette fonction peut
   * changer à chaque rendu sans rouvrir la connexion.
   */
  const surEvenement = useCallback(
    (evenement: { readonly kind: string }): void => {
      if (evenement.kind === "assistant_call") {
        void rechargerAppel();
        return;
      }
      if (evenement.kind === "message_updated") {
        // Le bouton de messagerie de la barre supérieure a sa propre cadence
        // de secours ; rien à forcer ici.
        return;
      }
      // Agenda, arrivées, tarifs, paiements, notifications : tout passe par le
      // tableau et la liste de notifications, qui sont les deux lectures
      // autorisées de cet écran.
      void rechargerBoard();
      void rechargerNotifications();
    },
    [rechargerAppel, rechargerBoard, rechargerNotifications],
  );

  const resynchroniser = useCallback((): void => {
    void rechargerBoard();
    void rechargerNotifications();
    void rechargerAppel();
  }, [rechargerAppel, rechargerBoard, rechargerNotifications]);

  const { etat: etatFlux } = useEvenementsCabinet({
    actif: true,
    onEvenement: surEvenement,
    onResynchronisation: resynchroniser,
  });

  const degrade = horsLigne || etatFlux === "reconnexion" || etatFlux === "hors_ligne";
  const [blocage, setBlocage] = useState<string | null>(null);

  // Le retour du lien efface la raison de blocage : la garder affichée
  // laisserait croire que l'écriture est encore interdite.
  useEffect(() => {
    if (!degrade) setBlocage(null);
  }, [degrade]);

  /**
   * Refuse une écriture quand le lien est dégradé, EN DISANT POURQUOI.
   *
   * ⚠️ CE N'EST PAS UNE DÉCISION DE SÉCURITÉ. La RLS et les portes décident de
   * ce qui est permis ; ici on évite seulement d'envoyer une écriture dont on
   * sait déjà qu'elle échouera, et surtout on empêche l'écran d'afficher un
   * état optimiste qui ne serait jamais confirmé. Une écriture partie est
   * toujours tranchée par le serveur.
   */
  function refuserHorsLigne(): boolean {
    if (!degrade) return false;
    setBlocage(fr.collaboration.connexion.horsLigneDetail);
    return true;
  }

  async function confirmerArrivee(rdv: RdvAccueil): Promise<void> {
    if (refuserHorsLigne()) return;
    setFeedback(undefined);
    const result = await markAppointmentArrived(rdv.id);
    if (!result.ok) {
      setErreur(result.error.message);
      return;
    }
    if (!result.data) return;
    setFeedback(fr.reception.feedback.arriveeConfirmee);
    apresMutation();
  }
  async function confirmerAbsent(rdv: RdvAccueil): Promise<void> {
    if (refuserHorsLigne()) return;
    setFeedback(undefined);
    const result = await markAppointmentNoShow(rdv.id);
    if (!result.ok) {
      setErreur(result.error.message);
      return;
    }
    if (!result.data) return;
    setFeedback(fr.reception.feedback.absentConfirme);
    apresMutation();
  }
  async function confirmerDemande(rdv: RdvAccueil): Promise<void> {
    if (refuserHorsLigne()) return;
    setFeedback(undefined);
    const result = await confirmAppointment(rdv.id);
    if (!result.ok) {
      setErreur(result.error.message);
      return;
    }
    if (!result.data) return;
    setFeedback(fr.feedback.confirme);
    apresMutation();
  }
  async function marquerLu(id: string): Promise<void> {
    const result = await markNotificationRead(id);
    if (!result.ok || !result.data) return;
    setFeedback(fr.reception.feedback.notificationLue);
    void rechargerNotifications();
  }

  /**
   * Accusé humain de l'appel. On ne retire le bandeau QUE si la porte a
   * confirmé l'écriture : une réponse qui n'est pas partie laisserait le
   * médecin attendre sans le savoir.
   */
  async function repondreAppel(callId: string): Promise<void> {
    const result = await acquitterAppel(callId);
    if (!result.ok || result.data !== true) {
      throw new Error("acquittement-non-confirme");
    }
    setAppel(null);
  }
  function ouvrirEncaissement(paiement: PaiementAccueil): void {
    if (refuserHorsLigne()) return;
    setDeplacementOuvert(false);
    setEncaissementCible(paiement);
  }
  function ouvrirDeplacement(): void {
    if (refuserHorsLigne()) return;
    setEncaissementCible(null);
    setDeplacementOuvert(true);
  }
  function paiementDuRdv(rdv: RdvAccueil): PaiementAccueil | undefined {
    if (rdv.patientId === null) return undefined;
    return paiements.find((p) => p.collectedAt === null && p.patientId === rdv.patientId);
  }

  const { journee, demandes, paiements: paiementsBoard } = useMemo(
    () => ({
      journee: board?.journee ?? [],
      demandes: board?.demandes ?? [],
      paiements: board?.paiements ?? [],
    }),
    [board],
  );
  const paiements = paiementsBoard;
  const rdvSelectionne = useMemo(
    () => (selectionId === null ? null : (journee.find((r) => r.id === selectionId) ?? demandes.find((r) => r.id === selectionId) ?? null)),
    [journee, demandes, selectionId],
  );
  const paiementsDus = useMemo(() => paiements.filter((p) => p.collectedAt === null), [paiements]);
  const compteurs = useMemo(() => {
    let retards = 0;
    let attente = 0;
    for (const rdv of journee) {
      if (rdv.status === "confirmed") {
        const debut = Date.parse(rdv.startsAt);
        if (!Number.isNaN(debut) && maintenant.getTime() > debut) retards += 1;
      }
      if (rdv.status === "arrived") attente += 1;
    }
    return { attente, retards };
  }, [journee, maintenant]);

  const boardRef = useRef(board);
  boardRef.current = board;
  const gestesRef = useRef({ confirmerArrivee, ouvrirEncaissement, ouvrirDeplacement, paiementDuRdv });
  gestesRef.current = { confirmerArrivee, ouvrirEncaissement, ouvrirDeplacement, paiementDuRdv };

  useEffect(() => {
    function auClavier(evenement: KeyboardEvent): void {
      if (evenement.metaKey || evenement.ctrlKey || evenement.altKey) return;
      if (evenement.isComposing) return;
      const cible = evenement.target as HTMLElement | null;
      const saisie = cible !== null && (cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.tagName === "SELECT" || cible.isContentEditable);
      if (evenement.key === "Escape" && !saisie) {
        setEncaissementCible(null);
        setDeplacementOuvert(false);
        return;
      }
      if (saisie) return;
      if (evenement.key === "/") {
        evenement.preventDefault();
        rechercheRef.current?.focus();
        return;
      }
      const touche = evenement.key.toLowerCase();
      if (touche === "t") {
        setAncre(versJourIso(new Date()));
        return;
      }
      if (touche === "n") {
        router.push("/agenda/nouveau");
        return;
      }
      const gestes = gestesRef.current;
      const boardCourant = boardRef.current;
      const rdv = selectionId === null ? null : (boardCourant?.journee.find((r) => r.id === selectionId) ?? boardCourant?.demandes.find((r) => r.id === selectionId) ?? null);
      if (rdv === null) return;
      if (touche === "a" && rdv.status === "confirmed") {
        void gestes.confirmerArrivee(rdv);
        return;
      }
      if (touche === "p") {
        const paiement = gestes.paiementDuRdv(rdv);
        if (paiement !== undefined) gestes.ouvrirEncaissement(paiement);
        return;
      }
      if (touche === "r") gestes.ouvrirDeplacement();
    }
    window.addEventListener("keydown", auClavier);
    return () => window.removeEventListener("keydown", auClavier);
  }, [router, selectionId]);

  const aujourdhuiIso = versJourIso(maintenant);
  function decaler(jours: number): void {
    const d = depuisJourIso(ancre);
    d.setDate(d.getDate() + jours);
    setAncre(versJourIso(d));
    setSelectionId(null);
    setDeplacementOuvert(false);
  }

  const nbPraticiennes = useMemo(() => new Set(journee.map((r) => r.practitionerId)).size, [journee]);
  const useCompact = nbPraticiennes <= 1;

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Topbar + recherche dropdown absolu */}
      <div className="relative shrink-0">
        <TopbarReception
          ancreIso={ancre}
          aujourdhuiIso={aujourdhuiIso}
          versSaisieJour={versSaisieJour}
          requete={requete}
          onRequete={setRequete}
          rechercheRef={rechercheRef}
        />
        {requete.trim().length >= 2 ? <ResultatsRecherche requete={requete} onFermer={() => setRequete("")} /> : null}
      </div>

      {/* État de la liaison : pastille discrète quand tout va bien, surface
          d'attention dès que le lien tombe. « Connecté » ne signifie jamais
          « tout est synchronisé » — chaque écriture reste confirmée par sa
          propre réponse. */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <EtatConnexionCabinet etat={etatFlux} derniereSynchro={derniereSynchro} />
      </div>

      {appel !== null ? (
        <BandeauAppelMedecin
          appel={appel}
          onAcquitter={repondreAppel}
          onExpirer={() => setAppel(null)}
        />
      ) : null}

      <PulseReception
        attente={compteurs.attente}
        retards={compteurs.retards}
        aEncaisser={paiementsDus.length}
        demandes={demandes.length}
        onFocusAttente={() => attenteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onFocusEncaisser={() => encaissementRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onFocusDemandes={() => attenteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      {(degrade || horsLigneSession) && board != null ? (
        <div className="flex shrink-0 flex-col gap-1">
          <BandeauHorsLigne />
          <p className="m-0 font-ui text-label text-attention-ink">
            {fr.collaboration.connexion.horsLigneDetail}
            {derniereSynchro !== null ? ` ${fr.collaboration.connexion.derniereSynchro} : ${new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(derniereSynchro))}.` : null}
          </p>
          {blocage !== null ? (
            <p role="status" className="m-0 font-ui text-label font-medium text-attention-ink">
              {blocage}
            </p>
          ) : null}
        </div>
      ) : null}
      {feedback !== undefined ? (
        <p role="status" className="shrink-0 rounded-md border border-positive bg-positive-bg px-4 py-2 font-ui text-body text-positive">
          {feedback}
        </p>
      ) : null}
      {erreur !== undefined && !horsLigne ? (
        <BlocErreur
          message={erreur}
          action={
            <Bouton rang="principal" onClick={() => void rechargerBoard()}>
              {fr.actions.reessayer}
            </Bouton>
          }
        />
      ) : null}

      {board == null ? (
        degrade || horsLigneSession ? (
          <BlocErreur
            message={fr.collaboration.connexion.horsLigneDetail}
            action={
              <Bouton rang="principal" onClick={() => void rechargerBoard()}>
                {fr.actions.reessayer}
              </Bouton>
            }
          />
        ) : (
          <Squelette lignes={8} />
        )
      ) : (
        <>
          {/* BENTO — ligne 1 : Journée (2/3) + pile Attention/Arrivées (1/3) */}
          <div className="grid gap-4 tablet:grid-cols-receptionMiddle">
            <section aria-label={fr.reception.frise.titre} className="flex min-h-0 flex-col gap-3 overflow-hidden rounded-2xl border border-rule bg-card p-5 shadow-lift1">
              <div className="flex shrink-0 items-center gap-2">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-brand-600 text-on-brand shadow-lift1">
                    <span className="font-ui text-label font-bold">J</span>
                  </span>
                  <h2 className="font-ui text-heading font-semibold text-ink-900">{fr.reception.frise.titre}</h2>
                  <span className="rounded-full bg-brand-50 px-2.5 py-0.5 font-num text-label font-semibold tabular-nums text-brand-700">{journee.length}</span>
                </div>
                <div className="ml-auto flex items-center gap-1 rounded-full bg-sunken p-1">
                  <Bouton rang="discret" onClick={() => decaler(-1)}>
                    ‹
                  </Bouton>
                  <Bouton rang="discret" onClick={() => setAncre(aujourdhuiIso)}>
                    {fr.agenda.aujourdhui}
                  </Bouton>
                  <Bouton rang="discret" onClick={() => decaler(1)}>
                    ›
                  </Bouton>
                  <LienBouton href="/agenda" rang="discret">
                    {fr.agenda.semaine.vueSemaine}
                  </LienBouton>
                </div>
              </div>

              {journee.length === 0 && demandes.length === 0 ? (
                <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-rule bg-sunken px-6 py-10">
                  <span aria-hidden="true" className="flex h-14 w-14 items-center justify-center rounded-2xl bg-card shadow-lift1">
                    <span className="h-8 w-8 rounded-xl bg-grad-empty opacity-disabled" />
                  </span>
                  <p className="font-ui text-body font-medium text-ink-700">{fr.reception.frise.videJournee}</p>
                  <p className="max-w-form text-center font-ui text-label text-ink-500">Les rendez-vous du jour apparaissent ici. Créez le premier en un clic.</p>
                  <LienBouton href="/agenda/nouveau" rang="principal">
                    {fr.reception.frise.nouveauRdv}
                  </LienBouton>
                </div>
              ) : useCompact ? (
                <AgendaCompact
                  journee={journee}
                  maintenant={maintenant}
                  estAujourdhui={ancre === aujourdhuiIso}
                  selectionId={selectionId}
                  onSelectRdv={(id) => {
                    setSelectionId(id);
                    setDeplacementOuvert(false);
                  }}
                  paiementPour={paiementDuRdv}
                />
              ) : (
                <FriseJour
                  journee={journee}
                  maintenant={maintenant}
                  estAujourdhui={ancre === aujourdhuiIso}
                  selectionId={selectionId}
                  onSelectRdv={(id) => {
                    setSelectionId(id);
                    setDeplacementOuvert(false);
                  }}
                />
              )}

              {rdvSelectionne !== null ? (
                <BarreContextuelle
                  rdv={rdvSelectionne}
                  paiementDisponible={paiementDuRdv(rdvSelectionne) !== undefined}
                  desactive={degrade}
                  onArrivee={() => void confirmerArrivee(rdvSelectionne)}
                  onAbsent={() => void confirmerAbsent(rdvSelectionne)}
                  onPaiement={() => {
                    const p = paiementDuRdv(rdvSelectionne);
                    if (p !== undefined) ouvrirEncaissement(p);
                  }}
                  onDeplacer={ouvrirDeplacement}
                  onClose={() => setSelectionId(null)}
                />
              ) : (
                <p className="shrink-0 rounded-lg bg-sunken px-3 py-2 font-ui text-label text-ink-500">{fr.reception.frise.selectionHint}</p>
              )}
            </section>

            <div ref={attenteRef} className="flex min-h-0 flex-col gap-4">
              <div className="rounded-2xl border border-rule bg-card p-5 shadow-lift1">
                <ZoneAttention
                  journee={journee}
                  demandes={demandes}
                  paiements={paiements}
                  maintenant={maintenant}
                  onFocusEncaissement={ouvrirEncaissement}
                  onArrivee={(rdv) => void confirmerArrivee(rdv)}
                  onConfirmationDemande={(rdv) => void confirmerDemande(rdv)}
                  onSelectRdv={setSelectionId}
                />
              </div>
              <div className="rounded-2xl border border-rule bg-card p-5 shadow-lift1">
                <FileArrivees journee={journee} maintenant={maintenant} onAbsent={(rdv) => void confirmerAbsent(rdv)} onSelectRdv={setSelectionId} />
              </div>
            </div>
          </div>

          {/* BENTO — ligne 2 : Paiements | Notifications | Clôture  */}
          <div ref={encaissementRef} className="grid gap-4 tablet:grid-cols-receptionBottom">
            <div className="rounded-2xl border border-rule bg-card p-5 shadow-lift1">
              <PaiementsZone paiements={paiements} maintenant={maintenant} onEncaisser={ouvrirEncaissement} />
            </div>
            <div className="rounded-2xl border border-rule bg-card p-5 shadow-lift1">
              <CentreNotifications
                notifications={notifications}
                paiementsDus={paiementsDus}
                onMarquerLu={(id) => void marquerLu(id)}
                onFocusEncaissement={ouvrirEncaissement}
              />
            </div>
            <div className="rounded-2xl border border-rule bg-card p-5 shadow-lift1">
              <PreparationJour journee={journee} paiements={paiements} />
            </div>
          </div>

          <DockActions journee={journee} paiements={paiements} onRechercheFocus={() => rechercheRef.current?.focus()} />

          {encaissementCible !== null ? (
            <ModalEncaissement paiement={encaissementCible} onFermer={() => setEncaissementCible(null)} apresMutation={apresMutation} />
          ) : null}

          {deplacementOuvert && rdvSelectionne !== null ? (
            <TiroirDeplacement
              rdv={rdvSelectionne}
              onFerme={() => setDeplacementOuvert(false)}
              onSuccess={() => {
                setDeplacementOuvert(false);
                setFeedback(fr.reception.feedback.rdvDeplace);
                apresMutation();
              }}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function BarreContextuelle({
  rdv,
  paiementDisponible,
  desactive = false,
  onArrivee,
  onAbsent,
  onPaiement,
  onDeplacer,
  onClose,
}: {
  readonly rdv: RdvAccueil;
  readonly paiementDisponible: boolean;
  /** Lien dégradé : les gestes d'écriture sont neutralisés, la sélection reste. */
  readonly desactive?: boolean;
  readonly onArrivee: () => void;
  readonly onAbsent: () => void;
  readonly onPaiement: () => void;
  readonly onDeplacer: () => void;
  readonly onClose: () => void;
}): React.JSX.Element {
  const gel = rdv.status === "completed" || rdv.status === "cancelled" || rdv.status === "requested";
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 rounded-md border border-rule bg-sunken px-3 py-2">
      <span className="font-num text-label tabular-nums text-ink-700">{plage(rdv.startsAt, rdv.endsAt) ?? fr.etats.texteAbsent}</span>
      <span className="min-w-0 flex-1 truncate font-ui text-body font-medium text-ink-900">
        {[rdv.lastName, rdv.firstName].filter(Boolean).join(" ") || fr.agenda.patientNonRattache}
      </span>
      {!gel && rdv.status === "confirmed" ? (
        <Bouton rang="secondaire" onClick={onArrivee} disabled={desactive}>
          {fr.reception.arrivees.marquerArrivee}
        </Bouton>
      ) : null}
      {!gel && (rdv.status === "confirmed" || rdv.status === "arrived") ? (
        <>
          {paiementDisponible ? (
            <Bouton rang="secondaire" onClick={onPaiement} disabled={desactive}>
              {fr.reception.paiements.encaisserCourt}
            </Bouton>
          ) : null}
          <Bouton rang="discret" onClick={onDeplacer} disabled={desactive}>
            {fr.actions.modifierLeRendezVous}
          </Bouton>
          <Bouton rang="discret" onClick={onAbsent} disabled={desactive}>
            {fr.reception.arrivees.marquerAbsent}
          </Bouton>
        </>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label={fr.jarvis.fermer}
        className="ml-auto inline-flex h-7 w-7 items-center justify-center rounded-full bg-card font-ui text-label text-ink-500 hover:text-ink-700 focus-visible:outline focus-visible:outline-action-600"
      >
        ✕
      </button>
    </div>
  );
}
