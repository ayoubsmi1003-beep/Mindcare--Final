/**
 * `brief-matinal.ts` — l'entrée du brief du matin, partagée voix/écran.
 *
 * EXTRACTION PURE de `briefMatinal.executer` (`jarvis-capacites.ts`) :
 * même projection, même mapping caisse, mêmes défauts (`?? []`, `?? null`,
 * `?? 0`). La capacité et le bloc dashboard appellent ceci : deux surfaces,
 * une seule vérité. `null` financier = hors périmètre (ADR-005), pas zéro.
 */
import type { TableauDeBord } from "./dashboard";
import type { Periode } from "./finance-calendrier";
import type { CarteIdentite } from "./jarvis-identite";
import type { SafeAgendaContext, SafeFinanceContext } from "./jarvis-projections";
import { projeterAgenda } from "./jarvis-projections";

export interface EntreeBriefMatinal {
  readonly agenda: SafeAgendaContext;
  readonly finance: SafeFinanceContext | null;
  readonly enAttente: number;
}

export function preparerEntreeBriefMatinal(
  tableau: TableauDeBord | null,
  aujourdHui: string,
  luA: string,
  carte: CarteIdentite,
): EntreeBriefMatinal {
  const agenda = projeterAgenda(tableau?.journee ?? [], carte, "app.dashboard_today");
  const caisse = tableau?.encaisse ?? null;
  const periode: Periode = { nom: "jour", du: aujourdHui, au: aujourdHui };
  const finance: SafeFinanceContext | null =
    caisse === null
      ? null
      : {
          periode,
          encaisseDzd: caisse.montantDzd,
          enAttenteDzd: 0,
          enAttenteNombre: 0,
          seances: caisse.seances,
          chargesDzd: null,
          resultatNetDzd: null,
          perimetre: caisse.perimetre,
          provenance: [{ porte: "app.dashboard_today", luA, tronque: false }],
        };
  return { agenda, finance, enAttente: tableau?.attenteNombre ?? 0 };
}
