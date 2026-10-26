/**
 * Écran de connexion — câblage entre `FormulaireConnexion` et `src/services/auth`.
 *
 * v12 — HÉRO BOLD + MÉDAILLON CERVEAU. Le fond reste le `FondShaderVert`
 * WebGL1 « Mesh drift » ; la carte reste le verre 21st.dev. Nouveautés :
 * médaillon de verre portant `MarqueMindCare` — le VRAI cerveau de feuilles
 * de l'identité (redessiné à la grille, `Icones.tsx`), pas un pictogramme
 * inventé ; héro Inter 800 sans tiret, deux lignes hiérarchisées ;
 * parallaxe douce du médaillon au pointeur (8° max, réduite à néant sous
 * `prefers-reduced-motion`). Trois contrôles uniquement.
 * Aucune décision d'autorisation ici — `router.replace` vers Patients.
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { FormulaireConnexion } from "@/components/FormulaireConnexion";
import { FondShaderVert } from "@/components/connexion/FondShaderVert";
import { MarqueMindCare } from "@/components/ui/Icones";
import { fr } from "@/i18n/fr";
import { signIn } from "@/services/auth";
import { getInstallationStatus } from "@/services/onboarding";

export default function PageConnexion(): React.JSX.Element {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);
  const sceneRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let annule = false;
    void getInstallationStatus().then((result) => {
      if (annule || !result.ok) return;
      if (result.data.environment === "self-hosted" && !result.data.provisionne) {
        router.replace("/premiere-configuration");
      }
    });
    return () => {
      annule = true;
    };
  }, [router]);

  function handleSubmit(email: string, motDePasse: string): void {
    setEnCours(true);
    setMessageErreur(undefined);
    setHorsLigne(false);

    void signIn({ email, password: motDePasse }).then((result) => {
      if (result.ok) {
        router.replace("/patients");
        return;
      }
      setHorsLigne(result.error.code === "hors-ligne");
      setMessageErreur(result.error.message);
      setEnCours(false);
    });
  }

  /**
   * Parallaxe du médaillon — le pointeur penche le cerveau de ±8°. Écrit
   * des variables CSS sur la scène, jamais d'état React : aucun re-rendu.
   * Inerte au clavier et sous `prefers-reduced-motion` (le CSS ignore les
   * variables quand l'animation est coupée).
   */
  function handlePointeur(event: React.PointerEvent<HTMLElement>): void {
    const scene = sceneRef.current;
    if (scene === null || event.pointerType === "touch") return;
    const rect = scene.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    scene.style.setProperty("--medaillon-rx", `${(-y * 8).toFixed(2)}deg`);
    scene.style.setProperty("--medaillon-ry", `${(x * 8).toFixed(2)}deg`);
  }

  function handleSortie(): void {
    sceneRef.current?.style.removeProperty("--medaillon-rx");
    sceneRef.current?.style.removeProperty("--medaillon-ry");
  }

  return (
    <main
      ref={sceneRef}
      className="scene-connexion"
      onPointerMove={handlePointeur}
      onPointerLeave={handleSortie}
    >
      <FondShaderVert />
      <div className="medaillon-cerveau" aria-hidden="true">
        <MarqueMindCare taille={46} />
      </div>
      <h1 className="hero-connexion">
        <span className="hero-connexion-titre">{fr.connexion.bienvenueTitre}</span>
        <span className="hero-connexion-detail">{fr.connexion.bienvenueDetail}</span>
      </h1>
      <FormulaireConnexion
        onSubmit={handleSubmit}
        enCours={enCours}
        messageErreur={messageErreur}
        horsLigne={horsLigne}
      />
    </main>
  );
}
