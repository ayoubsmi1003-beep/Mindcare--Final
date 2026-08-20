/**
 * « À votre attention » — au plus trois éléments, tous déterministes.
 *
 * ⚠️ AUCUN MODÈLE DE LANGAGE, AUCUN SEUIL STATISTIQUE. Les trois règles vivent
 * dans `app.finance_overview` (036 §3), en SQL, et chacune porte un PLANCHER
 * D'ÉCHANTILLON au-dessous duquel elle ne se déclenche pas — trois impayés
 * minimum, cinq séances minimum dans la période de référence. La raison est
 * mesurée : au 2026-08-20, la base porte DEUX paiements. Un seuil en
 * pourcentage sur deux lignes décrit le hasard, et une alerte qui décrit le
 * hasard apprend à ignorer les alertes.
 *
 * ⚠️ SECTION ABSENTE PLUTÔT QUE « RIEN À SIGNALER ». Quand aucun point ne se
 * déclenche, l'appelant ne rend pas ce composant du tout. Une ligne « rien
 * d'inhabituel » à chaque ouverture est un bruit permanent qui n'apprend rien,
 * et qui prend la place d'une information à l'écran le plus rare du cabinet :
 * celui qu'on lit entre deux patients.
 *
 * ⚠️ CHAQUE ACTION NOMME CE QU'ELLE FAIT. Jamais « Voir ». Un verbe précis dit
 * ce qui va s'ouvrir, et évite le clic exploratoire.
 *
 * ⚠️ AUCUN NOM DE PATIENT ICI. Les points portent des COMPTES et des MONTANTS
 * agrégés — jamais une identité. Nommer quelqu'un dans une alerte financière
 * l'afficherait sur un écran que le patient suivant peut voir (I5).
 */

import { Bouton, PanneauInfo } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { formaterDzd } from "@/services/finance";
import type { PointAttention } from "@/services/finance-periode";

/** L'action attachée à chaque code — précise, jamais générique. */
const ACTIONS: Readonly<Record<PointAttention["code"], keyof typeof fr.finances.attention>> = {
  "attente-elevee": "voirImpayes",
  corrections: "verifierCorrections",
  "baisse-marquee": "ouvrirJournal",
};

function texteDe(p: PointAttention): string {
  const t = fr.finances.attention;
  return t[p.code]
    .replace("{n}", String(p.nombre))
    .replace("{montant}", formaterDzd(p.valeur));
}

export function PointsAttention({
  points,
  onOuvrirJournal,
}: {
  readonly points: readonly PointAttention[];
  readonly onOuvrirJournal: () => void;
}): React.JSX.Element | null {
  if (points.length === 0) return null;

  const t = fr.finances.attention;

  return (
    <section className="flex flex-col gap-3" aria-label={t.titre}>
      <h2 className="font-ui text-heading font-semibold text-ink-900">{t.titre}</h2>
      {/* Trois au maximum. La porte n'en produit pas davantage, mais la coupe
          est redite ici : une liste d'alertes qui s'allonge cesse d'être lue. */}
      {points.slice(0, 3).map((p) => (
        <PanneauInfo
          key={p.code}
          ton={p.severite === "attention" ? "attention" : "neutre"}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="font-ui text-body">{texteDe(p)}</span>
            <Bouton onClick={onOuvrirJournal}>{t[ACTIONS[p.code]]}</Bouton>
          </div>
        </PanneauInfo>
      ))}
    </section>
  );
}
