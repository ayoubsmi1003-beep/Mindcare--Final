"use client";

/**
 * Rangée 3 — LE CALENDRIER, EN UNE BANDE.
 *
 * ═══ CE QUI A ÉTÉ REMPLACÉ ═════════════════════════════════════════════════
 *
 * Le calendrier précédent était une grille à 7 colonnes, façon « contributions
 * GitHub » : il imposait un balayage vertical pour lire un mois et occupait
 * plusieurs centaines de pixels de haut. Or la question posée à ce bloc est
 * « quels jours ont rapporté ? », pas « quel jour de la semaine sommes-nous ».
 *
 * Une BANDE HORIZONTALE d'une seule ligne répond à la même question dans ~90 px
 * et se lit de gauche à droite, comme un mois se lit.
 *
 * ═══ CONTRASTE — UN DÉFAUT DÉJÀ MESURÉ UNE FOIS ════════════════════════════
 *
 * ⚠️ Du texte blanc sur `--brand-400` donne 2.32:1, mesuré, très en dessous du
 * 4.5:1 requis. SEUL `--brand-600` (5.10:1) porte du blanc. Les paliers clairs
 * gardent donc une encre sombre — c'est pourquoi la couleur du texte suit le
 * palier et n'est pas fixée une fois pour toutes.
 *
 * ═══ ARITHMÉTIQUE ══════════════════════════════════════════════════════════
 *
 * Les montants viennent de la base. Le seul calcul est le choix d'un PALIER
 * d'intensité (1 à 4) à partir du maximum de la période : une grandeur
 * graphique, jamais affichée comme un chiffre.
 */

import { fr } from "@/i18n/fr";
import { formaterDzd, type JourCaisse } from "@/services/finance-cash";

import { CACHE_VISUELLEMENT } from "./a11y";

/** Quatre paliers. Le plus foncé seul porte du texte blanc. */
const PALIERS = [
  { fond: "var(--sunken)", encre: "var(--ink-500)" },
  { fond: "var(--brand-100)", encre: "var(--ink-700)" },
  { fond: "var(--brand-200)", encre: "var(--ink-900)" },
  { fond: "var(--brand-400)", encre: "var(--ink-900)" },
  { fond: "var(--brand-600)", encre: "var(--paper)" },
] as const;

export function BandeCalendrier({
  jours,
  compact = false,
}: {
  readonly jours: readonly JourCaisse[];
  readonly compact?: boolean;
}): React.JSX.Element {
  const t = fr.finances.calendrier;

  let plafond = 0;
  for (const j of jours) if (j.montant > plafond) plafond = j.montant;

  function palier(montant: number): (typeof PALIERS)[number] {
    if (montant <= 0 || plafond === 0) return PALIERS[0];
    const rang = Math.min(4, Math.max(1, Math.ceil((montant / plafond) * 4)));
    return PALIERS[rang] ?? PALIERS[0];
  }

  return (
    <section className="flex flex-col gap-2" aria-label={t.titre}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-ui text-heading font-semibold text-ink-900">{t.titre}</h2>
        <p className="truncate font-ui text-label text-ink-500">{t.aide}</p>
      </div>

      {/* Une seule rangée : chaque jour prend une part égale de la largeur.
          `min-w-0` autorise les cellules à se comprimer plutôt qu'à déborder —
          c'est ce qui garantit l'absence de défilement horizontal à 1280. */}
      <ul className="flex w-full items-end gap-1" aria-hidden="true">
        {jours.map((j) => {
          const p = palier(j.montant);
          const jourDuMois = j.jour_iso.slice(8, 10);
          return (
            <li
              key={j.jour_iso}
              className="relative min-w-0 flex-1"
              title={(j.a_impaye ? t.celluleImpaye : t.cellule)
                .replace("{date}", j.jour_iso)
                .replace("{montant}", formaterDzd(j.montant))
                .replace("{n}", String(j.nb_seances))}
            >
              <div
                className={[
                  "flex items-center justify-center rounded-md font-num tabular-nums",
                  compact ? "h-5" : "h-9 text-eyebrow",
                ].join(" ")}
                style={{ background: p.fond, color: p.encre }}
              >
                {compact ? "" : jourDuMois}
              </div>
              {/* Le point ambre marque un jour qui porte un impayé. */}
              {j.a_impaye ? (
                <span
                  className="absolute -top-1 left-1/2 h-2 w-2 -translate-x-1/2 rounded-full bg-attention"
                />
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-end gap-2 font-ui text-label text-ink-500">
        <span>{t.moins}</span>
        {PALIERS.map((p, i) => (
          <span
            key={i}
            className="h-3 w-3 rounded-sm"
            style={{ background: p.fond }}
            aria-hidden="true"
          />
        ))}
        <span>{t.plus}</span>
      </div>

      {/* Le div porte le masquage : voir a11y.ts — `h-px` ne borne pas un
          `<table>`, dont la hauteur CSS est un minimum. */}
      <div className={CACHE_VISUELLEMENT}>
        <table>
        <caption>{t.titre}</caption>
        <tbody>
          {jours.map((j) => (
            <tr key={j.jour_iso}>
              <th scope="row">{j.jour_iso}</th>
              <td>{formaterDzd(j.montant)}</td>
              <td>{j.nb_seances}</td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </section>
  );
}
