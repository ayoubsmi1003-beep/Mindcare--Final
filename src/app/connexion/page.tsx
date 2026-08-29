/**
 * Écran de connexion — câblage entre `FormulaireConnexion` et `src/services/auth`.
 *
 * Le composant est présentationnel et ne connaît aucun service ; cette page
 * fait la jonction, et elle seule. Elle ne prend AUCUNE décision d'autorisation
 * : elle ouvre une session, puis laisse la RLS Postgres décider de ce que cette
 * session voit. Il n'y a pas de « si le rôle est X, aller vers Y » ici — tout
 * le monde arrive sur Patients, et la base répond ce qu'elle doit répondre.
 *
 * POURQUOI `router.replace` ET PAS `push` : après une connexion réussie, le
 * bouton Retour ne doit pas ramener sur un formulaire de connexion déjà utilisé.
 *
 * v9 — L'ÉCRAN D'ENTRÉE EST COMPOSÉ. Deux colonnes au-dessus de la rupture
 * `tablet` : le panneau de marque à gauche (le dégradé `--grad-auth`, le mark,
 * l'accroche, le semis de feuilles en filigrane), le formulaire à droite dans
 * sa carte opaque. En dessous, le panneau de marque se replie en en-tête au-
 * dessus de la carte — jamais supprimé : c'est lui qui dit « vous êtes chez
 * MindCare » à la première heure. Aucune valeur du formulaire ne repose sur le
 * dégradé : la carte reste blanche et opaque, à contraste constant (§4.2).
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormulaireConnexion } from "@/components/FormulaireConnexion";
import { MarqueMindCare, MotifFeuilles } from "@/components/ui/Icones";
import { fr } from "@/i18n/fr";
import { signIn } from "@/services/auth";

export default function PageConnexion(): React.JSX.Element {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);

  function handleSubmit(email: string, motDePasse: string): void {
    setEnCours(true);
    setMessageErreur(undefined);
    setHorsLigne(false);

    void signIn({ email, password: motDePasse }).then((result) => {
      if (result.ok) {
        // On ne remet pas `enCours` à false : la page est sur le point de
        // disparaître, et rendre le bouton à nouveau cliquable pendant la
        // navigation invite à un second envoi.
        router.replace("/patients");
        return;
      }

      // `hors-ligne` est distingué de l'erreur : la conduite à tenir n'est pas
      // la même, et le formulaire le rend différemment (ton neutre, pas
      // `--attention`). Une coupure réseau n'est pas une faute de saisie.
      setHorsLigne(result.error.code === "hors-ligne");
      setMessageErreur(result.error.message);
      setEnCours(false);
    });
  }

  return (
    /* Le titre de l'écran est le `<h1>` du formulaire lui-même : en ajouter
        un second ici donnerait deux titres de premier niveau sur une page
        qui n'a qu'un sujet, et un lecteur d'écran annoncerait la même chose
        deux fois. Le panneau de marque ne porte donc aucun titre — le mark
        et l'accroche sont des images et du texte d'accompagnement. */
    <main
      className="flex min-h-viewport items-center justify-center p-6"
      /* V3 — `--grad-auth`, au catalogue fermé d'ADR-022, qui nomme
       * explicitement l'écran de connexion parmi les surfaces où la couleur
       * est autorisée. v9 ajoute le reflet : une source de lumière, donc une
       * épaisseur, sur ce qui était un aplat. */
      style={{ background: "var(--grad-auth)", fontFamily: "var(--font-ui)" }}
    >
      <div className="relative flex w-full max-w-auth items-stretch justify-center gap-10 tablet:justify-between">
        {/* Le reflet, sous les deux colonnes — décor pur, jamais une encre. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden bg-grad-hero-reflet tablet:block"
        />

        {/* ── Le panneau de marque — au-dessus de la rupture `tablet` ────── */}
        <div className="sur-marque relative hidden flex-1 flex-col justify-between py-8 tablet:flex">
          <div className="flex items-center gap-4 text-on-brand">
            <MarqueMindCare taille={44} titre="MindCare OS" />
            <span className="font-ui text-title font-semibold">MindCare OS</span>
          </div>
          <div className="flex flex-col gap-3 text-on-brand">
            <p className="m-0 font-ui text-title font-semibold">
              {fr.connexion.accroche}
            </p>
            <MotifFeuilles className="h-32 w-64 text-on-brand opacity-filigrane" />
          </div>
        </div>

        {/* ── Le panneau de marque REPLIÉ — l'en-tête au-dessus de la carte ── */}
        <div className="sur-marque absolute -top-2 left-0 right-0 flex items-center justify-center gap-3 pb-4 text-on-brand tablet:hidden">
          <MarqueMindCare taille={32} titre="MindCare OS" />
          <span className="font-ui text-body font-semibold">MindCare OS</span>
        </div>

        {/* La carte, à contraste constant — aucune valeur ne repose sur le
            dégradé. Au-dessus de la rupture, elle occupe la colonne droite ;
            en dessous, elle se pose sous l'en-tête replié. */}
        <div className="relative mt-12 flex w-full justify-center tablet:mt-0 tablet:w-auto">
          <FormulaireConnexion
            onSubmit={handleSubmit}
            enCours={enCours}
            messageErreur={messageErreur}
            horsLigne={horsLigne}
          />
        </div>
      </div>
    </main>
  );
}
