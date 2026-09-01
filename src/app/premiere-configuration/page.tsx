/**
 * Écran de premier lancement — câblage entre `FormulairePremierLancement` et
 * `src/services/onboarding`. Même répartition des rôles que `connexion/page.tsx` :
 * ce fichier ne prend aucune décision d'autorisation, il ouvre un formulaire
 * puis appelle une porte SQL qui, elle, décide (084/085).
 *
 * GARDE D'ACCÈS : cet écran ne doit exister que sur une installation
 * `self-hosted` pas encore provisionnée. Ailleurs (développement, ou une
 * installation déjà configurée), on renvoie immédiatement vers la connexion —
 * jamais un formulaire de création de compte qui n'a plus lieu d'être.
 */

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  FormulairePremierLancement,
  type EntreeFormulairePremierLancement,
} from "@/components/FormulairePremierLancement";
import { MarqueMindCare, MotifFeuilles } from "@/components/ui/Icones";
import { fr } from "@/i18n/fr";
import { getInstallationStatus, provisionOwnerAccount } from "@/services/onboarding";

type EtatGarde = "verification" | "autorise" | "refuse";

export default function PagePremiereConfiguration(): React.JSX.Element | null {
  const router = useRouter();
  const [garde, setGarde] = useState<EtatGarde>("verification");
  const [enCours, setEnCours] = useState(false);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [succes, setSucces] = useState(false);

  useEffect(() => {
    let annule = false;
    void getInstallationStatus().then((result) => {
      if (annule) return;
      const autorise =
        result.ok && result.data.environment === "self-hosted" && !result.data.provisionne;
      if (!autorise) {
        router.replace("/connexion");
        return;
      }
      setGarde("autorise");
    });
    return () => {
      annule = true;
    };
  }, [router]);

  function handleSubmit(entree: EntreeFormulairePremierLancement): void {
    setEnCours(true);
    setMessageErreur(undefined);

    void provisionOwnerAccount(entree).then((result) => {
      if (result.ok) {
        setSucces(true);
        // Pas de session ouverte automatiquement : la praticienne se connecte
        // avec les identifiants qu'elle vient de choisir, comme n'importe
        // quel autre jour — la même porte, la même vérification.
        return;
      }
      setMessageErreur(
        result.error.code === "conflit"
          ? fr.premierLancement.erreurConflit
          : result.error.message,
      );
      setEnCours(false);
    });
  }

  if (garde !== "autorise") return null;

  return (
    <main
      className="flex min-h-viewport items-center justify-center p-6"
      style={{ background: "var(--grad-auth)", fontFamily: "var(--font-ui)" }}
    >
      <div className="relative flex w-full max-w-auth items-stretch justify-center gap-10 tablet:justify-between">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden bg-grad-hero-reflet tablet:block"
        />

        <div className="sur-marque relative hidden flex-1 flex-col justify-between py-8 tablet:flex">
          <div className="flex items-center gap-4 text-on-brand">
            <MarqueMindCare taille={44} titre="MindCare OS" />
            <span className="font-ui text-title font-semibold">MindCare OS</span>
          </div>
          <div className="flex flex-col gap-3 text-on-brand">
            <p className="m-0 font-ui text-title font-semibold">{fr.premierLancement.accroche}</p>
            <MotifFeuilles className="h-32 w-64 text-on-brand opacity-filigrane" />
          </div>
        </div>

        <div className="sur-marque absolute -top-2 left-0 right-0 flex items-center justify-center gap-3 pb-4 text-on-brand tablet:hidden">
          <MarqueMindCare taille={32} titre="MindCare OS" />
          <span className="font-ui text-body font-semibold">MindCare OS</span>
        </div>

        <div className="relative mt-12 flex w-full justify-center tablet:mt-0 tablet:w-auto">
          {succes ? (
            <div className="flex w-full max-w-form flex-col items-start gap-6 rounded-xl border border-rule bg-card p-10 shadow-lift3">
              <span
                aria-hidden="true"
                className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-grad-orb text-on-brand shadow-glow-brand"
              >
                <MarqueMindCare taille={28} />
              </span>
              <p role="status" className="m-0 font-ui text-body text-ink-900">
                {fr.premierLancement.succes}
              </p>
              <button
                type="button"
                onClick={() => router.replace("/connexion")}
                className="flex min-h-target-lg w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-action-600 px-5 py-3 font-ui text-body font-semibold text-paper shadow-lift1 transition duration-quick ease-soft hover:bg-action-700 hover:shadow-lift2 active:bg-action-900 active:shadow-lift1"
              >
                {fr.premierLancement.allerConnexion}
              </button>
            </div>
          ) : (
            <FormulairePremierLancement
              onSubmit={handleSubmit}
              enCours={enCours}
              messageErreur={messageErreur}
            />
          )}
        </div>
      </div>
    </main>
  );
}
