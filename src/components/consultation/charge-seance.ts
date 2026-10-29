/**
 * Une seule lecture de séance à la fois.
 *
 * Le dossier peut afficher plusieurs cartes de séances ; chacune a besoin de
 * `get_consultation` et `get_consultation_analysis`, deux portes journalisantes.
 * Les lancer toutes en parallèle sur un poste lent épuise le pool et transforme
 * une lecture confortable en 503. Cette file sérialise les chargements : la
 * première carte arrive vite, les suivantes suivent, et aucune requête n'est
 * perdue.
 */
let file: Promise<unknown> = Promise.resolve();

export function enqueueChargeSeance<T>(tache: () => Promise<T>): Promise<T> {
  const resultat = file.then(tache, tache);
  file = resultat.then(
    () => undefined,
    () => undefined,
  );
  return resultat;
}
