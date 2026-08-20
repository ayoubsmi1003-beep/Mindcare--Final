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
 */

"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { FormulaireConnexion } from "@/components/FormulaireConnexion";
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
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "var(--size-viewport)",
        padding: "var(--s-6)",
        /* V3 — `--grad-auth`, au catalogue fermé d'ADR-022, qui nomme
         * explicitement l'écran de connexion parmi les surfaces où la couleur
         * est autorisée. Le dégradé est ICI, sur le fond, et non plus sous les
         * champs de saisie : c'est le premier écran que voit la praticienne le
         * matin, il doit dire la marque, mais aucune de ses valeurs ne repose
         * dessus. La carte du formulaire est blanche et opaque par-dessus. */
        background: "var(--grad-auth)",
        fontFamily: "var(--font-ui)",
      }}
    >
      {/* Le titre de l'écran est le `<h1>` du formulaire lui-même : en ajouter
          un second ici donnerait deux titres de premier niveau sur une page
          qui n'a qu'un sujet, et un lecteur d'écran annoncerait la même chose
          deux fois. */}
      <FormulaireConnexion
        onSubmit={handleSubmit}
        enCours={enCours}
        messageErreur={messageErreur}
        horsLigne={horsLigne}
      />
    </main>
  );
}
