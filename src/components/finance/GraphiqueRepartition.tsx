/**
 * D'où vient le revenu — barres horizontales, une par groupe.
 *
 * ⚠️ EN `div`, PAS EN SVG, ET C'EST UN CHOIX. Une barre horizontale est un bloc
 * dont la largeur est un pourcentage : le navigateur sait faire ça nativement,
 * il le refait tout seul au redimensionnement, et le texte dedans reste du
 * VRAI texte — sélectionnable, zoomable, lisible par un lecteur d'écran sans
 * qu'on ait à le dupliquer. Un SVG n'apporterait ici qu'une mise en page figée.
 *
 * ⚠️ « NON RATTACHÉ » NE SE MASQUE JAMAIS. Trois sauts nullables séparent un
 * paiement de son type de consultation :
 *   payments.consultation_id      → nullable (011)
 *   consultations.appointment_id  → nullable (007)
 *   appointments.kind             → nullable PAR DÉCISION (024)
 * Ce seau est ce qui fait tenir l'invariant I-2 — la somme des parts égale le
 * facturé. Le cacher pour « faire propre » donnerait un graphique qui ne
 * totalise pas le chiffre affiché deux centimètres plus haut, et personne ne
 * saurait pourquoi. Il est donc affiché, étiqueté, expliqué, et placé EN
 * DERNIER quelle que soit sa taille.
 *
 * ⚠️ AUCUN LIBELLÉ N'EST INVENTÉ ICI. Les treize types viennent de
 * `fr.agenda.types` — les mêmes chaînes que l'agenda, fournies par le cabinet
 * (024). Deux vocabulaires pour un même acte obligeraient la praticienne à
 * traduire d'un écran à l'autre.
 */

import { fr } from "@/i18n/fr";
import { formaterDzd } from "@/services/finance";
import type { Groupe } from "@/services/finance-periode";

import { CACHE_VISUELLEMENT } from "./a11y";

/** Six teintes, pas davantage — au-delà, elles deviennent indiscernables. */
const TEINTES: readonly string[] = [
  "bg-action-600",
  "bg-info-600",
  "bg-brand-400",
  "bg-info-400",
  "bg-ai-500",
  "bg-ink-500",
];

function libelleDe(g: Groupe): string {
  if (g.nonRattache) return fr.finances.graphiques.nonRattache;
  // Une praticienne : la porte rend son nom. Un type : on traduit la clé.
  if (g.libelle !== undefined && g.libelle !== "") return g.libelle;
  const types = fr.agenda.types as Record<string, string | undefined>;
  return types[g.cle] ?? g.cle;
}

export function GraphiqueRepartition({
  groupes,
  total,
  titreTableau,
}: {
  readonly groupes: readonly Groupe[];
  /** Le facturé de la période — le dénominateur, jamais recalculé ici. */
  readonly total: number;
  readonly titreTableau: string;
}): React.JSX.Element {
  const t = fr.finances.graphiques;

  // `total === 0` : aucune division. La section vide est gérée par l'appelant ;
  // ce garde-fou n'existe que pour qu'aucun `NaN%` ne puisse atteindre le DOM.
  const part = (montant: number): number =>
    total === 0 ? 0 : (montant * 100) / total;

  return (
    <figure className="m-0 flex flex-col gap-3">
      <ul className="flex list-none flex-col gap-3 p-0">
        {groupes.map((g, i) => {
          const pct = part(g.montantDzd);
          return (
            <li key={g.cle} className="flex flex-col gap-1">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-ui text-body text-ink-900">{libelleDe(g)}</span>
                <span className="font-ui text-label text-ink-500">
                  <span className="font-num tabular-nums text-ink-900">
                    {formaterDzd(g.montantDzd)}
                  </span>{" "}
                  · <span className="font-num tabular-nums">{pct.toFixed(1).replace(".", ",")} %</span>{" "}
                  · <span className="font-num tabular-nums">{g.seances}</span>{" "}
                  {g.seances === 1 ? fr.finances.resume.seance : fr.finances.resume.seances}
                </span>
              </div>
              {/* La piste est un creux ; la barre est posée dedans. Le
                  pourcentage est ÉCRIT au-dessus : la longueur ne porte donc
                  jamais l'information seule (§4 règle 4). */}
              <div className="h-2 w-full overflow-hidden rounded-full bg-sunken">
                <div
                  className={[
                    "h-full rounded-full",
                    // Le seau « Non rattaché » prend une encre neutre, jamais
                    // une teinte de série : ce n'est pas une catégorie, c'est
                    // l'absence de catégorie.
                    g.nonRattache ? "bg-ink-300" : (TEINTES[i % TEINTES.length] ?? "bg-ink-500"),
                  ].join(" ")}
                  // La largeur est une DONNÉE, pas une décision de design :
                  // elle vient du montant. C'est le seul style calculé de ce
                  // composant, et il est en pourcentage, donc sans unité en dur.
                  style={{ width: `${pct}%` }}
                />
              </div>
              {g.nonRattache ? (
                <p className="font-ui text-label text-ink-500">{t.nonRattacheAide}</p>
              ) : null}
            </li>
          );
        })}
      </ul>

      {/* ═══ L'ÉQUIVALENT TEXTUEL ═══ */}
      <table className={CACHE_VISUELLEMENT}>
        <caption>{t.tableauDonnees} — {titreTableau}</caption>
        <thead>
          <tr>
            <th scope="col">{titreTableau}</th>
            <th scope="col">{fr.finances.kpi.facture}</th>
            <th scope="col">%</th>
            <th scope="col">{fr.finances.kpi.seancesTarifees}</th>
          </tr>
        </thead>
        <tbody>
          {groupes.map((g) => (
            <tr key={g.cle}>
              <th scope="row">{libelleDe(g)}</th>
              <td>{formaterDzd(g.montantDzd)}</td>
              <td>{part(g.montantDzd).toFixed(1).replace(".", ",")} %</td>
              <td>{g.seances}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
