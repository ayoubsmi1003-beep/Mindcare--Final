/**
 * Les surfaces : cartes, sections, panneaux, en-têtes, dispositions de fiche.
 *
 * TOUT EST OPAQUE ICI, SANS EXCEPTION. Aucune de ces surfaces ne porte de
 * verre : elles reçoivent de la donnée clinique — nom de patient, heure de
 * rendez-vous, dose, montant — et §4 règle 2 l'interdit. Le verre est réservé
 * au mobilier flottant (panneau Jarvis, carte de confirmation, ⌘K, en-tête
 * collant, fond de modale). Ce n'est pas une préférence : un texte translucide
 * change de contraste selon ce qui défile derrière, et « 25 mg » contre
 * « 250 mg » ne se lit pas au conditionnel.
 *
 * LA PROFONDEUR VIENT DE L'OMBRE, PAS DE LA COULEUR. Trois niveaux seulement
 * (`--lift-1/2/3`), ombres froides et vertes. Une carte au repos est à
 * `lift1` ; `lift2` signale qu'on la survole ; `lift3` est réservé à ce qui
 * flotte réellement. Empiler des fonds différents pour simuler des plans
 * fatigue l'œil sur huit heures — l'ombre le fait sans ajouter de couleur.
 */

import type { ReactNode } from "react";

/**
 * La surface de base.
 *
 * `interactive` n'ajoute PAS de translation. Une carte qui se soulève sous le
 * curseur déplace la cible qu'on vise, et sur un agenda dense on vise beaucoup.
 * Le survol change l'ombre et la bordure — perceptible, sans mouvement.
 */
export function Carte({
  children,
  interactive = false,
  discrete = false,
}: {
  readonly children: ReactNode;
  /** La carte est cliquable dans son ensemble. */
  readonly interactive?: boolean;
  /** Surface encastrée plutôt que posée — listes internes, sous-blocs. */
  readonly discrete?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={[
        "rounded-lg border",
        discrete ? "bg-sunken border-rule shadow-none" : "bg-card border-rule shadow-lift1",
        interactive
          ? "transition duration-quick ease-soft hover:border-ink-300 hover:shadow-lift2"
          : "",
      ].join(" ")}
    >
      {children}
    </div>
  );
}

/**
 * Une section de page : un titre, et ce qu'il annonce.
 *
 * Le titre est un `heading` et non un `title` : sur un écran qui en compte
 * plusieurs, réserver `title` au sujet de la page garde la hiérarchie lisible.
 * `--s-6` sous le titre et `--s-10` entre sections — l'espace est ce qui dit
 * « ceci est un autre sujet », plus fiable qu'un trait.
 */
export function Section({
  titre,
  action,
  children,
}: {
  readonly titre: string;
  /** Une action qui porte sur la section entière, alignée à droite du titre. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-ui text-heading font-semibold text-ink-900">{titre}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * L'en-tête d'un écran : sur-titre, titre, sous-titre, actions.
 *
 * Le sur-titre (`eyebrow`, majuscules) porte le contexte — de quel dossier,
 * de quelle semaine il s'agit — et le titre porte le sujet. Les séparer permet
 * de lire le contexte sans relire le titre, ce qui compte quand on ouvre le
 * même écran quarante fois par jour.
 */
export function EnTetePage({
  surTitre,
  titre,
  sousTitre,
  actions,
}: {
  readonly surTitre?: string;
  readonly titre: string;
  readonly sousTitre?: string;
  readonly actions?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        {surTitre === undefined ? null : (
          <span className="font-ui text-eyebrow font-semibold uppercase text-ink-500">
            {surTitre}
          </span>
        )}
        {/* `break-words` : un nom de patient très long ne doit ni déborder ni
            pousser les actions hors de l'écran (I11, cinquième état). */}
        <h1 className="font-ui text-display font-semibold text-ink-900 break-words">{titre}</h1>
        {sousTitre === undefined ? null : (
          <p className="font-ui text-body text-ink-500">{sousTitre}</p>
        )}
      </div>
      {actions === undefined ? null : (
        <div className="flex flex-wrap items-center gap-3">{actions}</div>
      )}
    </header>
  );
}

/**
 * Un panneau d'information — un fait, pas une alerte.
 *
 * Ton neutre par défaut. `attention` existe pour ce qui demande un geste ; il
 * n'y a pas de ton `critical`, volontairement : aucun panneau d'information
 * n'annonce une perte de données, et le rouge reste un budget (§4 règle 1).
 */
export function PanneauInfo({
  titre,
  ton = "neutre",
  children,
}: {
  readonly titre?: string;
  readonly ton?: "neutre" | "attention" | "positif";
  readonly children: ReactNode;
}): React.JSX.Element {
  const tons = {
    neutre: "bg-sunken border-rule text-ink-700",
    attention: "bg-attention-bg border-attention text-ink-700",
    positif: "bg-positive-bg border-positive text-ink-700",
  } as const;
  const encres = {
    neutre: "text-ink-500",
    attention: "text-attention",
    positif: "text-positive",
  } as const;

  return (
    <div className={["rounded-md border p-4", tons[ton]].join(" ")}>
      {titre === undefined ? null : (
        <p
          className={[
            "font-ui text-label font-medium uppercase tracking-label",
            encres[ton],
          ].join(" ")}
        >
          {titre}
        </p>
      )}
      <div className="font-ui text-body">{children}</div>
    </div>
  );
}

/**
 * La grille d'une fiche : des champs en lecture, sur plusieurs colonnes.
 *
 * `auto-fit` plutôt qu'un nombre de colonnes figé : la même fiche donne quatre
 * colonnes sur le poste du cabinet (1920), deux sur un portable, une sur un
 * écran étroit — sans point de rupture à maintenir et sans qu'aucun champ ne
 * soit jamais écrasé sous sa largeur lisible.
 */
export function GrilleChamps({ children }: { readonly children: ReactNode }): React.JSX.Element {
  return <div className="grid grid-cols-fiche gap-x-8 gap-y-6">{children}</div>;
}
