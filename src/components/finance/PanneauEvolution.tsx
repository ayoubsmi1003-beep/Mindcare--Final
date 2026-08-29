"use client";

/**
 * Rangée 2, gauche — ÉVOLUTION. SIX BARRES MENSUELLES.
 *
 * ═══ POURQUOI MENSUEL, ET PAS JOURNALIER ═══════════════════════════════════
 *
 * Le graphe de V6 traçait UN SEUIL PAR JOUR de la période. Sur un mois, à ~5
 * séances par jour dont 2 encaissées, il affichait deux barres et vingt-neuf
 * emplacements vides. Ce n'était pas une période creuse : c'était le mauvais
 * GRAIN. Un graphique majoritairement vide se lit comme une panne d'affichage,
 * et on cesse de le regarder. Six mois, c'est la plus petite fenêtre où une
 * tendance de cabinet devient visible.
 *
 * ═══ POURQUOI CE N'EST PLUS UN SVG ÉTIRÉ ═══════════════════════════════════
 *
 * ⚠️ LE DÉFAUT VISUEL VENAIT DE `preserveAspectRatio="none"`. Il permet à un
 * `viewBox` de 100 unités de remplir n'importe quelle largeur — mais il étire
 * TOUT, y compris le TEXTE et les cercles. Les noms de mois sortaient dilatés
 * horizontalement, dans une graisse qui n'existe dans aucune fonte du dépôt :
 * c'est ce qui donnait au graphique son aspect bricolé.
 *
 * La géométrie est donc en HTML/CSS — des blocs positionnés en POURCENTAGE,
 * qui se redimensionnent sans rien déformer — et le SVG ne porte plus QUE la
 * ligne du résultat net, où l'étirement est sans conséquence (un segment reste
 * un segment). Le texte est du vrai texte : il reste net, il hérite des jetons
 * de typographie, et il se sélectionne.
 *
 * ═══ L'ÉCHELLE, ET SON ZÉRO ════════════════════════════════════════════════
 *
 * Recette et charges partagent UN SEUL axe : deux axes distincts feraient
 * paraître 8 000 DZD de charges plus haut que 40 000 DZD de recette.
 *
 * ⚠️ LE RÉSULTAT NET PEUT ÊTRE NÉGATIF, et il l'est dès que les charges du mois
 * dépassent la recette — le cas ORDINAIRE d'un mois creux. Une version
 * antérieure écrasait les négatifs à zéro : la ligne se couchait sur l'axe et un
 * mois déficitaire se lisait comme un mois à l'équilibre. Sur un graphique
 * d'argent, c'est un mensonge. L'échelle couvre donc [bas, haut] avec le zéro à
 * SA place, et les barres partent de la ligne de zéro.
 *
 * Ces calculs sont des POURCENTAGES DE HAUTEUR, jamais des montants : aucun
 * d'eux ne s'affiche. Les montants, eux, arrivent calculés de Postgres.
 */

import { fr } from "@/i18n/fr";
import { formaterDzd, type SeauMois } from "@/services/finance-cash";

import { CACHE_VISUELLEMENT } from "./a11y";

/**
 * Gabarit d'une colonne mensuelle, en % de sa largeur : deux barres accolées,
 * centrées, avec une gouttière au milieu et des marges égales sur les bords.
 * Ce sont des proportions de DESSIN, pas des valeurs de design — elles n'ont
 * pas de jeton parce qu'elles ne décrivent ni une couleur, ni un espacement de
 * l'interface, mais la géométrie interne d'un graphique.
 */
const BARRE_LARGEUR = 32;
const BARRE_RECETTE_X = 14;
const BARRE_CHARGES_X = 54;
const CENTRE_COLONNE = 50;

export function PanneauEvolution({
  serie,
  compact = false,
}: {
  readonly serie: readonly SeauMois[];
  readonly compact?: boolean;
}): React.JSX.Element {
  const t = fr.finances.evolution;

  let haut = 0;
  let bas = 0;
  for (const s of serie) {
    if (s.revenu > haut) haut = s.revenu;
    if (s.charges > haut) haut = s.charges;
    if (s.resultat_net > haut) haut = s.resultat_net;
    if (s.resultat_net < bas) bas = s.resultat_net;
  }
  // ⚠️ LA MARGE S'AJOUTE AU PLAFOND, PAS À L'ÉTENDUE. Une première version
  // écrivait `etendue * 1.08`, ce qui n'allongeait que le BAS : le sommet
  // restait à 0 % et la barre maximale touchait le bord supérieur, où elle se
  // lit comme un débordement plutôt que comme un maximum. Le dégagement doit
  // donc relever `haut`, ce qui décale tout le tracé vers le bas.
  const amplitude = haut - bas || 1;
  const plafond = haut + amplitude * 0.12;
  const etendue = plafond - bas;

  /** Ordonnée d'une valeur, en % depuis le HAUT de l'aire de tracé. */
  const yPct = (valeur: number): number => ((plafond - valeur) * 100) / etendue;

  const zero = yPct(0);

  return (
    <section className="flex h-full min-h-0 flex-col gap-2" aria-label={t.titre}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-ui text-heading font-semibold text-ink-900">{t.titre}</h2>
        <p className="truncate font-ui text-label text-ink-500">{t.aide}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-ui text-label text-ink-500">
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-brand-600" aria-hidden="true" />
          {t.legendeRevenu}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-sm bg-attention" aria-hidden="true" />
          {t.legendeCharges}
        </span>
        <span className="flex items-center gap-2">
          <span className="h-1 w-3 rounded-full bg-ink-700" aria-hidden="true" />
          {t.legendeNet}
        </span>
      </div>

      {/* ── L'AIRE DE TRACÉ ──────────────────────────────────────────────── */}
      <div className="relative min-h-0 flex-1" aria-hidden="true">
        {/* Repère du maximum : sans lui, aucune barre n'a d'ordre de grandeur. */}
        <div
          className="absolute inset-x-0 border-t border-dashed border-rule"
          style={{ top: `${yPct(haut)}%` }}
        />
        {/* Le maximum À GAUCHE et SOUS son trait. À droite il tombait derrière
            la barre du dernier mois et sortait du cadre — « 67 250 DZ… ».
            `text-ink-500` et non `ink-300`, réservé au NON-TEXTE (2.43:1). */}
        <span
          className="absolute left-0 pt-1 font-num text-label tabular-nums text-ink-500"
          style={{ top: `${yPct(haut)}%` }}
        >
          {formaterDzd(haut)}
        </span>

        {/* La ligne de ZÉRO, pleine : sans elle, une barre au-dessus et une
            barre en dessous se ressemblent. */}
        <div className="absolute inset-x-0 border-t border-rule" style={{ top: `${zero}%` }} />

        {/* Les barres, en pourcentage de hauteur — rien n'est déformé.
            v9 — le dégradé de famille sur chaque barre (marque pour la
            recette, ambre pour les charges) : un graphique d'agrégat est une
            surface où ADR-025 autorise la couleur. Le dégradé ne passe
            derrière AUCUN chiffre — les valeurs vivent dans le tableau
            équivalent et les infobulles, jamais sur les barres. */}
        <div className="absolute inset-0 flex items-stretch gap-1">
          {serie.map((s) => (
            <div key={s.mois_iso} className="relative min-w-0 flex-1">
              <div
                className="absolute rounded-t bg-grad-tile-brand"
                style={{
                  left: `${BARRE_RECETTE_X}%`,
                  width: `${BARRE_LARGEUR}%`,
                  bottom: `${100 - zero}%`,
                  height: `${Math.max(0, zero - yPct(s.revenu))}%`,
                }}
              />
              <div
                className="absolute rounded-t bg-grad-tile-amber"
                style={{
                  left: `${BARRE_CHARGES_X}%`,
                  width: `${BARRE_LARGEUR}%`,
                  bottom: `${100 - zero}%`,
                  height: `${Math.max(0, zero - yPct(s.charges))}%`,
                }}
              />
            </div>
          ))}
        </div>

        {/* Le résultat net. SVG étiré VOLONTAIREMENT ici, et c'est sans effet :
            il ne porte aucun texte, et un segment étiré reste un segment.
            Segments DROITS — une spline inventerait, entre deux mois, des
            valeurs qu'aucune donnée ne soutient. */}
        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          focusable="false"
        >
          <polyline
            fill="none"
            stroke="var(--ink-700)"
            strokeWidth="1.25"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            points={serie
              .map((s, i) => {
                const largeur = 100 / Math.max(1, serie.length);
                return `${i * largeur + largeur / 2},${yPct(s.resultat_net)}`;
              })
              .join(" ")}
          />
        </svg>

        {/* Les repères du net : des blocs HTML, PAS des <circle>, qui seraient
            transformés en ovales par l'étirement du SVG ci-dessus. */}
        <div className="absolute inset-0 flex items-stretch gap-1">
          {serie.map((s) => (
            <div key={`n-${s.mois_iso}`} className="relative min-w-0 flex-1">
              <span
                className="absolute h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-700"
                style={{ left: `${CENTRE_COLONNE}%`, top: `${yPct(s.resultat_net)}%` }}
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── LES MOIS — du vrai texte, sous l'aire de tracé ───────────────── */}
      <div className="flex shrink-0 items-baseline gap-1">
        {serie.map((s, i) => (
          <div
            key={`m-${s.mois_iso}`}
            className="min-w-0 flex-1 text-center"
            title={`${s.mois_label} · ${t.legendeNet} ${formaterDzd(s.resultat_net)}`}
          >
            <span
              className={[
                "block truncate font-ui text-eyebrow",
                // Le mois en cours porte l'encre pleine : c'est celui qu'on lit.
                i === serie.length - 1 ? "font-medium text-ink-700" : "text-ink-500",
              ].join(" ")}
            >
              {compact ? s.mois_label.slice(0, 3) : s.mois_label}
            </span>
          </div>
        ))}
      </div>

      {/* Le tableau équivalent : un lecteur d'écran lit des CHIFFRES, pas une
          description de rectangles. Le div porte le masquage — voir a11y.ts,
          `h-px` ne borne pas un <table>. */}
      <div className={CACHE_VISUELLEMENT}>
        <table>
          <caption>{t.tableau}</caption>
          <thead>
            <tr>
              <th scope="col">{t.colonneMois}</th>
              <th scope="col">{t.legendeRevenu}</th>
              <th scope="col">{t.legendeCharges}</th>
              <th scope="col">{t.legendeNet}</th>
            </tr>
          </thead>
          <tbody>
            {serie.map((s) => (
              <tr key={s.mois_iso}>
                <th scope="row">{s.mois_label}</th>
                <td>{formaterDzd(s.revenu)}</td>
                <td>{formaterDzd(s.charges)}</td>
                <td>{formaterDzd(s.resultat_net)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
