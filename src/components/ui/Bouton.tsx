/**
 * Boutons et liens d'action — la hiérarchie d'action du produit.
 *
 * POURQUOI CE FICHIER EXISTE. Les écrans de S3 et S4 composaient chaque bouton
 * à la main, en styles en ligne. Trois conséquences, toutes constatées :
 * aucun état de survol nulle part, un anneau de focus réécrit à chaque endroit
 * (donc absent par oubli à certains), et deux boutons de même rang qui ne se
 * ressemblaient pas d'un écran à l'autre. Une hiérarchie d'action qui varie
 * oblige à relire l'écran au lieu de le reconnaître.
 *
 * TROIS RANGS, PAS PLUS. `principal` : l'action que l'écran existe pour
 * permettre — un seul par vue. `secondaire` : une action réelle mais qui n'est
 * pas le sujet. `discret` : navigation et retour en arrière, ce qui ne modifie
 * rien. Un quatrième rang rendrait le premier moins lisible.
 *
 * PAS DE RANG « DESTRUCTEUR » ROUGE. Annuler un rendez-vous prend `attention`,
 * pas `critical` : le rouge est un budget réservé au disque critique et à la
 * perte de données (§4 règle 1). Un bouton rouge sur un geste banal use le
 * signal exactement là où il devra porter.
 *
 * Classes Tailwind et non styles en ligne : le survol, le focus et la
 * transition n'existent pas en style en ligne, et le dépôt n'admet qu'une seule
 * feuille CSS (préflight 6 ter). Toute classe employée ici est adossée à un
 * jeton (I10) — `tailwind.config.ts` n'expose aucune valeur libre.
 */

import Link from "next/link";

export type RangBouton = "principal" | "secondaire" | "discret";

/**
 * Socle commun : géométrie, cible tactile, focus, transition.
 *
 * `min-h-target` tient le plancher d'accessibilité (≥36px, §4.4) sans qu'un
 * appelant ait à y penser. `focus-visible` et non `focus` : l'anneau ne doit
 * pas s'allumer sous la souris, seulement au clavier — sinon il devient du
 * bruit et on finit par le retirer.
 */
const SOCLE = [
  "inline-flex items-center justify-center gap-2",
  "min-h-target rounded-md px-4",
  "font-ui text-body font-medium",
  "cursor-pointer select-none text-center",
  "transition duration-quick ease-soft",
  "outline-none focus-visible:outline focus-visible:outline-teal-600 focus-visible:outline-offset",
  "disabled:cursor-not-allowed disabled:opacity-disabled disabled:shadow-none",
].join(" ");

const RANGS: Readonly<Record<RangBouton, string>> = {
  // L'ombre s'accentue au survol au lieu de déplacer le bouton : un élément
  // qui se soulève sous le curseur déplace aussi la cible qu'on vise.
  principal: [
    "bg-teal-600 text-paper shadow-lift1",
    "hover:bg-teal-700 hover:shadow-lift2",
    "active:bg-teal-900 active:shadow-lift1",
  ].join(" "),
  secondaire: [
    "bg-card text-ink-900 border border-rule shadow-lift1",
    "hover:bg-sunken hover:border-ink-300 hover:shadow-lift2",
    "active:bg-sunken active:shadow-lift0",
  ].join(" "),
  discret: [
    "bg-transparent text-ink-500 border border-transparent",
    "hover:bg-sunken hover:text-ink-900",
    "active:bg-sunken",
  ].join(" "),
};

/** Rang d'un geste qui retire quelque chose. `attention`, jamais `critical`. */
const RETRAIT = [
  "bg-card text-attention border border-attention shadow-lift1",
  "hover:bg-attention-bg hover:shadow-lift2",
  "active:bg-attention-bg active:shadow-lift0",
].join(" ");

export interface BoutonProps {
  readonly children: React.ReactNode;
  readonly rang?: RangBouton;
  /** Geste qui annule ou retire. Prend le ton `attention`. */
  readonly retrait?: boolean;
  readonly type?: "button" | "submit";
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** Occupe toute la largeur disponible — formulaires étroits, tiroirs. */
  readonly pleineLargeur?: boolean;
}

export function Bouton({
  children,
  rang = "secondaire",
  retrait = false,
  type = "button",
  onClick,
  disabled = false,
  pleineLargeur = false,
}: BoutonProps): React.JSX.Element {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={[
        SOCLE,
        retrait ? RETRAIT : RANGS[rang],
        pleineLargeur ? "w-full" : "",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/**
 * Le même objet, en navigation.
 *
 * Un lien reste un lien — clic milieu, ouverture dans un onglet, lecture par un
 * lecteur d'écran comme une destination et non comme une commande. On aligne
 * l'apparence, jamais la sémantique : un `<button onClick={router.push}>`
 * casserait les trois.
 */
export function LienBouton({
  href,
  children,
  rang = "secondaire",
  retrait = false,
  pleineLargeur = false,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
  readonly rang?: RangBouton;
  readonly retrait?: boolean;
  readonly pleineLargeur?: boolean;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className={[
        SOCLE,
        "no-underline",
        retrait ? RETRAIT : RANGS[rang],
        pleineLargeur ? "w-full" : "",
      ].join(" ")}
    >
      {children}
    </Link>
  );
}

/**
 * Une barre d'actions.
 *
 * L'action principale est à GAUCHE, contrairement à l'usage des boîtes de
 * dialogue système. La lecture se fait de gauche à droite : sur un écran dense,
 * l'œil trouve d'abord ce qu'il cherche le plus souvent. `flex-wrap` parce
 * qu'une barre à trois actions sur un portable de 13 pouces doit passer à la
 * ligne, pas déborder.
 */
export function BarreActions({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="flex flex-wrap items-center gap-3">{children}</div>;
}
