"use client";

import { fr } from "@/i18n/fr";

/**
 * En-tête cockpit V11 — la coquille porte déjà le NOM (Topbar), ici on ne
 * répète jamais le nom : contexte séance + durée, sur UNE ligne calme.
 *
 * Le chrono arrive en `ReactNode` (`ChronoSeance` reste propriétaire de son
 * tick dans la page) et le retour aussi. `meta` est déjà composée par
 * l'appelant (`type · date`) : aucun formatage ici, donc aucune décision ici.
 */
export function CockpitHeader({
  meta,
  chrono,
  retour,
  terminee,
}: {
  readonly meta: string | null;
  readonly chrono: React.ReactNode;
  readonly retour: React.ReactNode;
  readonly terminee: boolean;
}): React.JSX.Element {
  const cockpit = fr.consultation.cockpit;
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-rule pb-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
        {retour}
        <span aria-hidden="true" className="h-6 w-px shrink-0 self-center bg-rule" />
        {meta === null ? null : (
          <p className="text-balance font-ui text-body font-semibold tabular-nums text-ink-900">
            {meta}
          </p>
        )}
      </div>
      <p
        aria-label={cockpit.dureeSeance}
        className="flex shrink-0 items-center gap-2.5 rounded-full border border-rule bg-card py-1 pl-3 pr-4 shadow-douce"
      >
        <span
          aria-hidden="true"
          className={[
            "h-2 w-2 rounded-full",
            terminee ? "bg-ink-300" : "bg-positive animate-respire",
          ].join(" ")}
        />
        <span className="font-ui text-label font-medium text-ink-500">
          {terminee ? cockpit.seanceTermineeLibelle : cockpit.seanceEnCours}
        </span>
        <span className="font-num text-body font-bold tabular-nums text-ink-900">
          {chrono}
        </span>
      </p>
    </header>
  );
}
