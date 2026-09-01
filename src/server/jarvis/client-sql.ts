/**
 * `clientSql` — la forme `{ data, error }` de supabase-js, au-dessus de `pg`.
 *
 * ═══ POURQUOI IMITER UNE FORME QU'ON VIENT D'ABANDONNER ════════════════════
 *
 * `jarvis-resume-cas` et `jarvis-analyze-session` enchaînent chacune quatre à
 * six `client.rpc(...)` dont ils lisent `{ data, error }`. Réécrire ces
 * enchaînements en style `Result` toucherait des centaines de lignes de logique
 * CLINIQUE — construction du contexte de cas, validation zod des sections,
 * garde-fous de citation — c'est-à-dire précisément le code que le portage doit
 * laisser tranquille.
 *
 * Ce module rend donc la même forme, au-dessus de `withCaller`. Les deux
 * fonctions gardent leur corps ; seule la fabrique du client change. C'est ce
 * que le plan appelle « transformation mécanique », et c'est ce qui rend le
 * diff relisible.
 *
 * ═══ UNE TRANSACTION PAR APPEL, ET C'EST VOULU ═════════════════════════════
 *
 * Chaque `.rpc()` ouvre sa propre transaction, comme chaque appel PostgREST
 * ouvrait sa propre requête. On aurait pu envelopper toute la fonction dans UNE
 * transaction — c'est tentant, et ce serait un défaut :
 *
 *   · ces fonctions appellent un LLM ENTRE deux `rpc`. Une transaction ouverte
 *     pendant la génération tiendrait ses verrous pendant des dizaines de
 *     secondes, et immobiliserait une connexion du pool ;
 *   · la sémantique changerait sans que personne l'ait demandé. Aujourd'hui,
 *     `save_case_summary_sections` est atomique À ELLE SEULE — l'atomicité vit
 *     DANS la fonction Postgres (règle 5), pas dans l'appelant.
 *
 * On conserve donc exactement le découpage transactionnel d'avant.
 */

import { faireePgPort } from "@/server/db/pgPort";
import { withCaller } from "@/server/db/withCaller";
import type { RpcArgs, ScalarValue } from "@/services/db/port";
import type { AppError } from "@/services/errors";

/**
 * Les arguments acceptés — PLUS LARGES que `RpcArgs`, et il le faut.
 *
 * `complete_jarvis_turn(p_outil jsonb)` reçoit un OBJET. PostgREST le
 * sérialisait pour nous ; `pg` ne le fait pas, et `RpcArgs` n'admet que des
 * scalaires. On accepte donc l'objet ici et on le sérialise juste avant
 * l'appel : PostgreSQL infère `jsonb` depuis la position du paramètre.
 */
export type ArgsJarvis = Readonly<Record<string, unknown>>;

function scalariser(args: ArgsJarvis): RpcArgs {
  const out: Record<string, ScalarValue> = {};
  for (const [cle, valeur] of Object.entries(args)) {
    if (
      valeur === null ||
      typeof valeur === "string" ||
      typeof valeur === "number" ||
      typeof valeur === "boolean"
    ) {
      out[cle] = valeur;
      continue;
    }
    if (valeur === undefined) continue; // clé absente = valeur par défaut SQL
    out[cle] = JSON.stringify(valeur);
  }
  return out;
}

/**
 * Même typage que `supabase-js` : `data` est ce que la fonction rend, et
 * l'appelant le précise (ou le transtype). C'est nécessaire parce que la forme
 * DÉPEND de la fonction appelée — un tableau de lignes pour une `SETOF`, un
 * booléen pour `append_jarvis_turn`. Un type unique mentirait sur l'un des deux.
 */
export interface ReponseRpc<T = unknown> {
  readonly data: T | null;
  readonly error: AppError | null;
}

export interface ClientSql {
  readonly rpc: <T = unknown>(nom: string, args?: ArgsJarvis) => Promise<ReponseRpc<T>>;
}

/**
 * ⚠️ LE DÉTAIL QUI FAISAIT PERDRE DES TOURS DE CONVERSATION EN SILENCE.
 *
 * PostgREST distingue deux cas selon le TYPE DE RETOUR de la fonction :
 *   · `RETURNS SETOF` / `RETURNS TABLE` → un tableau de lignes ;
 *   · `RETURNS boolean` (ou tout scalaire) → LA VALEUR, pas un tableau.
 *
 * `app.append_jarvis_turn` et `app.complete_jarvis_turn` rendent `boolean`, et
 * les appelants écrivent `data === true`. Un adaptateur qui rendrait toujours
 * des lignes ferait donc échouer cette comparaison À CHAQUE FOIS : les deux
 * fonctions rendraient `false`, `persiste:false` partirait dans l'événement
 * final, et AUCUN tour de conversation ne serait enregistré — sans la moindre
 * erreur, puisque ces portes dégradent gracieusement par conception.
 *
 * On reproduit donc la règle de PostgREST. Le signal est fiable :
 * `SELECT * FROM app.fn(...)` sur une fonction scalaire rend UNE ligne d'UNE
 * colonne, nommée COMME LA FONCTION. Une fonction TABLE qui rendrait par
 * hasard une seule colonne ne porterait pas ce nom-là.
 */
function deplierScalaire(nom: string, lignes: readonly unknown[]): unknown {
  if (lignes.length !== 1) return lignes;
  const ligne = lignes[0];
  if (ligne === undefined) return lignes;
  // `faireePgPort` déplie déjà les scalaires pour la frontière HTTP (DbPort) :
  // un booléen arrive ici comme `[true]` et non comme `[{fn: true}]`. On le
  // rend scalaire pour les appelants qui écrivent `data === true`.
  if (ligne === null || typeof ligne !== "object") return ligne;
  const cles = Object.keys(ligne);
  if (cles.length !== 1 || cles[0] !== nom) return lignes;
  return (ligne as Record<string, unknown>)[nom];
}

/**
 * Construit un client lié à UNE identité.
 *
 * ⚠️ `userId` vient de `resolve_session(cookie)`, jamais du corps de la requête.
 * C'est ce qui fait que la RLS arbitre ces appels exactement comme elle
 * arbitrait ceux du navigateur : les portes voient `auth.uid()`, et une
 * praticienne ne peut pas faire résumer le dossier d'une patiente qui n'est pas
 * la sienne — même en passant l'identifiant à la main.
 */
export function clientSql(userId: string): ClientSql {
  return {
    rpc: async <T = unknown>(nom: string, args: ArgsJarvis = {}): Promise<ReponseRpc<T>> => {
      try {
        const r = await withCaller(userId, async (q) => {
          const port = faireePgPort(q, `jarvis.${nom}`);
          return port.rpc<Record<string, unknown>>(nom, scalariser(args));
        });
        if (!r.ok) return { data: null, error: r.error };
        // `deplierScalaire` rend soit la valeur scalaire, soit les lignes ;
        // les appelants lisent l'une ou l'autre selon la fonction, exactement
        // comme du temps de PostgREST.
        return { data: deplierScalaire(nom, r.data) as T, error: null };
      } catch (brut) {
        // `withCaller` ne lève que si la connexion est perdue. On rend la même
        // forme que pour un échec applicatif : l'appelant n'a pas à distinguer,
        // et surtout il ne doit pas avoir à écrire un `try/catch` de plus.
        return {
          data: null,
          error: {
            code: "indisponible",
            message: "Le service de données est momentanément indisponible.",
            context: `jarvis.${nom}`,
            ...(brut !== undefined && { cause: brut }),
          },
        };
      }
    },
  };
}
