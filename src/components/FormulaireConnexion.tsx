/**
 * Formulaire de connexion — PUREMENT PRÉSENTATIONNEL.
 *
 * Aucun appel réseau, aucun `src/services/*` importé ici : le formulaire reçoit
 * `onSubmit` et se contente d'appeler la fonction fournie (I3).
 *
 * v11 — CARTE VERRE SUR SHADER VERT. Aucune logique métier ne change :
 * mêmes props, mêmes états (enCours/erreur/hors-ligne), mêmes garde-fous
 * a11y. Seul l'habillage devient verre : pastilles pilule translucides,
 * bouton verre pleine largeur. Aucune couleur en dur — `tokens.css` seul.
 */

"use client";

import { useId, useState } from "react";

import { fr } from "@/i18n/fr";
import { login } from "@/i18n/login";
import { Icone } from "./ui/Icones";

export interface FormulaireConnexionProps {
  readonly onSubmit: (email: string, motDePasse: string) => void;
  readonly enCours: boolean;
  readonly messageErreur?: string | undefined;
  readonly horsLigne: boolean;
}

export function FormulaireConnexion({
  onSubmit,
  enCours,
  messageErreur,
  horsLigne,
}: FormulaireConnexionProps): React.JSX.Element {
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const emailId = useId();
  const motDePasseId = useId();
  const erreurId = useId();
  const horsLigneId = useId();

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (enCours) return;
    onSubmit(email, motDePasse);
  }

  return (
    <div className="carte-verre-login">
      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        aria-describedby={
          [messageErreur !== undefined ? erreurId : null, horsLigne ? horsLigneId : null]
            .filter((value): value is string => value !== null)
            .join(" ") || undefined
        }
      >
        {horsLigne ? (
          <p
            id={horsLigneId}
            role="status"
            className="m-0 rounded-md border border-rule bg-sunken px-4 py-3 font-ui text-body text-ink-700"
          >
            {fr.etats.horsLigne}
          </p>
        ) : null}

        {messageErreur !== undefined ? (
          <div
            id={erreurId}
            role="alert"
            className="m-0 flex items-start gap-3 rounded-md border border-attention bg-attention-bg px-4 py-3"
          >
            <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-attention-ink">
              <Icone nom="alerte" taille={20} />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <strong className="font-ui text-label font-semibold uppercase tracking-label text-attention-ink">
                {fr.erreur.titre}
              </strong>
              <span className="font-ui text-body text-ink-700">{messageErreur}</span>
            </span>
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <label
            htmlFor={emailId}
            className="champ-verre-label font-ui text-label font-medium tracking-label"
          >
            {login.username}
          </label>
          <div className="champ-verre">
            <input
              id={emailId}
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={320}
              required
              disabled={enCours}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder={login.username}
              aria-label={login.username}
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor={motDePasseId}
            className="champ-verre-label font-ui text-label font-medium tracking-label"
          >
            {fr.connexion.champMotDePasse}
          </label>
          <div className="champ-verre">
            <input
              id={motDePasseId}
              type="password"
              autoComplete="current-password"
              required
              disabled={enCours}
              value={motDePasse}
              onChange={(event) => setMotDePasse(event.target.value)}
              placeholder={fr.connexion.champMotDePasse}
              aria-label={fr.connexion.champMotDePasse}
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={enCours}
          aria-busy={enCours || undefined}
          className="bouton-verre mt-2 px-6 py-4 text-body"
        >
          {enCours ? fr.connexion.connexionEnCours : fr.actions.seConnecter}
        </button>
      </form>
    </div>
  );
}
