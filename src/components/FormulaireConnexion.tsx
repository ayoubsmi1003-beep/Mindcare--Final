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
 * v9 — LA CARTE EST COMPOSÉE. L'en-tête de carte porte la marque (le mark au
 * trait, blanc sur sa pastille de dégradé — le seul dégradé de la carte, et
 * c'est l'orbe du produit), le titre, et les états d'erreur prennent la place
 * qu'ils ont toujours eue : entre le titre et les champs, JAMAIS après le
 * bouton — une erreur qu'on découvre en bas d'un formulaire est une erreur
 * qu'on ne relit pas.
 */

"use client";

import { useId, useState } from "react";

import { fr } from "@/i18n/fr";
import { Icone, MarqueMindCare } from "./ui/Icones";

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

  return (
    <div className="flex w-full flex-col gap-6 rounded-xl border border-rule bg-card p-10 shadow-lift3 max-w-form">
      {/* L'en-tête de marque de la carte : le mark dans son orbe, le titre.
          C'est le même mark que le rail — l'application se reconnaît avant
          qu'on ait lu un mot. */}
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-grad-orb text-on-brand shadow-glow-brand"
        >
          <MarqueMindCare taille={28} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 font-ui text-title font-semibold text-ink-900">
            {fr.connexion.titre}
          </h1>
          <p className="m-0 font-ui text-label text-ink-500">{fr.connexion.accroche}</p>
        </div>
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
            className="min-h-target-lg w-full rounded-md border border-rule bg-card px-4 py-3 font-ui text-body text-ink-900 outline-none transition duration-quick ease-soft placeholder:text-ink-300 hover:border-ink-300 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-disabled"
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
            className="min-h-target-lg w-full rounded-md border border-rule bg-card px-4 py-3 font-ui text-body text-ink-900 outline-none transition duration-quick ease-soft placeholder:text-ink-300 hover:border-ink-300 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-disabled"
          />
        </div>

        <button
          type="submit"
          disabled={enCours}
          aria-busy={enCours}
          /* ⚠️ `--brand-500` PENDANT L'ENVOI, ET SURTOUT PAS `--brand-400`.
           *
           * L'ancienne palette employait ici son ton 400. Le renommage v2
           * aurait donné `--brand-400` — le ton du LOGO, bien plus clair que
           * son prédécesseur : le libellé blanc du bouton y tombe à ≈ 2.2:1,
           * très en dessous du plancher de 4.5:1. Un bouton lisible au repos
           * devenait illisible exactement pendant qu'il annonce « Connexion
           * en cours… », c'est-à-dire au moment où on le lit.
           *
           * C'est le piège du renommage : un mappage 1:1 entre deux rampes
           * qui n'ont pas la même clarté déplace des contrastes sans rien
           * changer d'apparent dans le code. `--brand-500` tient le plancher
           * et reste visiblement en retrait de l'état actif. */
          className={[
            "mt-2 flex min-h-target-lg w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 px-5 py-3",
            "font-ui text-body font-semibold text-paper shadow-lift1",
            "transition duration-quick ease-soft",
            enCours
              ? "cursor-default bg-brand-500 shadow-none"
              : "bg-action-600 hover:bg-action-700 hover:shadow-lift2 active:bg-action-900 active:shadow-lift1",
          ].join(" ")}
        >
          {enCours ? fr.connexion.connexionEnCours : fr.actions.seConnecter}
        </button>
      </form>
    </div>
  );
}
