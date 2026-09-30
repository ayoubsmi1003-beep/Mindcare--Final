/**
 * LES ÉCHELLES — de l'arithmétique pure, sans React ni DOM.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POURQUOI UN FICHIER À PART
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * L'échelle était une fonction privée de `Graphes.tsx`, ce qui la rendait
 * intestable : la seule façon de prouver qu'un axe affiche des graduation rondes
 * était de le regarder à l'écran. Extraite ici, elle se teste en arithmétique —
 * et `Graphes.tsx`, déjà long, perd un bloc.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * LE DÉFAUT CORRIGÉ
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * L'ancienne `echelleSignee` posait le plafond à `haut + étendue × 12 %`, puis
 * interpolait CINQ graduations entre le plafond et le plancher. Sur l'« Évolution »
 * réelle (six mois, quatre à zéro, un mois très déficitaire) l'axe affichait
 *
 *     185 380 · 101 660 · 17 940 · −65 780 · −149 500
 *
 * Aucun de ces nombres n'est rond, donc aucun saut ne se lit d'un coup d'œil.
 * Pire : le domaine englobait la LIGNE, qui est une différence et peut être
 * négative, alors que les deux BARRES ne peuvent pas l'être. Un mois
 * déficitaire étirait donc l'aire vers le bas et écrasait les deux séries qui, elles,
 * ont besoin d'une comparaison de hauteurs exacte.
 *
 * D'où deux échelles distinctes, et non un simple réglage de la même :
 *
 *   · `echelleBarres` — domaine strictement positif, graduations rondes.
 *   · `echelleNette` — domaine signé et symétrique autour de zéro, parce qu'un
 *     écart à l'équilibre se lit dans les deux sens.
 */

/** Les multiplicatifs « jolis » : 1, 2, 2,5, 5, 10. */
const MULTIPLICATIFS = [1, 2, 2.5, 5, 10] as const;

/**
 * Le pas de graduation le plus petit possible qui couvre encore `cible`.
 *
 * Un pas dix fois trop grand donnerait deux repères sur toute la hauteur et
 * l'axe perdrait son rôle de règle ; un pas lui-même arbitraire (46 345) est
 * illisible. D'où la double contrainte, que `pasJoli` respecte par construction.
 *
 * Fonction GÉNÉRIQUE : elle ignore que l'on parle de dinars. C'est
 * `graduations` qui impose le pas entier, parce que c'est elle qui dessine un
 * axe de montants.
 */
export function pasJoli(cible: number): number {
  if (!(cible > 0)) return 1;
  const decade = 10 ** Math.floor(Math.log10(cible));
  const multiplicatif = MULTIPLICATIFS.find((m) => m >= cible / decade);
  return (multiplicatif ?? 10) * decade;
}

/**
 * Les graduations d'un axe, du plus petit au plus grand, en montants ronds.
 *
 * @param cible Nombre d'intervalles souhaités — quatre par défaut, ce qui donne
 *   cinq repères : la densité de la maquette, et la seule qui reste lisible
 *   dans une gouttière de 64 px.
 *
 * ⚠️ LE PAS EST UN ENTIER. `amount_dzd` est un `integer` : un repère de « 0,5 »
 * afficherait un demi-dinar, et deux repères voisins se formateraient à
 * l'identique sous `maximumFractionDigits: 0`.
 */
export function graduations(min: number, max: number, cible = 4): readonly number[] {
  const n = Math.max(1, Math.floor(cible));
  const pas = Math.max(1, pasJoli((Math.max(max, min) - Math.min(min, 0)) / n));

  // ⚠️ `Math.floor` ET `Math.ceil`, jamais un arrondi au plus proche : une
  // graduation doit ENCADRER les données, jamais en couper une en deux.
  const bas = Math.floor(Math.min(min, 0) / pas) * pas;
  let haut = Math.ceil(Math.max(max, 0) / pas) * pas;
  if (haut <= bas) haut = bas + pas;

  // Indexé, pas accumulé : `bas + pas + pas + …` dérive en virgule flottante,
  // et l'on verrait « 149 999,999998 » au lieu de « 150 000 ».
  const nombre = Math.round((haut - bas) / pas);
  return Array.from({ length: nombre + 1 }, (_, i) => bas + i * pas);
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LES BARRES — un domaine strictement positif
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface EchelleBarres {
  /** Ordonnée d'une valeur, en % depuis le HAUT de l'aire de tracé. */
  readonly y: (valeur: number) => number;
  /** Le plancher : TOUJOURS 0. Une recette ou une charge ne peut pas être négative. */
  readonly bas: 0;
  readonly plafond: number;
}

/**
 * L'échelle des deux séries de barres, sur un domaine positif commun.
 *
 * ⚠️ UN SEUL DOMAINE POUR LES DEUX SÉRIES. Deux échelles distinctes feraient
 * paraître 8 000 DZD de charges plus haut que 40 000 DZD de recette — l'erreur
 * de lecture la plus coûteuse qu'un graphique d'argent puisse produire. La
 * symétrie est donc ici un prix à payer, pas un oubli.
 *
 * ⚠️ LE PLAFOND LAISSE UN CRAN DE RESPIRATION. Arrondi au pas, il vaudrait
 * exactement la valeur maximale pour une série ronde, et la barre la plus haute
 * toucherait le bord supérieur : elle se lirait comme un débordement du cadre
 * plutôt que comme un maximum. D'où le cran supplémentaire.
 */
export function echelleBarres(
  valeurs: readonly number[],
  cible = 4,
): EchelleBarres {
  let max = 0;
  for (const v of valeurs) if (v > max) max = v;

  const pas = Math.max(1, pasJoli(max / Math.max(1, cible)));
  const arrondi = Math.ceil(max / pas) * pas;
  const plafond = arrondi > max ? arrondi : arrondi + pas;

  return {
    y: (valeur: number): number => ((plafond - valeur) * 100) / plafond,
    bas: 0,
    plafond,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LE RÉSULTAT NET — un domaine signé, symétrique autour de zéro
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface EchelleNette {
  /** Ordonnée d'une valeur, en % depuis le HAUT de la bande. */
  readonly y: (valeur: number) => number;
  /** L'ordonnée de l'équilibre, en % depuis le haut. Toujours 50 par symétrie. */
  readonly zero: number;
  readonly plafond: number;
  readonly plancher: number;
}

/**
 * L'échelle de la ligne de résultat net, dans SA PROPRE bande.
 *
 * ⚠️ SYMÉTRIQUE AUTOUR DE ZÉRO, même quand les données ne le sont pas. Sur
 * −130 000 contre +40 000, une échelle ajustée aux données mettrait l'équilibre
 * à 23 % de la bande : tous les mois favorables se tasseraient en haut, et
 * l'œil lirait « bon mois » là où il n'y a qu'un résultat médiocre. La symétrie
 * garde l'équilibre au milieu, donc l'écart se lit dans les deux sens.
 *
 * ⚠️ LES NÉGATIFS SONT HONORÉS, ET VISIBLES. Une version antérieure écrasait les
 * valeurs négatives à zéro : la ligne se couchait sur l'axe et un mois
 * déficitaire se lisait comme un mois à l'équilibre. Sur un graphique d'argent,
 * c'est un mensonge.
 */
export function echelleNette(valeurs: readonly number[], cible = 4): EchelleNette {
  let maxi = 0;
  let mini = 0;
  for (const v of valeurs) {
    if (v > maxi) maxi = v;
    if (v < mini) mini = v;
  }

  const portee = Math.max(Math.abs(maxi), Math.abs(mini));
  const pas = Math.max(1, pasJoli((portee * 2) / Math.max(1, cible)));
  const arrondi = Math.ceil(portee / pas) * pas;
  const demi = arrondi > portee ? arrondi : arrondi + pas;

  return {
    y: (valeur: number): number => ((demi - valeur) * 100) / (demi * 2),
    zero: 50,
    plafond: demi,
    plancher: -demi,
  };
}
