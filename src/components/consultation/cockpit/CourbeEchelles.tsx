"use client";

import { EtatVide } from "@/components/ui";
import { Icone } from "@/components/ui/Icones";
import { couleurTrait, type Famille } from "@/components/ui/Graphes";
import { dateCivile } from "@/components/patients/format";
import { fr } from "@/i18n/fr";
import type { EchelleResume } from "@/services/patients";

const SERIES: readonly Famille[] = ["emeraude", "azure", "violet"];

function dateCourte(iso: string): string {
  return dateCivile(iso.slice(0, 10)) ?? iso.slice(0, 10);
}

/**
 * L'évolution des échelles — une preuve, pas une décoration.
 *
 * Le dossier n'expose que deux mesures par échelle (`dernier` + `precedent`,
 * portes 076/078) : chaque série est donc un segment honnête entre deux
 * points RÉELS datés, jamais une courbe interpolée. Les valeurs sont en
 * toutes lettres à côté du tracé (le sens ne passe jamais par la couleur
 * seule) et le tracé est `aria-hidden`. Zéro série comparable : vide honnête,
 * jamais de courbe inventée pour remplir l'espace.
 */
export function CourbeEchelles({
  echelles,
}: {
  readonly echelles: readonly EchelleResume[];
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;

  const tracables = echelles.filter(
    (e) =>
      e.precedent !== null &&
      e.dernier.score !== null &&
      e.precedent.score !== null &&
      e.dernier.date !== e.precedent.date,
  );

  // La période dite est celle des points TRACÉS, jamais un « 7 derniers
  // jours » qui mentirait dès que deux mesures s'écartent davantage.
  const bornes = tracables.flatMap((e) => [e.precedent?.date ?? "", e.dernier.date]).sort();
  const periode =
    bornes.length === 0
      ? null
      : `${dateCourte(bornes[0] ?? "")} → ${dateCourte(bornes[bornes.length - 1] ?? "")}`;

  return (
    <section
      aria-label={fr.consultation.evolutionTitre}
      className="flex flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-violet-100 bg-tuile-lavande text-violet-700 shadow-douce">
            <Icone nom="statistiques" taille={20} />
          </span>
          <h2 className="font-ui text-heading font-bold text-ink-900">
            {fr.consultation.evolutionTitre}
          </h2>
        </div>
        {periode === null ? null : (
          <p className="font-ui text-label tabular-nums text-ink-500">{periode}</p>
        )}
      </div>

      {tracables.length === 0 ? (
        <EtatVide message={cockpit.courbeVide} icone="statistiques" />
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {tracables.slice(0, 3).map((e, i) => {
            const famille = SERIES[i % SERIES.length] ?? "emeraude";
            const avant = e.precedent?.score ?? 0;
            const apres = e.dernier.score ?? 0;
            const haut = Math.max(avant, apres);
            const bas = Math.min(avant, apres);
            const amplitude = haut - bas || 1;
            // Ordonnées dans un carré 100×100 : la pente dit la direction,
            // les chiffres à côté disent la valeur — le tracé ne porte rien.
            const y = (v: number): number => 88 - ((v - bas) / amplitude) * 76;
            const yAvant = y(avant);
            const yApres = y(apres);
            return (
              <li
                key={e.scaleCode}
                className="flex items-center gap-3 border-b border-rule py-3 last:border-0"
              >
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: couleurTrait(famille) }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-ui text-body font-semibold text-ink-900">
                    {e.scaleName}
                  </span>
                  <span className="block font-ui text-label tabular-nums text-ink-500">
                    {String(avant)} → {String(apres)} · {dateCourte(e.precedent?.date ?? "")} →{" "}
                    {dateCourte(e.dernier.date)}
                  </span>
                </span>
                <svg
                  aria-hidden="true"
                  focusable="false"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="h-7 w-16 shrink-0"
                >
                  <polyline
                    fill="none"
                    stroke={couleurTrait(famille)}
                    strokeWidth="4"
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    vectorEffect="non-scaling-stroke"
                    points={`6,${String(yAvant)} 94,${String(yApres)}`}
                  />
                </svg>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
