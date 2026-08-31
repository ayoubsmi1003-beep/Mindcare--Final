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
 *
 * v9 — LE BANDEAU EST COMPOSÉ, plus une ligne grise. La pastille d'horloge
 * ancre le regard, l'eyebrow porte l'état, et le lien « Reprendre » devient
 * l'objet le plus posable de la barre : c'est LE geste que ce bandeau existe
 * pour offrir. Aucune donnée clinique ne repose sur le bandeau — son libellé
 * est un état, pas une valeur.
 */

"use client";

import Link from "next/link";

import { fr } from "@/i18n/fr";
import type { UserRole } from "@/services/authz";

import { Icone } from "./ui/Icones";
import { useSeanceEnCours } from "./useSeanceEnCours";

export function BandeauSeanceEnCours({ role }: { readonly role: UserRole }): React.JSX.Element | null {
  const { seanceId: brut, afficher } = useSeanceEnCours(role);

  if (!afficher || brut === null) return null;
  // `get_open_consultation` rend un uuid ; selon l'adaptateur la valeur peut arriver
  // emballée (`{ get_open_consultation: uuid }`). Le service déballe déjà, mais on
  // reste défensif ici pour éviter `/consultation/[object Object]` en cas de
  // divergence d'adaptateur.
  const rec: unknown = brut;
  const seanceId = typeof brut === "string" ? brut : String((rec as Record<string, unknown>).get_open_consultation ?? brut);
  if (seanceId === "[object Object]" || seanceId.trim() === "") return null;

  return (
    <aside
      aria-label={fr.consultation.seanceEnCours}
      className="flex flex-wrap items-center gap-3 border-b border-rule bg-card px-5 py-2"
    >
      <span
        aria-hidden="true"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-action-100 text-action-600"
      >
        <Icone nom="horloge" taille={16} />
      </span>

      <span className="font-ui text-label font-semibold tracking-label text-ink-700">
        {fr.consultation.seanceEnCours}
      </span>

      <Link
        href={`/consultation/${seanceId}`}
        className="ml-auto inline-flex min-h-target items-center gap-2 rounded-full bg-action-600 px-4 py-2 font-ui text-label font-medium text-paper no-underline shadow-lift1 transition duration-quick ease-soft hover:bg-action-700 hover:shadow-lift2"
      >
        {fr.consultation.reprendre}
        <Icone nom="fleche" taille={16} />
      </Link>
    </aside>
  );
}
