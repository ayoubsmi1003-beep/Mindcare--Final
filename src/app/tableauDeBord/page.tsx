/**
 * Tableau de bord — LE poste d'accueil pour l'assistante, un placeholder
 * honnête pour les praticiennes.
 *
 * ⚠️ COMPOSITION PAR RÔLE (I12), jamais des champs masqués. Pour l'assistante,
 * ce fichier rend le cockpit complet : sa navigation existe déjà dans AppShell
 * (`NAVIGATION_ASSISTANTE`) et sa donnée vient d'un contrat de lecture qui ne
 * PORTE aucun champ clinique (`app.reception_board`, 046) — rien n'est caché,
 * rien n'est absent du réseau parce qu'il n'a jamais été demandé.
 *
 * Pour owner/practitioner : UNE phrase honnête. Le tableau de bord praticien
 * est la session V4, restée due entière (D-23) — le lot cockpit ne l'absorbe
 * pas. Un placeholder simulé mentrait (I19) ; une phrase dit ce qui arrivera.
 *
 * La racine `/` n'est PAS touchée : elle redirige vers /patients comme avant
 * (règle 10 — le moindre geste hors périmètre coûte plus cher qu'il ne rend).
 *
 * LES CINQ ÉTATS (05-UX §1) sont portés par `CockpitReception` zone par zone ;
 * le garde de session ci-dessous suit le patron exact de `/agenda`.
 */

"use client";

import { CockpitReception } from "@/components/reception/CockpitReception";
import {
  BandeauHorsLigne,
  BlocErreur,
  EtatVide,
  LienBouton,
  Squelette,
} from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";

export default function PageTableauDeBord(): React.JSX.Element {
  const { utilisateur, sessionTranchee, horsLigne: horsLigneSession, deconnecter } =
    useSessionEcran();

  // Session tranchée NÉGATIVEMENT : sortie explicite, pas un vide muet.
  if (sessionTranchee === false) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={
            horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]
          }
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  if (utilisateur === undefined) {
    // Le squelette a la FORME de ce qui arrive (05-UX §2) : en-tête + corps.
    return (
      <main className="flex flex-col gap-8 p-8">
        <Squelette lignes={1} />
        <Squelette lignes={8} />
      </main>
    );
  }

  // Profil ILLISIBLE mais session valide : le défaut sûr d'/agenda — on
  // affiche avec la composition la plus étroite plutôt que de bloquer un
  // écran qui marche. La RLS reste la seule frontière sur la donnée.
  const role = utilisateur?.role ?? "assistant";

  // Praticiennes : V4 reste due — on le DIT au lieu d'afficher un faux écran.
  if (role !== "assistant") {
    return (
      <AppShell role={role} nomComplet={utilisateur?.fullName ?? ""} onDeconnexion={deconnecter}>
        <div className="flex flex-col gap-6">
          {horsLigneSession ? <BandeauHorsLigne /> : null}
          <EtatVide message={fr.reception.placeholderPraticienne} />
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell
      role={role}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
    >
      {/* Le cockpit se dimensionne lui-même : hauteur pleine du main, défilement
          interne par zone, zéro défilement de page à 1440×900. */}
      <div className="flex h-full min-h-0 flex-col">
        <CockpitReception horsLigneSession={horsLigneSession} />
      </div>
    </AppShell>
  );
}
