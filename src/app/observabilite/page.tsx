/**
 * Observabilité — M09 reliquat LOT5 · inspection en lecture seule.
 *
 * ═══ COMPOSITION PAR RÔLE (I12), JAMAIS DES CHAMPS MASQUÉS ═══
 * `owner`/`practitioner` reçoivent le panneau (données demandées pour eux,
 * RLS en base) ; `assistant` reçoit une ERREUR, pas un panneau vide —
 * le panneau n'est jamais monté pour elle, donc aucun appel de porte ne
 * part (à vérifier en E2E par interception réseau). `null` (session
 * illisible) est une ERREUR avec « Réessayer », jamais un rôle supposé
 * (leçon V9 Lot C : `?? "assistant"` faisait changer de métier).
 *
 * Non listée au rail (fr.ts gelé) : liée depuis Paramètres pour les
 * praticiennes, URL directe sinon. Le rail est cosmétique (Rail.tsx) :
 * l'absence d'entrée ne protège ni n'expose rien — la RLS décide.
 */

"use client";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import { BlocErreur, Squelette } from "@/components/ui";
import { Bouton, LienBouton } from "@/components/ui/Bouton";
import { fr } from "@/i18n/fr";
import { m09 } from "@/i18n/m09";
import { PanneauObservabilite } from "@/components/observabilite/PanneauObservabilite";

export default function PageObservabilite(): React.JSX.Element {
  const {
    utilisateur,
    sessionTranchee,
    horsLigne: horsLigneSession,
    deconnecter,
    reessayer,
  } = useSessionEcran();

  if (sessionTranchee === false) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <BlocErreur
          message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-8 p-8">
        <Squelette lignes={1} />
        <Squelette lignes={8} />
      </main>
    );
  }

  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <BlocErreur
          message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<Bouton onClick={reessayer}>{fr.actions.reessayer}</Bouton>}
        />
      </main>
    );
  }

  if (utilisateur.role === "assistant") {
    return (
      <AppShell
        role={utilisateur.role}
        nomComplet={utilisateur.fullName}
        onDeconnexion={deconnecter}
        titre={m09.ecran.titre}
        sousTitre={m09.ecran.sousTitre}
      >
        <main className="flex flex-col gap-4 p-8">
          <BlocErreur
            message={m09.ecran.nonAutorise}
            action={
              <LienBouton href="/tableauDeBord" rang="secondaire">
                {m09.ecran.retourTableau}
              </LienBouton>
            }
          />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      titre={m09.ecran.titre}
      sousTitre={m09.ecran.sousTitre}
    >
      <div className="flex max-w-form flex-col gap-6">
        <PanneauObservabilite horsLigne={horsLigneSession} />
      </div>
    </AppShell>
  );
}
