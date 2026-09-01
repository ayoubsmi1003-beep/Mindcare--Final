/**
 * La machine à états de démarrage — §H du plan.
 *
 * ⚠️ PAS DE `setTimeout` COMME SYNCHRONISATION. Chaque transition est déclenchée
 * par un ÉVÉNEMENT mesuré (une sonde a répondu, un processus s'est terminé, un
 * budget de temps est dépassé) — jamais par « attendre N secondes et espérer ».
 * C'est un défaut déjà rencontré et corrigé ailleurs dans ce dépôt
 * (`garde-origine.mjs`, `verifier-base.mjs`) ; cette machine l'évite dès sa
 * conception plutôt que de le corriger après coup.
 *
 * Ce module est un RÉDUCTEUR PUR : aucun accès disque, réseau ou processus.
 * `electron/main/orchestrateur.ts` (étapes 5 à 8 du plan) l'entoure des vraies
 * sondes (PostgreSQL, migrations, `/api/health`) et lui fait produire les
 * transitions. Le garder pur est ce qui le rend testable sans machine Windows,
 * sans PostgreSQL, sans Electron.
 */

export type Etat =
  | "BOOTING"
  | "CHECKING_RUNTIME"
  | "INITIALIZING_CLUSTER"
  | "STARTING_DATABASE"
  | "WAITING_DATABASE"
  | "RUNNING_MIGRATIONS"
  | "STARTING_BACKEND"
  | "WAITING_BACKEND"
  | "HEALTH_CHECK"
  | "READY"
  | "RECOVERY"
  | "FAILED";

export type CauseEchec =
  | "runtime-absent"
  | "version-cluster-incompatible"
  | "port-occupe"
  | "base-injoignable"
  | "migration-manquante"
  | "migration-echouee"
  | "backend-injoignable"
  | "backend-crash"
  | "sonde-sante-echouee"
  | "budget-depasse";

export interface EtatMachine {
  readonly etat: Etat;
  readonly tentativesRecuperation: number;
  readonly cause?: CauseEchec | undefined;
  readonly detail?: string | undefined;
}

/** Une seule reprise bornée (§H) : au-delà, on tombe en FAILED. */
export const BUDGET_RECUPERATION = 1;

export function etatInitial(): EtatMachine {
  return { etat: "BOOTING", tentativesRecuperation: 0 };
}

export type Evenement =
  | { readonly type: "RUNTIME_PRESENT" }
  | { readonly type: "RUNTIME_ABSENT"; readonly detail?: string }
  | { readonly type: "CLUSTER_ABSENT" }
  | { readonly type: "CLUSTER_PRESENT" }
  | { readonly type: "CLUSTER_INITIALISE" }
  | { readonly type: "CLUSTER_VERSION_INCOMPATIBLE"; readonly detail?: string }
  | { readonly type: "SERVICE_DEMARRE" }
  | { readonly type: "PORT_OCCUPE"; readonly detail?: string }
  | { readonly type: "BASE_JOIGNABLE" }
  | { readonly type: "BASE_INJOIGNABLE"; readonly detail?: string }
  | { readonly type: "MIGRATIONS_A_JOUR" }
  | { readonly type: "MIGRATIONS_MANQUANTES"; readonly detail?: string }
  | { readonly type: "MIGRATION_ECHOUEE"; readonly detail?: string }
  | { readonly type: "BACKEND_DEMARRE" }
  | { readonly type: "BACKEND_INJOIGNABLE"; readonly detail?: string }
  | { readonly type: "BACKEND_CRASH"; readonly detail?: string }
  | { readonly type: "SANTE_OK" }
  | { readonly type: "SANTE_ECHEC"; readonly detail?: string }
  | { readonly type: "BUDGET_DEPASSE"; readonly detail?: string }
  | { readonly type: "REESSAYER" };

function echec(m: EtatMachine, cause: CauseEchec, detail: string | undefined): EtatMachine {
  return { etat: "FAILED", tentativesRecuperation: m.tentativesRecuperation, cause, detail };
}

/**
 * Un échec ne va pas directement en FAILED : il passe par RECOVERY, qui
 * autorise UNE reprise bornée avant de renoncer (§H). `echecOuRecuperation`
 * centralise ce choix pour que chaque branche d'échec ci-dessous l'applique
 * de la même façon.
 */
function echecOuRecuperation(
  m: EtatMachine,
  cause: CauseEchec,
  detail: string | undefined,
): EtatMachine {
  if (m.tentativesRecuperation < BUDGET_RECUPERATION) {
    return { etat: "RECOVERY", tentativesRecuperation: m.tentativesRecuperation + 1, cause, detail };
  }
  return echec(m, cause, detail);
}

export function reduire(m: EtatMachine, e: Evenement): EtatMachine {
  switch (m.etat) {
    case "BOOTING":
      if (e.type === "RUNTIME_PRESENT") return { ...m, etat: "CHECKING_RUNTIME" };
      break;

    case "CHECKING_RUNTIME":
      if (e.type === "RUNTIME_ABSENT") return echec(m, "runtime-absent", e.detail);
      if (e.type === "CLUSTER_ABSENT") return { ...m, etat: "INITIALIZING_CLUSTER" };
      if (e.type === "CLUSTER_PRESENT") return { ...m, etat: "STARTING_DATABASE" };
      if (e.type === "CLUSTER_VERSION_INCOMPATIBLE") {
        return echec(m, "version-cluster-incompatible", e.detail);
      }
      break;

    case "INITIALIZING_CLUSTER":
      if (e.type === "CLUSTER_INITIALISE") return { ...m, etat: "STARTING_DATABASE" };
      if (e.type === "BASE_INJOIGNABLE") return echecOuRecuperation(m, "base-injoignable", e.detail);
      break;

    case "STARTING_DATABASE":
      if (e.type === "SERVICE_DEMARRE") return { ...m, etat: "WAITING_DATABASE" };
      if (e.type === "PORT_OCCUPE") return echec(m, "port-occupe", e.detail);
      break;

    case "WAITING_DATABASE":
      if (e.type === "BASE_JOIGNABLE") return { ...m, etat: "RUNNING_MIGRATIONS" };
      if (e.type === "BASE_INJOIGNABLE") return echecOuRecuperation(m, "base-injoignable", e.detail);
      if (e.type === "BUDGET_DEPASSE") return echecOuRecuperation(m, "base-injoignable", e.detail);
      break;

    case "RUNNING_MIGRATIONS":
      if (e.type === "MIGRATIONS_A_JOUR") return { ...m, etat: "STARTING_BACKEND" };
      if (e.type === "MIGRATIONS_MANQUANTES") return echec(m, "migration-manquante", e.detail);
      if (e.type === "MIGRATION_ECHOUEE") return echec(m, "migration-echouee", e.detail);
      break;

    case "STARTING_BACKEND":
      if (e.type === "BACKEND_DEMARRE") return { ...m, etat: "WAITING_BACKEND" };
      if (e.type === "PORT_OCCUPE") return echec(m, "port-occupe", e.detail);
      break;

    case "WAITING_BACKEND":
      if (e.type === "BACKEND_INJOIGNABLE") return echecOuRecuperation(m, "backend-injoignable", e.detail);
      if (e.type === "BUDGET_DEPASSE") return echecOuRecuperation(m, "backend-injoignable", e.detail);
      if (e.type === "SANTE_OK") return { ...m, etat: "HEALTH_CHECK" };
      break;

    case "HEALTH_CHECK":
      if (e.type === "SANTE_OK") return { ...m, etat: "READY", cause: undefined, detail: undefined };
      if (e.type === "SANTE_ECHEC") return echecOuRecuperation(m, "sonde-sante-echouee", e.detail);
      break;

    case "READY":
      if (e.type === "BACKEND_CRASH") return echecOuRecuperation(m, "backend-crash", e.detail);
      break;

    case "RECOVERY":
      // Toujours reprendre à CHECKING_RUNTIME, jamais à l'étape qui a échoué :
      // un cluster déjà présent ou des migrations déjà appliquées font que
      // l'orchestrateur retraverse ces étapes en quelques appels sans effet
      // (CLUSTER_PRESENT, MIGRATIONS_A_JOUR) — plus lent qu'une reprise
      // ciblée, jamais faux. Une reprise ciblée par cause obligerait à faire
      // confiance à un état partiellement construit, ce que cette machine
      // refuse par principe (même logique que le refus de démarrage sur
      // schéma partiel de `verifier-base.mjs`).
      if (e.type === "REESSAYER") return { ...m, etat: "CHECKING_RUNTIME" };
      break;

    case "FAILED":
      // État terminal : aucune transition n'en sort. Un nouveau lancement
      // d'Electron reconstruit une machine fraîche via `etatInitial()`.
      break;
  }
  return m;
}
