"use client";

/**
 * LA TUILE D'AGRÉGAT — V8 « Aurora ». L'élément signature du système.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QU'ELLE CORRIGE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * V7 affichait ses compteurs dans des cartes blanches bordées, chiffre en
 * `text-title` (21 px, graisse 600). Résultat mesuré à l'écran : quatre
 * rectangles identiques, dont la valeur ne se distinguait de son étiquette ni
 * par la taille, ni par la couleur, ni par la matière. Un tableau de bord dont
 * les chiffres ne sautent pas aux yeux n'est pas un tableau de bord — c'est
 * une liste.
 *
 * La tuile V8 change les quatre leviers à la fois, parce qu'un seul n'aurait
 * rien produit de visible :
 *
 *   · LA MATIÈRE — un dégradé pastel à trois arrêts avec dérive de teinte,
 *     et non un aplat. La dérive est ce qui fait qu'une surface se lit comme
 *     un matériau plutôt que comme une couleur de fond.
 *   · LA TYPOGRAPHIE — 28 px en graisse 800, interlettrage −0.03em, chiffres
 *     tabulaires. Le chiffre devient un objet dessiné.
 *   · LA PROFONDEUR — une ombre TEINTÉE de la famille, pas un gris.
 *   · LA DONNÉE — une étincelle optionnelle, qui répond à « ça monte ou ça
 *     descend ? » sans qu'on ait à ouvrir un écran de plus.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4.2 — POURQUOI UNE TUILE A LE DROIT D'ÊTRE EN DÉGRADÉ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * UNE TUILE COMPTE, ELLE NE DÉCRIT PERSONNE. Elle porte un agrégat — un
 * total, un effectif, une part — jamais une dose, un score, un montant de
 * ligne comptable ni un nom de patient. La frontière d'ADR-025 ne bouge pas :
 * ce qui est interdit derrière une donnée clinique nominative le reste.
 *
 * Et le dégradé est CLAIR, ce qui n'est pas un détail : l'encre reste
 * `--ink-900` sur les trois arrêts de chaque famille (≥ 14:1 sur l'arrêt le
 * plus foncé). C'est la raison pour laquelle la tuile V8 est pastel et non
 * profonde — sur un fond sombre, la hiérarchie interne d'une tuile (étiquette,
 * valeur, variation) exigerait trois blancs atténués, dont aucun ne passe
 * 4.5:1 sur la partie claire d'un dégradé. La version claire garde les trois
 * niveaux d'encre du système et n'a rien à négocier.
 */

import type { ReactNode } from "react";

import { Etincelle, type Famille } from "./Graphes";
import { Icone, type NomIcone } from "./Icones";

/**
 * Les tons de tuile. Ce sont des noms de MATIÈRE, pas de rôle : `menthe` ne
 * veut pas dire « positif ». L'écran choisit selon la composition qu'il veut
 * obtenir — la couleur d'une tuile de tableau de bord raconte une famille de
 * sujet (l'activité, l'argent, les gens), pas un jugement sur la valeur.
 *
 * ⚠️ IL N'Y A PAS DE TON « CRITIQUE ». Le rouge est un budget (§4 règle 1) :
 * il est réservé à la perte de donnée. Une tuile qui compte des impayés prend
 * `corail`, qui appelle le regard sans annoncer un incident.
 */
export type TonTuile = "menthe" | "azur" | "lavande" | "ambre" | "corail" | "neutre";

interface Matiere {
  readonly fond: string;
  readonly pastille: string;
  readonly famille: Famille;
}

/**
 * Classes écrites EN TOUTES LETTRES. Tailwind balaye le source et ne résout
 * aucune interpolation : `bg-tuile-${ton}` ne serait jamais émis, et la tuile
 * rendrait un fond transparent — en silence, sans erreur de build. C'est
 * exactement le mécanisme des 37 `bg-white/10` morts trouvés en V7.
 */
const MATIERES: Record<TonTuile, Matiere> = {
  menthe: {
    fond: "bg-tuile-menthe",
    pastille: "bg-emeraude-100 text-emeraude-700",
    famille: "emeraude",
  },
  azur: {
    fond: "bg-tuile-azur",
    pastille: "bg-azure-100 text-azure-700",
    famille: "azure",
  },
  lavande: {
    fond: "bg-tuile-lavande",
    pastille: "bg-violet-100 text-violet-700",
    famille: "violet",
  },
  ambre: {
    fond: "bg-tuile-ambre",
    pastille: "bg-ambre-100 text-ambre-700",
    famille: "ambre",
  },
  corail: {
    fond: "bg-tuile-corail",
    pastille: "bg-corail-100 text-corail-700",
    famille: "corail",
  },
  neutre: {
    fond: "bg-tuile-neutre",
    pastille: "bg-brand-100 text-brand-700",
    famille: "aqua",
  },
};

export interface TuileProps {
  readonly etiquette: string;
  /** L'explication longue, en infobulle. Elle définit CE QUE COMPTE le nombre. */
  readonly aide?: string;
  /** La valeur, DÉJÀ FORMATÉE. Ce composant n'arrondit, ne somme, ne divise pas. */
  readonly valeur: string;
  readonly sousLigne?: string;
  readonly icone?: NomIcone;
  readonly ton?: TonTuile;
  /**
   * La série de l'étincelle. Absente = pas d'étincelle : on ne dessine pas une
   * tendance qu'on n'a pas. Une courbe plate inventée pour remplir la place
   * serait une donnée fictive au sens de la règle 8.
   */
  readonly serie?: readonly number[];
  /** Un pied de tuile libre — un lien, une pastille d'état. */
  readonly pied?: ReactNode;
}

/** Sous quatre points, une courbe relie des accidents, elle ne décrit rien. */
const SEUIL_POINTS = 4;

function afficherEtincelle(serie: readonly number[] | undefined): boolean {
  if (serie === undefined || serie.length < SEUIL_POINTS) return false;
  return serie.filter((v) => v !== 0).length >= 2;
}

export function Tuile({
  etiquette,
  aide,
  valeur,
  sousLigne,
  icone,
  ton = "neutre",
  serie,
  pied,
}: TuileProps): React.JSX.Element {
  const m = MATIERES[ton];

  return (
    <div
      className={[
        "relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-5 shadow-tuile",
        m.fond,
      ].join(" ")}
    >
      <div className="flex items-start justify-between gap-3">
        <p
          className="min-w-0 font-ui text-label font-semibold text-ink-700"
          {...(aide === undefined ? {} : { title: aide })}
        >
          {etiquette}
        </p>
        {icone === undefined ? null : (
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-douce",
              m.pastille,
            ].join(" ")}
          >
            <Icone nom={icone} taille={20} />
          </span>
        )}
      </div>

      {/* ⚠️ `truncate` ET NON UN RETOUR À LA LIGNE. Un montant coupé en deux
          lignes se lit comme deux nombres. Mesuré en V7 sur « -142 500 DZD »
          dans une tuile d'un cinquième de largeur : la valeur sortait du
          cadre. Le titre porte la valeur complète en infobulle. */}
      {/* ⚠️ V9 — MAIS UN MONTANT TRONQUÉ RESTE UN MONTANT FAUX. Relevé à
          l'écran Finances : « 165 500 D… » et « 106 500 D… ». L'infobulle
          rattrape au survol, pas au coup d'œil — or une tuile de recette EST un
          coup d'œil. On RÉDUIT donc le corps plutôt que de couper : 28 px
          jusqu'à neuf caractères, 22 px au-delà. `truncate` reste en dernier
          filet, mais il ne doit plus servir sur un montant réel. */}
      <p
        className={[
          "truncate font-ui font-extrabold tabular-nums text-ink-900",
          valeur.length > 9 ? "text-title tracking-title" : "text-chiffre tracking-chiffre",
        ].join(" ")}
        title={valeur}
      >
        {valeur}
      </p>

      {sousLigne === undefined ? null : (
        <p className="truncate font-ui text-label font-medium text-ink-500">{sousLigne}</p>
      )}

      {/* ⚠️ L'ÉTINCELLE NE S'AFFICHE PAS À N'IMPORTE QUEL PRIX.
          Première version : elle débordait dans les marges de la tuile pour
          se lire comme sa matière. Mesuré sur les données réelles du cabinet
          — une série journalière où un seul jour porte un encaissement et où
          les autres valent zéro — elle rendait un TRIANGLE plein de la
          hauteur de la tuile, qui remontait sous le montant. Une forme qui
          ressemble à un défaut de rendu est pire que pas de forme.

          Deux garde-fous en découlent. `SEUIL_POINTS` : sous quatre points,
          une courbe ne décrit pas une tendance, elle relie des accidents.
          `au moins deux valeurs non nulles` : une série d'un seul pic n'est
          pas une tendance non plus. Et la place reste VIDE quand la série ne
          les passe pas — on ne remplace jamais une tendance absente par une
          courbe fabriquée (règle 8). */}
      {afficherEtincelle(serie) ? (
        <div className="mt-auto pt-1">
          <Etincelle valeurs={serie ?? []} famille={m.famille} />
        </div>
      ) : null}

      {pied === undefined ? null : <div className="mt-auto">{pied}</div>}
    </div>
  );
}

/**
 * LA TUILE VEDETTE — le chiffre que l'œil cherche en premier.
 *
 * Une seule par écran, et c'est tout l'intérêt : hiérarchiser tout revient à
 * ne rien hiérarchiser. Fond profond, encre blanche PURE — il n'existe
 * délibérément pas de blanc atténué dans ce système, aucun alpha inférieur à 1
 * ne passant 4.5:1 sur la partie claire d'un dégradé de marque. La hiérarchie
 * interne se fait à la taille et à la graisse, jamais en baissant le contraste.
 */
export function TuileVedette({
  etiquette,
  aide,
  valeur,
  sousLigne,
  icone,
  materiau = "nuit",
}: {
  readonly etiquette: string;
  readonly aide?: string;
  readonly valeur: string;
  readonly sousLigne?: string;
  readonly icone?: NomIcone;
  readonly materiau?: "nuit" | "marque" | "aube";
}): React.JSX.Element {
  const fonds = {
    nuit: "bg-vedette-nuit",
    marque: "bg-vedette-marque",
    aube: "bg-vedette-aube",
  } as const;

  return (
    <div
      className={[
        "relative flex min-w-0 flex-col gap-3 overflow-hidden rounded-2xl p-5 shadow-vedette",
        fonds[materiau],
      ].join(" ")}
    >
      {/* Le reflet — une source de lumière, donc une épaisseur. Décor pur,
          posé dans sa propre couche : il ne touche à aucune encre. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-reflet" />

      <div className="relative flex items-start justify-between gap-3">
        <p
          className="min-w-0 font-ui text-label font-semibold text-on-brand"
          {...(aide === undefined ? {} : { title: aide })}
        >
          {etiquette}
        </p>
        {icone === undefined ? null : (
          <span
            aria-hidden="true"
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-on-brand-surface text-on-brand shadow-filet"
          >
            <Icone nom={icone} taille={20} />
          </span>
        )}
      </div>

      <p
        className="relative truncate font-ui text-chiffre font-extrabold tabular-nums tracking-chiffre text-on-brand"
        title={valeur}
      >
        {valeur}
      </p>

      {sousLigne === undefined ? null : (
        <p className="relative truncate font-ui text-label font-medium text-on-brand">
          {sousLigne}
        </p>
      )}
    </div>
  );
}
