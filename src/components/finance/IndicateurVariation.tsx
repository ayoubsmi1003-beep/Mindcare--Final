/**
 * La variation d'un indicateur d'une période à l'autre.
 *
 * ⚠️ CE COMPOSANT NE CALCULE RIEN. Le sens, le pourcentage et le nombre de
 * jours comparés sont décidés par `app.finance_variation` (036 §2) et voyagent
 * tels quels. Recalculer ici « si courant > précédent alors hausse » ferait une
 * seconde vérité sur la même question, et le jour où les deux divergent, c'est
 * la flèche qui ment sur un montant.
 *
 * ⚠️ « — » N'EST PAS « 0 % », ET C'EST TOUT L'ENJEU.
 *   `nouveau`       il y a quelque chose maintenant, il n'y avait rien avant.
 *                   Aucun ratio ne décrit ça : ni +∞ %, ni +100 %.
 *   `indisponible`  l'une des deux valeurs manque (un taux sans assiette).
 * Dans les deux cas on écrit « — » et on dit POURQUOI en toutes lettres.
 * Afficher « +100 % » sur un premier mois d'activité serait un chiffre inventé
 * sous un signe de pourcentage.
 *
 * ⚠️ LA COULEUR NE PORTE JAMAIS L'INFORMATION SEULE (§4 règle 4). La flèche
 * donne la direction par sa FORME, le libellé la donne en toutes lettres, et
 * le tout reste lisible en niveaux de gris comme pour un daltonien.
 */

import { Badge, type TonBadge } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { Variation } from "@/services/finance-periode";

/**
 * Le sens d'une variation n'a PAS de valeur morale universelle, et c'est
 * pourquoi `bonSensEstHausse` existe.
 *
 * Une hausse du facturé est une bonne nouvelle ; une hausse des impayés n'en
 * est pas une. Sans ce paramètre, le composant peindrait en vert une dette qui
 * grossit — l'interface dirait le contraire du chiffre qu'elle affiche.
 */
function tonDe(sens: Variation["sens"], bonSensEstHausse: boolean): TonBadge {
  if (sens === "hausse") return bonSensEstHausse ? "positif" : "attention";
  if (sens === "baisse") return bonSensEstHausse ? "attention" : "positif";
  return "neutre";
}

const FLECHES: Readonly<Record<Variation["sens"], string>> = {
  hausse: "↑",
  baisse: "↓",
  stable: "→",
  nouveau: "",
  indisponible: "",
};

export function IndicateurVariation({
  variation,
  bonSensEstHausse = true,
  /** `pt` pour un écart de points de pourcentage (un taux), `%` sinon. */
  unite = "%",
}: {
  readonly variation: Variation;
  readonly bonSensEstHausse?: boolean;
  readonly unite?: "%" | "pt";
}): React.JSX.Element {
  const { sens, pourcentage, joursCompares } = variation;
  const t = fr.finances.kpi;

  // Pas de pourcentage calculable : on le DIT, on ne l'invente pas.
  if (pourcentage === null) {
    const raison = sens === "nouveau" ? t.aucunPrecedent : t.indisponible;
    return (
      <p className="font-ui text-label text-ink-500">
        {/* Le tiret est DÉCORATIF : la raison, juste après, est le vrai
            contenu. L'annoncer aussi ferait lire « tiret » avant chaque
            explication. */}
        <span aria-hidden="true">{t.absent}</span> {raison}
      </p>
    );
  }

  // Virgule décimale : c'est un écran français, et `toFixed` rend un point.
  const valeur = Math.abs(pourcentage).toFixed(1).replace(".", ",");
  const signe = sens === "hausse" ? "+" : sens === "baisse" ? "−" : "";
  const libelle = `${signe}${valeur} ${unite === "pt" ? "pt" : "%"}`;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Badge ton={tonDe(sens, bonSensEstHausse)}>
        {/* La flèche double le signe ; ni l'un ni l'autre n'est seul porteur. */}
        <span aria-hidden="true">{FLECHES[sens]}</span>
        <span className="font-num tabular-nums">{libelle}</span>
      </Badge>
      <span className="font-ui text-label text-ink-500">
        {t.vsJours.replace("{n}", String(joursCompares))}
      </span>
    </div>
  );
}
