/**
 * `OrbeVoix` — L'ORBE, ET CE QU'IL DIT VRAIMENT.
 *
 * ═══ CE COMPOSANT NE DÉTIENT AUCUN ÉTAT VOCAL ═══
 *
 * La vérité vit dans `services/jarvis-reveil.ts`, un singleton de module. Ce
 * composant s'y ABONNE et n'en garde qu'un miroir. C'est ce qui permet à l'orbe
 * du panneau, à celui de l'en-tête et à tout futur point d'entrée d'afficher
 * exactement la même chose sans se coordonner.
 *
 * ⚠️ L'ORBE NE MIME JAMAIS UN ÉTAT (règle 8). Il n'a pas de minuteur décoratif,
 * pas d'animation « qui fait vivant » pendant qu'il ne se passe rien. Chacun
 * des huit états correspond à un fait rapporté par la machine, et l'amplitude
 * affichée pendant l'écoute est le niveau sonore RÉEL mesuré au micro. Un orbe
 * qui respirerait sans écouter serait une donnée fictive dans une
 * fonctionnalité livrée.
 *
 * ═══ L'AMPLITUDE NE PASSE PAS PAR REACT ═══
 *
 * Un `setState` à chaque trame audio, c'est 20 rendus par seconde de tout le
 * sous-arbre. On écrit donc la valeur dans une variable CSS via une `ref`, dans
 * une boucle `requestAnimationFrame` : zéro rendu, et le style se met à jour
 * dans le compositeur. Ce qui traverse la frontière est un SCALAIRE lissé —
 * de quoi animer un cercle, jamais de quoi reconstituer une parole.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  abonnerVoix,
  acquitterErreur,
  cloturerCommande,
  declencherEcoute,
  definirVoixSouhaitee,
  interrompreVoix,
  niveauEcoute,
  type EtatVoix,
  type VueVoix,
} from "@/services/jarvis-reveil";

/**
 * L'apparence de chaque état. Aucun hex : uniquement des jetons du design
 * system (§5 de CLAUDE.md).
 *
 * ⚠️ AUCUN ÉTAT N'EST DISTINGUÉ PAR LA SEULE COULEUR. Chacun porte un libellé
 * textuel lu par `aria-live` et affiché en info-bulle : un daltonien, ou une
 * praticienne qui regarde son patient plutôt que l'écran, doit pouvoir savoir
 * ce que fait l'assistant.
 */
const APPARENCE: Record<EtatVoix, { readonly noyau: string; readonly anneau: string }> = {
  veille: { noyau: "bg-grad-orb", anneau: "" },
  reveille: { noyau: "bg-grad-orb shadow-glow-ai", anneau: "ring-2 ring-ai-300" },
  ecoute: { noyau: "bg-grad-orb shadow-glow-ai", anneau: "ring-2 ring-ai-600" },
  // `animate-pulse` : le SEUL mouvement non piloté par une mesure. Il est
  // justifié — « un instant… » est précisément l'état où rien d'observable ne
  // se produit, et un orbe figé y serait indiscernable d'un orbe planté.
  traitement: { noyau: "bg-grad-orb animate-pulse", anneau: "ring-2 ring-ai-100" },
  parole: { noyau: "bg-grad-orb shadow-glow-ai", anneau: "ring-2 ring-ai-300" },
  interrompu: { noyau: "bg-grad-orb", anneau: "ring-2 ring-rule" },
  erreur: { noyau: "bg-attention-bg", anneau: "ring-2 ring-attention" },
  desactive: { noyau: "bg-sunken", anneau: "" },
};

interface Props {
  /** Diamètre en pixels. L'en-tête en veut un plus petit que le lanceur. */
  readonly taille?: number;
}

export function OrbeVoix({ taille = 32 }: Props): React.JSX.Element {
  const [vue, setVue] = useState<VueVoix | null>(null);
  const noyauRef = useRef<HTMLSpanElement>(null);

  useEffect(() => abonnerVoix(setVue), []);

  const etat = vue?.etat ?? "desactive";

  // La boucle d'amplitude ne tourne QUE pendant l'écoute : ailleurs, il n'y a
  // rien à mesurer, et une boucle `rAF` permanente réveillerait le processeur
  // du poste pour dessiner un cercle immobile.
  useEffect(() => {
    if (etat !== "ecoute") {
      noyauRef.current?.style.setProperty("--niveau", "0");
      return;
    }
    let image = 0;
    const battre = (): void => {
      noyauRef.current?.style.setProperty("--niveau", niveauEcoute().toFixed(3));
      image = requestAnimationFrame(battre);
    };
    image = requestAnimationFrame(battre);
    return () => cancelAnimationFrame(image);
  }, [etat]);

  /**
   * ⚠️ LE CLIC ENTRE DANS LE MÊME CHEMIN QUE LE MOT DE RÉVEIL. `declencherEcoute`
   * est l'unique porte d'activation : deux chemins distincts divergeraient, et
   * le défaut n'apparaîtrait que sur l'un des deux gestes.
   *
   * Ce clic sert AUSSI de geste utilisateur débloquant l'autoplay : sans lui,
   * le premier son d'une session serait refusé par le navigateur.
   */
  const surClic = useCallback(() => {
    switch (etat) {
      case "veille":
      case "interrompu":
        void declencherEcoute();
        return;
      case "ecoute":
        // Fin manuelle : la praticienne sait qu'elle a fini avant le silence.
        void cloturerCommande();
        return;
      case "reveille":
      case "traitement":
      case "parole":
        interrompreVoix();
        return;
      case "erreur":
        acquitterErreur();
        return;
      case "desactive":
        // ⚠️ CE N'EST PAS UN BOUTON MORT. Premier clic = la praticienne active
        // la voix sur ce poste ; c'est là, et seulement là, que le navigateur
        // demandera le micro. Le choix est retenu pour les fois suivantes.
        definirVoixSouhaitee(true);
        return;
    }
  }, [etat]);

  const libelle = fr.jarvis.voix.reveil.etats[etat];
  // La raison prime sur le mot à prononcer : quand la voix est indisponible, on
  // dit POURQUOI plutôt que d'enseigner un mot qui ne réveillerait rien.
  const detail =
    vue?.raison ?? (etat === "veille" ? fr.jarvis.voix.reveil.motAPrononcer : libelle);
  const apparence = APPARENCE[etat];
  // ⚠️ « désactivé » N'EST PAS « inerte ». L'orbe éteint reste cliquable —
  // c'est le geste qui allume la voix. Le désactiver vraiment enfermerait la
  // praticienne dans un état dont aucun clic ne sort.
  const eteint = etat === "desactive";

  return (
    <button
      type="button"
      onClick={surClic}
      aria-label={`${libelle} — ${detail}`}
      title={detail}
      className={[
        "relative inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0",
        "transition duration-quick ease-soft",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ai-600",
        eteint ? "cursor-pointer opacity-60" : "cursor-pointer",
        apparence.anneau,
      ].join(" ")}
      style={{ width: taille, height: taille }}
    >
      <span
        ref={noyauRef}
        aria-hidden
        className={`block h-full w-full rounded-full transition-transform duration-quick ease-soft ${apparence.noyau}`}
        style={{
          // L'amplitude réelle, écrite par la boucle `rAF`. `--niveau` vaut 0
          // partout ailleurs, donc l'échelle vaut exactement 1 : aucun mouvement
          // n'est inventé hors de l'écoute.
          transform: "scale(calc(1 + var(--niveau, 0) * 0.18))",
        }}
      />
      {/* Le libellé d'état, annoncé aux lecteurs d'écran sans encombrer l'écran.
          `polite` : une transition d'orbe ne doit pas couper la parole en cours
          d'un lecteur d'écran au milieu d'une consultation. */}
      <span aria-live="polite" className="sr-only">
        {libelle}
      </span>
    </button>
  );
}
