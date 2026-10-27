"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { arreterVoixLocale } from "@/services/alexa-local";
import { subscribeAlexaNavigation } from "@/services/alexa-navigation";
import { voixSouhaitee } from "@/services/jarvis-reveil";
import { demarrerMainsLibres, mainsLibresActif } from "@/services/voix-mains-libres";

/** The microphone starts only on the doctor's click and closes with the app. */
export function BootVoix(): null {
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => subscribeAlexaNavigation(path => router.push(path)), [router]);
  // La navigation ferme la BOUCLE directe, jamais le mains-libres : le choix
  // du mot de réveil vaut pour toute l'application, pas pour un écran.
  useEffect(() => { arreterVoixLocale(); }, [pathname]);
  useEffect(() => {
    // ⚠️ LE MOT DE RÉVEIL SURVIT À LA NAVIGATION ET AU REMONTAGE. Le choix est
    // mémorisé sur ce poste ; le réarmer ici le rend vrai partout. Rien n'est
    // demandé au premier lancement : `voixSouhaitee()` reste faux tant que la
    // praticienne n'a pas opté une première fois.
    if (voixSouhaitee() && !mainsLibresActif()) void demarrerMainsLibres();
  }, []);
  useEffect(() => {
    const surVisibilite = () => {
      if (document.hidden) {
        arreterVoixLocale();
        return;
      }
      // Un onglet caché peut avoir suspendu la détection : on réarme au
      // retour, mais seulement si la praticienne l'avait demandé.
      if (voixSouhaitee() && !mainsLibresActif()) void demarrerMainsLibres();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    window.addEventListener("pagehide", arreterVoixLocale);
    return () => {
      document.removeEventListener("visibilitychange", surVisibilite);
      window.removeEventListener("pagehide", arreterVoixLocale);
      arreterVoixLocale();
    };
  }, []);
  return null;
}
