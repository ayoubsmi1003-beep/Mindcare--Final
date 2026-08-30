/**
 * `insertion-dictee.ts` — OÙ SE POSE CE QUI VIENT D'ÊTRE DICTÉ.
 *
 * ═══ LA RÈGLE, ET ELLE N'A PAS D'EXCEPTION ═══
 *
 * ⚠️ UNE DICTÉE N'EFFACE JAMAIS RIEN. Ce module ne connaît qu'une opération :
 * INSÉRER. Il n'existe aucun chemin par lequel un texte déjà écrit puisse
 * disparaître — pas même la sélection en cours.
 *
 * C'est délibéré et contre-intuitif : dans un éditeur ordinaire, taper par
 * dessus une sélection la remplace. Ici, la « frappe » arrive d'un
 * fournisseur de transcription, plusieurs secondes après le geste, sur un
 * champ que la praticienne a pu re-sélectionner entre-temps. Faire disparaître
 * un paragraphe clinique parce qu'il se trouvait sélectionné quand la
 * transcription est revenue serait une perte de documentation causée par un
 * micro. On insère donc TOUJOURS au DÉBUT de la sélection, jamais à sa place.
 *
 * ═══ CE QUE LE MODULE NE FAIT PAS ═══
 *
 * Il ne corrige pas, ne reformule pas, ne ponctue pas, ne classe pas le texte
 * dans une autre rubrique. Ce que la praticienne a dit arrive tel que le
 * fournisseur l'a rendu ; la relecture lui appartient (règle 7 : la machine
 * propose, l'humaine dispose).
 */

export interface InsertionDictee {
  /** Le contenu complet du champ après insertion. */
  readonly texte: string;
  /** Où poser le curseur ensuite — juste après le texte inséré. */
  readonly curseur: number;
}

/** Faut-il un séparateur entre `gauche` et `droite` ? */
function separateur(gauche: string, droite: string): string {
  if (gauche === "" || droite === "") return "";
  const finDeLigne = /\s$/.test(gauche);
  const debutDeLigne = /^\s/.test(droite);
  if (finDeLigne || debutDeLigne) return "";
  // Une fin de phrase appelle un retour à la ligne : deux paragraphes dictés
  // à la suite doivent rester deux paragraphes.
  return /[.!?…]$/.test(gauche.trimEnd()) ? "\n" : " ";
}

/**
 * Insère `ajout` dans `existant` à la position `curseur`.
 *
 * @param curseur position d'insertion, ou `null` quand elle est inconnue —
 *   le champ n'a jamais reçu le focus, ou le navigateur ne la rend pas. Le
 *   texte est alors AJOUTÉ À LA FIN : c'est le seul endroit dont on soit sûr
 *   qu'il ne coupe pas une phrase en deux.
 */
export function insererDictee(
  existant: string,
  ajout: string,
  curseur: number | null,
): InsertionDictee {
  const propre = ajout.trim();
  if (propre === "") return { texte: existant, curseur: existant.length };
  if (existant === "") return { texte: propre, curseur: propre.length };

  const position =
    curseur === null || !Number.isFinite(curseur)
      ? existant.length
      : Math.max(0, Math.min(Math.trunc(curseur), existant.length));

  const gauche = existant.slice(0, position);
  const droite = existant.slice(position);

  const avant = separateur(gauche, propre);
  const apres = separateur(propre, droite);

  const texte = `${gauche}${avant}${propre}${apres}${droite}`;
  return { texte, curseur: gauche.length + avant.length + propre.length };
}
