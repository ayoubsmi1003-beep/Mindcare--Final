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
 * v10 — AUTH-SWITCH VERT/BLANC, FIGÉ EN CONNEXION SEULE. La carte est
 * scindée comme la référence 21st.dev (panneau vert à gauche, formulaire
 * blanc à droite, pastilles pilule), mais SANS bascule `sign-up` ni social :
 * un cabinet n'a ni inscription publique ni OAuth externe (loi 18-07,
 * local-first). Le panneau vert est statique — marque, accroche, semis de
 * feuilles en filigrane. En dessous de `tablet`, il se replie en bandeau
 * au-dessus du formulaire — jamais supprimé. Aucune valeur du formulaire
 * ne repose sur le dégradé : la colonne droite reste blanche et opaque,
 * à contraste constant (§4.2).
 */

"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { FormulaireConnexion } from "@/components/FormulaireConnexion";
import { MarqueMindCare, MotifFeuilles } from "@/components/ui/Icones";
import { fr } from "@/i18n/fr";
import { signIn } from "@/services/auth";
import { getInstallationStatus } from "@/services/onboarding";

export default function PageConnexion(): React.JSX.Element {
  const router = useRouter();
  const [enCours, setEnCours] = useState(false);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [horsLigne, setHorsLigne] = useState(false);

  /**
   * Premier lancement (§D, phase Bureau Windows) : une installation
   * `self-hosted` sans compte réel n'a rien à faire sur cet écran — la
   * praticienne n'a encore aucun identifiant à saisir. `cloud-dev` (le
   * développement) n'est JAMAIS concerné : y rediriger sans cesse casserait
   * `pnpm dev`, où aucun compte n'est provisionné par ce chemin.
   *
   * Échec de la sonde (hors ligne, base injoignable) → on reste sur cet
   * écran : `signIn` produira alors son propre message, plus informatif que
   * de bloquer avant même d'avoir tenté quoi que ce soit.
   */
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
        deux fois. Le panneau vert ne porte donc aucun titre — le mark et
        l'accroche sont des images et du texte d'accompagnement. */
    <main
      className="flex min-h-viewport items-center justify-center bg-canevas p-6"
      style={{ fontFamily: "var(--font-ui)" }}
    >
      {/* La carte scindée AuthSwitch : vert à gauche, blanc à droite.
          `overflow-hidden` + `rounded-3xl` : la courbe de la référence, sans
          cercle positionné en dur. Le fond de page reste `--canevas`
          (menthe clair) — le vert ne vit QUE dans le panneau, jamais en
          aplat plein écran qui écraserait le contraste. */}
      <div className="grid w-full max-w-auth overflow-hidden rounded-3xl border border-rule bg-card shadow-elevee tablet:grid-cols-2">
        {/* ── Panneau vert — statique, jamais une bascule sign-up ─────────── */}
        <div className="sur-marque relative flex flex-col justify-between gap-8 overflow-hidden bg-grad-brand p-8 text-on-brand tablet:p-12">
          {/* Reflet : source de lumière sur le dégradé, décor pur. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-reflet"
          />
          <div className="relative flex items-center gap-4">
            <MarqueMindCare taille={44} titre="MindCare OS" />
            <span className="flex min-w-0 flex-col">
              <span className="font-ui text-title font-semibold">MindCare OS</span>
              <span className="font-ui text-label">{fr.coquille.marqueSousTitre}</span>
            </span>
          </div>
          <div className="relative flex flex-col gap-4">
            <p className="m-0 font-ui text-title font-semibold">
              {fr.connexion.accroche}
            </p>
            <MotifFeuilles className="h-32 w-64 text-on-brand opacity-filigrane" />
          </div>
        </div>

        {/* ── Colonne formulaire — blanche, opaque, contraste constant ────── */}
        <div className="relative flex w-full items-center justify-center">
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
