"use client";

/**
 * LES GRAPHIQUES — V8 « Aurora ». SVG écrit à la main, zéro dépendance.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI PAS UNE LIBRAIRIE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Trois raisons, dans cet ordre.
 *
 * 1. LE BUDGET. Le dépôt tient cinq dépendances d'exécution et
 *    `06-PERF-BUDGET.md` se mesure au build. Recharts en ajoute une qui traîne
 *    d3-scale, d3-shape et d3-array derrière elle — pour six formes que
 *    l'application dessine réellement.
 *
 * 2. LES JETONS. Une librairie de graphiques apporte SA palette, SES rayons,
 *    SES ombres et SA typographie. On les recouvre ensuite un à un, et il en
 *    reste toujours un — l'infobulle, le curseur, la graduation — qui trahit
 *    qu'un morceau de l'écran vient d'ailleurs. C'est exactement ce qui fait
 *    qu'un tableau de bord se lit comme un assemblage. Ici chaque trait est
 *    une variable de `tokens.css`.
 *
 * 3. L'ACCESSIBILITÉ. Le contrat de `PanneauEvolution` — tableau équivalent
 *    masqué visuellement, aire de tracé `aria-hidden`, aucune valeur peinte
 *    sur un dégradé — est reconduit ici pour TOUTES les formes. Une librairie
 *    l'aurait rendu à réimplémenter par-dessus son propre arbre.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LES DEUX GÉOMÉTRIES, ET POURQUOI ELLES DIFFÈRENT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ `preserveAspectRatio="none"` ÉTIRE TOUT — texte compris. C'est le défaut
 * qui donnait au graphique de V6 son aspect bricolé : les noms de mois
 * sortaient dilatés horizontalement, dans une graisse qui n'existe dans aucune
 * fonte du dépôt.
 *
 * D'où deux familles :
 *
 *   · LES FORMES ÉTIRABLES (aire, barres, étincelle, frise) remplissent leur
 *     conteneur en `preserveAspectRatio="none"`. Elles ne contiennent AUCUN
 *     texte et AUCUN cercle ; leurs traits portent `vectorEffect=
 *     "non-scaling-stroke"`, qui rend l'épaisseur immunisée à l'étirement. Les
 *     libellés et les points sont des éléments HTML posés PAR-DESSUS, en
 *     pourcentage — du vrai texte, net, sélectionnable, qui hérite des jetons.
 *
 *   · LES FORMES CIRCULAIRES (anneau, jauge) gardent un carré et
 *     `xMidYMid meet`. Un cercle étiré est un ovale, et un ovale se lit comme
 *     un défaut de rendu.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * L'ÉCHELLE SIGNÉE — reprise de `PanneauEvolution`, et c'est la partie
 * réellement réutilisable de l'existant
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⚠️ LE ZÉRO EST À SA PLACE, LES NÉGATIFS SONT HONORÉS. Une version antérieure
 * écrasait les valeurs négatives à zéro : la ligne se couchait sur l'axe et un
 * mois déficitaire se lisait comme un mois à l'équilibre. Sur un graphique
 * d'argent, c'est un mensonge.
 *
 * ⚠️ LA MARGE S'AJOUTE AU PLAFOND, PAS À L'ÉTENDUE. `etendue * 1.12`
 * n'allongerait que le bas : le sommet resterait à 0 % et la barre maximale
 * toucherait le bord supérieur, où elle se lit comme un débordement plutôt que
 * comme un maximum.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4.2 — CE QUI NE CHANGE PAS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Les dégradés de ces graphiques remplissent des AIRES et des ARCS. Aucune
 * valeur n'est jamais peinte dessus : les chiffres vivent dans les libellés
 * HTML posés sur une surface opaque, dans les infobulles et dans le tableau
 * équivalent. La règle est de lisibilité, pas de style — un fond qui varie
 * fait varier le contraste du texte qu'il porte.
 */

import * as React from "react";

import { fr } from "@/i18n/fr";

import { DonutChart, type DonutChartSegment } from "./donut-chart";

/* ═══════════════════════════════════════════════════════════════════════════
 * LA PALETTE DE SÉRIE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les six familles, dans l'ordre où un graphique les consomme quand il n'a pas
 * de raison d'en choisir une en particulier.
 *
 * ⚠️ L'ORDRE N'EST PAS ARBITRAIRE : deux familles voisines dans cette liste
 * sont écartées en TEINTE (vert → bleu → violet → ambre → corail → aqua). Un
 * ordre qui placerait émeraude et aqua côte à côte rendrait les deux premières
 * parts d'un anneau indistinguables pour un œil deutéranope — et la légende ne
 * répare pas ça, elle demande un aller-retour du regard à chaque lecture.
 */
export type Famille = "emeraude" | "azure" | "violet" | "ambre" | "corail" | "aqua";

export const FAMILLES: readonly Famille[] = [
  "emeraude",
  "azure",
  "violet",
  "ambre",
  "corail",
  "aqua",
];

/**
 * Le TRAIT de chaque famille — un ton 600, seul niveau qui tienne à la fois
 * sur une carte blanche et sur le remplissage clair de sa propre aire.
 */
const TRAIT: Record<Famille, string> = {
  emeraude: "var(--emeraude-600)",
  azure: "var(--azure-600)",
  violet: "var(--violet-600)",
  ambre: "var(--ambre-600)",
  corail: "var(--corail-600)",
  aqua: "var(--aqua-600)",
};

/** Le REMPLISSAGE — ton 400, porté à une opacité décroissante vers le bas. */
const REMPLISSAGE: Record<Famille, string> = {
  emeraude: "var(--emeraude-400)",
  azure: "var(--azure-400)",
  violet: "var(--violet-400)",
  ambre: "var(--ambre-400)",
  corail: "var(--corail-400)",
  aqua: "var(--aqua-400)",
};

/**
 * Les classes de PASTILLE de légende. Écrites en toutes lettres et non
 * composées (`bg-${famille}-600`) : Tailwind balaye le SOURCE, il ne résout
 * aucune interpolation. Une classe composée à l'exécution n'est jamais émise —
 * la pastille serait alors transparente, en silence.
 */
const PASTILLE: Record<Famille, string> = {
  emeraude: "bg-emeraude-600",
  azure: "bg-azure-600",
  violet: "bg-violet-600",
  ambre: "bg-ambre-600",
  corail: "bg-corail-600",
  aqua: "bg-aqua-600",
};

export function couleurTrait(famille: Famille): string {
  return TRAIT[famille];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * OUTILS D'ÉCHELLE
 * ═══════════════════════════════════════════════════════════════════════════ */

interface Echelle {
  /** Ordonnée d'une valeur, en % depuis le HAUT de l'aire de tracé. */
  readonly y: (valeur: number) => number;
  /** L'ordonnée du zéro, en % depuis le haut. */
  readonly zero: number;
  readonly haut: number;
  readonly bas: number;
}

function echelleSignee(valeurs: readonly number[]): Echelle {
  let haut = 0;
  let bas = 0;
  for (const v of valeurs) {
    if (v > haut) haut = v;
    if (v < bas) bas = v;
  }
  const amplitude = haut - bas || 1;
  const plafond = haut + amplitude * 0.12;
  const etendue = plafond - bas;
  const y = (valeur: number): number => ((plafond - valeur) * 100) / etendue;
  return { y, zero: y(0), haut, bas };
}

/**
 * Le texte réservé au lecteur d'écran. Même classe que `finance/a11y.ts` — la
 * déclaration vit dans `tokens.css`, pas dans un utilitaire Tailwind dont on
 * n'a pas vérifié la survie au remplacement des échelles.
 */
const CACHE = "cache-visuellement";

/* ═══════════════════════════════════════════════════════════════════════════
 * AIRE — une série continue dans le temps
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface PointSerie {
  /** Clé de rendu ET libellé d'infobulle. Jamais un nom de patient. */
  readonly cle: string;
  readonly label: string;
  readonly valeur: number;
  /** Le texte affiché dans l'infobulle et le tableau équivalent. */
  readonly valeurLisible: string;
}

/**
 * L'aire. Courbe en segments DROITS — une spline inventerait, entre deux
 * points, des valeurs qu'aucune donnée ne soutient.
 *
 * `graduations` marque les libellés à afficher sous l'aire : sur 30 jours, en
 * écrire trente donnerait une bouillie. Le composant n'en choisit AUCUN
 * lui-même — c'est l'écran qui sait combien de place il a.
 */
export function Aire({
  points,
  famille = "emeraude",
  titreTableau,
  colonneLabel,
  colonneValeur,
  hauteurClasse = "h-40",
  graduations = 6,
}: {
  readonly points: readonly PointSerie[];
  readonly famille?: Famille;
  readonly titreTableau: string;
  readonly colonneLabel: string;
  readonly colonneValeur: string;
  readonly hauteurClasse?: string;
  readonly graduations?: number;
}): React.JSX.Element {
  if (points.length === 0) {
    return <p className="font-ui text-body text-ink-500">{fr.graphes.aucunPoint}</p>;
  }

  const ech = echelleSignee(points.map((p) => p.valeur));
  const pas = 100 / Math.max(1, points.length - 1);
  const x = (i: number): number => (points.length === 1 ? 50 : i * pas);

  const ligne = points.map((p, i) => `${x(i)},${ech.y(p.valeur)}`).join(" ");
  const aire = `${x(0)},${ech.zero} ${ligne} ${x(points.length - 1)},${ech.zero}`;

  // Un identifiant STABLE par famille : deux aires de la même famille peuvent
  // partager leur dégradé, et un identifiant tiré au hasard casserait
  // l'hydratation (serveur et client rendraient deux `id` différents).
  const idDegrade = `aire-${famille}`;

  const modulo = Math.max(1, Math.ceil(points.length / graduations));

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className={["relative w-full", hauteurClasse].join(" ")} aria-hidden="true">
        {/* La grille : trois filets horizontaux, très discrets. Sans repère,
            une courbe n'a aucun ordre de grandeur ; avec dix, c'est du papier
            millimétré et la courbe disparaît dedans. */}
        {[25, 50, 75].map((t) => (
          <div
            key={t}
            className="absolute inset-x-0 border-t border-rule opacity-disabled"
            style={{ top: `${t}%` }}
          />
        ))}
        <div className="absolute inset-x-0 border-t border-rule" style={{ top: `${ech.zero}%` }} />

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          focusable="false"
        >
          <defs>
            <linearGradient id={idDegrade} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={REMPLISSAGE[famille]} stopOpacity="0.55" />
              <stop offset="60%" stopColor={REMPLISSAGE[famille]} stopOpacity="0.18" />
              <stop offset="100%" stopColor={REMPLISSAGE[famille]} stopOpacity="0" />
            </linearGradient>
          </defs>
          <polygon fill={`url(#${idDegrade})`} points={aire} />
          <polyline
            fill="none"
            stroke={TRAIT[famille]}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            points={ligne}
          />
        </svg>

        {/* Les repères : des blocs HTML, PAS des `<circle>`, qui seraient
            transformés en ovales par l'étirement du SVG ci-dessus. Seul le
            DERNIER point en porte un — trente pastilles seraient du bruit, et
            c'est la valeur d'aujourd'hui qu'on cherche. */}
        {points.length > 0 ? (
          <span
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card shadow-douce"
            style={{
              left: `${x(points.length - 1)}%`,
              top: `${ech.y(points[points.length - 1]?.valeur ?? 0)}%`,
              backgroundColor: TRAIT[famille],
            }}
          />
        ) : null}

        {/* La bande de survol : une colonne invisible par point, qui porte
            l'infobulle native. Pas de panneau flottant fait main — il faudrait
            le positionner, le contenir dans la fenêtre et le fermer, pour
            rendre exactement ce que `title` rend déjà. */}
        <div className="absolute inset-0 flex">
          {points.map((p) => (
            <div
              key={p.cle}
              title={`${p.label} · ${p.valeurLisible}`}
              className="min-w-0 flex-1 transition duration-quick ease-out hover:bg-sunken hover:opacity-disabled"
            />
          ))}
        </div>
      </div>

      <div className="flex w-full items-baseline" aria-hidden="true">
        {points.map((p, i) => (
          <div key={`g-${p.cle}`} className="min-w-0 flex-1 text-center">
            {i % modulo === 0 || i === points.length - 1 ? (
              <span className="block truncate font-num text-eyebrow tabular-nums text-ink-500">
                {p.label}
              </span>
            ) : null}
          </div>
        ))}
      </div>

      <TableauEquivalent
        titre={titreTableau}
        colonnes={[colonneLabel, colonneValeur]}
        lignes={points.map((p) => [p.label, p.valeurLisible])}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ÉTINCELLE — la sparkline d'une tuile
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Une courbe minuscule, sans axe, sans libellé, sans repère.
 *
 * Elle ne répond qu'à une question : « ça monte ou ça descend ? ». Lui ajouter
 * une graduation la ferait prétendre répondre à « de combien ? », ce dont sa
 * taille la rend incapable — et une échelle illisible est pire qu'une échelle
 * absente. Le chiffre exact est au-dessus, en toutes lettres.
 *
 * `aria-hidden` sans tableau équivalent, DÉLIBÉRÉMENT : la valeur qu'elle
 * accompagne est déjà annoncée par la tuile. Un tableau de trente points pour
 * décorer un compteur noierait le lecteur d'écran sous des chiffres que
 * personne ne lui a demandés.
 */
export function Etincelle({
  valeurs,
  famille = "emeraude",
}: {
  readonly valeurs: readonly number[];
  readonly famille?: Famille;
}): React.JSX.Element | null {
  if (valeurs.length < 2) return null;

  const ech = echelleSignee(valeurs);
  const pas = 100 / (valeurs.length - 1);
  const ligne = valeurs.map((v, i) => `${i * pas},${ech.y(v)}`).join(" ");
  const aire = `0,100 ${ligne} 100,100`;
  const id = `etincelle-${famille}`;

  return (
    <svg
      className="h-10 w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      focusable="false"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={REMPLISSAGE[famille]} stopOpacity="0.5" />
          <stop offset="100%" stopColor={REMPLISSAGE[famille]} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon fill={`url(#${id})`} points={aire} />
      <polyline
        fill="none"
        stroke={TRAIT[famille]}
        strokeWidth="1.75"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        points={ligne}
      />
    </svg>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * BARRES GROUPÉES — deux séries et une ligne
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface GroupeBarres {
  readonly cle: string;
  readonly label: string;
  readonly a: number;
  readonly b: number;
  /** La ligne superposée — le résultat, la synthèse des deux barres. */
  readonly ligne: number;
  readonly aLisible: string;
  readonly bLisible: string;
  readonly ligneLisible: string;
}

/**
 * Deux barres accolées par groupe, plus une ligne nette par-dessus.
 *
 * ⚠️ UN SEUL AXE POUR LES DEUX SÉRIES. Deux axes distincts feraient paraître
 * 8 000 DZD de charges plus haut que 40 000 DZD de recette — l'erreur de
 * lecture la plus coûteuse qu'un graphique d'argent puisse produire.
 */
export function BarresGroupees({
  groupes,
  familleA = "emeraude",
  familleB = "ambre",
  libelleA,
  libelleB,
  libelleLigne,
  titreTableau,
  colonneLabel,
  hauteurClasse = "h-44",
}: {
  readonly groupes: readonly GroupeBarres[];
  readonly familleA?: Famille;
  readonly familleB?: Famille;
  readonly libelleA: string;
  readonly libelleB: string;
  readonly libelleLigne: string;
  readonly titreTableau: string;
  readonly colonneLabel: string;
  readonly hauteurClasse?: string;
}): React.JSX.Element {
  if (groupes.length === 0) {
    return <p className="font-ui text-body text-ink-500">{fr.graphes.aucunPoint}</p>;
  }

  const ech = echelleSignee(
    groupes.flatMap((g) => [g.a, g.b, g.ligne]),
  );

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Legende
        entrees={[
          { famille: familleA, libelle: libelleA },
          { famille: familleB, libelle: libelleB },
          { famille: null, libelle: libelleLigne },
        ]}
      />

      <div className={["relative w-full", hauteurClasse].join(" ")} aria-hidden="true">
        {[25, 50, 75].map((t) => (
          <div
            key={t}
            className="absolute inset-x-0 border-t border-rule opacity-disabled"
            style={{ top: `${t}%` }}
          />
        ))}
        <div className="absolute inset-x-0 border-t border-rule" style={{ top: `${ech.zero}%` }} />

        {/* Les barres — en pourcentage de hauteur, donc rien n'est déformé.
            Le rayon est posé en haut seulement : une barre arrondie en bas
            flotterait au lieu de reposer sur son axe. */}
        <div className="absolute inset-0 flex items-stretch gap-2">
          {groupes.map((g) => (
            <div key={g.cle} className="relative flex min-w-0 flex-1 justify-center gap-1">
              <Barre
                famille={familleA}
                hautPct={Math.max(0, ech.zero - ech.y(g.a))}
                basPct={100 - ech.zero}
                titre={`${g.label} · ${libelleA} ${g.aLisible}`}
              />
              <Barre
                famille={familleB}
                hautPct={Math.max(0, ech.zero - ech.y(g.b))}
                basPct={100 - ech.zero}
                titre={`${g.label} · ${libelleB} ${g.bLisible}`}
              />
            </div>
          ))}
        </div>

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          focusable="false"
        >
          <polyline
            fill="none"
            stroke="var(--ink-700)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeDasharray="4 3"
            vectorEffect="non-scaling-stroke"
            points={groupes
              .map((g, i) => {
                const largeur = 100 / groupes.length;
                return `${i * largeur + largeur / 2},${ech.y(g.ligne)}`;
              })
              .join(" ")}
          />
        </svg>

        <div className="absolute inset-0 flex items-stretch gap-2">
          {groupes.map((g) => (
            <div key={`p-${g.cle}`} className="relative min-w-0 flex-1">
              <span
                className="absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-card bg-ink-700"
                style={{ top: `${ech.y(g.ligne)}%` }}
                title={`${g.label} · ${libelleLigne} ${g.ligneLisible}`}
              />
            </div>
          ))}
        </div>
      </div>

      <div className="flex items-baseline gap-2" aria-hidden="true">
        {groupes.map((g, i) => (
          <span
            key={`l-${g.cle}`}
            className={[
              "min-w-0 flex-1 truncate text-center font-ui text-eyebrow",
              // Le dernier groupe porte l'encre pleine : c'est celui qu'on lit.
              i === groupes.length - 1 ? "font-semibold text-ink-900" : "text-ink-500",
            ].join(" ")}
          >
            {g.label}
          </span>
        ))}
      </div>

      <TableauEquivalent
        titre={titreTableau}
        colonnes={[colonneLabel, libelleA, libelleB, libelleLigne]}
        lignes={groupes.map((g) => [g.label, g.aLisible, g.bLisible, g.ligneLisible])}
      />
    </div>
  );
}

function Barre({
  famille,
  hautPct,
  basPct,
  titre,
}: {
  readonly famille: Famille;
  readonly hautPct: number;
  readonly basPct: number;
  readonly titre: string;
}): React.JSX.Element {
  return (
    <span
      title={titre}
      className="relative min-w-0 flex-1"
      style={{ maxWidth: "var(--barre-largeur)" }}
    >
      <span
        className="absolute inset-x-0 rounded-t-md transition duration-quick ease-out"
        style={{
          bottom: `${basPct}%`,
          height: `${hautPct}%`,
          backgroundImage: `linear-gradient(180deg, ${TRAIT[famille]} 0%, ${REMPLISSAGE[famille]} 100%)`,
        }}
      />
    </span>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * ANNEAU — une composition en parts
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface PartAnneau {
  readonly cle: string;
  readonly label: string;
  /** La part en POURCENTAGE, calculée en SQL. Ce composant ne divise jamais. */
  readonly pct: number;
  readonly valeurLisible: string;
}

/**
 * Un donut, son total au centre, sa légende à côté.
 *
 * ⚠️ AUCUNE ARITHMÉTIQUE MÉTIER ICI. `pct` arrive calculé de Postgres. Le seul
 * calcul du composant est la conversion d'un pourcentage en LONGUEUR D'ARC —
 * de la géométrie, pas de la comptabilité. Une somme recalculée côté client
 * finirait un jour par diverger de celle du serveur, et c'est le genre d'écart
 * qu'on ne découvre que devant un comptable.
 *
 * `stroke-dasharray` sur un cercle plutôt que des `<path>` en arcs : un seul
 * élément par part, aucune trigonométrie, et les extrémités restent nettes.
 */
export function Anneau({
  parts,
  centreValeur,
  centreLibelle,
  titreTableau,
  colonneLabel,
  colonneValeur,
}: {
  readonly parts: readonly PartAnneau[];
  readonly centreValeur: string;
  readonly centreLibelle: string;
  readonly titreTableau: string;
  readonly colonneLabel: string;
  readonly colonneValeur: string;
}): React.JSX.Element {
  // ── Adapteur MindCare → DonutChart générique ──────────────────────────
  // `Anneau` conserve son contrat métier (PartAnneau, centre, tableau
  // équivalent) et délègue la géométrie au seul composant d'anneau du dépôt.
  // Aucune arithmétique métier ici : `pct` arrive de Postgres, la seule
  // conversion est pct → longueur d'arc, faite dans DonutChart.
  const [survole, setSurvole] = React.useState<PartAnneau | null>(null);

  const segments: readonly DonutChartSegment[] = parts.map((p, i) => {
    const famille = FAMILLES[i % FAMILLES.length] ?? "emeraude";
    // `DonutChartSegment` porte une signature d'index : `cle` y est admise
    // sans assertion. En poser une masquait ce fait et interdisait au
    // compilateur de vérifier les autres champs.
    const segment: DonutChartSegment = {
      value: p.pct,
      color: TRAIT[famille],
      label: p.label,
      // champs supplémentaires pour retrouver la part d'origine au survol
      cle: p.cle,
      pct: p.pct,
      valeurLisible: p.valeurLisible,
    };
    return segment;
  });

  const handleHover = React.useCallback(
    (seg: DonutChartSegment | null) => {
      if (seg === null) {
        setSurvole(null);
        return;
      }
      // La signature d'index rend `seg.cle` de type `unknown` : on le VÉRIFIE
      // au lieu de le forcer par une double assertion.
      const brut = seg.cle;
      const cle = typeof brut === "string" ? brut : undefined;
      const trouve =
        (cle !== undefined ? parts.find((p) => p.cle === cle) : undefined) ??
        parts.find((p) => p.label === seg.label) ??
        null;
      setSurvole(trouve);
    },
    [parts],
  );

  // ⚠️ LA SORTIE VIDE VIENT APRÈS LES HOOKS, ET C'EST UN CORRECTIF, PAS UN
  // DÉPLACEMENT COSMÉTIQUE. Elle était placée AVANT `useState` : un anneau
  // qui passait de « avec données » à « sans données » changeait le nombre de
  // hooks appelés entre deux rendus, ce que React ne tolère pas — l'écran
  // tombait. Un composant appelle TOUJOURS ses hooks, puis décide de ce qu'il
  // affiche.
  if (parts.length === 0) {
    return <p className="font-ui text-body text-ink-500">{fr.graphes.aucunPoint}</p>;
  }

  const centre = survole === null
    ? (
        <>
          <span className="w-full truncate font-ui text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">
            {centreValeur}
          </span>
          <span className="w-full truncate font-ui text-label font-medium text-ink-500">
            {centreLibelle}
          </span>
        </>
      )
    : (
        <>
          <span
            className="w-full truncate font-ui text-label font-semibold text-ink-700"
            title={survole.label}
          >
            {survole.label}
          </span>
          <span className="w-full truncate font-ui text-chiffre font-bold tabular-nums tracking-chiffre text-ink-900">
            {survole.valeurLisible}
          </span>
          <span className="font-num text-label tabular-nums text-ink-500">
            {Number.isInteger(survole.pct) ? survole.pct.toFixed(0) : survole.pct.toFixed(1)} %
          </span>
        </>
      );

  return (
    <div className="flex min-w-0 flex-col items-center gap-5 tablet:flex-row">
      <div className="shrink-0 rounded-full shadow-douce" aria-hidden="true">
        <DonutChart
          data={segments}
          size={160}
          strokeWidth={14}
          animationDuration={0.75}
          animationDelayPerSegment={0.05}
          highlightOnHover
          centerContent={centre}
          onSegmentHover={handleHover}
          ariaLabel={`${titreTableau} : ${centreValeur} ${centreLibelle}`}
        />
      </div>

      {/* Légende : reste la source de vérité lisible sans survol. Le survol
          clavier/souris d'une ligne reflète celui de l'anneau, dans les deux sens. */}
      <ul className="flex min-w-0 flex-1 list-none flex-col gap-1.5 p-0">
        {parts.map((p, i) => {
          const famille = FAMILLES[i % FAMILLES.length] ?? "emeraude";
          const actif = survole?.cle === p.cle;
          return (
            <li
              key={p.cle}
              /*
                ⚠️ `flex-wrap`, ET C'EST UN DÉFAUT MESURÉ À L'ÉCRAN.

                Le libellé était `truncate` et le montant `shrink-0` : dans une
                carte étroite — l'anneau « Anatomie » vit dans une grille de
                trois — le montant prenait toute la place et le libellé tombait
                à UNE LETTRE. La légende affichait « P 4 000 DZD » et
                « T 4 000 DZD » : deux catégories devenues indiscernables, sur
                le panneau censé dire d'où vient l'argent.

                Le montant passe donc À LA LIGNE quand il ne tient pas, au lieu
                d'affamer le libellé. Une ligne de plus coûte moins qu'une
                catégorie qu'on ne peut plus nommer.
              */
              className={[
                "flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5 rounded-md px-2 py-1.5 transition duration-quick ease-out",
                actif ? "bg-sunken" : "",
                "focus-within:bg-sunken focus-within:outline-none",
              ].join(" ")}
              onMouseEnter={() => setSurvole(p)}
              onMouseLeave={() => setSurvole(null)}
              onFocus={() => setSurvole(p)}
              onBlur={() => setSurvole(null)}
              tabIndex={0}
              aria-label={`${p.label} : ${p.valeurLisible} · ${Number.isInteger(p.pct) ? p.pct.toFixed(0) : p.pct.toFixed(1)} %`}
            >
              <span
                aria-hidden="true"
                className={["mt-1 h-2.5 w-2.5 shrink-0 rounded-full", PASTILLE[famille]].join(" ")}
              />
              {/* `basis` plutôt que `flex-1` : le libellé réclame une largeur
                  minimale lisible et laisse le montant passer dessous s'il ne
                  reste pas la place. `break-words` évite qu'un mot composé long
                  (« Thérapie familiale ») reparte en débordement silencieux. */}
              <span className="min-w-0 flex-1 basis-32 break-words font-ui text-body text-ink-700">
                {p.label}
              </span>
              <span className="shrink-0 font-num text-num font-semibold tabular-nums text-ink-900">
                {p.valeurLisible}
              </span>
            </li>
          );
        })}
      </ul>

      <TableauEquivalent
        titre={titreTableau}
        colonnes={[colonneLabel, colonneValeur]}
        lignes={parts.map((p) => [p.label, p.valeurLisible])}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * JAUGE — une progression, une part d'un tout
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un arc de 270°, ouvert en bas. L'ouverture n'est pas un ornement : elle
 * distingue immédiatement une jauge (bornée, orientée) d'un anneau
 * (composition, sans début ni fin).
 */
export function Jauge({
  pct,
  valeur,
  libelle,
  famille = "emeraude",
}: {
  readonly pct: number;
  readonly valeur: string;
  readonly libelle: string;
  readonly famille?: Famille;
}): React.JSX.Element {
  const borne = Math.max(0, Math.min(100, pct));
  const RAYON = 15.9155;
  // 75 % de la circonférence = les 270° de l'arc. Le quart restant est
  // l'ouverture du bas, jamais dessiné.
  const PISTE = 75;
  const rempli = (borne * PISTE) / 100;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative h-32 w-32" aria-hidden="true">
        <svg viewBox="0 0 42 42" className="h-full w-full"
          style={{ transform: "rotate(135deg)" }} focusable="false">
          <circle
            cx="21"
            cy="21"
            r={RAYON}
            fill="none"
            stroke="var(--sunken)"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${PISTE} ${100 - PISTE}`}
          />
          <circle
            cx="21"
            cy="21"
            r={RAYON}
            fill="none"
            stroke={TRAIT[famille]}
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={`${rempli} ${100 - rempli}`}
          />
        </svg>
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="font-ui text-heading font-bold tabular-nums text-ink-900">
            {valeur}
          </span>
        </div>
      </div>
      <p className="text-center font-ui text-label text-ink-500">{libelle}</p>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * FRISE HORAIRE — la charge d'une journée
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface CreneauFrise {
  readonly cle: string;
  /** L'heure, en toutes lettres — « 08:00 ». Jamais recalculée ici. */
  readonly heure: string;
  readonly n: number;
  readonly titre: string;
}

/**
 * Une colonne par heure ouvrée. Ce n'est pas un histogramme : les valeurs sont
 * de petits entiers (0 à 4 séances), et une échelle continue sur cinq valeurs
 * produirait des différences de hauteur illisibles. La hauteur est donc une
 * PROPORTION DU MAXIMUM OBSERVÉ, et le maximum s'affiche à côté.
 */
export function FriseHeures({
  creneaux,
  famille = "aqua",
  titreTableau,
  colonneLabel,
  colonneValeur,
}: {
  readonly creneaux: readonly CreneauFrise[];
  readonly famille?: Famille;
  readonly titreTableau: string;
  readonly colonneLabel: string;
  readonly colonneValeur: string;
}): React.JSX.Element {
  if (creneaux.length === 0) {
    return <p className="font-ui text-body text-ink-500">{fr.graphes.aucunPoint}</p>;
  }
  const max = creneaux.reduce((m, c) => (c.n > m ? c.n : m), 0);

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex h-32 items-end gap-1.5" aria-hidden="true">
        {creneaux.map((c) => (
          <div key={c.cle} className="flex min-w-0 flex-1 flex-col justify-end gap-1">
            <span
              title={c.titre}
              className={[
                "w-full rounded-t-md transition duration-normal ease-out",
                c.n === 0 ? "bg-sunken" : "",
              ].join(" ")}
              style={
                c.n === 0
                  ? { height: "var(--s-1)" }
                  : {
                      height: `${Math.max(12, (c.n * 100) / Math.max(1, max))}%`,
                      backgroundImage: `linear-gradient(180deg, ${TRAIT[famille]} 0%, ${REMPLISSAGE[famille]} 100%)`,
                    }
              }
            />
          </div>
        ))}
      </div>
      <div className="flex gap-1.5" aria-hidden="true">
        {creneaux.map((c, i) => (
          <span
            key={`h-${c.cle}`}
            className="min-w-0 flex-1 truncate text-center font-num text-eyebrow tabular-nums text-ink-500"
          >
            {i % 2 === 0 ? c.heure : ""}
          </span>
        ))}
      </div>
      <TableauEquivalent
        titre={titreTableau}
        colonnes={[colonneLabel, colonneValeur]}
        lignes={creneaux.map((c) => [c.heure, String(c.n)])}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * PIÈCES PARTAGÉES
 * ═══════════════════════════════════════════════════════════════════════════ */

export function Legende({
  entrees,
}: {
  readonly entrees: readonly { readonly famille: Famille | null; readonly libelle: string }[];
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 font-ui text-label font-medium text-ink-500">
      {entrees.map((e) => (
        <span key={e.libelle} className="flex items-center gap-2">
          {e.famille === null ? (
            // La série tracée en LIGNE porte un trait, pas un disque : la forme
            // de la pastille rappelle la forme du tracé, ce qui évite d'aller
            // chercher lequel des trois est la ligne.
            <span className="h-0.5 w-4 rounded-full bg-ink-700" aria-hidden="true" />
          ) : (
            <span
              className={["h-2.5 w-2.5 rounded-full", PASTILLE[e.famille]].join(" ")}
              aria-hidden="true"
            />
          )}
          {e.libelle}
        </span>
      ))}
    </div>
  );
}

/**
 * Le tableau équivalent. Un lecteur d'écran lit des CHIFFRES, pas une
 * description de rectangles.
 *
 * ⚠️ LE MASQUAGE EST SUR LE `<div>` ENVELOPPE, JAMAIS SUR LE `<table>`.
 * MESURÉ : sur un élément `display: table`, `height` est traité par CSS comme
 * un MINIMUM. Le tableau équivalent du calendrier (31 lignes) mesurait ainsi
 * 856 px de haut et rallongeait la page de 761 px — un défilement dont la
 * cause était invisible, puisque le tableau ne se voit pas.
 */
function TableauEquivalent({
  titre,
  colonnes,
  lignes,
}: {
  readonly titre: string;
  readonly colonnes: readonly string[];
  readonly lignes: readonly (readonly string[])[];
}): React.JSX.Element {
  return (
    <div className={CACHE}>
      <table>
        <caption>{titre}</caption>
        <thead>
          <tr>
            {colonnes.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lignes.map((l, i) => (
            // Index, pas `l[0]` : le libellé affiché (quantième seul, mois seul…)
            // se répète volontairement d'une période à l'autre — ce n'est PAS un
            // identifiant. `lignes` vient d'un tableau stable en ordre à chaque
            // rendu, donc l'index y est un identifiant de ligne correct.
            <tr key={i}>
              <th scope="row">{l[0]}</th>
              {l.slice(1).map((cellule, j) => (
                <td key={j}>{cellule}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
