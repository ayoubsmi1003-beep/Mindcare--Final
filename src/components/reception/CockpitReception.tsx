/**
 * L'orchestrateur du poste d'accueil : UNE source de vérité (le board), des
 * rafraîchissements bornés, un clavier gardé, et les gestes d'accueil.
 *
 * ═══ LIVE = POLLING BORNÉ, PAS REALTIME ══════════════════════════════════
 *   · board          toutes les 120 s, onglet visible seulement ;
 *   · notifications  toutes les 30 s, idem ;
 *   · après CHAQUE mutation réussie : rechargement immédiat des deux ;
 *   · au retour sur l'onglet (`visibilitychange`) : rechargement des deux.
 * Aucun bouton « Actualiser » n'existe — l'écran est vivant sans geste, et le
 * critère du lot l'interdit explicitement. Realtime reste hors périmètre v1 :
 * aucune extension de `DbPort`, aucun bus d'événements.
 *
 * ═══ LE CLAVIER N'INVENTE RIEN ═══════════════════════════════════════════
 * `Ctrl/⌘+K` appartient à Jarvis (`PanneauJarvis`) et n'est PAS écouté ici.
 * Touches simples ignorées pendant une saisie ou avec modificateurs :
 *   N nouveau RDV · T aujourd'hui · / recherche · Échap referme les tiroirs
 *   A arrivée · P paiement · R déplacer — sur le RDV sélectionné uniquement ;
 *   sans sélection, silence : jamais d'action surprise sur le mauvais RDV.
 *
 * ⚠️ ZÉRO DÉCISION D'AUTORISATION ICI. Les portes décident (006, 011, 029) ;
 * ce composant orchestre des appels et affiche leur résultat, y compris leurs
 * refus — un message d'erreur lisible vaut mieux qu'un bouton absent qui ment.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { fr } from "@/i18n/fr";

import { plage } from "@/components/AgendaPieces";
import {
  BandeauHorsLigne,
  BlocErreur,
  Squelette,
} from "@/components/ui/Etats";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { Chiffre } from "@/components/ui/Badge";

import {
  getReceptionBoard,
  markAppointmentArrived,
  markAppointmentNoShow,
  type PaiementAccueil,
  type RdvAccueil,
  type TableauAccueil,
} from "@/services/reception";
import {
  listNotifications,
  markNotificationRead,
  type NotificationItem,
} from "@/services/notifications";
import { confirmAppointment, updateAppointment } from "@/services/appointments";

import { FriseJour } from "./FriseJour";
import { ZoneAttention } from "./ZoneAttention";
import { FileArrivees } from "./FileArrivees";
import { PaiementsZone, TiroirEncaissement } from "./PaiementsZone";
import { CentreNotifications } from "./CentreNotifications";
import { PreparationJour } from "./PreparationJour";
import { TiroirDeplacement } from "./TiroirDeplacement";
import { ResultatsRecherche } from "./RechercheEclair";

const INTERVALLE_BOARD_MS = 120_000;
const INTERVALLE_NOTIFICATIONS_MS = 30_000;
const INTERVALLE_TICK_MS = 30_000;

function versJourIso(d: Date): string {
  const mois = String(d.getMonth() + 1).padStart(2, "0");
  const jour = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mois}-${jour}`;
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
  const jourIso = ancre;

  // ── Lectures ────────────────────────────────────────────────────────────
  const rechargerBoard = useCallback(async (): Promise<void> => {
    const result = await getReceptionBoard(jourIso);
    if (!result.ok) {
      // ERREUR REMPLACE le contenu (05-UX §1) ; hors-ligne se distingue et
      // garde la lecture déjà chargée visible (05-UX §5).
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
    // Un échec ici ne bloque rien : complément, pas raison d'être (I20).
  }, []);

  useEffect(() => {
    void rechargerBoard();
    void rechargerNotifications();
    setMaintenant(new Date());
  }, [rechargerBoard, rechargerNotifications]);

  // Polling borné — suspendu quand l'onglet est caché, repris au retour.
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

  // Le tick rafraîchit la VÉRITÉ affichée (chronos, ligne « maintenant »).
  useEffect(() => {
    const tick = setInterval(() => setMaintenant(new Date()), INTERVALLE_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  function apresMutation(): void {
    void rechargerBoard();
    void rechargerNotifications();
  }

  // ── Gestes ──────────────────────────────────────────────────────────────
  async function confirmerArrivee(rdv: RdvAccueil): Promise<void> {
    setFeedback(undefined);
    const result = await markAppointmentArrived(rdv.id);
    if (!result.ok) {
      setErreur(result.error.message);
      return;
    }
    if (!result.data) return; // introuvable/hors périmètre : le board dira la vérité
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
    return paiements.find(
      (p) => p.collectedAt === null && p.patientId === rdv.patientId,
    );
  }

  // ── Données dérivées — mémoïsées sur le board seul ──────────────────────
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
    () =>
      selectionId === null
        ? null
        : (journee.find((r) => r.id === selectionId) ??
          demandes.find((r) => r.id === selectionId) ??
          null),
    [journee, demandes, selectionId],
  );

  const paiementsDus = useMemo(
    () => paiements.filter((p) => p.collectedAt === null),
    [paiements],
  );

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

  // ── Clavier gardé ───────────────────────────────────────────────────────
  const boardRef = useRef(board);
  boardRef.current = board;
  const gestesRef = useRef({
    confirmerArrivee,
    ouvrirEncaissement,
    ouvrirDeplacement,
    paiementDuRdv,
  });
  gestesRef.current = { confirmerArrivee, ouvrirEncaissement, ouvrirDeplacement, paiementDuRdv };

  useEffect(() => {
    function auClavier(evenement: KeyboardEvent): void {
      if (evenement.metaKey || evenement.ctrlKey || evenement.altKey) return;
      if (evenement.isComposing) return;

      const cible = evenement.target as HTMLElement | null;
      const saisie =
        cible !== null &&
        (cible.tagName === "INPUT" ||
          cible.tagName === "TEXTAREA" ||
          cible.tagName === "SELECT" ||
          cible.isContentEditable);

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

      // Contextuels : ils exigent une sélection, sinon silence — jamais
      // d'action surprise sur le mauvais rendez-vous.
      const gestes = gestesRef.current;
      const boardCourant = boardRef.current;
      const rdv =
        selectionId === null
          ? null
          : (boardCourant?.journee.find((r) => r.id === selectionId) ??
            boardCourant?.demandes.find((r) => r.id === selectionId) ??
            null);
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* ── En-tête compact : titre, date, recherche, nouveau ───────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="font-ui text-title font-semibold text-ink-900">{fr.reception.titre}</h1>
        <span className="font-ui text-body text-ink-500">
          {ancre === aujourdhuiIso ? fr.agenda.aujourdhui : versSaisieJour(ancre)}
        </span>

        <div className="ml-auto flex items-center gap-2">
          <div className="w-64">
            <input
              ref={rechercheRef}
              type="search"
              aria-label={fr.reception.recherche.libelle}
              placeholder={fr.reception.recherche.indication}
              value={requete}
              onChange={(e) => setRequete(e.target.value)}
              className={[
                "min-h-target w-full rounded-md border border-rule bg-card px-3",
                "font-ui text-body text-ink-900 outline-none placeholder:text-ink-300",
                "focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
              ].join(" ")}
            />
          </div>
          <LienBouton href="/agenda/nouveau" rang="principal">
            {fr.agenda.nouveau}
          </LienBouton>
        </div>
      </div>

      {requete.trim().length >= 2 ? (
        <ResultatsRecherche requete={requete} onFermer={() => setRequete("")} />
      ) : null}

      {/* ── Pulse du jour : quatre COMPTES, jamais une somme ──────────────
          day_revenue rend zéro ligne à l'assistante (ADR-005) ; aucun total
          recomposé côté client ne contournera cette décision en base. */}
      <div className="grid grid-cols-pouls gap-3">
        <Chiffre valeur={compteurs.attente} libelle={fr.reception.pulse.salleAttente} attention={compteurs.attente > 0} />
        <Chiffre valeur={compteurs.retards} libelle={fr.reception.pulse.retards} attention={compteurs.retards > 0} />
        <Chiffre valeur={paiementsDus.length} libelle={fr.reception.pulse.aEncaisser} attention={paiementsDus.length > 0} />
        <Chiffre valeur={demandes.length} libelle={fr.reception.pulse.demandes} attention={demandes.length > 0} />
      </div>

      {(horsLigne || horsLigneSession) && board != null ? <BandeauHorsLigne /> : null}

      {feedback !== undefined ? (
        <p
          role="status"
          className="rounded-md border border-positive bg-positive-bg px-4 py-2 font-ui text-body text-positive"
        >
          {feedback}
        </p>
      ) : null}

      {/* ERREUR REMPLACE le contenu — ni état vide ni chiffres périmés dessous */}
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

      {/* ── Corps : frise + files. Défilement INTERNE seulement. ────────── */}
      {board == null ? (
        <Squelette lignes={8} />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-cockpit gap-4">
          <section
            aria-label={fr.reception.frise.titre}
            className="flex min-h-0 flex-col gap-2 rounded-lg border border-rule bg-card p-3"
          >
            <div className="flex items-center gap-2">
              <h2 className="font-ui text-heading font-semibold text-ink-900">
                {fr.reception.frise.titre}
              </h2>
              <div className="ml-auto flex items-center gap-1">
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
              <div className="flex flex-1 items-center justify-center">
                <p className="font-ui text-body text-ink-500">{fr.reception.frise.videJournee}</p>
              </div>
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
                  const paiement = paiementDuRdv(rdvSelectionne);
                  if (paiement !== undefined) ouvrirEncaissement(paiement);
                }}
                onDeplacer={ouvrirDeplacement}
                onClose={() => setSelectionId(null)}
              />
            ) : (
              <p className="px-1 font-ui text-label text-ink-500">
                {fr.reception.frise.selectionHint}
              </p>
            )}
          </section>

          {/* Files opérationnelles — défilement propre. Le plafond ≤ 9 items
              actionnables vit dans la zone nommée « attention », seule. */}
          <aside aria-label={fr.reception.titre} className="flex min-h-0 flex-col gap-5 overflow-y-auto pr-1">
            <ZoneAttention
              journee={journee}
              demandes={demandes}
              paiements={paiements}
              maintenant={maintenant}
              onEncaisser={ouvrirEncaissement}
              onArrivee={(rdv) => void confirmerArrivee(rdv)}
              onConfirmationDemande={(rdv) => void confirmerDemande(rdv)}
              onSelectRdv={setSelectionId}
            />

            <FileArrivees
              journee={journee}
              maintenant={maintenant}
              onAbsent={(rdv) => void confirmerAbsent(rdv)}
              onSelectRdv={setSelectionId}
            />

            <PaiementsZone
              paiements={paiements}
              maintenant={maintenant}
              onEncaisser={ouvrirEncaissement}
            />

            {encaissementCible !== null ? (
              <TiroirEncaissement
                paiement={encaissementCible}
                apresMutation={apresMutation}
                onFermer={() => setEncaissementCible(null)}
              />
            ) : null}

            <CentreNotifications
              notifications={notifications}
              paiementsDus={paiementsDus}
              onMarquerLu={(id) => void marquerLu(id)}
              onOuvrirEncaissement={ouvrirEncaissement}
            />

            <PreparationJour journee={journee} paiements={paiements} />

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
          </aside>
        </div>
      )}
    </div>
  );
}

/* ═══ Sous-composants locaux ══════════════════════════════════════════════ */

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
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-rule bg-sunken px-3 py-2">
      <span className="font-num text-label tabular-nums text-ink-700">
        {plage(rdv.startsAt, rdv.endsAt) ?? fr.etats.texteAbsent}
      </span>
      <span className="min-w-0 flex-auto truncate font-ui text-body font-medium text-ink-900">
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
              {fr.reception.paiements.encaisser}
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
        className="ml-auto min-h-target rounded-md px-2 font-ui text-label text-ink-500 outline-none hover:text-ink-700 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
      >
        ✕
      </button>
    </div>
  );
}
