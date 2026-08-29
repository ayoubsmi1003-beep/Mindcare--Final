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
 *
 * ═══ v9 — LA COULEUR A UN RÔLE, PAS UNE HUMEUR ═════════════════════════════
 *
 * Quatre tuiles blanches portent leur famille en PASTILLE (marque pour les
 * encaissements, ambre pour les charges) ; la tuile ANCRE — le résultat net,
 * le chiffre que l'œil cherche en premier — prend le dégradé de marque
 * (`--grad-tile-brand`) et l'encre blanche unique. Aucune valeur clinique ou
 * nominative ne repose sur le dégradé : une tuile compte, elle ne décrit
 * personne (§4.2). Le signe du résultat reste LISIBLE dans la valeur elle-même
 * (« -12 500 DZD ») — sur un fond de marque, la hiérarchie ne se fait jamais
 * en baissant le contraste.
 */

import { fr } from "@/i18n/fr";
import { Icone, type NomIcone } from "@/components/ui/Icones";
import { formaterDzd, type Pulse } from "@/services/finance-cash";

function Tuile({
  etiquette,
  aide,
  valeur,
  sousLigne,
  icone,
  ancre = false,
}: {
  readonly etiquette: string;
  readonly aide: string;
  readonly valeur: string;
  readonly sousLigne: string;
  /** Absent sur la tuile ancre : le dégradé de marque la signale déjà. */
  readonly icone?: NomIcone;
  readonly ancre?: boolean;
}): React.JSX.Element {
  if (ancre) {
    /* LA TUILE ANCRE — le dégradé de marque, l'encre blanche pure. Elle se
     * trouve sans être lue ; les quatre autres restent au même niveau entre
     * elles — hiérarchiser tout revient à ne rien hiérarchiser. */
    return (
      <div className="flex min-w-0 flex-col justify-between gap-2 rounded-lg bg-brand-800 px-4 py-3 shadow-lift1">
        <p
          className="truncate font-ui text-label font-medium text-on-brand"
          title={aide}
        >
          {etiquette}
        </p>
        {/* ⚠️ `text-title` POUR LES CINQ, ANCRE COMPRISE. Mesuré : à
            `text-display` (30 px), « -142 500 DZD » ne tient pas dans une
            tuile d'un cinquième de largeur et sortait tronqué. Un montant
            tronqué est pire qu'un montant plus petit : il se lit comme un
            autre montant. L'ancre se distingue par le FOND, la GRAISSE et la
            pastille, pas par une taille qui ne tient pas. */}
        <p className="font-num truncate text-title font-semibold tabular-nums text-on-brand">
          {valeur}
        </p>
        <p className="truncate font-ui text-label text-on-brand">{sousLigne}</p>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-col justify-between gap-2 rounded-lg border border-rule bg-card px-4 py-3 shadow-lift1 transition duration-quick ease-soft hover:shadow-lift2">
      <div className="flex items-center justify-between gap-2">
        <p
          className="truncate font-ui text-label font-medium text-ink-500"
          title={aide}
        >
          {etiquette}
        </p>
        {/* La pastille porte la FAMILLE (encaissement = marque, charge =
            ambre), jamais un statut. Elle double l'étiquette écrite — la
            couleur n'est pas le seul porteur (§4 règle 4). L'icône des
            charges est une page : une pièce de papier, pas un avertissement —
            une charge n'est pas une alerte, c'est un axe comptable. */}
        {icone === undefined ? null : (
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md",
              icone === "documents"
                ? "bg-attention-bg text-attention-ink"
                : "bg-action-100 text-action-600",
            ].join(" ")}
          >
            <Icone nom={icone} taille={16} />
          </span>
        )}
      </div>
      <p className="font-num truncate text-title font-semibold tabular-nums text-ink-900">
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
        icone="horloge"
      />
      <Tuile
        etiquette={t.semaine}
        aide={t.semaineAide}
        valeur={formaterDzd(pulse.revenu_semaine)}
        sousLigne={panier}
        icone="finances"
      />
      <Tuile
        etiquette={t.mois}
        aide={t.moisAide}
        valeur={formaterDzd(pulse.revenu_mois)}
        sousLigne={seances}
        icone="statistiques"
      />
      <Tuile
        etiquette={t.charges}
        aide={t.chargesAide}
        valeur={formaterDzd(pulse.charges_periode)}
        sousLigne={charges}
        icone="documents"
      />
      <Tuile
        etiquette={t.resultatNet}
        aide={t.resultatNetAide}
        valeur={formaterDzd(pulse.resultat_net_periode)}
        sousLigne={seances}
        ancre
      />
    </div>
  );
}
