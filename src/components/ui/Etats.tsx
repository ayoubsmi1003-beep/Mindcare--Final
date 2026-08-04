/**
 * Les cinq états d'un écran (I11) : chargement · vide · erreur · hors-ligne ·
 * texte long ou absent.
 *
 * Ils vivent ici pour une raison mesurée : réécrits par écran, l'un d'eux
 * finit par afficher « Une erreur est survenue » — le vague exact qu'interdit
 * la règle 8 du §4. Une erreur dit ce qui s'est passé, ce qui a été préservé,
 * et quoi faire.
 *
 * `--attention` partout, jamais `--critical` : le rouge est un budget réservé
 * au disque critique et à la perte de données (§4 règle 1). Un appel réseau qui
 * échoue n'a rien perdu.
 */

import type { ReactNode } from "react";

import { fr } from "@/i18n/fr";

/**
 * Bandeau hors ligne.
 *
 * `role="status"` et non `role="alert"` : la perte de réseau n'interrompt pas
 * le travail (I20), elle informe. Un `alert` couperait la parole au lecteur
 * d'écran au milieu d'une note.
 *
 * Le bandeau APPARAÎT sans rien pousser : il est posé en haut du contenu et
 * garde sa place réservée. Un bandeau qui s'insère décale tout l'écran d'un
 * cran au moment précis où la praticienne visait un bouton.
 */
export function BandeauHorsLigne(): React.JSX.Element {
  return (
    <p
      role="status"
      className={[
        "flex items-center gap-3 rounded-md border border-rule bg-sunken px-4 py-3",
        "font-ui text-body text-ink-700",
      ].join(" ")}
    >
      {/* Une forme, pas seulement une couleur (§4 règle 4). */}
      <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full bg-ink-300" />
      {fr.etats.horsLigne}
    </p>
  );
}

/**
 * Bloc d'erreur.
 *
 * `message` vient de `fr.erreurs.*` via `AppError` — jamais du message brut de
 * Postgres, qui porte régulièrement la valeur ayant déclenché l'erreur
 * (« Key (phone)=(0554…) »), c'est-à-dire une donnée identifiante à l'écran (I5).
 */
export function BlocErreur({
  message,
  action,
}: {
  readonly message: string;
  /** « Réessayer », le plus souvent. Une erreur sans issue est une impasse. */
  readonly action?: ReactNode;
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className="flex flex-col gap-3 rounded-md border border-attention bg-attention-bg p-4"
    >
      <div className="flex flex-col gap-1">
        <strong className="font-ui text-label font-semibold uppercase tracking-label text-attention">
          {fr.erreur.titre}
        </strong>
        <p className="font-ui text-body text-ink-700">{message}</p>
      </div>
      {action}
    </div>
  );
}

/**
 * État vide.
 *
 * JAMAIS D'ILLUSTRATION (§4 règle 7) — une phrase en `--ink-500` et une action
 * teal. Un dessin de boîte vide occupe l'espace sans rien dire, et sur un écran
 * qu'on ouvre quarante fois par jour il devient du bruit permanent.
 *
 * Un état vide est HONNÊTE : il dit qu'il n'y a rien, il ne meuble pas avec de
 * la donnée fictive (I19).
 */
export function EtatVide({
  message,
  action,
}: {
  readonly message: string;
  readonly action?: ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-4 rounded-lg border border-rule bg-card px-6 py-12 text-center">
      <p className="max-w-main font-ui text-body text-ink-500">{message}</p>
      {action}
    </div>
  );
}

/**
 * Squelette de chargement.
 *
 * Il occupe LA PLACE DE CE QUI ARRIVE, pas une place générique : sinon le
 * contenu, en arrivant, décale l'écran — et c'est exactement l'instant où on
 * clique. Les blocs respirent en opacité seule, sans se déplacer et sans
 * changer de couleur (§4 règle 5) ; `prefers-reduced-motion` est déjà respecté
 * globalement par `tokens.css`.
 *
 * `aria-busy` et un texte de rechange : un lecteur d'écran doit entendre
 * « chargement », pas une suite de blocs muets.
 */
export function Squelette({
  lignes = 3,
}: {
  readonly lignes?: number;
}): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      className="flex flex-col gap-3 rounded-lg border border-rule bg-card p-6"
    >
      <span className="sr-only">{fr.etats.chargement}</span>
      {Array.from({ length: lignes }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={[
            "block h-4 animate-respire rounded-sm bg-sunken",
            // La dernière ligne est plus courte : un paragraphe réel l'est
            // presque toujours, et l'œil lit « du texte » au lieu de « des
            // barres ».
            i === lignes - 1 ? "w-1/2" : "w-full",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

/**
 * Un champ en lecture.
 *
 * Champ non renseigné : une PHRASE, jamais un tiret nu — un tiret se confond
 * avec une valeur, et sur un numéro de téléphone la confusion se paie au moment
 * où on cherche à joindre quelqu'un.
 */
export function Champ({
  libelle,
  valeur,
}: {
  readonly libelle: string;
  readonly valeur: string | null;
}): React.JSX.Element {
  const vide = valeur === null || valeur === "";
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="font-ui text-label font-medium tracking-label text-ink-500">{libelle}</span>
      <span
        className={[
          "font-ui text-body tabular-nums",
          // Un nom long ou une note d'une ligne entière ne doit ni déborder ni
          // pousser la colonne voisine (I11, cinquième état).
          "whitespace-pre-wrap break-words",
          vide ? "text-ink-300" : "text-ink-900",
        ].join(" ")}
      >
        {vide ? fr.etats.texteAbsent : valeur}
      </span>
    </div>
  );
}
