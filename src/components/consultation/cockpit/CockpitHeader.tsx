"use client";

/**
 * En-tête compact du cockpit — UNE ligne calme, pas deux en-têtes qui se
 * concurrencent. La coquille porte déjà l'identité en persistant ; ici le nom
 * reste le `h1` (plan du document) suivi du contexte séance sur la même ligne
 * visuelle, chrono modeste à l'autre bout.
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
    <header className="flex flex-wrap items-baseline justify-between gap-x-5 gap-y-1 border-b border-rule pb-3">
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3">
        {retour}
        <span aria-hidden="true" className="h-6 w-px shrink-0 self-center bg-rule" />
        <h1 className="truncate font-ui text-heading font-bold text-ink-900">{titre}</h1>
        {meta === null ? null : (
          <p className="truncate font-ui text-label tabular-nums text-ink-500">{meta}</p>
        )}
      </div>
      <p className="flex shrink-0 items-center gap-2 font-num text-num font-semibold tabular-nums text-ink-900">
        {chrono}
      </p>
    </header>
  );
}
