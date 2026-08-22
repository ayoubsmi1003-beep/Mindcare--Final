"use client";

/**
 * L'historique documentaire d'un dossier.
 *
 * ⚠️ AUCUNE ACTION DE MODIFICATION NI DE SUPPRESSION, ICI NI AILLEURS. `030`
 * ne pose aucune porte `update_document` ni `delete_document`, et la table
 * elle-même est verrouillée par déclencheur : un certificat remis au patient
 * existe hors du système, et le rattraper en base ne le rattrape pas dans sa
 * poche. Une erreur se corrige en émettant un NOUVEAU document, numéroté à sa
 * date. Ne pas ajouter de bouton « corriger » ici en croyant compléter l'écran.
 *
 * ⚠️ `printed_count` COMPTE DES ENVOIS À L'IMPRESSION, PAS DES FEUILLES. Le
 * navigateur ne dit jamais si la boîte de dialogue a été validée ou annulée.
 * La colonne le dit dans son libellé, et l'infobulle le redit : afficher
 * « imprimé 2 fois » affirmerait une chose que le système ne peut pas savoir.
 */

import { Bouton } from "@/components/ui";
import { CACHE_VISUELLEMENT } from "@/components/finance/a11y";
import { fr } from "@/i18n/fr";
import type { Document } from "@/services/documents";

/** `2026-08-21T09:12:00Z` → `21/08/2026`, dans le fuseau du cabinet. */
function dateLisible(iso: string): string {
  return new Intl.DateTimeFormat("fr-DZ", {
    timeZone: "Africa/Algiers",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

export function ListeDocuments({
  documents,
  documentOuvert,
  onOuvrir,
}: {
  readonly documents: readonly Document[];
  readonly documentOuvert: string | null;
  readonly onOuvrir: (id: string) => void;
}): React.JSX.Element {
  return (
    <table className="w-full border-collapse font-ui text-body">
      {/* ⚠️ PAS `sr-only` : tailwind.config.ts REMPLACE les échelles du cœur au
          lieu de les étendre, et une classe absente ne produit aucune règle — en
          silence. `CACHE_VISUELLEMENT` est écrit dans tokens.css. */}
      <caption className={CACHE_VISUELLEMENT}>{fr.documents.liste.titre}</caption>
      <thead>
        <tr className="border-b border-rule text-left">
          <th scope="col" className="py-2 pr-3 font-medium text-ink-500">
            {fr.documents.liste.colonneType}
          </th>
          <th scope="col" className="py-2 pr-3 font-medium text-ink-500">
            {fr.documents.liste.colonneDate}
          </th>
          <th
            scope="col"
            className="py-2 pr-3 font-medium text-ink-500"
            title={fr.documents.impression.avertissementCompteur}
          >
            {fr.documents.liste.colonneImpressions}
          </th>
          <th scope="col" className="py-2">
            <span className={CACHE_VISUELLEMENT}>{fr.documents.liste.ouvrir}</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {documents.map((d) => (
          <tr
            key={d.id}
            className={[
              "border-b border-rule",
              d.id === documentOuvert ? "bg-brand-50" : "",
            ].join(" ")}
          >
            <td className="whitespace-nowrap py-2 pr-3 text-ink-900">
              {fr.documents.types[d.docType]}
            </td>
            <td className="whitespace-nowrap py-2 pr-3 font-num text-ink-700">
              {dateLisible(d.issuedAt)}
            </td>
            <td className="whitespace-nowrap py-2 pr-3 font-num text-ink-700">
              {d.printedCount}
            </td>
            <td className="py-2 text-right">
              <Bouton rang="discret" onClick={() => onOuvrir(d.id)}>
                {fr.documents.liste.ouvrir}
              </Bouton>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
