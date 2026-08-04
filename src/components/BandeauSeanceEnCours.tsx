/**
 * Bandeau de rappel « Séance en cours », rendu par la coquille.
 *
 * ⚠️ CE COMPOSANT PORTE LE SEUL APPEL RÉSEAU DE LA COQUILLE. `AppShell` reste
 * purement présentationnel (voir son en-tête) : il ne fait que rendre
 * `<BandeauSeanceEnCours />` avant `{children}`, sans jamais importer de
 * service lui-même. C'est ce composant, et lui seul, qui connaît
 * `useSeanceEnCours` — la séparation existe précisément pour que les cinq
 * écrans (dont les trois écrans S3 gelés) reçoivent ce rappel sans qu'aucun
 * d'eux, ni la coquille, n'ait à être modifié.
 *
 * Surface OPAQUE (`--card` / `--rule`), pas de verre — §4 réserve le verre à
 * la chrome flottante, et ce bandeau vit dans le flux normal de la page, pas
 * au-dessus. Ton neutre, jamais `--critical` : une séance ouverte est un état
 * normal, pas un incident.
 */

"use client";

import Link from "next/link";

import { fr } from "@/i18n/fr";
import type { UserRole } from "@/services/authz";

import { useSeanceEnCours } from "./useSeanceEnCours";

export function BandeauSeanceEnCours({ role }: { readonly role: UserRole }): React.JSX.Element | null {
  const { seanceId, afficher } = useSeanceEnCours(role);

  if (!afficher || seanceId === null) return null;

  return (
    <aside
      aria-label={fr.consultation.seanceEnCours}
      style={{
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "var(--s-3)",
        padding: "var(--s-3) var(--s-5)",
        background: "var(--card)",
        borderBottom: "var(--rule-width) solid var(--rule)",
        fontFamily: "var(--font-ui)",
      }}
    >
      <span
        style={{
          fontSize: "var(--text-eyebrow-size)",
          lineHeight: "var(--text-eyebrow-leading)",
          letterSpacing: "var(--text-eyebrow-tracking)",
          fontWeight: "var(--weight-semibold)",
          textTransform: "uppercase",
          color: "var(--ink-500)",
        }}
      >
        {fr.consultation.seanceEnCours}
      </span>

      <Link
        href={`/consultation/${seanceId}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: "var(--target-min)",
          marginLeft: "auto",
          padding: "var(--s-1) var(--s-3)",
          borderRadius: "var(--r-md)",
          border: "var(--rule-width) solid var(--rule)",
          background: "var(--card)",
          color: "var(--ink-900)",
          fontSize: "var(--text-label-size)",
          lineHeight: "var(--text-label-leading)",
          fontFamily: "var(--font-ui)",
          textDecoration: "none",
        }}
      >
        {fr.consultation.reprendre}
      </Link>
    </aside>
  );
}
