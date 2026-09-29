/**
 * Messages — centre de communication du cabinet (WhatsApp Business, Page
 * Facebook ; Instagram : non connecté, absent de l'écran plutôt que simulé).
 *
 * Trois volets : conversations, fil actif, contexte/actions. AUCUNE DÉCISION
 * D'AUTORISATION ICI : les filtres sont une vue (cf. `filtrerConversations`),
 * l'envoi passe par `preparerEnvoi` (politique + consentement) puis
 * `/api/communication/envoyer` (registre + egress serveur). Un brouillon
 * contenant des données patient finit en `blocked` honnête, jamais dehors.
 *
 * Garde de session repris de l'agenda : `sessionTranchee === false` a sa
 * propre sortie, le squelette ne respire jamais sans fin (10 s).
 */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import {
  BadgeCanal,
  BadgeHandoff,
  BulleMessage,
  filtrerConversations,
  LigneConversation,
  type FiltreMessages,
} from "@/components/MessagesPieces";
import {
  BandeauHorsLigne,
  BlocErreur,
  Bouton,
  EtatVide,
  LienBouton,
  Section,
  Squelette,
} from "@/components/ui";
import { ChampZoneTexte } from "@/components/ui/Champs";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";
import { frCommunication, frMessages } from "@/i18n/communication";
import { lierPatient, marquerRemise, proposerCandidats, type CandidatPatient } from "@/services/communication/appariement";
import {
  approuverMessage,
  demanderHandoff,
  lireRoutage,
  listerConversations,
  listerMessages,
  preparerEnvoi,
  rejeterMessage,
  type RoutageConversation,
} from "@/services/communication/communication-service";
import { lireConsentement, poserConsentement } from "@/services/communication/consentement";
import { lireConnexions, type EtatConnexion } from "@/services/communication/connexions";
import { executerEnvoi } from "@/services/communication/envoi";
import type {
  ItemMessage,
  ResumeConversation,
} from "@/services/communication/types";

const DELAI_CHARGEMENT_MS = 10_000;

const FILTRES: readonly { id: FiltreMessages; libelle: string }[] = [
  { id: "tous", libelle: frMessages.filtres.tous },
  { id: "whatsapp", libelle: frMessages.filtres.whatsapp },
  { id: "facebook", libelle: frMessages.filtres.facebook },
  { id: "instagram", libelle: frMessages.filtres.instagram },
  { id: "non_traites", libelle: frMessages.filtres.nonTraites },
  { id: "humain_requis", libelle: frMessages.filtres.humainRequis },
];

function outilPour(
  canal: string,
): "whatsapp.envoyer_texte" | "facebook.envoyer_message_page" | "instagram.envoyer_reponse" {
  if (canal === "facebook") return "facebook.envoyer_message_page";
  if (canal === "instagram") return "instagram.envoyer_reponse";
  return "whatsapp.envoyer_texte";
}

export default function PageMessages(): React.JSX.Element {
  const { utilisateur, sessionTranchee, horsLigne: horsLigneSession, deconnecter } =
    useSessionEcran();

  const [conversations, setConversations] = useState<readonly ResumeConversation[] | null>(null);
  const [connexions, setConnexions] = useState<readonly EtatConnexion[]>([]);
  const [filtre, setFiltre] = useState<FiltreMessages>("tous");
  const [selection, setSelection] = useState<string | null>(null);
  const [messages, setMessages] = useState<readonly ItemMessage[]>([]);
  const [routage, setRoutage] = useState<RoutageConversation | null>(null);
  const [consentement, setConsentement] = useState<boolean | null>(null);
  const [candidats, setCandidats] = useState<readonly CandidatPatient[]>([]);
  const [compositeur, setCompositeur] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [enEchec, setEnEchec] = useState(false);

  const charger = useCallback(async () => {
    const minuteur = setTimeout(() => setEnEchec(true), DELAI_CHARGEMENT_MS);
    try {
      const [convs, conns] = await Promise.all([listerConversations(100), lireConnexions(null)]);
      clearTimeout(minuteur);
      if (!convs.ok) {
        setEnEchec(true);
        return;
      }
      setEnEchec(false);
      setConversations(convs.data);
      if (conns.ok) setConnexions(conns.data);
    } catch {
      clearTimeout(minuteur);
      setEnEchec(true);
    }
  }, []);

  useEffect(() => {
    if (sessionTranchee !== true) return;
    void charger();
  }, [sessionTranchee, charger]);

  const chargerFil = useCallback(async (conversationId: string) => {
    const [msgs, rout] = await Promise.all([
      listerMessages(conversationId, 200),
      lireRoutage(conversationId),
    ]);
    if (msgs.ok) setMessages(msgs.data);
    const r = rout.ok ? rout.data : null;
    setRoutage(r);
    if (r?.patientId !== null && r?.patientId !== undefined && r.canal !== "facebook") {
      const c = await lireConsentement(r.patientId, r.canal);
      setConsentement(c.ok ? c.data : null);
    } else if (r?.patientId !== null && r?.patientId !== undefined) {
      const c = await lireConsentement(r.patientId, "facebook");
      setConsentement(c.ok ? c.data : null);
    } else {
      setConsentement(null);
    }
    if (r?.destinataire !== null && r?.destinataire !== undefined && r.patientId === null) {
      const cand = await proposerCandidats(r.destinataire);
      setCandidats(cand.ok ? cand.data : []);
    } else {
      setCandidats([]);
    }
  }, []);

  useEffect(() => {
    if (selection === null) return;
    void chargerFil(selection);
  }, [selection, chargerFil]);

  if (sessionTranchee === false) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  if (utilisateur === undefined || conversations === null) {
    return (
      <main className="flex flex-col gap-8 p-8">
        <Squelette lignes={2} />
        <Squelette lignes={8} />
      </main>
    );
  }

  const visibles = filtrerConversations(conversations, filtre);
  const active = conversations.find((c) => c.id === selection) ?? null;
  const statutCanal = (canal: string): string => {
    const e = connexions.find((c) => c.canal === canal);
    if (e === undefined || e.statut === "non_connecte") return frMessages.connexion.nonConnecte;
    if (e.statut === "erreur") return frMessages.connexion.erreur;
    return frMessages.connexion.connecte;
  };

  async function preparer(): Promise<void> {
    if (active === null || compositeur.trim() === "" || occupe) return;
    setOccupe(true);
    setNotice(null);
    try {
      const connecte = statutCanal(active.canal) === frMessages.connexion.connecte;
      const resultat = await preparerEnvoi(active.id, compositeur.trim(), {
        patientId: routage?.patientId ?? null,
        canal: active.canal,
        // Le navigateur n'exécute pas le classifieur : stockage local
        // légitime, l'egress serveur tranche à l'envoi (voir le service).
        signalPatient: false,
        connecte,
        horsLigne: horsLigneSession,
        clientMsgId: crypto.randomUUID(),
      });
      if (!resultat.ok) {
        setNotice(fr.erreurs.indisponible);
        return;
      }
      setCompositeur("");
      if (resultat.data.etat === "queued") setNotice(frMessages.prepareQueu);
      else if (resultat.data.etat === "approval_required") setNotice(frMessages.prepareApprobation);
      else if (resultat.data.etat === "blocked") {
        setNotice(
          resultat.data.motif === "consentement"
            ? frCommunication.consentementManquant
            : frMessages.prepareBloque,
        );
      }
      await chargerFil(active.id);
    } finally {
      setOccupe(false);
    }
  }

  async function approuverEtEnvoyer(message: ItemMessage): Promise<void> {
    if (active === null || occupe) return;
    setOccupe(true);
    setNotice(null);
    try {
      const approbation = await approuverMessage(message.id);
      if (!approbation.ok || approbation.data !== true) {
        setNotice(fr.erreurs.indisponible);
        return;
      }
      const envoi = await executerEnvoi(active.id, message.id, active.canal, outilPour(active.canal));
      setNotice(envoi.ok ? frMessages.envoye : frMessages.echecEnvoi);
      await chargerFil(active.id);
      await charger();
    } finally {
      setOccupe(false);
    }
  }

  async function envoyerDirect(message: ItemMessage): Promise<void> {
    if (active === null || occupe) return;
    setOccupe(true);
    setNotice(null);
    try {
      const envoi = await executerEnvoi(active.id, message.id, active.canal, outilPour(active.canal));
      setNotice(envoi.ok ? frMessages.envoye : frMessages.echecEnvoi);
      await chargerFil(active.id);
      await charger();
    } finally {
      setOccupe(false);
    }
  }

  async function handoff(
    vers: "HUMAN_REQUIRED" | "HUMAN_HANDLING" | "AI_HANDLING" | "RESOLVED",
    motif: string,
  ): Promise<void> {
    if (active === null || occupe) return;
    setOccupe(true);
    try {
      await demanderHandoff(active.id, vers, motif);
      await charger();
    } finally {
      setOccupe(false);
    }
  }

  async function basculerConsentement(): Promise<void> {
    if (routage?.patientId == null || occupe) return;
    setOccupe(true);
    try {
      const canal = routage.canal === "facebook" ? "facebook" : "whatsapp";
      await poserConsentement(routage.patientId, canal, !(consentement ?? false));
      const c = await lireConsentement(routage.patientId, canal);
      if (c.ok) setConsentement(c.data);
    } finally {
      setOccupe(false);
    }
  }

  return (
    <AppShell
      role={utilisateur?.role ?? "assistant"}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
      sousTitre={frMessages.sousTitre}
      sansGouttiere
    >
      <div className="flex min-h-0 flex-col gap-4 p-4 tablet:flex-row tablet:p-6">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        {/* Volet conversations */}
        <section aria-label={frMessages.titre} className="flex w-full flex-col gap-3 tablet:w-72">
          <div className="flex flex-wrap gap-2">
            {FILTRES.map((f) => (
              <Bouton
                key={f.id}
                type="button"
                rang="secondaire"
                taille="compact"
                onClick={() => setFiltre(f.id)}
                enfonce={filtre === f.id}
              >
                {f.libelle}
              </Bouton>
            ))}
          </div>
          {enEchec ? (
            <BlocErreur
              message={fr.erreurs.indisponible}
              action={
                <Bouton type="button" rang="secondaire" taille="compact" onClick={() => void charger()}>
                  {fr.actions.reessayer}
                </Bouton>
              }
            />
          ) : visibles.length === 0 ? (
            <EtatVide message={frMessages.listeVide} />
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 overflow-y-auto p-0">
              {visibles.map((c) => (
                <li key={c.id}>
                  <LigneConversation
                    conversation={c}
                    selectionnee={c.id === selection}
                    onChoisir={() => {
                      setSelection(c.id);
                      setNotice(null);
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Volet fil actif */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {active === null ? (
            <EtatVide message={frMessages.aucuneSelection} />
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <BadgeCanal canal={active.canal} />
                <BadgeHandoff etat={active.etatHandoff} />
                <span className="font-ui text-label text-ink-500">
                  {statutCanal(active.canal)}
                </span>
              </div>
              {messages.length === 0 ? (
                <EtatVide message={frMessages.conversationVide} />
              ) : (
                <div className="flex flex-col gap-2 overflow-y-auto">
                  {messages.map((m) => (
                    <div key={m.id} className="flex flex-col gap-1">
                      <BulleMessage message={m} />
                      {m.direction === "sortant" && m.etat === "approval_required" ? (
                        <div className="flex justify-end gap-2">
                          <Bouton
                            type="button"
                            rang="principal"
                            taille="compact"
                            disabled={occupe}
                            onClick={() => void approuverEtEnvoyer(m)}
                          >
                            {frMessages.actions.approuverEtEnvoyer}
                          </Bouton>
                          <Bouton
                            type="button"
                            rang="discret"
                            taille="compact"
                            disabled={occupe}
                            onClick={() =>
                              void rejeterMessage(m.id).then(() => {
                                if (active !== null) void chargerFil(active.id);
                              })
                            }
                          >
                            {frMessages.actions.refuser}
                          </Bouton>
                        </div>
                      ) : null}
                      {m.direction === "sortant" && m.etat === "approved" ? (
                        <div className="flex justify-end gap-2">
                          <Bouton
                            type="button"
                            rang="principal"
                            taille="compact"
                            disabled={occupe}
                            onClick={() => void envoyerDirect(m)}
                          >
                            {frMessages.actions.envoyer}
                          </Bouton>
                        </div>
                      ) : null}
                      {m.direction === "sortant" && (m.etat === "sent" || m.etat === "delivered") ? (
                        <div className="flex justify-end gap-2">
                          <Bouton
                            type="button"
                            rang="discret"
                            taille="compact"
                            disabled={occupe}
                            onClick={() =>
                              void marquerRemise(m.id, m.etat === "sent" ? "delivered" : "read").then(
                                () => {
                                  if (active !== null) void chargerFil(active.id);
                                },
                              )
                            }
                          >
                            {m.etat === "sent" ? "delivered" : "read"}
                          </Bouton>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
              <ChampZoneTexte
                libelle={frMessages.actions.preparer}
                valeur={compositeur}
                onChange={setCompositeur}
                lignes={3}
                placeholder={frMessages.compositeurPlaceholder}
              />
              <div className="flex gap-2">
                <Bouton
                  type="button"
                  rang="principal"
                  taille="compact"
                  disabled={occupe || compositeur.trim() === ""}
                  onClick={() => void preparer()}
                >
                  {frMessages.actions.preparer}
                </Bouton>
              </div>
              {notice !== null ? <p className="font-ui text-body text-ink-700">{notice}</p> : null}
            </>
          )}
        </section>

        {/* Volet contexte */}
        <aside className="flex w-full flex-col gap-4 tablet:w-72">
          {active !== null ? (
            <>
              <Section titre={frMessages.consentement.titre}>
                <p className="font-ui text-body text-ink-700">
                  {consentement === true
                    ? frMessages.consentement.actif
                    : frMessages.consentement.inactif}
                </p>
                {routage?.patientId != null ? (
                  <Bouton
                    type="button"
                    rang="secondaire"
                    taille="compact"
                    disabled={occupe}
                    onClick={() => void basculerConsentement()}
                  >
                    {consentement === true
                      ? frMessages.consentement.retirer
                      : frMessages.consentement.autoriser}
                  </Bouton>
                ) : null}
              </Section>
              <Section titre={frMessages.candidats}>
                {candidats.length === 0 ? (
                  <p className="font-ui text-body text-ink-700">{frMessages.aucunCandidat}</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-2 p-0">
                    {candidats.map((c) => (
                      <li key={c.patientId} className="flex items-center justify-between gap-2">
                        <span className="font-ui text-body text-ink-900">{c.libelle}</span>
                        <Bouton
                          type="button"
                          rang="secondaire"
                          taille="compact"
                          disabled={occupe}
                          onClick={() =>
                            void lierPatient(active.id, c.patientId).then(() => {
                              void chargerFil(active.id);
                              void charger();
                            })
                          }
                        >
                          {frMessages.actions.lier}
                        </Bouton>
                      </li>
                    ))}
                  </ul>
                )}
                {routage?.patientId != null ? (
                  <Link
                    href={`/patients/${routage.patientId}`}
                    className="font-ui text-body text-action-600"
                  >
                    {frMessages.actions.voirDossier}
                  </Link>
                ) : null}
              </Section>
              <Section titre={frMessages.handoff[active.etatHandoff] ?? active.etatHandoff}>
                <div className="flex flex-col gap-2">
                  <Bouton
                    type="button"
                    rang="secondaire"
                    taille="compact"
                    disabled={occupe}
                    onClick={() => void handoff("HUMAN_REQUIRED", frMessages.actions.passerAccueil)}
                  >
                    {frMessages.actions.passerAccueil}
                  </Bouton>
                  <Bouton
                    type="button"
                    rang="discret"
                    taille="compact"
                    disabled={occupe}
                    onClick={() => void handoff("AI_HANDLING", frMessages.actions.reprendreIA)}
                  >
                    {frMessages.actions.reprendreIA}
                  </Bouton>
                  <Bouton
                    type="button"
                    rang="discret"
                    taille="compact"
                    disabled={occupe}
                    onClick={() => void handoff("RESOLVED", frMessages.actions.resoudre)}
                  >
                    {frMessages.actions.resoudre}
                  </Bouton>
                  <Link
                    href="/agenda/nouveau"
                    className="font-ui text-body text-action-600"
                  >
                    {frMessages.actions.proposerRendezVous}
                  </Link>
                </div>
              </Section>
            </>
          ) : null}
        </aside>
      </div>
    </AppShell>
  );
}
