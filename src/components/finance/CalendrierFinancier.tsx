/**
 * Le calendrier financier — l'intensité du facturé, jour par jour.
 *
 * ⚠️ IL NE S'AFFICHE QU'AU GRAIN « JOUR ». Au grain semaine ou mois, un seau ne
 * correspond plus à une case de calendrier, et forcer l'affichage donnerait une
 * grille dont chaque case mentirait sur sa période. L'appelant décide ; ce
 * composant suppose le grain « jour ».
 *
 * ⚠️ LA COULEUR NE PORTE JAMAIS L'INFORMATION SEULE (§4 règle 4). Chaque case
 * porte son montant EXACT dans son nom accessible, et un `<table>` complet
 * double la grille pour le lecteur d'écran. Une intensité de teinte est un
 * raccourci de lecture, pas une donnée.
 *
 * ⚠️ « AUCUNE SÉANCE » N'EST PAS « INTENSITÉ 1 ». C'est un cinquième état,
 * visuellement distinct (un creux, pas une teinte de marque). Sans lui, un jour
 * à 0 DZD et un jour au plus faible chiffre d'affaires se ressembleraient — et
 * la grille dirait qu'il s'est passé quelque chose un jour où le cabinet était
 * fermé.
 *
 * ⚠️ `max === 0` NE PRODUIT AUCUNE CASE ALLUMÉE. Une période entièrement vide
 * normalisée sur son propre maximum donnerait `0/0` : toutes les cases au
 * niveau le plus haut, c'est-à-dire un calendrier qui prétend que rien est
 * beaucoup.
 */

import { fr } from "@/i18n/fr";
import { formaterDzd } from "@/services/finance";
import { estAvantOuEgal, type Seau } from "@/services/finance-periode";

import { CACHE_VISUELLEMENT } from "./a11y";

/**
 * Cinq niveaux : le creux (aucune séance) puis quatre paliers de marque.
 * Quatre paliers suffisent — au-delà, deux teintes voisines ne se distinguent
 * plus, et une échelle qu'on ne sait pas lire ne dit rien.
 */
const NIVEAUX: readonly string[] = [
  "bg-sunken",       // 0 — aucune séance
  "bg-brand-100",
  "bg-brand-200",
  "bg-brand-400",
  "bg-brand-600",
];

const JOURS = ["L", "M", "M", "J", "V", "S", "D"] as const;

/** Index ISO du jour de la semaine, lundi = 0. */
function colonneDe(date: string): number {
  const [a, m, j] = date.split("-").map(Number);
  const d = new Date(Date.UTC(a ?? 1970, (m ?? 1) - 1, j ?? 1));
  return (d.getUTCDay() + 6) % 7;
}

export function CalendrierFinancier({
  serie,
  aujourdHui,
}: {
  readonly serie: readonly Seau[];
  readonly aujourdHui: string;
}): React.JSX.Element {
  const t = fr.finances.graphiques;
  const max = serie.reduce((m, s) => Math.max(m, s.factureDzd), 0);

  function niveauDe(s: Seau): number {
    if (s.factureDzd <= 0 || max <= 0) return 0;
    // Quatre paliers, bornés : `Math.ceil` garantit qu'un montant non nul ne
    // retombe jamais au niveau « aucune séance ».
    return Math.min(4, Math.max(1, Math.ceil((s.factureDzd / max) * 4)));
  }

  // Les cases vides du début de grille, pour que le 1er tombe sous son vrai jour.
  const premier = serie[0];
  const decalage = premier === undefined ? 0 : colonneDe(premier.debut);

  return (
    <figure className="m-0 flex flex-col gap-3">
      <figcaption className="font-ui text-label text-ink-500">
        {t.calendrierAide}
      </figcaption>

      <div className="flex flex-col gap-2">
        {/* En-têtes de colonnes. `aria-hidden` : le tableau équivalent porte
            déjà les dates complètes, et « L M M J V S D » lu à voix haute
            n'apprendrait rien. */}
        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
          {JOURS.map((j, i) => (
            <span key={i} className="text-center font-ui text-label text-ink-500">
              {j}
            </span>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
          {Array.from({ length: decalage }, (_, i) => (
            <span key={`vide-${i}`} />
          ))}
          {serie.map((s) => {
            const futur = !estAvantOuEgal(s.debut, aujourdHui);
            const n = niveauDe(s);
            return (
              <span
                key={s.debut}
                title={`${s.debut} · ${formaterDzd(s.factureDzd)}`}
                className={[
                  "flex aspect-square items-center justify-center rounded-sm",
                  NIVEAUX[n] ?? "bg-sunken",
                  // Un jour à venir n'est pas un jour creux : il est en
                  // pointillé, et n'entre dans aucun palier.
                  futur ? "border border-dashed border-rule bg-card" : "",
                  // ⚠️ L'ENCRE SUIT LE FOND, ET LE SEUIL A ÉTÉ MESURÉ, PAS DEVINÉ.
                  //
                  // Première version : blanc dès le palier 3 (`--brand-400`).
                  // Relevé au navigateur le 2026-08-20 par
                  // `mesure-v3-navigateur.mjs` : **2.32:1**, très au-dessous du
                  // plancher de 4.5:1. `--brand-400` est le teal du LOGO, et
                  // tokens.css le dit déjà en toutes lettres — « JAMAIS du texte
                  // sur blanc » — la réciproque valait tout autant.
                  //
                  // Seul `--brand-600` porte du blanc (5.10:1, vérifié dans
                  // tokens.css). Les trois paliers clairs prennent l'encre la
                  // plus foncée : sur `--brand-400`, `--ink-900` donne ~8:1.
                  //
                  // C'est exactement la leçon de `--ink-300` et de `--attention`
                  // en V3 : une couleur « a l'air » lisible, et ne l'est pas.
                  // Un contraste se calcule.
                  n >= 4 ? "text-on-brand" : "text-ink-900",
                ].join(" ")}
              >
                <span className="font-num text-label tabular-nums">
                  {s.debut.slice(8)}
                </span>
              </span>
            );
          })}
        </div>

        {/* L'échelle, écrite. Une intensité sans légende n'est qu'une couleur. */}
        <div className="flex flex-wrap items-center gap-2" aria-hidden="true">
          <span className="font-ui text-label text-ink-500">{t.aucuneSeance}</span>
          {NIVEAUX.map((c, i) => (
            <span key={i} className={`inline-block h-3 w-3 rounded-sm ${c}`} />
          ))}
          <span className="font-ui text-label text-ink-500">
            {max > 0 ? formaterDzd(max) : ""}
          </span>
        </div>
      </div>

      {/* ═══ L'ÉQUIVALENT TEXTUEL — la grille entière, en clair ═══ */}
      <table className={CACHE_VISUELLEMENT}>
        <caption>{t.tableauDonnees} — {t.calendrier}</caption>
        <thead>
          <tr>
            <th scope="col">{fr.finances.periodes.du}</th>
            <th scope="col">{fr.finances.kpi.facture}</th>
            <th scope="col">{fr.finances.kpi.encaisse}</th>
            <th scope="col">{fr.finances.kpi.attente}</th>
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
