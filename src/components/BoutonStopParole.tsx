"use client";

/**
 * STOP — visible exactly while Alexa's voice really comes out of the speaker
 * (the `playing` fact published by `jarvis-voix`, not an intention). One click,
 * no confirmation, idempotent: it silences the sound and drops the sentences
 * still being synthesized. The answer text stays on screen; an open voice
 * conversation goes back to listening.
 */
import { useEffect, useState } from "react";

import { alexa } from "@/i18n/alexa";
import { marquerVoix } from "@/services/alexa-local";
import { abonnerLecture, arreterLecture } from "@/services/jarvis-voix";
import { Icone } from "./ui/Icones";

export function useAlexaParle(): boolean {
  const [parle, setParle] = useState(false);
  useEffect(() => abonnerLecture((active) => setParle(active)), []);
  return parle;
}

export function BoutonStopParole({ className }: { readonly className?: string }): React.JSX.Element | null {
  const parle = useAlexaParle();
  if (!parle) return null;
  return (
    <button
      type="button"
      onClick={() => { marquerVoix("stop"); arreterLecture(); }}
      aria-label={alexa.stopParole}
      title={alexa.stopParole}
      data-testid="stop-parole"
      className={[
        "inline-flex min-h-target shrink-0 cursor-pointer items-center justify-center gap-2 rounded-full border border-rule bg-card px-4 font-ui text-label text-ink-900 shadow-lift1 transition duration-quick ease-soft hover:bg-sunken",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-action-600",
        className ?? "",
      ].join(" ")}
    >
      <Icone nom="croix" taille={16} />
      <span>{alexa.stopParole}</span>
    </button>
  );
}
