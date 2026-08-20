/**
 * L'évolution du facturé — barres EMPILÉES, encaissé puis en attente.
 *
 * ⚠️ POURQUOI EMPILÉ, ET PAS DEUX SÉRIES CÔTE À CÔTE. Parce que
 * `encaissé + en attente = facturé` est un INVARIANT (I-1), vérifié en base et
 * revérifié dans le service avant tout rendu. L'empilement le rend VISIBLE :
 * la hauteur totale d'une barre EST le facturé du seau. Deux barres voisines
 * obligeraient à faire l'addition de tête, et rien à l'écran ne dirait qu'elle
 * tombe juste.
 *
 * ⚠️ AUCUNE BIBLIOTHÈQUE DE GRAPHIQUES. Le dépôt n'en a aucune, et en ajouter
 * une pour 60 lignes de SVG coûterait : un budget de bundle (`06-PERF-BUDGET`),
 * un second système de couleurs qui ferait échouer le contrôle 1 du checkpoint
 * (aucun hex hors `tokens.css`), et une dépendance à maintenir. Les barres sont
 * des `<rect>`, et c'est tout ce dont un graphique de 31 points a besoin.
 *
 * ⚠️ LE GRAIN EST DÉCIDÉ EN BASE (036 §3), donc au plus 31 seaux : jour ≤ 31 j,
 * semaine ≤ 120 j, mois au-delà. Le composant n'a jamais à décider quoi faire
 * de 366 barres dans 700 px — la question ne se pose pas.
 *
 * ⚠️ LE TABLEAU N'EST PAS UNE OPTION. Il est TOUJOURS dans le DOM, caché à
 * l'œil, annoncé au lecteur d'écran. Le SVG est `aria-hidden` : c'est un rendu
 * du tableau, pas un substitut. Un graphique sans équivalent textuel est un
 * îlot de données inaccessible (§37 du contrat).
 */

import { fr } from "@/i18n/fr";
import { formaterDzd } from "@/services/finance";
import { estAvantOuEgal, type Grain, type Seau } from "@/services/finance-periode";

import { CACHE_VISUELLEMENT } from "./a11y";

const L = 720;   // largeur du repère
const H = 220;   // hauteur du repère
const MARGE_G = 8;
const MARGE_D = 8;
const MARGE_H = 12;
const BASE = 190; // ligne de zéro

/**
 * L'étiquette d'un seau, selon le grain. Les dates arrivent en `AAAA-MM-JJ` de
 * la base ; on n'en affiche que ce qui distingue un seau du suivant — un
 * graphique mensuel n'a pas besoin du quantième.
 */
function etiquette(debut: string, grain: Grain): string {
  const [a, m, j] = debut.split("-");
  if (grain === "mois") return `${m}/${a?.slice(2) ?? ""}`;
  return `${j}/${m}`;
}

export function GraphiqueEvolution({
  serie,
  grain,
  aujourdHui,
}: {
  readonly serie: readonly Seau[];
  readonly grain: Grain;
  readonly aujourdHui: string;
}): React.JSX.Element {
  const t = fr.finances.graphiques;

  const max = serie.reduce((m, s) => Math.max(m, s.factureDzd), 0);
  const nb = serie.length;

  // ⚠️ `max === 0` NE DOIT PAS PRODUIRE UNE DIVISION PAR ZÉRO NI UNE BARRE
  // PLEINE HAUTEUR. Une période sans séance rend des barres de hauteur nulle et
  // une ligne de base — c'est-à-dire la vérité : il ne s'est rien passé.
  const echelle = (montant: number): number =>
    max === 0 ? 0 : ((BASE - MARGE_H) * montant) / max;

  const largeurUtile = L - MARGE_G - MARGE_D;
  const pas = nb === 0 ? 0 : largeurUtile / nb;
  // Barres jointives mais séparées d'un cheveu, et jamais plus larges que 48px :
  // trois barres étalées sur 700 px se liraient comme un diagramme de surface.
  const largeurBarre = Math.max(1, Math.min(48, pas * 0.72));

  // Combien d'étiquettes d'axe on peut poser sans qu'elles se chevauchent.
  const pasEtiquette = Math.max(1, Math.ceil(nb / 8));

  return (
    <figure className="m-0 flex flex-col gap-3">
      {/* La légende porte le sens ; les couleurs ne font que le redoubler. */}
      <figcaption className="flex flex-wrap items-center gap-4">
        <span className="flex items-center gap-2 font-ui text-label text-ink-700">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-positive" />
          {t.legendeEncaisse}
        </span>
        <span className="flex items-center gap-2 font-ui text-label text-ink-700">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-sm bg-attention" />
          {t.legendeAttente}
        </span>
        <span className="font-ui text-label text-ink-500">{t.evolutionAide}</span>
      </figcaption>

      {/* Le graphique DÉFILE dans son conteneur si la fenêtre est étroite ; la
          PAGE, elle, ne défile jamais latéralement (§4 règle 9). */}
      <div className="overflow-x-auto">
        <svg
          viewBox={`0 0 ${L} ${H}`}
          className="h-auto w-full min-w-chart"
          role="presentation"
          aria-hidden="true"
          focusable="false"
        >
          {/* Ligne de base — le zéro, toujours tracé, même quand tout est nul. */}
          <line
            x1={MARGE_G} y1={BASE} x2={L - MARGE_D} y2={BASE}
            className="stroke-rule" strokeWidth={1}
          />

          {serie.map((s, i) => {
            const x = MARGE_G + i * pas + (pas - largeurBarre) / 2;
            const hEnc = echelle(s.encaisseDzd);
            const hAtt = echelle(s.attenteDzd);
            const futur = !estAvantOuEgal(s.debut, aujourdHui);

            return (
              <g key={s.debut}>
                {/* Encaissé — posé sur la ligne de base. */}
                {hEnc > 0 ? (
                  <rect
                    x={x} y={BASE - hEnc} width={largeurBarre} height={hEnc}
                    className="fill-positive" rx={2}
                  />
                ) : null}
                {/* En attente — EMPILÉ au-dessus : le sommet est le facturé. */}
                {hAtt > 0 ? (
                  <rect
                    x={x} y={BASE - hEnc - hAtt} width={largeurBarre} height={hAtt}
                    className="fill-attention" rx={2}
                  />
                ) : null}
                {/* Un seau à venir n'est pas « zéro » : il n'a pas encore eu
                    lieu. Un liseré discret le distingue d'une journée creuse,
                    sans lui donner de hauteur. */}
                {futur && hEnc === 0 && hAtt === 0 ? (
                  <rect
                    x={x} y={BASE - 2} width={largeurBarre} height={2}
                    className="fill-ink-100"
                  />
                ) : null}
                {i % pasEtiquette === 0 ? (
                  <text
                    x={x + largeurBarre / 2} y={BASE + 16}
                    textAnchor="middle"
                    className="fill-ink-500 font-num text-label"
                  >
                    {etiquette(s.debut, grain)}
                  </text>
                ) : null}
              </g>
            );
          })}

          {/* Le maximum, écrit. Sans lui, la hauteur d'une barre ne dit rien. */}
          {max > 0 ? (
            <text x={MARGE_G} y={MARGE_H} className="fill-ink-500 font-num text-label">
              {formaterDzd(max)}
            </text>
          ) : null}
        </svg>
      </div>

      {/* ═══ L'ÉQUIVALENT TEXTUEL — toujours présent, jamais optionnel ═══ */}
      <table className={CACHE_VISUELLEMENT}>
        <caption>{t.tableauDonnees} — {t.evolution}</caption>
        <thead>
          <tr>
            <th scope="col">{t.grain[grain]}</th>
            <th scope="col">{fr.finances.kpi.facture}</th>
            <th scope="col">{t.legendeEncaisse}</th>
            <th scope="col">{t.legendeAttente}</th>
            <th scope="col">{fr.finances.kpi.seancesTarifees}</th>
          </tr>
        </thead>
        <tbody>
          {serie.map((s) => (
            <tr key={s.debut}>
              <th scope="row">{s.debut}</th>
              <td>{formaterDzd(s.factureDzd)}</td>
              <td>{formaterDzd(s.encaisseDzd)}</td>
              <td>{formaterDzd(s.attenteDzd)}</td>
              <td>{s.seances}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
