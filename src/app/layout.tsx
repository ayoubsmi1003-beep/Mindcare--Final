import type { ReactNode } from "react";

import { SyntheticDataBanner } from "@/components/SyntheticDataBanner";

// Source unique des jetons de design (I10). Importé au niveau racine : aucun
// écran ne rend correctement sans lui, tailwind.config.ts ne faisant que
// consommer les variables qu'il déclare.
import "../styles/tokens.css";

export default function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    /* `suppressHydrationWarning` SUR CETTE BALISE ET NULLE PART AILLEURS.
       Une extension de navigateur (TrendTrack) pose `data-trendtrack-react-active`
       sur `<html>` AVANT que React ne s'hydrate : le serveur n'a pas rendu cet
       attribut, le client le trouve, et React déclare l'arbre entier
       non réconcilié. Le défaut n'est pas dans ce dépôt et aucune correction de
       notre code ne le ferait disparaître — le poste du cabinet portera ses
       propres extensions.

       ⚠️ CE N'EST PAS UN INTERRUPTEUR À GÉNÉRALISER. Posé plus bas dans l'arbre,
       il masquerait de VRAIES divergences serveur/client — une dose, un montant
       ou une heure de rendez-vous affichés différemment selon le rendu, sans
       qu'aucun avertissement ne le signale. Il ne couvre ici que les attributs
       de `<html>` lui-même, pas ses enfants. */
    <html lang="fr" suppressHydrationWarning>
      <body>
        {/* ADR-016 — posé À LA RACINE, donc impossible à oublier sur un écran.
            Placé dans un layout par page, il manquerait exactement là où on ne
            l'a pas prévu, c'est-à-dire là où on en aurait besoin. */}
        <SyntheticDataBanner />
        {children}
      </body>
    </html>
  );
}
