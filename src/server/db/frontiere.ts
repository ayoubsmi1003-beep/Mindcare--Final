/**
 * La frontière HTTP → SQL : validation des entrées et contrôle de démarrage.
 *
 * ⚠️ CE QUE CE FICHIER N'EST PAS. Ce n'est pas ce qui protège les données. Ce
 * qui les protège reste la RLS, le `FORCE ROW LEVEL SECURITY`, la matrice de
 * droits et le `SELECT` révoqué d'ADR-019. Un appelant qui déjouerait
 * intégralement tout ce qui suit ne lirait toujours pas la patiente d'une autre
 * praticienne, et laisserait toujours une trace d'audit.
 *
 * Ce fichier fait deux choses plus modestes, et il faut les nommer justement
 * pour ne pas se croire protégé par elles :
 *   1. il REFUSE LA RECONNAISSANCE — on ne peut pas sonder l'existence d'une
 *      fonction SQL en variant le nom dans la requête ;
 *   2. il rend la surface ÉNUMÉRABLE EN REVUE — la liste exhaustive de ce que
 *      le réseau peut atteindre tient dans un fichier engendré.
 *
 * Aucune de ces deux propriétés ne justifie d'élargir un droit en base.
 */

import { z } from "zod";

import { RELATIONS_AUTORISEES, RPC_AUTORISES } from "./allowlist.generated";
import type { Querier } from "./withCaller";

/**
 * Les valeurs scalaires que `RpcArgs` autorise. Rien d'autre ne traverse : ni
 * objet, ni tableau. Un argument structuré devrait être sérialisé
 * explicitement par le service, ce qui rend visible en revue le fait qu'on
 * envoie du JSON à une fonction SQL (`app.update_patient(p_changes jsonb)` est
 * le seul cas, et son service passe déjà une chaîne).
 */
const Scalaire = z.union([z.string().max(65_536), z.number(), z.boolean(), z.null()]);

/**
 * Les clés d'arguments. Le motif n'est pas décoratif : ces clés deviennent des
 * IDENTIFIANTS dans `fn(cle := $1)`. Elles sont certes échappées par `ident()`,
 * mais une clé qui ne ressemble pas à un nom de paramètre PostgreSQL n'a aucune
 * raison légitime d'exister, et la refuser tôt coûte moins cher que de faire
 * confiance à un seul niveau d'échappement.
 */
const CleArgument = z.string().regex(/^[a-z_][a-z0-9_]*$/, "clé d'argument invalide");

export const EntreeRpc = z.object({
  name: z.string().min(1).max(128),
  // `.record()` avec 32 clés au plus : une fonction SQL de ce dépôt en prend au
  // maximum une poignée. La borne existe pour qu'un corps JSON gigantesque ne
  // devienne pas un coût de parcours avant même d'atteindre la base.
  args: z.record(CleArgument, Scalaire).refine((o) => Object.keys(o).length <= 32, {
    message: "trop d'arguments",
  }),
});

const Filtre = z.object({
  column: z.string().min(1).max(128),
  op: z.enum(["eq", "neq", "gt", "gte", "lt", "lte"]),
  value: Scalaire,
});

const Tri = z.object({
  column: z.string().min(1).max(128),
  ascending: z.boolean(),
});

export const EntreeSelect = z.object({
  relation: z.string().min(1).max(128),
  columns: z.array(z.string().min(1).max(128)).min(1).max(64),
  filters: z.array(Filtre).max(16).optional(),
  order: z.array(Tri).max(8).optional(),
  // 500 : au-delà, ce n'est plus un écran, c'est un export. `search_patients`
  // borne déjà à 100 EN BASE (020) ; cette borne-ci couvre les trois relations
  // lues en direct, qui n'ont pas de porte pour les borner.
  limit: z.number().int().min(1).max(500).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
});

export type EntreeRpcT = z.infer<typeof EntreeRpc>;
export type EntreeSelectT = z.infer<typeof EntreeSelect>;

/** Le nom est-il dans l'allowlist engendrée ? */
export function rpcAutorise(nom: string): boolean {
  return RPC_AUTORISES.has(nom);
}

/**
 * La relation ET toutes ses colonnes citées — y compris celles des filtres et
 * des tris. Une colonne de filtre non bornée serait un trou : `filters` finit
 * dans le SQL au même titre que `columns`.
 */
export function selectAutorise(spec: EntreeSelectT): boolean {
  const permises = RELATIONS_AUTORISEES[spec.relation];
  if (permises === undefined) return false;
  const ensemble = new Set(permises);
  for (const c of spec.columns) if (!ensemble.has(c)) return false;
  for (const f of spec.filters ?? []) if (!ensemble.has(f.column)) return false;
  for (const o of spec.order ?? []) if (!ensemble.has(o.column)) return false;
  return true;
}

/**
 * ═══ LE CONTRÔLE DE DÉMARRAGE ══════════════════════════════════════════════
 *
 * Chaque nom de l'allowlist doit EXISTER dans `pg_proc` et être exécutable par
 * `authenticated`. Ce contrôle attrape deux dérives que rien d'autre ne voit :
 *
 *   · une fonction SUPPRIMÉE ou renommée par une migration — l'écran
 *     correspondant tomberait en cours de consultation, pas au démarrage ;
 *   · un droit ÉLARGI en silence — si une fonction hors allowlist devenait
 *     exécutable, on veut le savoir ici, pas le découvrir dans un audit.
 *
 * Il est mémoïsé sur la PROMESSE, pas sur le résultat : deux requêtes qui
 * arrivent ensemble au démarrage ne doivent pas lancer deux vérifications, et
 * un échec ne doit pas être mis en cache comme un succès.
 */
let verification: Promise<void> | undefined;

export function reinitialiserVerification(): void {
  verification = undefined;
}

export async function verifierAllowlist(q: Querier): Promise<void> {
  const noms = [...RPC_AUTORISES];

  const lignes = await q.query<{ proname: string; executable: boolean }>(
    `SELECT p.proname,
            bool_or(has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS executable
       FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'app' AND p.proname = ANY($1)
      GROUP BY p.proname`,
    [noms],
  );

  const trouvees = new Map(lignes.map((l) => [l.proname, l.executable]));
  const absentes = noms.filter((n) => !trouvees.has(n));
  const nonExecutables = noms.filter((n) => trouvees.get(n) === false);

  if (absentes.length > 0 || nonExecutables.length > 0) {
    // Le message nomme les fonctions : ce sont des noms de FONCTIONS, pas des
    // données. Il part dans le journal du serveur, jamais dans une réponse HTTP.
    throw new Error(
      "Allowlist incohérente avec la base. " +
        (absentes.length > 0 ? `Absentes de pg_proc : ${absentes.join(", ")}. ` : "") +
        (nonExecutables.length > 0
          ? `Non exécutables par authenticated : ${nonExecutables.join(", ")}. `
          : "") +
        "Le serveur refuse de servir la frontière de données dans cet état.",
    );
  }

  // Les relations lues en direct doivent exister elles aussi.
  const rels = Object.keys(RELATIONS_AUTORISEES);
  const vues = await q.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'app' AND c.relname = ANY($1)`,
    [rels],
  );
  const relTrouvees = new Set(vues.map((v) => v.relname));
  const relAbsentes = rels.filter((r) => !relTrouvees.has(r));
  if (relAbsentes.length > 0) {
    throw new Error(`Relations absentes de la base : ${relAbsentes.join(", ")}.`);
  }
}

/** Enveloppe mémoïsée — une seule vérification par processus. */
export function verifierUneFois(executer: () => Promise<void>): Promise<void> {
  if (verification === undefined) {
    verification = executer().catch((e: unknown) => {
      // On efface la mémoïsation : un échec transitoire (base pas encore
      // démarrée) doit pouvoir être retenté à la requête suivante, sinon un
      // simple décalage d'ordonnancement condamnerait le processus.
      verification = undefined;
      throw e;
    });
  }
  return verification;
}
