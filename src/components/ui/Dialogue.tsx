"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import { Icone } from "./Icones";

/**
 * Dialogue natif, au-dessus de l'application.
 *
 * Le `<dialog>` natif porte le piège de focus, Échap et le top-layer du
 * navigateur. On ne réimplémente pas ces comportements : on les habille.
 */
export function Dialogue({
  titre,
  sousTitre,
  ouvert = false,
  busy = false,
  onFermer,
  children,
  pied,
  large = false,
}: {
  readonly titre: string;
  readonly sousTitre?: string;
  readonly ouvert?: boolean;
  readonly busy?: boolean;
  readonly onFermer: () => void;
  readonly children: ReactNode;
  readonly pied?: ReactNode;
  readonly large?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titreId = useId();

  useEffect(() => {
    const dialogue = ref.current;
    if (dialogue === null || !ouvert) return;
    if (!dialogue.open) dialogue.showModal();
    return () => {
      if (dialogue.open) dialogue.close();
    };
  }, [ouvert]);

  if (!ouvert) return null;

  return (
    <dialog
      ref={ref}
      className={["dialogue-mindcare", large ? "dialogue-mindcare--large" : ""].join(" ")}
      aria-labelledby={titreId}
      aria-busy={busy}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onFermer();
      }}
    >
      <header className="flex items-start justify-between gap-4 border-b border-rule pb-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 id={titreId} className="font-ui text-title font-bold tracking-title text-ink-900">
            {titre}
          </h2>
          {sousTitre === undefined ? null : (
            <p className="font-ui text-body text-ink-500">{sousTitre}</p>
          )}
        </div>
        <button
          type="button"
          onClick={onFermer}
          disabled={busy}
          aria-label="Fermer"
          className="inline-flex h-target w-target shrink-0 items-center justify-center rounded-xl text-ink-500 transition duration-quick ease-out hover:bg-sunken hover:text-ink-900 disabled:opacity-disabled"
        >
          <Icone nom="croix" taille={20} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto py-4">{children}</div>

      {pied === undefined ? null : (
        <footer className="border-t border-rule pt-4">{pied}</footer>
      )}
    </dialog>
  );
}
