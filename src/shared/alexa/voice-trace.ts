/**
 * Voice timing traces: one per spoken interaction, timestamps only. Never any
 * text, audio, patient or transcript — a trace says WHERE the time went
 * (microphone, recognition, Alexa, Kokoro, playback), not what was said.
 */
export type MarqueVoix =
  | "onset" // speech detected
  | "premierPartiel" // first live words on screen
  | "finParole" // the pause that ends the utterance
  | "final" // Whisper's final text
  | "tourEnvoye" // request sent to Alexa
  | "tourRecu" // Alexa's answer received
  | "lectureDebut" // first Kokoro sound out of the speaker
  | "lectureFin" // last sound
  | "ecouteReprise" // listening again
  | "stop" // STOP clicked or barge-in
  | "silence"; // sound actually stopped

export interface TraceVoix {
  readonly id: number;
  readonly marques: Partial<Record<MarqueVoix, number>>;
}

const MESURES = {
  premierPartiel: ["onset", "premierPartiel"],
  transcriptionFinale: ["finParole", "final"],
  alexa: ["tourEnvoye", "tourRecu"],
  kokoroPremierSon: ["tourRecu", "lectureDebut"],
  reponseTotale: ["finParole", "lectureDebut"],
  repriseEcoute: ["lectureFin", "ecouteReprise"],
  interruption: ["stop", "silence"],
} as const satisfies Record<string, readonly [MarqueVoix, MarqueVoix]>;
export type MesureVoix = keyof typeof MESURES;

export function creerTracesVoix(maintenant: () => number, capacite = 50) {
  const traces: { id: number; marques: Partial<Record<MarqueVoix, number>> }[] = [];
  let suivant = 0;
  const courante = () => traces[traces.length - 1];
  return {
    /** `onset` opens a new interaction; `stop` without one opens one too (typed answer). */
    marquer(marque: MarqueVoix): void {
      if (marque === "onset" || (marque === "stop" && courante() === undefined)) {
        traces.push({ id: ++suivant, marques: {} });
        if (traces.length > capacite) traces.shift();
      }
      const t = courante();
      if (t !== undefined && t.marques[marque] === undefined) t.marques[marque] = maintenant();
    },
    traces(): readonly TraceVoix[] {
      return traces.map((t) => ({ id: t.id, marques: { ...t.marques } }));
    },
    /** P50 / P95 / max in ms for each stage, over the interactions that reached it. */
    rapport(): Record<MesureVoix, { n: number; p50: number; p95: number; max: number } | null> {
      const sortie: Partial<Record<MesureVoix, { n: number; p50: number; p95: number; max: number } | null>> = {};
      for (const nom of Object.keys(MESURES) as MesureVoix[]) {
        const [de, a] = MESURES[nom];
        const valeurs = traces
          .map((t) => { const debut = t.marques[de], fin = t.marques[a]; return debut !== undefined && fin !== undefined ? fin - debut : null; })
          .filter((v): v is number => v !== null && v >= 0)
          .sort((x, y) => x - y);
        const q = (p: number) => Math.round(valeurs[Math.min(valeurs.length - 1, Math.floor(p * valeurs.length))]!);
        sortie[nom] = valeurs.length === 0 ? null : { n: valeurs.length, p50: q(0.5), p95: q(0.95), max: Math.round(valeurs.at(-1)!) };
      }
      return sortie as Record<MesureVoix, { n: number; p50: number; p95: number; max: number } | null>;
    },
  };
}
