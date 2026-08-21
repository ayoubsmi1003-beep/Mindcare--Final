"use client";

/**
 * Rangée 1 — LE POULS FINANCIER. Cinq tuiles, une seule ligne, ~130 px.
 *
 * ═══ CE QUI A ÉTÉ RETIRÉ, ET POURQUOI ══════════════════════════════════════
 *
 * L'écran précédent empilait quatre cartes PLEINE LARGEUR, chacune suivie d'un
 * paragraphe explicatif. Quatre chiffres coûtaient ~1000 px de défilement, et
 * la médecin devait faire défiler pour voir son quatrième indicateur.
 *
 * Les phrases n'ont pas disparu : elles sont devenues des INFOBULLES sur
 * l'étiquette (`title`). Une explication qu'on lit une fois n'a pas à occuper
 * l'écran tous les jours — mais la retirer complètement aurait supprimé la
 * seule définition de « ce que compte ce nombre ».
 *
 * ═══ PAS DE TUILE « IMPAYÉS » ICI, DÉLIBÉRÉMENT ════════════════════════════
 *
 * Un impayé est une EXCEPTION, pas un axe comptable. Lui donner une tuile de
 * tête le mettrait au même rang que la recette et suggérerait deux colonnes de
 * comptabilité là où il n'y en a qu'une. Il vit dans « À votre attention ».
 *
 * ═══ AUCUNE ARITHMÉTIQUE ═══════════════════════════════════════════════════
 *
 * Aucun `.reduce`, aucun `/ 100`, aucune somme. Tous les nombres arrivent
 * calculés de `app.get_finance_overview`. Ce fichier FORMATE, il ne calcule pas.
 */

import { fr } from "@/i18n/fr";
import { formaterDzd, type Pulse } from "@/services/finance-cash";

function Tuile({
  etiquette,
  aide,
  valeur,
  sousLigne,
  ancre = false,
  ton = "neutre",
}: {
  readonly etiquette: string;
  readonly aide: string;
  readonly valeur: string;
  readonly sousLigne: string;
  readonly ancre?: boolean;
  readonly ton?: "neutre" | "positif" | "negatif";
}): React.JSX.Element {
  const encre =
    ton === "positif" ? "text-positive" : ton === "negatif" ? "text-critical" : "text-ink-900";

  return (
    <div
      className={[
        "flex min-w-0 flex-col justify-between rounded-lg bg-card px-4 py-3",
        // L'ancre visuelle porte une élévation et un liseré : elle se trouve
        // sans être lue. Les quatre autres restent au même niveau entre elles —
        // hiérarchiser tout revient à ne rien hiérarchiser.
        ancre ? "shadow-lift2 ring-1 ring-brand-200" : "shadow-lift1",
      ].join(" ")}
    >
      <p
        className="truncate font-ui text-eyebrow font-medium uppercase text-ink-500"
        title={aide}
      >
        {etiquette}
      </p>
      {/* ⚠️ `text-title` POUR LES CINQ, ANCRE COMPRISE. Mesuré : à `text-display`
          (30 px), « -142 500 DZD » ne tient pas dans une tuile d'un cinquième de
          largeur et sortait tronqué — « -142 500 … ». Un montant tronqué est
          pire qu'un montant plus petit : il se lit comme un autre montant.
          L'ancre se distingue par la GRAISSE, la couleur et l'élévation, pas
          par une taille qui ne tient pas. */}
      <p
        className={[
          "font-display truncate leading-none",
          ancre ? "text-title font-semibold" : "text-title font-medium",
          encre,
        ].join(" ")}
      >
        {valeur}
      </p>
      <p className="truncate font-ui text-label text-ink-500">{sousLigne}</p>
    </div>
  );
}

export function TuilesPulse({ pulse }: { readonly pulse: Pulse }): React.JSX.Element {
  const t = fr.finances.pulse;

  const seances =
    pulse.nb_seances_periode === 0
      ? t.aucuneSeance
      : pulse.nb_seances_periode === 1
        ? t.uneSeance
        : t.seances.replace("{n}", String(pulse.nb_seances_periode));

  // Sans séance, le panier moyen est NULL — la porte le rend ainsi exprès.
  // On affiche « — », jamais 0 : zéro serait un chiffre faux, et NaN un défaut.
  const panier =
    pulse.panier_moyen === null
      ? t.absent
      : t.panierMoyen.replace("{montant}", formaterDzd(pulse.panier_moyen));

  // ⚠️ COMPTÉ EN SQL (`pulse.nb_charges_recurrentes`, migration 041). Cette
  // sous-ligne se déduisait autrefois du nombre de CATÉGORIES de charges :
  // cinq charges sur quatre catégories affichaient « 4 charges récurrentes ».
  // Le nombre comptait autre chose que ce que son étiquette annonçait.
  const charges =
    pulse.nb_charges_recurrentes === 1
      ? t.uneChargeRecurrente
      : t.chargesRecurrentes.replace("{n}", String(pulse.nb_charges_recurrentes));

  return (
    <div className="grid grid-cols-deux gap-3 tablet:grid-cols-trois desktop:grid-cols-pouls">
      <Tuile
        etiquette={t.aujourdhui}
        aide={t.aujourdhuiAide}
        valeur={formaterDzd(pulse.revenu_aujourdhui)}
        sousLigne={seances}
      />
      <Tuile
        etiquette={t.semaine}
        aide={t.semaineAide}
        valeur={formaterDzd(pulse.revenu_semaine)}
        sousLigne={panier}
      />
      <Tuile
        etiquette={t.mois}
        aide={t.moisAide}
        valeur={formaterDzd(pulse.revenu_mois)}
        sousLigne={seances}
      />
      <Tuile
        etiquette={t.charges}
        aide={t.chargesAide}
        valeur={formaterDzd(pulse.charges_periode)}
        sousLigne={charges}
      />
      <Tuile
        etiquette={t.resultatNet}
        aide={t.resultatNetAide}
        valeur={formaterDzd(pulse.resultat_net_periode)}
        sousLigne={seances}
        ancre
        // Le signe vient de la BASE (`resultat_net_periode`), pas d'une
        // soustraction refaite ici.
        ton={pulse.resultat_net_periode < 0 ? "negatif" : "positif"}
      />
    </div>
  );
}
