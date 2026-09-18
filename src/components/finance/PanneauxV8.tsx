"use client";

/**
 * LES FINANCES — V8 « Aurora ». L'écran le plus analytique du produit.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE QUI EST REMPLACÉ, ET CE QUI SURVIT
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * REMPLACÉ : la géométrie. `PanneauEvolution` dessinait ses barres en blocs
 * HTML positionnés en pourcentage et `PanneauAnatomie` listait deux séries de
 * barres horizontales. Les deux marchaient ; les deux étaient les seules
 * formes du produit, réinventées sur place, sans rien à partager avec le
 * tableau de bord ni avec les écrans à venir.
 *
 * SURVIT : tout le raisonnement. L'échelle signée qui honore les négatifs,
 * l'axe UNIQUE pour recette et charges, l'interdiction de recalculer un
 * pourcentage côté client, le tableau équivalent pour les lecteurs d'écran.
 * Ces règles ont migré dans `components/ui/Graphes.tsx`, où elles servent
 * désormais six formes au lieu d'une.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠️ AUCUNE ARITHMÉTIQUE MÉTIER DANS CE FICHIER
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Aucun `.reduce`, aucune somme, aucune division. Tous les montants et tous
 * les pourcentages arrivent calculés par `app.get_finance_overview`. Ce
 * fichier FORMATE et COMPOSE.
 *
 * `part_pct` en particulier vient de SQL, et c'est une correction déjà payée :
 * une version antérieure calculait `(montant * 100) / total` en JavaScript, ce
 * qui produisait un pourcentage pouvant diverger du total affiché juste à côté
 * — deux arrondis, deux vérités, sur un écran d'argent.
 */

import {
  Aire,
  Anneau,
  BarresGroupees,
  type GroupeBarres,
  type PartAnneau,
  type PointSerie,
} from "@/components/ui/Graphes";
import { Tuile, TuileVedette } from "@/components/ui/Tuile";
import { fr } from "@/i18n/fr";
import {
  formaterDzd,
  type JourCaisse,
  type PartCharge,
  type PartRevenu,
  type Pulse,
  type SeauMois,
} from "@/services/finance-cash";

/* ═══════════════════════════════════════════════════════════════════════════
 * LE POULS — cinq tuiles
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Les étincelles de ce pouls sont RÉELLES.
 *
 * ⚠️ ELLES VIENNENT DE `apercu.calendrier`, la série journalière que la porte
 * rend déjà pour la bande du bas — pas d'une courbe fabriquée pour meubler la
 * tuile. C'est la distinction qui compte : une étincelle inventée serait une
 * donnée fictive au sens de la règle 8, et sur un écran d'argent elle serait
 * lue comme une tendance.
 *
 * Les tuiles dont aucune série ne décrit l'agrégat n'en portent aucune. « Ce
 * mois » et « Charges » sont des totaux de période, et il n'existe aucune
 * série journalière de CHARGES dans le contrat de lecture : leur place reste
 * vide plutôt que remplie de faux.
 */
export function PoulsV8({
  pulse,
  calendrier,
}: {
  readonly pulse: Pulse;
  readonly calendrier: readonly JourCaisse[];
}): React.JSX.Element {
  const t = fr.finances.pulse;

  const serieJournaliere = calendrier.map((j) => j.montant);

  const seances =
    pulse.nb_seances_periode === 0
      ? t.aucuneSeance
      : pulse.nb_seances_periode === 1
        ? t.uneSeance
        : t.seances.replace("{n}", String(pulse.nb_seances_periode));

  // Sans séance, le panier moyen est NULL — la porte le rend ainsi exprès.
  // « — », jamais 0 : zéro serait un chiffre faux, et NaN un défaut.
  const panier =
    pulse.panier_moyen === null
      ? t.absent
      : t.panierMoyen.replace("{montant}", formaterDzd(pulse.panier_moyen));

  // ⚠️ COMPTÉ EN SQL (migration 041). Cette sous-ligne se déduisait autrefois
  // du nombre de CATÉGORIES de charges : cinq charges sur quatre catégories
  // affichaient « 4 charges récurrentes ». Le nombre comptait autre chose que
  // ce que son étiquette annonçait.
  const charges =
    pulse.nb_charges_recurrentes === 1
      ? t.uneChargeRecurrente
      : t.chargesRecurrentes.replace("{n}", String(pulse.nb_charges_recurrentes));

  return (
    <div className="grid grid-cols-deux items-stretch gap-4 tablet:grid-cols-trois desktop:grid-cols-pouls">
      <Tuile
        ton="menthe"
        icone="horloge"
        etiquette={t.aujourdhui}
        aide={t.aujourdhuiAide}
        valeur={formaterDzd(pulse.revenu_aujourdhui)}
        sousLigne={seances}
        serie={serieJournaliere}
      />
      <Tuile
        ton="azur"
        icone="finances"
        etiquette={t.semaine}
        aide={t.semaineAide}
        valeur={formaterDzd(pulse.revenu_semaine)}
        sousLigne={panier}
        serie={serieJournaliere.slice(-7)}
      />
      <Tuile
        ton="lavande"
        icone="statistiques"
        etiquette={t.mois}
        aide={t.moisAide}
        valeur={formaterDzd(pulse.revenu_mois)}
        sousLigne={seances}
      />
      <Tuile
        ton="ambre"
        icone="documents"
        etiquette={t.charges}
        aide={t.chargesAide}
        valeur={formaterDzd(pulse.charges_periode)}
        sousLigne={charges}
      />
      {/* LA VEDETTE — le résultat net, le chiffre que l'œil cherche en
          premier. Une seule par écran. Le SIGNE reste lisible dans la valeur
          elle-même (« -51 000 DZD ») : sur un fond de marque, la hiérarchie ne
          se fait jamais en baissant le contraste, et il n'existe pas de rouge
          ici — le rouge est un budget réservé à la perte de donnée (§4
          règle 1). Un mois déficitaire n'est pas un incident, c'est un fait
          comptable. */}
      <TuileVedette
        materiau="nuit"
        icone="statistiques"
        etiquette={t.resultatNet}
        aide={t.resultatNetAide}
        valeur={formaterDzd(pulse.resultat_net_periode)}
        sousLigne={seances}
      />
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * L'ÉVOLUTION — six mois
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ MENSUEL, ET PAS JOURNALIER — la décision de V6, toujours valable. Un
 * graphe par jour affichait, sur un mois à ~5 séances dont 2 encaissées, deux
 * barres et vingt-neuf emplacements vides. Ce n'était pas une période creuse :
 * c'était le mauvais GRAIN. Six mois est la plus petite fenêtre où une
 * tendance de cabinet devient visible.
 */
export function EvolutionV8({ serie }: { readonly serie: readonly SeauMois[] }): React.JSX.Element {
  const t = fr.finances.evolution;

  const groupes: GroupeBarres[] = serie.map((s) => ({
    cle: s.mois_iso,
    label: s.mois_label.slice(0, 4),
    a: s.revenu,
    b: s.charges,
    ligne: s.resultat_net,
    aLisible: formaterDzd(s.revenu),
    bLisible: formaterDzd(s.charges),
    ligneLisible: formaterDzd(s.resultat_net),
  }));

  return (
    <BarresGroupees
      groupes={groupes}
      familleA="emeraude"
      familleB="ambre"
      libelleA={t.legendeRevenu}
      libelleB={t.legendeCharges}
      libelleLigne={t.legendeNet}
      titreTableau={t.tableau}
      colonneLabel={t.colonneMois}
    />
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA COMPOSITION — deux anneaux
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * D'où vient l'argent, où il part.
 *
 * DEUX ANNEAUX SÉPARÉS, jamais un seul : une recette et une dépense ne se
 * comparent pas sur la même circonférence. Les fondre donnerait un camembert
 * dont la moitié serait un signe et l'autre moitié l'inverse.
 *
 * Le centre porte le TOTAL DE LA FAMILLE, qui arrive du pouls — pas une somme
 * recalculée sur les parts affichées. Les deux pourraient diverger d'un dinar
 * par arrondi, et l'écart serait affiché à quinze pixels de son origine.
 */
export function CompositionV8({
  revenus,
  charges,
  totalRevenus,
  totalCharges,
}: {
  readonly revenus: readonly PartRevenu[];
  readonly charges: readonly PartCharge[];
  readonly totalRevenus: number;
  readonly totalCharges: number;
}): React.JSX.Element {
  const t = fr.finances.anatomie;

  const partsRevenus: PartAnneau[] = revenus.map((r) => ({
    cle: r.cle,
    label: libelleType(r.libelle === "" ? r.cle : r.libelle),
    pct: r.part_pct,
    valeurLisible: formaterDzd(r.montant),
  }));

  const partsCharges: PartAnneau[] = charges.map((c) => ({
    cle: c.cle,
    label: libelleCategorie(c.libelle === "" ? c.cle : c.libelle),
    pct: c.part_pct,
    valeurLisible: formaterDzd(c.montant),
  }));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        <h3 className="font-ui text-label font-bold uppercase tracking-eyebrow text-ink-500">
          {t.revenus}
        </h3>
        {partsRevenus.length === 0 ? (
          <p className="font-ui text-body text-ink-500">{t.aucunRevenu}</p>
        ) : (
          <Anneau
            parts={partsRevenus}
            centreValeur={formaterDzd(totalRevenus)}
            centreLibelle={t.centreRecettes}
            titreTableau={t.revenus}
            colonneLabel={fr.graphes.colonnePart}
            colonneValeur={fr.graphes.colonneMontant}
          />
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3 border-t border-rule pt-6">
        <h3 className="font-ui text-label font-bold uppercase tracking-eyebrow text-ink-500">
          {t.charges}
        </h3>
        {partsCharges.length === 0 ? (
          <p className="font-ui text-body text-ink-500">{t.aucuneCharge}</p>
        ) : (
          <Anneau
            parts={partsCharges}
            centreValeur={formaterDzd(totalCharges)}
            centreLibelle={t.centreCharges}
            titreTableau={t.charges}
            colonneLabel={fr.graphes.colonnePart}
            colonneValeur={fr.graphes.colonneMontant}
          />
        )}
      </div>
    </div>
  );
}

/** Libellés lisibles : la base rend des clés d'enum, jamais du français. */
function libelleType(cle: string): string {
  if (cle === "__non_rattache__") return fr.finances.anatomie.nonRattache;
  const mot = cle.replace(/_/g, " ");
  return mot.charAt(0).toUpperCase() + mot.slice(1);
}

function libelleCategorie(cle: string): string {
  const table = fr.finances.categories as Record<string, string | undefined>;
  return table[cle] ?? cle;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA SÉRIE JOURNALIÈRE — l'aire dominante
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * L'argent encaissé, jour par jour, sur la période choisie.
 *
 * Elle remplace la bande de cases du bas de l'écran V6 — une carte de chaleur
 * sur 31 cellules, qui disait « plus » ou « moins » sans jamais dire COMBIEN.
 * Une aire dit les deux : la forme donne la tendance, l'infobulle donne le
 * chiffre exact du jour visé.
 *
 * ⚠️ LE LIBELLÉ D'AXE EST LE QUANTIÈME SEUL (« 14 »), pas la date complète.
 * Sur 31 points, « 14/08/2026 » écrit trente et une fois est illisible ; le
 * mois est déjà dans le sélecteur de période, en haut de l'écran, et la date
 * complète reste dans l'infobulle et dans le tableau équivalent.
 */
export function SerieJournaliereV8({
  jours,
}: {
  readonly jours: readonly JourCaisse[];
}): React.JSX.Element {
  const t = fr.finances.calendrier;

  const points: PointSerie[] = jours.map((j) => ({
    cle: j.jour_iso,
    label: j.jour_iso.slice(8, 10),
    valeur: j.montant,
    valeurLisible: (j.a_impaye ? t.celluleImpaye : t.cellule)
      .replace("{date}", j.jour_iso)
      .replace("{montant}", formaterDzd(j.montant))
      .replace("{n}", String(j.nb_seances)),
  }));

  return (
    <Aire
      points={points}
      famille="emeraude"
      /* ⚠️ `h-36` ET NON `h-48` — CORRIGÉ APRÈS CAPTURE. À 192 px, l'aire
         d'un mois où un seul jour porte un encaissement rendait un pic isolé
         au milieu de 150 px de vide : le panneau occupait un tiers de l'écran
         pour une information qui tient dans un quart. La hauteur d'une aire
         se règle sur la DENSITÉ ATTENDUE de la série, pas sur la place
         disponible. */
      hauteurClasse="h-36"
      titreTableau={t.titre}
      colonneLabel={fr.graphes.colonneJour}
      colonneValeur={fr.graphes.colonneMontant}
    />
  );
}
