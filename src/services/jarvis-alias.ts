/**
 * `jarvis-alias.ts` — LES NOMS DEMANDÉS, SANS SECOND CHEMIN D'ACCÈS AUX DONNÉES.
 *
 * ═══ CE FICHIER NE REQUÊTE RIEN ═══
 * Chaque entrée nomme une capacité RÉELLE du registre de lecture
 * (`jarvis-capacites.ts`) et une traduction PURE d'arguments. L'exécution reste
 * `CapaciteEnregistree.lancer` de la cible — donc sa validation Zod stricte,
 * son budget, sa délégation au service existant. Un alias qui reconstruirait
 * une requête divergerait le jour où la porte SQL change de signature, et
 * c'est le défaut qui a déjà coûté une session sur `list_agenda` (024 → 025).
 *
 * ═══ POURQUOI DES TRADUCTIONS, ET PAS DE SIMPLES RENVOIS ═══
 * Les schémas cibles sont `z.strictObject` : toute clé inconnue échoue la
 * validation AVANT toute lecture. Un modèle qui propose `{date_from, date_to}`
 * là où la cible attend `{du, au}` doit voir ses clés renommées ici, sinon
 * l'alias ne servirait qu'à produire des `regle-metier`. La traduction ne fait
 * que RENOMMER et ÉLAGUER des clés — jamais inventer une valeur, jamais
 * appeler un service.
 *
 * ═══ SENS UNIQUE DES IMPORTS ═══
 * Ce fichier n'importe RIEN de `jarvis-capacites.ts` : c'est ce dernier qui
 * l'importe pour résoudre les alias dans `capaciteLecture()`. L'inverse
 * créerait un cycle, et la boucle (`jarvis-boucle.ts`) reste intacte — elle
 * continue d'appeler `capaciteLecture`, qui connaît désormais les alias.
 */

export interface AliasCapacite {
  /** Le nom RÉEL dans le registre de lecture — jamais un nom d'alias. */
  readonly cible: string;
  /** Renomme et élague les clés. Pure : aucun accès données, aucune valeur inventée. */
  readonly traduire: (args: unknown) => unknown;
}

function estObjet(args: unknown): args is Record<string, unknown> {
  return typeof args === "object" && args !== null && !Array.isArray(args);
}

/**
 * Ne garde que les clés attendues, en prenant la première variante présente.
 * Une clé absente reste absente : c'est le schéma Zod de la cible qui tranche,
 * pas une valeur par défaut posée ici.
 */
function choisir(
  args: unknown,
  variantes: Readonly<Record<string, readonly string[]>>,
): unknown {
  if (!estObjet(args)) return args;
  const sortie: Record<string, unknown> = {};
  for (const [cle, noms] of Object.entries(variantes)) {
    for (const nom of noms) {
      const valeur: unknown = args[nom];
      if (valeur !== undefined) {
        sortie[cle] = valeur;
        break;
      }
    }
  }
  return sortie;
}

const versVide = (args: unknown): unknown => choisir(args, {});

export const ALIAS_CAPACITES: Readonly<Record<string, AliasCapacite>> = {
  get_agenda: {
    cible: "get_agenda_range",
    traduire: (args) => choisir(args, { du: ["du", "date_from"], au: ["au", "date_to"] }),
  },
  get_next_appointment: { cible: "get_next_patient", traduire: versVide },
  search_patient: {
    cible: "search_patients",
    traduire: (args) => choisir(args, { query: ["query", "q"] }),
  },
  get_patient_summary: {
    cible: "get_patient_context",
    traduire: (args) => choisir(args, { patientId: ["patientId", "patient_id", "id"] }),
  },
  get_finance_overview: {
    cible: "get_period_revenue",
    traduire: (args) => choisir(args, { periode: ["periode", "period"] }),
  },
  get_pending_payments: {
    cible: "get_outstanding_payments",
    traduire: (args) => choisir(args, { jour: ["jour", "date"] }),
  },
  get_attention_items: { cible: "get_notifications", traduire: versVide },
};

/**
 * Les noms demandés qui N'EXISTAIENT PAS — phases 2+ du plan Alexa.
 *
 * Phase 2 LIVRÉE : `get_consultation_history`, `get_current_medications` et
 * `get_patient_financial_summary` sont désormais des capacités RÉELLES du
 * registre de lecture, pas des alias. La liste est donc vide — elle reste en
 * place pour documenter les noms encore à venir, s'il y en a.
 */
export const PHASE2_NON_OFFERTS: readonly string[] = [];

export function estEnPhase2(nom: string): boolean {
  return PHASE2_NON_OFFERTS.includes(nom);
}
