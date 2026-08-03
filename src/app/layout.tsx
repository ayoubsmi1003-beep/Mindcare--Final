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
    <html lang="fr">
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
