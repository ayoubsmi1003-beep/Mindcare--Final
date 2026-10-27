/**
 * LA DICTÉE D'UN CHAMP FACE AU MOT DE RÉVEIL — UN SEUL MICRO, UNE SEULE VOIX.
 *
 * `jarvis-voix.ts` ne tient qu'un enregistreur à la fois. Pendant une capture
 * du réveil (réveil entendu, commande en cours, réponse en train d'être lue),
 * presser le micro d'un champ ouvrirait un second enregistrement sur le même
 * périphérique — ou, pire, enregistrerait la praticienne en train de taper.
 * Le refus doit être VISIBLE : un bouton qui ne fait rien se lit comme une
 * panne, pas comme une règle.
 */
import { describe, expect, it, vi } from "vitest";

import { dicteeAutorisee } from "@/components/consultation/DicteeChamp";
import { fr } from "@/i18n/fr";

describe("la dictée d'un champ pendant une capture du réveil", () => {
  it("refuse une seconde prise du micro avec le message déjà connu", () => {
    const signaler = vi.fn();
    const demarrer = vi.fn();
    if (dicteeAutorisee(() => true, signaler)) demarrer();

    expect(demarrer).not.toHaveBeenCalled();
    expect(signaler).toHaveBeenCalledExactlyOnceWith(fr.jarvis.voix.dejaEnCours);
  });

  it("ouvre le micro quand aucune capture du réveil n'est en cours", () => {
    const signaler = vi.fn();

    expect(dicteeAutorisee(() => false, signaler)).toBe(true);
    expect(signaler).not.toHaveBeenCalled();
  });
});
