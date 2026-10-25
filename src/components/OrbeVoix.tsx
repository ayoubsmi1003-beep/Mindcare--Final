/**
 * `OrbeVoix` — L'ORBE, ET CE QU'IL DIT VRAIMENT.
 *
 * ═══ CE COMPOSANT NE DÉTIENT AUCUN ÉTAT VOCAL ═══
 *
 * La vérité vit dans `services/alexa-local.ts`, un singleton de module. Ce
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

import { useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import { alexa } from "@/i18n/alexa";
import { abonnerVoixLocale, basculerVoixLocale, niveauVoixLocale } from "@/services/alexa-local";
import type { EtatVoix, VueVoix } from "@/services/jarvis-reveil";

import { AvatarAlexa } from "./ui/avatar-alexa";
import { VagueAlexa, vagueDisponible } from "./ui/vague-alexa";

/**
 * L'apparence de chaque état. Aucun hex : uniquement des jetons du design
 * system (§5 de CLAUDE.md). L'anneau reste l'unique marquage d'état côté
 * chrome — la couleur du noyau vit désormais dans SiriOrb (présentation
 * seule, aucune logique).
 *
 * ⚠️ AUCUN ÉTAT N'EST DISTINGUÉ PAR LA SEULE COULEUR. Chacun porte un libellé
 * textuel lu par `aria-live` et affiché en info-bulle.
 */
const APPARENCE: Record<EtatVoix, { readonly noyau: string; readonly anneau: string }> = {
  veille: { noyau: "", anneau: "" },
  reveille: { noyau: "", anneau: "ring-2 ring-ai-500" },
  ecoute: { noyau: "", anneau: "ring-2 ring-ai-600" },
  traitement: { noyau: "", anneau: "ring-2 ring-ai-100" },
  parole: { noyau: "", anneau: "ring-2 ring-ai-500" },
  interrompu: { noyau: "", anneau: "ring-2 ring-rule" },
  erreur: { noyau: "", anneau: "ring-2 ring-attention" },
  desactive: { noyau: "", anneau: "" },
};

interface Props {
  /** Diamètre en pixels. L'en-tête en veut un plus petit que le lanceur. */
  readonly taille?: number;
}

export function OrbeVoix({ taille = 32 }: Props): React.JSX.Element {
  const [vue, setVue] = useState<VueVoix | null>(null);
  const noyauRef = useRef<HTMLSpanElement>(null);
  const [vagueOk, setVagueOk] = useState(false);

  useEffect(() => abonnerVoixLocale(setVue), []);
  useEffect(() => {
    setVagueOk(vagueDisponible());
  }, []);

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
      noyauRef.current?.style.setProperty("--niveau", niveauVoixLocale().toFixed(3));
      image = requestAnimationFrame(battre);
    };
    image = requestAnimationFrame(battre);
    return () => cancelAnimationFrame(image);
  }, [etat]);

  // The original click unlocks local capture; another click closes the microphone.
  const libelle = etat === "desactive" ? alexa.voixDemarrer : fr.jarvis.voix.reveil.etats[etat];
  const detail = vue?.raison ?? libelle;
  const apparence = APPARENCE[etat];
  // ⚠️ « désactivé » N'EST PAS « inerte ». L'orbe éteint reste cliquable —
  // c'est le geste qui allume la voix. Le désactiver vraiment enfermerait la
  // praticienne dans un état dont aucun clic ne sort.
  const eteint = etat === "desactive";

  // L'orbe vert (AvatarAlexa) est la couche visuelle ; l'anneau reste
  // l'unique marquage d'état côté chrome, avec son libellé textuel.
  const diametres = [16, 18, 28, 32, 56, 112, 132] as const;
  type DiametreConnu = (typeof diametres)[number];
  const diametre: DiametreConnu = (diametres as readonly number[]).includes(taille)
    ? (taille as DiametreConnu)
    : 32;

  return (
    <button
      type="button"
      onClick={basculerVoixLocale}
      aria-label={`${libelle} — ${detail}`}
      title={detail}
      className={[
        "relative inline-flex shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0",
        "transition duration-quick ease-soft",
        "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ai-600",
        eteint ? "cursor-pointer opacity-disabled" : "cursor-pointer",
        apparence.anneau,
      ].join(" ")}
      style={{ width: taille, height: taille }}
    >
      <span
        ref={noyauRef}
        aria-hidden
        className="flex h-full w-full items-center justify-center rounded-full transition-transform duration-quick ease-soft"
        style={{
          // L'amplitude réelle, écrite par la boucle `rAF`. `--niveau` vaut 0
          // partout ailleurs, donc l'échelle vaut exactement 1 : aucun mouvement
          // n'est inventé hors de l'écoute.
          transform: "scale(calc(1 + var(--niveau, 0) * 0.18))",
        }}
      >
        {(etat === "ecoute" || etat === "traitement") && vagueOk ? (
          <VagueAlexa size={taille} />
        ) : (
          <AvatarAlexa taille="sm" diametre={diametre} className="rounded-full" />
        )}
      </span>
      {/* Le libellé d'état, annoncé aux lecteurs d'écran sans encombrer l'écran.
          `polite` : une transition d'orbe ne doit pas couper la parole en cours
          d'un lecteur d'écran au milieu d'une consultation. */}
      <span aria-live="polite" className="sr-only">
        {libelle}
      </span>
    </button>
  );
}
