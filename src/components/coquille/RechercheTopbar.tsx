"use client";

/**
 * Recherche de la barre supérieure — même geste que l'annuaire Patients.
 *
 * Remplace visuellement le titre d'écran (retiré sur décision praticienne
 * 2026-10-28). Le titre reste exposé aux lecteurs d'écran via `Topbar`
 * (`sr-only`) : l'identité de page ne disparaît que visuellement.
 *
 * - Sur `/patients` : chaque frappe est diffusée par événement
 *   `mindcare:topbar-recherche` ; `src/app/patients/page.tsx` l'écoute et
 *   alimente sa `saisie` (qui garde son debounce + audit inchangés).
 * - Ailleurs : `Entrée` navigue vers `/patients?recherche=…`, relu au montage
 *   par la page Patients.
 *
 * Libellés via `fr.patients` uniquement, couleurs via jetons uniquement.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

import { fr } from "@/i18n/fr";

import { Icone } from "../ui/Icones";

export const EVENEMENT_RECHERCHE_TOPBAR = "mindcare:topbar-recherche";

export function RechercheTopbar(): React.JSX.Element {
  const chemin = usePathname();
  const router = useRouter();
  const [valeur, setValeur] = useState("");

  // Relit `?recherche=` quand on arrive sur /patients depuis une autre page.
  useEffect(() => {
    if (chemin !== "/patients" || typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const q = params.get("recherche") ?? params.get("q") ?? "";
    if (q !== "") setValeur(q);
  }, [chemin]);

  // Sur /patients, transmet à la liste (debounce + audit gardés côté page).
  useEffect(() => {
    if (chemin !== "/patients" || typeof window === "undefined") return;
    window.dispatchEvent(
      new CustomEvent<string>(EVENEMENT_RECHERCHE_TOPBAR, { detail: valeur }),
    );
  }, [valeur, chemin]);

  function soumettre(evenement: React.FormEvent): void {
    evenement.preventDefault();
    if (chemin === "/patients") return;
    const q = valeur.trim();
    router.push(q === "" ? "/patients" : `/patients?recherche=${encodeURIComponent(q)}`);
  }

  return (
    <form
      role="search"
      aria-label={fr.patients.rechercher}
      onSubmit={soumettre}
      className="flex w-full min-w-0 justify-center"
    >
      <div className="recherche-topbar-halo">
        <span aria-hidden="true" className="recherche-topbar-faisceau" />
        <div className="recherche-topbar-fond">
          <span aria-hidden="true" className="recherche-topbar-loupe">
            <Icone nom="recherche" taille={16} />
          </span>
          <label htmlFor="recherche-topbar" className="sr-only">
            {fr.patients.rechercher}
          </label>
          <input
            id="recherche-topbar"
            type="search"
            autoComplete="off"
            value={valeur}
            onChange={(e) => setValeur(e.target.value)}
            placeholder={fr.patients.rechercherIndication}
            aria-label={fr.patients.rechercher}
            className="recherche-topbar-champ"
          />
        </div>
      </div>
    </form>
  );
}
