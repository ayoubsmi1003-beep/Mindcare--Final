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
 */

"use client";

import { useId, useState } from "react";

import { fr } from "@/i18n/fr";

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
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--s-6)",
        padding: "var(--s-10)",
        borderRadius: "var(--r-xl)",
        maxWidth: "var(--width-form)",
        width: "var(--size-full)",
        /* ⚠️ CETTE CARTE EST OPAQUE, ET ELLE L'EST DEPUIS V3.
         *
         * Elle portait un dégradé composé ICI, à la main — un dégradé linéaire
         * de 180deg allant de `--brand-050` à `--card`.
         * Écrit avec des jetons, donc invisible à un contrôle qui ne cherche
         * que des couleurs en dur — et pourtant c'était un QUATRIÈME dégradé,
         * là où ADR-022 en ferme la liste à trois. Un dégradé composé de jetons
         * légitimes reste un dégradé inventé : ce qui est fermé, c'est la
         * liste, pas la provenance des couleurs.
         *
         * La couleur n'a pas disparu pour autant — elle a changé de plan. Le
         * DÉGRADÉ EST DERRIÈRE, sur le fond d'écran (`--grad-auth`, au
         * catalogue), et la carte se détache dessus en blanc franc. C'est le
         * meilleur dessin des deux : les champs de saisie et leurs étiquettes
         * reposent sur une surface opaque, donc à contraste constant, ce qu'un
         * fond dégradé sous un formulaire ne garantit jamais. */
        background: "var(--card)",
        boxShadow: "var(--lift-3)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <h1
        style={{
          fontSize: "var(--text-title-size)",
          lineHeight: "var(--text-title-leading)",
          letterSpacing: "var(--text-title-tracking)",
          fontWeight: "var(--weight-semibold)",
          color: "var(--ink-900)",
          margin: "var(--size-0)",
        }}
      >
        {fr.connexion.titre}
      </h1>

      {/* Hors ligne : ton neutre, jamais --attention ni --critical (§4.1). */}
      {horsLigne ? (
        <p
          id={horsLigneId}
          role="status"
          style={{
            margin: "var(--size-0)",
            padding: "var(--s-3) var(--s-4)",
            borderRadius: "var(--r-md)",
            background: "var(--sunken)",
            color: "var(--ink-700)",
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
          }}
        >
          {fr.etats.horsLigne}
        </p>
      ) : null}

      {/* Erreur : gabarit en trois temps déjà composé par l'appelant. On
          n'affiche ici que ce qu'il fournit, sans le réécrire (§4.8). */}
      {messageErreur !== undefined ? (
        <div
          id={erreurId}
          role="alert"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "var(--s-1)",
            padding: "var(--s-3) var(--s-4)",
            borderRadius: "var(--r-md)",
            background: "var(--attention-bg)",
            color: "var(--ink-700)",
          }}
        >
          <strong
            style={{
              fontSize: "var(--text-label-size)",
              lineHeight: "var(--text-label-leading)",
              letterSpacing: "var(--text-label-tracking)",
              fontWeight: "var(--weight-semibold)",
              color: "var(--attention-ink)",
            }}
          >
            {fr.erreur.titre}
          </strong>
          <span
            style={{
              fontSize: "var(--text-body-size)",
              lineHeight: "var(--text-body-leading)",
            }}
          >
            {messageErreur}
          </span>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}
        aria-describedby={
          [messageErreur !== undefined ? erreurId : null, horsLigne ? horsLigneId : null]
            .filter((value): value is string => value !== null)
            .join(" ") || undefined
        }
      >
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
          <label
            htmlFor={emailId}
            style={{
              fontSize: "var(--text-label-size)",
              lineHeight: "var(--text-label-leading)",
              letterSpacing: "var(--text-label-tracking)",
              fontWeight: "var(--weight-medium)",
              color: "var(--ink-700)",
            }}
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
            style={{
              padding: "var(--s-3) var(--s-4)",
              borderRadius: "var(--r-md)",
              border: "var(--rule-width) solid var(--rule)",
              background: "var(--card)",
              color: "var(--ink-900)",
              fontSize: "var(--text-body-size)",
              lineHeight: "var(--text-body-leading)",
              fontFamily: "var(--font-ui)",
              minHeight: "var(--target-comfort)",
            }}
          />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-2)" }}>
          <label
            htmlFor={motDePasseId}
            style={{
              fontSize: "var(--text-label-size)",
              lineHeight: "var(--text-label-leading)",
              letterSpacing: "var(--text-label-tracking)",
              fontWeight: "var(--weight-medium)",
              color: "var(--ink-700)",
            }}
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
            style={{
              padding: "var(--s-3) var(--s-4)",
              borderRadius: "var(--r-md)",
              border: "var(--rule-width) solid var(--rule)",
              background: "var(--card)",
              color: "var(--ink-900)",
              fontSize: "var(--text-body-size)",
              lineHeight: "var(--text-body-leading)",
              fontFamily: "var(--font-ui)",
              minHeight: "var(--target-comfort)",
            }}
          />
        </div>

        <button
          type="submit"
          disabled={enCours}
          aria-busy={enCours}
          style={{
            marginTop: "var(--s-2)",
            padding: "var(--s-3) var(--s-5)",
            borderRadius: "var(--r-md)",
            border: "none",
            minHeight: "var(--target-comfort)",
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
            background: enCours ? "var(--brand-500)" : "var(--action-600)",
            color: "var(--card)",
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
            fontWeight: "var(--weight-semibold)",
            fontFamily: "var(--font-ui)",
            cursor: enCours ? "default" : "pointer",
            transition: `background var(--d-quick) var(--e-soft)`,
          }}
        >
          {enCours ? fr.connexion.connexionEnCours : fr.actions.seConnecter}
        </button>
      </form>
    </div>
  );
}
