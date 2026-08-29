"use client";

/**
 * Rangée 2, centre — ANATOMIE. D'où vient l'argent, où il part.
 *
 * Deux listes de barres horizontales compactes, séparées par un filet : les
 * recettes par type de séance au-dessus, les charges par catégorie en dessous.
 * Les superposer dans une seule liste mélangerait deux signes — une recette et
 * une dépense ne se comparent pas sur la même barre.
 *
 * ═══ POURQUOI LE LIBELLÉ A SA PROPRE LIGNE ═════════════════════════════════
 *
 * ⚠️ MESURÉ À L'ÉCRAN : sur une colonne de ~32 %, poser le libellé, le montant,
 * la part et le nombre de séances SUR UNE SEULE LIGNE ne laissait au libellé
 * qu'une centaine de pixels. « Thérapie de couple » s'affichait « Therapie c… »
 * et « Renouvellement d'ordonnance » « Renouvell… ».
 *
 * Or c'est précisément le mot que la médecin lit en premier : le chiffre lui dit
 * COMBIEN, le libellé lui dit DE QUOI. Un montant sans son libellé ne répond
 * plus à la question du panneau — « d'où vient l'argent ». Tronquer le nom pour
 * garder la part en pourcentage, c'est sacrifier le sujet pour l'accessoire.
 *
 * Le libellé occupe donc la première ligne, sur toute la largeur moins son
 * montant ; la barre, la part et le nombre de séances tiennent sur la seconde.
 * Le bloc gagne une ligne et devient lisible.
 *
 * ═══ AUCUNE ARITHMÉTIQUE ═══════════════════════════════════════════════════
 *
 * ⚠️ `part_pct` ARRIVE DE LA BASE. Le composant de V6 calculait
 * `(montant * 100) / total` en JavaScript sur des données financières, ce qui
 * donnait un pourcentage pouvant diverger du total affiché juste à côté (deux
 * arrondis, deux vérités). Ici la largeur de barre EST `part_pct` — la valeur
 * lue par la médecin et la longueur qu'elle voit sortent du même calcul SQL.
 */

import { fr } from "@/i18n/fr";
import { formaterDzd, type PartCharge, type PartRevenu } from "@/services/finance-cash";

/** Libellés lisibles : la base rend des clés d'enum, jamais du français. */
function libelleType(cle: string): string {
  if (cle === "__non_rattache__") return fr.finances.anatomie.nonRattache;
  // Les types de séance viennent de `app.appointments.kind` : on les rend
  // lisibles sans table de correspondance figée, qui se désynchroniserait de
  // l'enum au premier ajout.
  const mot = cle.replace(/_/g, " ");
  return mot.charAt(0).toUpperCase() + mot.slice(1);
}

function libelleCategorie(cle: string): string {
  const table = fr.finances.categories as Record<string, string | undefined>;
  return table[cle] ?? cle;
}

function Barre({
  libelle,
  montant,
  pct,
  couleur,
  suffixe,
}: {
  readonly libelle: string;
  readonly montant: number;
  readonly pct: number;
  readonly couleur: string;
  readonly suffixe?: string;
}): React.JSX.Element {
  const part = fr.finances.anatomie.part.replace("{pct}", String(pct).replace(".", ","));

  return (
    <li className="flex flex-col gap-1">
      {/* Ligne 1 — LE SUJET. Le libellé prend toute la place disponible ;
          `title` rend le nom complet accessible si la colonne se resserre
          malgré tout. */}
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 flex-1 truncate font-ui text-label text-ink-700" title={libelle}>
          {libelle}
        </span>
        <span className="shrink-0 whitespace-nowrap font-num text-label tabular-nums text-ink-900">
          {formaterDzd(montant)}
        </span>
      </div>

      {/* Ligne 2 — LA MESURE. La barre s'étire, la part reste à droite. */}
      <div className="flex items-center gap-2">
        <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sunken">
          {/* La largeur EST `part_pct`, telle que Postgres l'a calculée. */}
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: couleur }} />
        </div>
        <span className="shrink-0 whitespace-nowrap font-num text-label tabular-nums text-ink-500">
          {part}
          {suffixe === undefined ? "" : ` · ${suffixe}`}
        </span>
      </div>
    </li>
  );
}

export function PanneauAnatomie({
  revenus,
  charges,
}: {
  readonly revenus: readonly PartRevenu[];
  readonly charges: readonly PartCharge[];
}): React.JSX.Element {
  const t = fr.finances.anatomie;

  return (
    <section className="flex h-full min-h-0 flex-col gap-3" aria-label={t.titre}>
      <h2 className="font-ui text-heading font-semibold text-ink-900">{t.titre}</h2>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
        <div>
          <h3 className="mb-2 font-ui text-label font-medium text-ink-500">
            {t.revenus}
          </h3>
          {revenus.length === 0 ? (
            <p className="font-ui text-label text-ink-500">{t.aucunRevenu}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {revenus.map((r) => (
                <Barre
                  key={r.cle}
                  libelle={libelleType(r.libelle)}
                  montant={r.montant}
                  pct={r.part_pct}
                  couleur="var(--grad-tile-brand)"
                  suffixe={
                    r.nb_seances === 1
                      ? fr.finances.pulse.uneSeance
                      : fr.finances.pulse.seances.replace("{n}", String(r.nb_seances))
                  }
                />
              ))}
            </ul>
          )}
        </div>

        <hr className="border-0 border-t border-rule" />

        <div>
          <h3 className="mb-2 font-ui text-label font-medium text-ink-500">
            {t.charges}
          </h3>
          {charges.length === 0 ? (
            <p className="font-ui text-label text-ink-500">{t.aucuneCharge}</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {charges.map((c) => (
                <Barre
                  key={c.cle}
                  libelle={libelleCategorie(c.libelle)}
                  montant={c.montant}
                  pct={c.part_pct}
                  couleur="var(--grad-tile-amber)"
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
