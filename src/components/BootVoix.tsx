"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { arreterVoixLocale } from "@/services/alexa-local";
import { subscribeAlexaNavigation } from "@/services/alexa-navigation";
import { voixSouhaitee } from "@/services/jarvis-reveil";
import { arreterMainsLibres, demarrerMainsLibres, mainsLibresActif } from "@/services/voix-mains-libres";

import { AlexaAutoRead } from "./AlexaAutoRead";

/** Closes the direct loop on navigation and keeps an opted-in hands-free session armed app-wide. */
export function BootVoix(): React.JSX.Element {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => subscribeAlexaNavigation(path => router.push(path)), [router]);
  // La navigation ferme la BOUCLE directe, jamais le mains-libres : le choix
  // du mot de réveil vaut pour toute l'application, pas pour un écran.
  useEffect(() => { arreterVoixLocale(); }, [pathname]);
  useEffect(() => {
    // ⚠️ LE MOT DE RÉVEIL EST RÉARMÉ À CHAQUE MONTAGE D'APPSHELL — pas
    // seulement au clic qui a mémorisé le choix. `mainsLibresActif()` rend
    // l'appel idempotent : un remontage pendant que la voix tourne déjà ne
    // rouvre rien. `voixSouhaitee()` reste faux au premier lancement, donc
    // aucun micro n'est demandé avant l'opt-in explicite.
    if (voixSouhaitee() && !mainsLibresActif()) void demarrerMainsLibres();
  }, []);
  useEffect(() => {
    const surVisibilite = () => {
      if (document.hidden) {
        arreterVoixLocale();
        return;
      }
      // Un onglet caché peut avoir suspendu la détection : on réarme au
      // retour SI elle n'est pas déjà active — jamais une seconde prise du
      // micro en parallèle.
      if (voixSouhaitee() && !mainsLibresActif()) void demarrerMainsLibres();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    window.addEventListener("pagehide", arreterVoixLocale);
    return () => {
      document.removeEventListener("visibilitychange", surVisibilite);
      window.removeEventListener("pagehide", arreterVoixLocale);
      // ⚠️ FERMER LE MAINS-LIBRES AU DÉMONTAGE (déconnexion, fermeture de
      // l'application). `arreterVoixLocale` ne suffit pas : le détecteur Vosk
      // garde sinon le micro et la préférence, et la session suivante
      // rouvrirait l'écoute sans geste. `desarmerReveil` rend le périphérique.
      arreterMainsLibres();
      arreterVoixLocale();
    };
  }, []);
  return <AlexaAutoRead />;
}
