/**
 * `parallele.ts` — une BORNE de concurrence, sans course.
 *
 * ═══ CE QUE C'EST ═══
 * `mapLimite` applique une fonction asynchrone à chaque item en démarrant au
 * plus `limite` appels simultanés, et rend les résultats DANS L'ORDRE des
 * items — jamais dans l'ordre d'achèvement. Déterministe : mêmes items, même
 * fonction, même résultat, quel que soit l'entrelacement.
 *
 * ═══ POURQUOI PAS `Promise.all` NU ═══
 * Le pool PostgreSQL du cabinet vaut 10 connexions (`server/db/pool.ts`), et
 * chaque `rpc` ouvre sa propre transaction. Un lot non borné peut donc vider
 * le pool et affamer une lecture clinique concurrente. Ici, la borne est
 * explicite et petite.
 *
 * ═══ CE QUE CE N'EST PAS ═══
 *   · Pas un ordonnanceur : aucun retry, aucune priorité, aucune annulation
 *     implicite. L'appelant garde son `AbortSignal`.
 *   · Pas une file d'attente de modèle : l'inférence ONNX a son propre
 *     singleton (`vecteur-production.ts`, `rerank-production.ts`).
 */

/** Applique `fn` à chaque item, au plus `limite` à la fois, ordre préservé. */
export async function mapLimite<T, R>(
  items: readonly T[],
  limite: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!Number.isInteger(limite) || limite <= 0) {
    throw new Error("mapLimite : limite invalide.");
  }
  const resultats = new Array<R>(items.length);
  let prochain = 0;
  const ouvriers = Array.from({ length: Math.min(limite, items.length) }, async () => {
    for (;;) {
      const index = prochain;
      prochain += 1;
      if (index >= items.length) return;
      resultats[index] = await fn(items[index] as T, index);
    }
  });
  await Promise.all(ouvriers);
  return resultats;
}
