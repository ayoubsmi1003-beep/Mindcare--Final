"use client";

/**
 * useRechercheInstantane — le même comportement sur toutes les recherches.
 *
 * Ce qui rend la recherche « immédiate » n'est pas un debounce plus court :
 * c'est l'absence de clignotement. On garde les résultats précédents à l'écran
 * pendant la requête suivante, on annule les réponses devenues obsolètes, et
 * on garde en mémoire les dernières pages — effacer une lettre puis la retaper
 * ne refait aucun aller-retour.
 *
 * ⚠️ CHAQUE APPEL PATIENT ÉCRIT UNE LIGNE D'AUDIT (`app.search_patients`).
 * 120 ms regroupe les frappes rapprochées ; on ne descend pas en dessous.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Result } from "@/services/result";

export interface PageRecherche<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

export interface EtatRecherche<T> {
  readonly resultats: readonly T[];
  readonly total: number;
  readonly chargement: boolean;
  readonly chargementPlus: boolean;
  readonly erreur: string | null;
}

export interface OptionsRecherche<T> {
  readonly requete: string;
  readonly chercher: (q: string, limit: number, offset: number) => Promise<Result<PageRecherche<T>>>;
  /** Sous ce seuil, la liste est vidée : pas de balayage pour rien. */
  readonly minimum?: number;
  /** Regroupe les frappes. Ne pas descendre sous 120 ms (audit patient). */
  readonly delai?: number;
  /** Taille d'une page. La porte borne à 100. */
  readonly taille?: number;
  /** Identité d'une ligne, pour dédupliquer les pages. */
  readonly cle?: (item: T) => string;
  /** Faux quand le panneau est fermé : annule et vide. */
  readonly actif?: boolean;
}

const VIDE: EtatRecherche<never> = {
  resultats: [],
  total: 0,
  chargement: false,
  chargementPlus: false,
  erreur: null,
};

function fusionner<T>(
  anciens: readonly T[],
  nouveaux: readonly T[],
  cle: (item: T) => string,
): readonly T[] {
  const vus = new Set(anciens.map(cle));
  const suite = [...anciens];
  for (const item of nouveaux) {
    const k = cle(item);
    if (vus.has(k)) continue;
    vus.add(k);
    suite.push(item);
  }
  return suite;
}

export function useRechercheInstantane<T>({
  requete,
  chercher,
  minimum = 2,
  delai = 120,
  taille = 50,
  cle = (item) => (item as { id: string }).id,
  actif = true,
}: OptionsRecherche<T>): {
  readonly etat: EtatRecherche<T>;
  readonly chargerPlus: () => void;
  readonly reinitialiser: () => void;
} {
  const [etat, setEtat] = useState<EtatRecherche<T>>(VIDE as EtatRecherche<T>);
  const seq = useRef(0);
  const cache = useRef(new Map<string, PageRecherche<T>>());
  const chercherRef = useRef(chercher);
  chercherRef.current = chercher;
  const cleRef = useRef(cle);
  cleRef.current = cle;

  const charger = useCallback(
    async (q: string, offset: number, ajouter: boolean) => {
      const id = ++seq.current;
      const cacheKey = `${offset}:${taille}:${q.toLocaleLowerCase("fr")}`;
      const connue = cache.current.get(cacheKey);

      if (connue !== undefined) {
        setEtat((precedent) => ({
          resultats: ajouter
            ? fusionner(precedent.resultats, connue.rows, cleRef.current)
            : connue.rows,
          total: connue.total,
          chargement: false,
          chargementPlus: false,
          erreur: null,
        }));
        return;
      }

      setEtat((precedent) => ({
        ...precedent,
        chargement: !ajouter,
        chargementPlus: ajouter,
        erreur: null,
      }));

      const reponse = await chercherRef.current(q, taille, offset);
      if (seq.current !== id) return;

      if (!reponse.ok) {
        setEtat((precedent) => ({
          ...precedent,
          chargement: false,
          chargementPlus: false,
          erreur: reponse.error.message,
        }));
        return;
      }

      cache.current.set(cacheKey, reponse.data);
      if (cache.current.size > 40) {
        const premiere = cache.current.keys().next();
        if (!premiere.done) cache.current.delete(premiere.value);
      }

      setEtat((precedent) => ({
        resultats: ajouter
          ? fusionner(precedent.resultats, reponse.data.rows, cleRef.current)
          : reponse.data.rows,
        total: reponse.data.total,
        chargement: false,
        chargementPlus: false,
        erreur: null,
      }));
    },
    [taille],
  );

  useEffect(() => {
    const q = requete.trim();
    seq.current += 1;
    if (!actif || q.length < minimum) {
      setEtat(VIDE);
      return;
    }
    const minuteur = setTimeout(() => {
      void charger(q, 0, false);
    }, delai);
    return () => clearTimeout(minuteur);
  }, [actif, charger, delai, minimum, requete]);

  const chargerPlus = useCallback(() => {
    const q = requete.trim();
    if (!actif || q.length < minimum) return;
    if (etat.chargement || etat.chargementPlus) return;
    if (etat.resultats.length >= etat.total) return;
    void charger(q, etat.resultats.length, true);
  }, [actif, charger, etat, minimum, requete]);

  const reinitialiser = useCallback(() => {
    seq.current += 1;
    setEtat(VIDE);
  }, []);

  return { etat, chargerPlus, reinitialiser };
}
