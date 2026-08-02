import type { ReactNode } from "react";

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
      <body>{children}</body>
    </html>
  );
}
