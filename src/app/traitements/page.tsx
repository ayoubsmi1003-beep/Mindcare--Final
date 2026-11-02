"use client";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import { ChargeTraitements } from "@/components/traitements/ChargeTraitements";
import { BlocErreur, LienBouton, Squelette } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { traitements } from "@/i18n/traitements";

export default function PageTraitements(): React.JSX.Element {
  const { utilisateur, horsLigne, deconnecter } = useSessionEcran();

  if (utilisateur === undefined) {
    return (
      <main className="p-8">
        <Squelette lignes={5} />
      </main>
    );
  }

  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <BlocErreur
          message={horsLigne ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      sousTitre={traitements.charge.sousTitre}
    >
      <ChargeTraitements />
    </AppShell>
  );
}
