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
 * signal exactement là où il devra porter. `critique` n'existe que pour les
 * destructions réelles (suppression, annulation définitive d'un document).
 *
 * FLOW × VERT — le langage d'interaction est emprunté au FlowButton 21st.dev
 * (pastille, cercle qui s'étend, flèches qui entrent et sortent, texte qui
 * glisse, pastille qui devient carte au survol), la couleur reste MindCare :
 * `--action-600` et `--brand-*`, jamais de noir. Toute classe employée ici est
 * adossée à un jeton (I10) — `tailwind.config.ts` n'expose aucune valeur libre.
 * Les durées et courbes viennent des jetons (`duration-scene` = 600 ms,
 * `ease-spring` = la courbe d'entrée des flèches de la référence).
 */

import Link from "next/link";

import { Icone } from "./Icones";

export type RangBouton = "principal" | "secondaire" | "discret";

/** Densité sans changer de langage : même chorégraphie, autres dimensions. */
export type TailleBouton = "defaut" | "compact" | "large" | "icone";

/**
 * Socle commun : géométrie Flow, cible tactile, focus, transition.
 *
 * `min-h-target` tient le plancher d'accessibilité (≥36px, §4.4) sans qu'un
 * appelant ait à y penser. `focus-visible` et non `focus` : l'anneau ne doit
 * pas s'allumer sous la souris, seulement au clavier — sinon il devient du
 * bruit et on finit par le retirer.
 *
 * `group` porte la chorégraphie des enfants (cercle, flèches, texte).
 * `rounded-full` au repos, `hover:rounded-lg` : la pastille devient carte,
 * exactement comme la référence. `motion-reduce:transition-none` : le style
 * reste, la chorégraphie s'efface (l'état hover/focus demeure lisible car le
 * cercle apparaît instantanément et les couleurs de survol s'appliquent).
 */
const SOCLE = [
  "group relative inline-flex max-w-full items-center justify-center gap-2 overflow-hidden",
  "rounded-full hover:rounded-lg",
  "font-ui text-body font-semibold tracking-body",
  "cursor-pointer select-none text-center",
  "transition-all duration-scene ease-out",
  "motion-reduce:transition-none",
  "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
  "disabled:cursor-not-allowed disabled:opacity-disabled disabled:shadow-none",
  "active:scale-95",
].join(" ");

const TAILLES: Readonly<Record<TailleBouton, string>> = {
  // `px-8 py-3` : les dimensions de la référence, en pas du système.
  defaut: "min-h-target px-8 py-3",
  // Dense (barres d'outils, lignes de tableau) — le plancher 36px demeure.
  compact: "min-h-target px-4 py-2 text-label",
  // Appel majeur (connexion, premier lancement).
  large: "min-h-target-lg px-10 py-4",
  // Icône seule : pas de flèches ni de glissement de texte, le cercle suffit.
  icone: "min-h-target min-w-target p-2",
};

/**
 * Chaque rang dit : bordure et texte au repos, couleur du cercle, texte au
 * survol. Le cercle porte le remplissage ; le texte et les flèches passent
 * par-dessus (`currentColor`, donc le contraste du texte vaut pour l'icône).
 */
const RANGS: Readonly<
  Record<RangBouton, { readonly base: string; readonly cercle: string }>
> = {
  // Rempli vert d'emblée (5.10:1 avec le blanc, mesuré) ; le cercle
  // `action-900` assombrit au survol et les flèches racontent le mouvement.
  principal: {
    base: [
      "border border-transparent bg-action-600 text-on-brand shadow-lift1",
      "hover:border-transparent hover:text-on-brand hover:shadow-lift2",
      "active:shadow-lift0",
    ].join(" "),
    cercle: "bg-action-900",
  },
  // Carte claire au repos, remplissage vert au survol — la chorégraphie
  // complète de la référence, teintée MindCare.
  secondaire: {
    base: [
      "border border-rule bg-card text-ink-900 shadow-lift1",
      "hover:border-transparent hover:text-on-brand hover:shadow-lift2",
      "active:shadow-lift0",
    ].join(" "),
    cercle: "bg-action-600",
  },
  // Le discret ne devient jamais un aplat blanc-sur-vert : cercle vert pâle,
  // encre verte profonde au survol. Même danse, volume bas.
  discret: {
    base: [
      "border border-transparent bg-transparent text-ink-500",
      "hover:border-transparent hover:text-action-900",
    ].join(" "),
    cercle: "bg-action-100",
  },
};

/** Rang d'un geste qui retire quelque chose. `attention`, jamais `critical`. */
const RETRAIT = {
  base: [
    "border border-attention bg-card text-attention-ink shadow-lift1",
    "hover:border-transparent hover:text-on-brand hover:shadow-lift2",
    "active:shadow-lift0",
  ].join(" "),
  cercle: "bg-attention-ink",
};

/** Destruction réelle uniquement (document annulé, donnée supprimée). */
const CRITIQUE = {
  base: [
    "border border-critical bg-card text-critical shadow-lift1",
    "hover:border-transparent hover:text-destructive-foreground hover:shadow-lift2",
    "active:shadow-lift0",
  ].join(" "),
  cercle: "bg-critical",
};

export interface BoutonProps {
  readonly children: React.ReactNode;
  readonly rang?: RangBouton;
  /** Geste qui annule ou retire. Prend le ton `attention`. */
  readonly retrait?: boolean;
  /** Destruction réelle (suppression, annulation définitive). Prend `critical`. */
  readonly critique?: boolean;
  /** Densité : même chorégraphie, autres dimensions. `icone` = icône seule. */
  readonly taille?: TailleBouton;
  /**
   * État de chargement : fige le bouton, annonce `aria-busy`, affiche un
   * point qui respire (la seule animation autorisée par le système) et
   * suspend la chorégraphie — l'animation ne doit jamais suggérer un succès
   * qui n'a pas eu lieu.
   */
  readonly chargement?: boolean;
  /**
   * Nom accessible OBLIGATOIRE avec `taille="icone"` : une icône seule sans
   * libellé est muette au lecteur d'écran.
   */
  readonly etiquette?: string;
  readonly type?: "button" | "submit";
  readonly onClick?: () => void;
  readonly disabled?: boolean;
  /** Occupe toute la largeur disponible — formulaires étroits, tiroirs. */
  readonly pleineLargeur?: boolean;
  /**
   * Le bouton COMMANDE UN PANNEAU qu'il déplie et replie.
   *
   * ⚠️ CE N'EST PAS UN DÉTAIL D'HABILLAGE. Sans `aria-expanded`, un lecteur
   * d'écran annonce « bouton » là où il devrait annoncer « bouton, replié » :
   * l'utilisateur ne sait pas qu'il y a quelque chose à ouvrir, ni si son clic
   * a produit un effet. Mesuré ROUGE au navigateur le 2026-08-20 sur le journal
   * des paiements — l'attribut était posé sur `<Bouton>` mais la surface de
   * props, volontairement fermée, ne le transmettait pas.
   *
   * Ajouté ICI plutôt que contourné par un `<button>` nu dans l'écran :
   * `ui/index.ts` le dit en toutes lettres — « si une pièce manque, elle
   * s'ajoute ICI, pas dans l'écran qui en a besoin ». Un second vocabulaire de
   * bouton, c'est deux grammaires à relire.
   *
   * Laisser `undefined` quand le bouton ne commande aucun panneau : un
   * `aria-expanded="false"` sur un bouton ordinaire ment tout autant.
   */
  readonly deploye?: boolean;
  /**
   * Le bouton est un interrupteur ENFONCÉ (chip multi-sélection).
   *
   * Rend `aria-pressed` : sans lui, un lecteur d'écran annonce « bouton »
   * sans dire si le choix est actif. Laisser `undefined` pour un bouton
   * ordinaire — un `aria-pressed="false"` sur une commande ment tout autant.
   */
  readonly enfonce?: boolean;
}

function habillage(
  rang: RangBouton,
  retrait: boolean,
  critique: boolean,
  taille: TailleBouton,
  enfonce: boolean | undefined,
  pleineLargeur: boolean,
): string {
  const ton = critique ? CRITIQUE : retrait ? RETRAIT : RANGS[rang];
  return [
    SOCLE,
    TAILLES[taille],
    ton.base,
    // Enfoncé = choix ACTIF : teinte profonde + graisse, jamais de décalage de
    // bordure (un `border-2` bougerait la mise en page à chaque bascule) et
    // jamais de glyphe (les icônes sont dessinées, pas des caractères).
    enfonce === true ? "border-action-600 bg-action-100 font-semibold text-ink-900" : "",
    pleineLargeur ? "w-full" : "",
  ].join(" ");
}

/**
 * La chorégraphie Flow : flèche qui entre par la gauche, texte qui glisse,
 * cercle qui s'étend depuis le centre, flèche qui sort vers la droite.
 *
 * `start`/`end` logiques : en RTL les positions se miroient et les flèches
 * se retournent (`rtl:-scale-x-100`), le texte glisse dans l'autre sens.
 * Réduit sous `prefers-reduced-motion` à une apparition instantanée
 * (`motion-reduce:transition-none` sur chaque couche).
 */
function Choregraphie({
  cercle,
  sansFleches,
  anime,
}: {
  /** Classe de fond du cercle (`bg-action-600`, …). */
  readonly cercle: string;
  /** Icône seule : le cercle suffit, les flèches n'ont aucun sens. */
  readonly sansFleches: boolean;
  /** Faux quand désactivé ou en chargement : aucune promesse animée. */
  readonly anime: boolean;
}): React.JSX.Element | null {
  if (!anime) return null;
  return (
    <>
      {sansFleches ? null : (
        <span
          aria-hidden="true"
          className={[
            "absolute -start-6 top-1/2 z-10 -translate-y-1/2 text-current",
            "transition-all duration-scene ease-spring",
            "group-hover:start-4",
            "motion-reduce:transition-none",
            "rtl:-scale-x-100",
          ].join(" ")}
        >
          <Icone nom="fleche" taille={16} />
        </span>
      )}
      <span
        aria-hidden="true"
        className={[
          "absolute left-1/2 top-1/2 z-0 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full opacity-0",
          cercle,
          "transition-all duration-scene ease-out",
          "group-hover:h-cercle group-hover:w-cercle group-hover:opacity-100",
          "motion-reduce:transition-none",
        ].join(" ")}
      />
      {sansFleches ? null : (
        <span
          aria-hidden="true"
          className={[
            "absolute end-4 top-1/2 z-10 -translate-y-1/2 text-current",
            "transition-all duration-scene ease-spring",
            "group-hover:-end-6",
            "motion-reduce:transition-none",
            "rtl:-scale-x-100",
          ].join(" ")}
        >
          <Icone nom="fleche" taille={16} />
        </span>
      )}
    </>
  );
}

function TexteBouton({
  sansFleches,
  children,
}: {
  readonly sansFleches: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  if (sansFleches) {
    return (
      <span className="relative z-10 inline-flex min-w-0 items-center justify-center">
        {children}
      </span>
    );
  }
  return (
    <span
      className={[
        "relative z-10 inline-flex min-w-0 max-w-full items-center justify-center gap-1",
        // Le texte s'écarte de la flèche qui entre (-12px → +12px en LTR,
        // miroir en RTL) sans jamais sortir du bouton (`overflow-hidden`).
        // `truncate` + `whitespace-nowrap` : fini les libellés qui se
        // chevauchent ou sortent du bouton (V10).
        "-translate-x-3 truncate whitespace-nowrap transition-all duration-scene ease-out",
        "group-hover:translate-x-3",
        "motion-reduce:transition-none motion-reduce:translate-x-0 motion-reduce:group-hover:translate-x-0",
        "rtl:translate-x-3 rtl:group-hover:-translate-x-3",
        "rtl:motion-reduce:translate-x-0 rtl:motion-reduce:group-hover:translate-x-0",
      ].join(" ")}
    >
      {children}
    </span>
  );
}

export function Bouton({
  children,
  rang = "secondaire",
  retrait = false,
  critique = false,
  taille = "defaut",
  chargement = false,
  etiquette,
  type = "button",
  onClick,
  disabled = false,
  pleineLargeur = false,
  deploye,
  enfonce,
}: BoutonProps): React.JSX.Element {
  const fige = disabled || chargement;
  const ton = critique ? CRITIQUE : retrait ? RETRAIT : RANGS[rang];
  const sansFleches = taille === "icone";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={fige}
      aria-busy={chargement || undefined}
      aria-label={etiquette}
      aria-expanded={deploye}
      aria-pressed={enfonce}
      className={habillage(rang, retrait, critique, taille, enfonce, pleineLargeur)}
    >
      <Choregraphie cercle={ton.cercle} sansFleches={sansFleches} anime={!fige} />
      {chargement ? (
        <span
          aria-hidden="true"
          className="relative z-10 inline-block size-2 shrink-0 animate-respire rounded-full bg-current"
        />
      ) : null}
      <TexteBouton sansFleches={sansFleches}>{children}</TexteBouton>
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
  critique = false,
  taille = "defaut",
  pleineLargeur = false,
}: {
  readonly href: string;
  readonly children: React.ReactNode;
  readonly rang?: RangBouton;
  readonly retrait?: boolean;
  readonly critique?: boolean;
  readonly taille?: TailleBouton;
  readonly pleineLargeur?: boolean;
}): React.JSX.Element {
  const ton = critique ? CRITIQUE : retrait ? RETRAIT : RANGS[rang];
  const sansFleches = taille === "icone";
  return (
    <Link
      href={href}
      className={[habillage(rang, retrait, critique, taille, undefined, pleineLargeur), "no-underline"].join(" ")}
    >
      <Choregraphie cercle={ton.cercle} sansFleches={sansFleches} anime />
      <TexteBouton sansFleches={sansFleches}>{children}</TexteBouton>
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
