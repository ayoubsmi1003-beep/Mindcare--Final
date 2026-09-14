"use client";

/**
 * En-tête compact du cockpit — le nom, son contexte, le chrono, la sortie.
 *
 * Le chrono arrive en `ReactNode` (`ChronoSeance` reste propriétaire de son
 * tick dans la page) et le retour aussi (`LienBouton` garde sa sémantique
 * de lien). `meta` est déjà composée par l'appelant (`type · date`) ou
 * `null` : aucun formatage ici, donc aucune décision ici.
 */
export function CockpitHeader({
  titre,
  meta,
  chrono,
  retour,
}: {
  readonly titre: string;
  readonly meta: string | null;
  readonly chrono: React.ReactNode;
  readonly retour: React.ReactNode;
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-5 gap-y-2 border-b border-rule pb-4">
      <div className="flex min-w-0 items-center gap-3">
        {retour}
        <span aria-hidden="true" className="h-6 w-px shrink-0 bg-rule" />
        <div className="flex min-w-0 flex-col">
          <h1 className="truncate font-ui text-heading font-bold text-ink-900">{titre}</h1>
          {meta === null ? null : (
            <p className="truncate font-ui text-label text-ink-500">{meta}</p>
          )}
        </div>
      </div>
      <p className="flex shrink-0 items-center gap-2 font-num text-num font-semibold tabular-nums text-ink-900">
        {chrono}
      </p>
    </header>
  );
}
