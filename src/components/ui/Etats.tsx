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

import { Icone, type NomIcone } from "./Icones";

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
        "flex items-center gap-3 rounded-xl border border-attention bg-attention-bg px-4 py-3",
        "font-ui text-body font-medium text-attention-ink",
      ].join(" ")}
    >
      <span aria-hidden="true" className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-card text-attention-ink shadow-lift1">
        <Icone nom="alerte" taille={16} />
      </span>
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
      className="flex items-start gap-4 rounded-xl border border-attention bg-attention-bg p-5 shadow-lift2"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-attention bg-card text-attention-ink shadow-lift1"
      >
        <Icone nom="alerte" taille={20} />
      </span>
      <div className="flex min-w-0 flex-col gap-1.5">
        <strong className="font-ui text-body font-semibold text-attention-ink">
          {fr.erreur.titre}
        </strong>
        <p className="font-ui text-body font-regular text-ink-700">{message}</p>
        {action === undefined ? null : <div className="mt-3">{action}</div>}
      </div>
    </div>
  );
}

/**
 * État vide — COMPOSÉ, jamais un blanc qui ressemble à un oubli.
 *
 * v9 : le disque de marque (`--grad-empty`, explicitement au catalogue des
 * états vides d'ADR-025) porte l'icône du contexte ; le titre dit ce qui
 * N'EST PAS, le message dit ce qu'on peut faire. Aucune donnée fictive
 * (I19), aucune illustration qui meuble : l'icône est celle de l'écran
 * lui-même, elle rappelle ce qu'on vient chercher ici.
 *
 * `icone` reste optionnel : un appelant qui ne la passe pas garde la
 * composition sobre d'avant — mais l'écran principal de chaque domaine la
 * passe, parce qu'un « rien » dessiné est plus calme qu'un « rien » brut.
 */
export function EtatVide({
  message,
  action,
  icone,
  titre,
}: {
  readonly message: string;
  readonly action?: ReactNode;
  readonly icone?: NomIcone;
  readonly titre?: string;
}): React.JSX.Element {
  return (
    /*
      V7 — L'ÉTAT VIDE N'EST PLUS UNE CARTE, ET LE DISQUE A MAIGRI.
      Il portait `bg-card`, une bordure et `shadow-lift2` : posé dans une
      `Carte` — ce qui est son usage principal, sur le tableau de bord — il
      produisait une carte DANS une carte. Il empilait en plus un disque de
      80 px contenant un disque de 56 px, une ombre dans une ombre pour tenir
      une seule icône. Les trois cartes « maintenant » du tableau de bord
      mesuraient 270 px de haut pour une phrase.

      Ici : aucune surface propre (le parent la fournit), un seul disque
      discret, et la phrase remonte. Un état vide explique pourquoi c'est vide,
      il ne meuble pas.
    */
    <div className="flex flex-col items-center gap-4 px-4 py-6 text-center">
      {icone === undefined ? null : (
        <span
          aria-hidden="true"
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl bg-sunken text-ink-500"
        >
          <Icone nom={icone} taille={20} />
        </span>
      )}
      <div className="flex max-w-form flex-col gap-2">
        {titre === undefined ? null : (
          <p className="font-ui text-heading font-semibold text-ink-900">{titre}</p>
        )}
        <p className="font-ui text-body font-regular text-ink-500">{message}</p>
      </div>
      {action === undefined ? null : <div className="mt-1">{action}</div>}
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
      className="flex flex-col gap-4 rounded-2xl border border-rule/60 bg-card p-6 shadow-lift2"
    >
      <span className="sr-only">{fr.etats.chargement}</span>
      <span
        aria-hidden="true"
        className="block h-5 w-1/3 animate-respire rounded-lg bg-sunken"
      />
      {Array.from({ length: lignes }, (_, i) => (
        <span
          key={i}
          aria-hidden="true"
          className={[
            "block h-4 animate-respire rounded-lg bg-sunken",
            i === lignes - 1 ? "w-1/2" : "w-full",
          ].join(" ")}
        />
      ))}
    </div>
  );
}

/**
 * L'état d'enregistrement d'une saisie longue.
 *
 * IL EXISTE PARCE QUE LE SILENCE MENT. Une zone de texte qui s'enregistre toute
 * seule sans rien dire laisse la praticienne décider seule si son travail est
 * en sécurité — et la réponse par défaut, quand rien ne s'affiche, est « oui ».
 * Elle ferme l'onglet. Sur une note de consultation, c'est la séance qui est
 * perdue.
 *
 * `echec` ne dit JAMAIS que le texte est conservé quelque part : aucune
 * persistance locale n'existe dans ce dépôt. Il dit ce qui est vrai — le texte
 * est encore à l'écran, et il faut le laisser là.
 *
 * `role="status"` et non `alert` : l'information n'interrompt pas la frappe.
 */
export function IndicateurEnregistrement({
  etat,
  horodatage,
}: {
  readonly etat: "repos" | "encours" | "enregistre" | "echec";
  /** Heure du dernier enregistrement réussi, déjà formatée par l'appelant. */
  readonly horodatage?: string;
}): React.JSX.Element | null {
  if (etat === "repos") return null;

  const libelles = {
    encours: fr.consultation.enregistrement,
    enregistre: fr.consultation.enregistre,
    echec: fr.consultation.nonEnregistre,
  } as const;

  const encres = {
    encours: "text-ink-500",
    enregistre: "text-ink-500",
    echec: "text-attention-ink",
  } as const;

  return (
    <span
      role="status"
      className={["flex items-center gap-2 font-ui text-label", encres[etat]].join(" ")}
    >
      {/* Une forme, pas seulement une couleur (§4 règle 4) : le point est plein
          quand l'enregistrement a abouti, creux tant qu'il est en cours. */}
      <span
        aria-hidden="true"
        className={[
          "inline-block h-2 w-2 shrink-0 rounded-full border",
          etat === "enregistre"
            ? "border-positive bg-positive"
            : etat === "echec"
              ? "border-attention bg-attention"
              : "border-ink-300 bg-transparent",
        ].join(" ")}
      />
      {libelles[etat]}
      {etat === "enregistre" && horodatage !== undefined ? (
        <span className="font-num tabular-nums">{horodatage}</span>
      ) : null}
    </span>
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
    <div className="flex min-w-0 flex-col gap-2 rounded-xl bg-sunken px-4 py-3">
      <span className="font-ui text-label font-medium text-ink-500">{libelle}</span>
      <span
        className={[
          "font-ui text-body font-regular tabular-nums",
          "whitespace-pre-wrap break-words",
          vide ? "text-ink-500" : "text-ink-900 font-medium",
        ].join(" ")}
      >
        {vide ? fr.etats.texteAbsent : valeur}
      </span>
    </div>
  );
}
