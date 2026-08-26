/**
 * `BootVoix` — L'AMORÇAGE DE LA VOIX. NE REND RIEN.
 *
 * ═══ POURQUOI UN COMPOSANT QUI N'AFFICHE RIEN ═══
 *
 * Le détecteur de mot de réveil doit vivre aussi longtemps que l'application,
 * pas aussi longtemps qu'un écran. Le monter dans `AppShell` — présent partout —
 * lui donne exactement cette durée de vie, et le démonte proprement à la
 * déconnexion.
 *
 * ⚠️ CE COMPOSANT NE DÉTIENT PAS L'ÉTAT VOCAL. Il ne fait que RETENIR une
 * référence sur un singleton de module. React monte, démonte et remonte à sa
 * guise — en mode strict, à chaque navigation, à chaque rechargement à chaud —
 * et le comptage de références de `retenirVoix` absorbe tout cela sans jamais
 * refermer les sessions ONNX dans l'intervalle. Un `useState` par montage
 * produirait autant de vérités que de montages.
 *
 * ⚠️ LE MICRO NE S'OUVRE PAS DE LUI-MÊME. Rien ne démarre tant que la
 * praticienne n'a pas activé la voix d'un clic sur l'orbe — voir
 * `voixSouhaitee` dans `jarvis-reveil.ts`.
 */

"use client";

import { useEffect, useState } from "react";

import { envoyer } from "@/services/conversation";
import { abonnerSouhait, retenirVoix } from "@/services/jarvis-reveil";

export function BootVoix(): null {
  const [actif, setActif] = useState(false);

  useEffect(() => abonnerSouhait(setActif), []);

  useEffect(() => {
    if (!actif) return;
    // `onCommande` branche la voix sur LE MÊME store que le clavier : la
    // commande dictée traverse ensuite la boucle Jarvis existante — contexte,
    // permissions, outils, carte de confirmation. La voix est une entrée, pas
    // un second cerveau.
    return retenirVoix({ onCommande: (texte: string) => envoyer(texte) });
  }, [actif]);

  return null;
}
