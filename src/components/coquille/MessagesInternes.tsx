/**
 * Messagerie interne du cabinet — bouton, badge de non-lus et panneau.
 *
 * ═══ CE QUE CETTE MESSAGERIE EST ════════════════════════════════════════════
 *
 * Un canal TEXTE entre le médecin et l'accueil, à l'intérieur du cabinet. Il ne
 * remplace ni le téléphone, ni l'alerte d'appel : l'alerte est un geste court
 * qui demande une présence, le message est une information qui attend.
 *
 * Elle est strictement distincte de `src/app/messages` (canal patient externe :
 * WhatsApp, Facebook, Instagram), qui a ses propres tables, son consentement et
 * son provider. Les confondre ferait entrer un message interne dans un pipeline
 * d'envoi externe — exactement ce que la règle 1 interdit.
 *
 * ═══ IDEMPOTENCE ════════════════════════════════════════════════════════════
 *
 * Chaque envoi porte un `client_msg_id` stable tant que le texte n'a pas changé.
 * Un échec réseau, puis « Réessayer », rejoue donc le MÊME identifiant : la
 * porte `app.send_internal_message` rend la ligne existante au lieu d'en créer
 * une seconde. Le brouillon n'est jamais effacé par un échec.
 *
 * ═══ CE QUI N'EST PAS FIDÈLE, ET NE DOIT PAS L'ÊTRE ═════════════════════════
 *
 * « Remis » signifie que le poste d'en face a lu la liste (la porte pose
 * `delivered_at`). « Lu » signifie qu'il a ouvert le panneau. Aucun des deux ne
 * prouve qu'une personne a compris le message — l'interface ne le prétend pas.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Bouton } from "@/components/ui/Bouton";
import { Icone } from "@/components/ui/Icones";
import { fr } from "@/i18n/fr";
import {
  envoyerMessageInterne,
  listerMessagesInternes,
  marquerMessagesLus,
  type MessageInterne,
} from "@/services/cabinet-collaboration";

const INTERVALLE_MS = 20_000;

function heureCourte(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "--:--";
  return new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" }).format(new Date(t));
}

export interface BoutonMessagesInternesProps {
  /** Rôle de l'utilisateur, pour le libellé « Vous ». */
  readonly role: "owner" | "practitioner" | "assistant";
  /**
   * Compteur externe : quand il change (un événement SSE `message_updated`),
   * la liste est relue immédiatement. Sans lui, l'interrogation de secours
   * suffit — l'écran reste correct, seulement moins vif.
   */
  readonly signalRafraichissement?: number;
}

export function BoutonMessagesInternes({
  role,
  signalRafraichissement,
}: BoutonMessagesInternesProps): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [messages, setMessages] = useState<readonly MessageInterne[]>([]);
  const [brouillon, setBrouillon] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);

  const dialogue = useRef<HTMLDialogElement>(null);
  const fil = useRef<HTMLDivElement>(null);
  /** Texte + identifiant du dernier envoi échoué, pour un rejeu idempotent. */
  const enAttente = useRef<{ readonly corps: string; readonly id: string } | null>(null);

  const nonLus = messages.filter((m) => m.nonLu).length;

  const charger = useCallback(async (marquerLu: boolean): Promise<void> => {
    const resultat = await listerMessagesInternes(100);
    if (!resultat.ok) {
      // Une liste qui ne se lit pas ne doit pas effacer celle déjà affichée :
      // un historique vide se lirait « plus aucun message ».
      setErreur(resultat.error.message);
      return;
    }
    setErreur(null);
    setMessages(resultat.data);
    if (marquerLu && resultat.data.some((m) => m.nonLu)) {
      const lu = await marquerMessagesLus();
      if (lu.ok && lu.data > 0) {
        setMessages((courant) => courant.map((m) => (m.nonLu ? { ...m, nonLu: false, luLe: new Date().toISOString() } : m)));
      }
    }
  }, []);

  // Interrogation de secours : le badge doit être juste même si l'écran n'est
  // pas abonné au flux (une autre page, ou un flux momentanément coupé).
  useEffect(() => {
    void charger(false);
    const minuteur = setInterval(() => {
      if (document.visibilityState === "visible") void charger(false);
    }, INTERVALLE_MS);
    return () => clearInterval(minuteur);
  }, [charger]);

  // Signal SSE : relecture immédiate. `void` — l'échec est déjà traité par
  // `charger`, et un rafraîchissement raté n'interrompt rien.
  useEffect(() => {
    if (signalRafraichissement === undefined) return;
    void charger(ouvert);
  }, [signalRafraichissement, ouvert, charger]);

  useEffect(() => {
    if (ouvert) {
      dialogue.current?.showModal();
      void charger(true);
      // Le panneau s'ouvre sur le message le plus récent.
      queueMicrotask(() => {
        if (fil.current !== null) fil.current.scrollTop = fil.current.scrollHeight;
      });
    } else if (dialogue.current?.open === true) {
      dialogue.current.close();
    }
  }, [ouvert, charger]);

  useEffect(() => {
    if (!ouvert) return;
    if (fil.current !== null) fil.current.scrollTop = fil.current.scrollHeight;
  }, [messages, ouvert]);

  async function envoyer(): Promise<void> {
    const corps = brouillon.trim();
    if (corps === "" || envoi) return;

    setEnvoi(true);
    setNotice(null);
    setErreur(null);

    // Même identifiant tant que le texte est identique : « Réessayer » rejoue
    // le même message, il n'en crée pas un second.
    const identifiant = enAttente.current !== null && enAttente.current.corps === corps
      ? enAttente.current.id
      : crypto.randomUUID();

    const resultat = await envoyerMessageInterne(identifiant, corps);
    setEnvoi(false);

    if (!resultat.ok || resultat.data === null) {
      enAttente.current = { corps, id: identifiant };
      setNotice(fr.collaboration.messagerie.nonEnvoye);
      setErreur(resultat.ok ? null : resultat.error.message);
      return;
    }

    enAttente.current = null;
    setBrouillon("");
    setNotice(resultat.data.dejaPresent ? fr.collaboration.messagerie.envoye : null);
    await charger(false);
  }

  return (
    <>
      <Bouton
        rang="discret"
        taille="compact"
        onClick={() => setOuvert(true)}
        etiquette={fr.collaboration.messagerie.ouvrir}
        deploye={ouvert}
      >
        <span className="inline-flex items-center gap-2">
          <Icone nom="messages" taille={16} className="text-ink-500" />
          <span className="hidden tablet:inline">{fr.collaboration.messagerie.ouvrirCourt}</span>
          {nonLus > 0 ? (
            <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-attention px-1.5 font-num text-label font-semibold tabular-nums text-on-brand">
              {nonLus}
            </span>
          ) : null}
        </span>
      </Bouton>

      <dialog
        ref={dialogue}
        onClose={() => setOuvert(false)}
        onClick={(e) => {
          if (e.target === dialogue.current) setOuvert(false);
        }}
        className="fixed inset-y-0 end-0 m-0 h-full max-h-full w-full max-w-md rounded-none border-0 border-s border-rule bg-card p-0 shadow-elevee backdrop:bg-voile"
        aria-label={fr.collaboration.messagerie.titre}
      >
        <div className="flex h-full max-h-full min-h-0 flex-col">
          <header className="flex shrink-0 items-center gap-3 border-b border-rule px-5 py-3">
            <h2 className="m-0 font-ui text-heading font-semibold text-ink-900">
              {fr.collaboration.messagerie.titre}
            </h2>
            {nonLus > 0 ? (
              <span className="rounded-full bg-attention-bg px-2 py-0.5 font-num text-label font-semibold tabular-nums text-attention-ink">
                {nonLus} {fr.collaboration.messagerie.nonLus}
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => setOuvert(false)}
              aria-label={fr.collaboration.messagerie.fermer}
              className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-sunken font-ui text-label text-ink-500 hover:bg-rule"
            >
              ✕
            </button>
          </header>

          <div ref={fil} className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-5 py-4">
            {messages.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
                <span
                  aria-hidden="true"
                  className="relative inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-tuile-menthe text-emeraude-700 shadow-douce"
                >
                  <Icone nom="messages" taille={24} />
                </span>
                <p className="m-0 max-w-form font-ui text-body text-ink-500">
                  {fr.collaboration.messagerie.vide}
                </p>
              </div>
            ) : (
              messages.map((m) => {
                const deMoi = role === m.senderRole;
                return (
                  <article
                    key={m.id}
                    className={[
                      "flex max-w-form flex-col gap-1 rounded-xl px-3 py-2",
                      deMoi ? "self-end bg-action-100" : "self-start bg-sunken",
                    ].join(" ")}
                  >
                    <p className="m-0 font-ui text-label font-medium text-ink-500">
                      {deMoi ? fr.collaboration.messagerie.vous : m.senderName}
                      <span className="ml-2 font-num tabular-nums">{heureCourte(m.creeLe)}</span>
                    </p>
                    <p className="m-0 whitespace-pre-wrap break-words font-ui text-body text-ink-900">{m.corps}</p>
                    {deMoi ? (
                      <p className="m-0 text-right font-ui text-label text-ink-500">
                        {m.luLe !== null
                          ? fr.collaboration.messagerie.lu
                          : m.remisLe !== null
                            ? fr.collaboration.messagerie.remis
                            : fr.collaboration.messagerie.envoye}
                      </p>
                    ) : null}
                  </article>
                );
              })
            )}
          </div>

          <footer className="flex shrink-0 flex-col gap-2 border-t border-rule px-5 py-4">
            <label htmlFor="message-interne" className="font-ui text-label font-medium text-ink-700">
              {fr.collaboration.messagerie.nouveauMessage}
            </label>
            <textarea
              id="message-interne"
              value={brouillon}
              onChange={(e) => setBrouillon(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder={fr.collaboration.messagerie.placeholder}
              className="w-full resize-y rounded-lg border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
            />
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 min-w-0 flex-1 font-ui text-label text-ink-500">
                {fr.collaboration.messagerie.prudence}
              </p>
              <Bouton
                rang="principal"
                taille="compact"
                onClick={() => void envoyer()}
                chargement={envoi}
                disabled={envoi || brouillon.trim() === ""}
              >
                {envoi
                  ? fr.collaboration.messagerie.envoiEnCours
                  : notice === null
                    ? fr.collaboration.messagerie.envoyer
                    : fr.collaboration.messagerie.reessayer}
              </Bouton>
            </div>
            {notice !== null ? (
              <p role="status" className="m-0 font-ui text-label text-attention-ink">
                {notice}
              </p>
            ) : null}
            {erreur !== null ? (
              <p role="status" className="m-0 font-ui text-label text-attention-ink">
                {erreur}
              </p>
            ) : null}
          </footer>
        </div>
      </dialog>
    </>
  );
}
