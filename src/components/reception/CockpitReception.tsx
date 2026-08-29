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

import {
  getReceptionBoard,
  markAppointmentArrived,
  markAppointmentNoShow,
  type PaiementAccueil,
  type RdvAccueil,
  type TableauAccueil,
} from "@/services/reception";
import { listNotifications, markNotificationRead, type NotificationItem } from "@/services/notifications";
import { confirmAppointment } from "@/services/appointments";

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

const INTERVALLE_BOARD_MS = 120_000;
const INTERVALLE_NOTIFICATIONS_MS = 30_000;
const INTERVALLE_TICK_MS = 30_000;

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

  const rechercheRef = useRef<HTMLInputElement>(null);
  const attenteRef = useRef<HTMLDivElement>(null);
  const encaissementRef = useRef<HTMLDivElement>(null);
  const jourIso = ancre;

  const rechargerBoard = useCallback(async (): Promise<void> => {
    const result = await getReceptionBoard(jourIso);
    if (!result.ok) {
      setHorsLigne(result.error.code === "hors-ligne");
      setErreur(result.error.code === "hors-ligne" ? undefined : result.error.message);
      return;
    }
    setHorsLigne(false);
    setErreur(undefined);
    setBoard(result.data);
  }, [jourIso]);

  const rechargerNotifications = useCallback(async (): Promise<void> => {
    const result = await listNotifications();
    if (result.ok) setNotifications(result.data);
  }, []);

  useEffect(() => {
    void rechargerBoard();
    void rechargerNotifications();
    setMaintenant(new Date());
  }, [rechargerBoard, rechargerNotifications]);

  useEffect(() => {
    const boardTimer = setInterval(() => {
      if (document.visibilityState === "visible") void rechargerBoard();
    }, INTERVALLE_BOARD_MS);
    const notifsTimer = setInterval(() => {
      if (document.visibilityState === "visible") void rechargerNotifications();
    }, INTERVALLE_NOTIFICATIONS_MS);
    function auRetour(): void {
      if (document.visibilityState !== "visible") return;
      setMaintenant(new Date());
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
    const tick = setInterval(() => setMaintenant(new Date()), INTERVALLE_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  function apresMutation(): void {
    void rechargerBoard();
    void rechargerNotifications();
  }

  async function confirmerArrivee(rdv: RdvAccueil): Promise<void> {
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
  function ouvrirEncaissement(paiement: PaiementAccueil): void {
    setDeplacementOuvert(false);
    setEncaissementCible(paiement);
  }
  function ouvrirDeplacement(): void {
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

      <PulseReception
        attente={compteurs.attente}
        retards={compteurs.retards}
        aEncaisser={paiementsDus.length}
        demandes={demandes.length}
        onFocusAttente={() => attenteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onFocusEncaisser={() => encaissementRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
        onFocusDemandes={() => attenteRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />

      {(horsLigne || horsLigneSession) && board != null ? <BandeauHorsLigne /> : null}
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
        <Squelette lignes={8} />
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
                    <span className="h-8 w-8 rounded-xl bg-grad-empty opacity-60" />
                  </span>
                  <p className="font-ui text-body font-medium text-ink-700">{fr.reception.frise.videJournee}</p>
                  <p className="max-w-sm text-center font-ui text-label text-ink-500">Les rendez-vous du jour apparaissent ici. Créez le premier en un clic.</p>
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
  onArrivee,
  onAbsent,
  onPaiement,
  onDeplacer,
  onClose,
}: {
  readonly rdv: RdvAccueil;
  readonly paiementDisponible: boolean;
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
        <Bouton rang="secondaire" onClick={onArrivee}>
          {fr.reception.arrivees.marquerArrivee}
        </Bouton>
      ) : null}
      {!gel && (rdv.status === "confirmed" || rdv.status === "arrived") ? (
        <>
          {paiementDisponible ? (
            <Bouton rang="secondaire" onClick={onPaiement}>
              {fr.reception.paiements.encaisserCourt}
            </Bouton>
          ) : null}
          <Bouton rang="discret" onClick={onDeplacer}>
            {fr.actions.modifierLeRendezVous}
          </Bouton>
          <Bouton rang="discret" onClick={onAbsent}>
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
