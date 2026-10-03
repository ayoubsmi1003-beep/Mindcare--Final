/**
 * Formulaire de connexion — PUREMENT PRÉSENTATIONNEL.
 *
 * Aucun appel réseau, aucun `src/services/*` importé ici : le formulaire reçoit
 * `onSubmit` et se contente d'appeler la fonction fournie. C'est l'agent qui
 * câble ce composant qui décide comment authentifier — ce fichier ne connaît
 * même pas Supabase (I3).
 *
 * Cinq états (I11) :
 *   - chargement  → `enCours` désactive le bouton et l'annonce (`aria-busy`,
 *                    libellé qui change).
 *   - vide        → non applicable à un formulaire à deux champs contrôlés
 *                    par l'appelant ; rien à afficher par défaut.
 *   - erreur      → `messageErreur`, déjà en trois temps, rendu TEL QUEL. On
 *                    ne le réécrit pas ici (voir `fr.erreur` en tête de
 *                    `src/i18n/fr.ts` : aucune promesse de préservation locale
 *                    n'existe dans ce dépôt, donc aucune n'est inventée ici).
 *   - hors ligne  → rendu distinct de l'erreur, ton neutre, pas `--attention`
 *                    ni `--critical` : hors ligne n'est pas une faute (I20).
 *   - texte long/absent → labels et bouton en flux normal, aucune troncature
 *                    forcée ; le champ e-mail peut recevoir une valeur longue.
 *
 * Aucune donnée saisie ne part dans un `console.log` (I5) : ce composant ne
 * journalise rien, jamais.
 *
 * v10 — AUTH-SWITCH VERT/BLANC, SANS INSCRIPTION NI SOCIAL. La référence
 * 21st.dev `AuthSwitch` apporte la composition (carte scindée, pastilles
 * pleine-largeur, bouton pilule) ; le reste est refusé pour des raisons
 * métier, pas de goût :
 *   · pas de mode `sign-up` : un cabinet n'a pas d'inscription publique, une
 *     bascule « Créez votre compte » serait une porte d'enregistrement
 *     sauvage (loi 18-07, audit) ;
 *   · pas de `SocialIcons` : OAuth externe sur des dossiers de psychiatrie,
 *     en local-first et souvent hors ligne, est une fuite, pas une fonction ;
 *   · pas de dégradé violet ni de `<style>` en ligne : `tokens.css` seul
 *     (I10), teinte `--grad-auth` verte déjà au catalogue ;
 *   · pas d'emoji en guise d'icônes : libellés liés + pastille de marque.
 * Il reste exactement : e-mail + mot de passe + bouton Se connecter.
 * Les états d'erreur gardent leur place : entre le titre et les champs,
 * JAMAIS après le bouton.
 */

"use client";

import { useId, useState } from "react";

import { fr } from "@/i18n/fr";
import { Bouton } from "./ui/Bouton";
import { Icone } from "./ui/Icones";

export interface FormulaireConnexionProps {
  readonly onSubmit: (email: string, motDePasse: string) => void;
  readonly enCours: boolean;
  // `| undefined` explicite : `exactOptionalPropertyTypes` distingue « propriété
  // absente » de « propriété présente valant undefined », et l'appelant remet
  // cette valeur à `undefined` pour effacer une erreur précédente.
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

  // Pastille AuthSwitch : gris de la maquette = `--sunken`, anneau vert au
  // focus-clavier. `rounded-full` : la géométrie pilule de la référence.
  // Aucune valeur en dur — `tailwind.config.ts` ne connaît que des jetons.
  const classePastille =
    "min-h-target-lg w-full rounded-full border border-rule bg-sunken px-6 py-4 font-ui text-body text-ink-900 outline-none transition duration-quick ease-soft placeholder:text-ink-300 hover:border-ink-300 focus-visible:border-action-600 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset disabled:cursor-not-allowed disabled:opacity-disabled";

  return (
    <div className="flex w-full flex-col gap-6 bg-card p-8 tablet:p-12">
      {/* Titre de la colonne formulaire — le `<h1>` unique de l'écran. La
          marque vit dans le panneau vert (page.tsx), pas ici : un seul
          orbe par écran, pas deux. */}
      <div className="flex min-w-0 flex-col gap-2 text-center tablet:text-left">
        <h1 className="m-0 font-ui text-display font-bold text-ink-900">
          {fr.connexion.titre}
        </h1>
        <p className="m-0 font-ui text-body text-ink-500">{fr.connexion.accroche}</p>
      </div>

      {/* Hors ligne : ton neutre, jamais --attention ni --critical (§4.1). */}
      {horsLigne ? (
        <p
          id={horsLigneId}
          role="status"
          className="m-0 flex items-start gap-3 rounded-md border border-rule bg-sunken px-4 py-3 font-ui text-body text-ink-700"
        >
          <span
            aria-hidden="true"
            className="mt-2 inline-block h-2 w-2 shrink-0 rounded-full bg-ink-300"
          />
          {fr.etats.horsLigne}
        </p>
      ) : null}

      {/* Erreur : gabarit en trois temps déjà composé par l'appelant. On
          n'affiche ici que ce qu'il fournit, sans le réécrire (§4.8). */}
      {messageErreur !== undefined ? (
        <div
          id={erreurId}
          role="alert"
          className="m-0 flex items-start gap-3 rounded-md border border-attention bg-attention-bg px-4 py-3"
        >
          <span
            aria-hidden="true"
            className="mt-0.5 inline-flex shrink-0 text-attention-ink"
          >
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

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-4"
        aria-describedby={
          [messageErreur !== undefined ? erreurId : null, horsLigne ? horsLigneId : null]
            .filter((value): value is string => value !== null)
            .join(" ") || undefined
        }
      >
        <div className="flex flex-col gap-2">
          <label
            htmlFor={emailId}
            className="font-ui text-label font-medium tracking-label text-ink-700"
          >
            {fr.connexion.champEmail}
          </label>
          <input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            disabled={enCours}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={fr.connexion.champEmail}
            className={classePastille}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label
            htmlFor={motDePasseId}
            className="font-ui text-label font-medium tracking-label text-ink-700"
          >
            {fr.connexion.champMotDePasse}
          </label>
          <input
            id={motDePasseId}
            type="password"
            autoComplete="current-password"
            required
            disabled={enCours}
            value={motDePasse}
            onChange={(event) => setMotDePasse(event.target.value)}
            placeholder={fr.connexion.champMotDePasse}
            className={classePastille}
          />
        </div>

        <div className="mt-2 flex justify-center tablet:justify-start">
          <Bouton
            type="submit"
            rang="principal"
            taille="large"
            pleineLargeur
            disabled={enCours}
            chargement={enCours}
          >
            {enCours ? fr.connexion.connexionEnCours : fr.actions.seConnecter}
          </Bouton>
        </div>
      </form>
    </div>
  );
}
