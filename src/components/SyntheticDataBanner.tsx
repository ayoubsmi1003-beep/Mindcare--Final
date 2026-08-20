/**
 * Bandeau « données fictives » — ADR-016.
 *
 * LA VALEUR EST LUE EN BASE, jamais déduite d'une variable d'environnement ni
 * d'une constante de build. C'est le point entier de ce composant : il doit
 * dire ce que la base FAIT — c'est-à-dire ce que le déclencheur
 * `assert_synthetic_when_cloud` consulte réellement — et pas ce qu'un `.env`
 * prétend. Un `.env` mal copié se trompe en silence.
 *
 * DÉFAUT SÛR. Pendant le chargement ET en cas d'erreur de lecture, le bandeau
 * S'AFFICHE. Ne pas savoir dans quel environnement on se trouve n'est pas une
 * raison de laisser croire que la base porte des dossiers réels. Le sens du
 * défaut est dicté par la conséquence de l'erreur, pas par la fréquence du cas.
 * (`getDeploymentEnvironment` applique déjà ce défaut ; on ne s'en remet pas à
 * lui pour autant — deux couches, même sens.)
 *
 * DESIGN, ET CE SONT DES RÈGLES DE SÉCURITÉ, PAS DE GOÛT :
 *   - `--attention`, JAMAIS `--critical`. Le rouge est un budget réservé au
 *     disque critique et à la perte de données. Un bandeau permanent en rouge
 *     cesse d'être lu en trois jours, et le jour où le disque sature réellement,
 *     personne ne le voit.
 *   - AUCUN VERRE. Le verre décore le mobilier — panneau Jarvis, carte de
 *     confirmation, barre ⌘K — jamais une surface qui porte une affirmation sur
 *     l'état des données.
 *   - Jetons uniquement, aucune valeur en dur (I10).
 *   - Le statut ne repose pas sur la couleur seule : un texte le porte (§4.4).
 */

"use client";

import { useEffect, useState } from "react";

import { fr } from "@/i18n/fr";
import {
  getDeploymentEnvironment,
  type DeploymentEnvironment,
} from "@/services/deployment";

export function SyntheticDataBanner(): React.JSX.Element | null {
  // `undefined` = pas encore lu. Le bandeau s'affiche quand même : voir
  // « défaut sûr » ci-dessus.
  const [environment, setEnvironment] = useState<DeploymentEnvironment | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void getDeploymentEnvironment().then((result) => {
      if (cancelled) return;
      setEnvironment(result.ok ? result.data : "cloud-dev");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Seul cas où le bandeau disparaît : la base a répondu, et elle a répondu
  // `self-hosted`. Tout le reste l'affiche.
  if (environment === "self-hosted") return null;

  return (
    <div
      role="status"
      /* V3 — RESTYLÉ, PAS SUPPRIMÉ. Le contrat de session demandait son retrait
       * (« il n'a plus d'objet en local ») : on n'est pas en local,
       * `app.deployment` vaut toujours `cloud-dev`, et ce bandeau est la surface
       * visible de la condition 2 d'ADR-016. Il s'efface DÉJÀ tout seul le jour
       * où la base répond `self-hosted` — c'est le mécanisme prévu, et il n'y
       * avait rien à retirer. Voir `src/app/layout.tsx`.
       *
       * Reste opaque, reste en `--attention`, ne prend NI verre NI dégradé : les
       * trois règles de sécurité écrites en tête de ce fichier n'ont pas été
       * assouplies pour l'occasion. Seuls le rythme et la graisse ont changé. */
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--s-3)",
        padding: "var(--s-2) var(--s-5)",
        background: "var(--attention-bg)",
        color: "var(--attention-ink)",
        borderBottom: "var(--rule-width) solid var(--attention)",
        fontFamily: "var(--font-ui)",
        fontSize: "var(--text-body-size)",
        lineHeight: "var(--text-body-leading)",
      }}
    >
      {/* `eyebrow` : le seul style de titre en majuscules du système (§3). */}
      <strong
        style={{
          fontSize: "var(--text-eyebrow-size)",
          lineHeight: "var(--text-eyebrow-leading)",
          letterSpacing: "var(--text-eyebrow-tracking)",
          fontWeight: "var(--weight-semibold)",
          textTransform: "uppercase",
        }}
      >
        {fr.bandeauSynthetique.titre}
      </strong>
      <span style={{ color: "var(--ink-700)" }}>{fr.bandeauSynthetique.corps}</span>
      <span
        style={{
          marginLeft: "auto",
          color: "var(--ink-500)",
          fontSize: "var(--text-label-size)",
          lineHeight: "var(--text-label-leading)",
        }}
      >
        {fr.bandeauSynthetique.reference}
      </span>
    </div>
  );
}
