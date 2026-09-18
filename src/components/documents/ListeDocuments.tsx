"use client";

/**
 * Liste Documents — cartes premium, état + numéro + patient + actions.
 *
 * VIEW ≠ PRINT : la liste n'affiche JAMAIS de blocage d'impression — elle liste.
 * Le statut voided est visible ("Annulé") et ne supprime jamais la ligne.
 */

import { Badge } from "@/components/ui/Badge";
import { Bouton } from "@/components/ui/Bouton";
import { Carte, PastilleIcone } from "@/components/ui/Surfaces";
import { fr } from "@/i18n/fr";
import type { Document } from "@/services/documents";

function dateLisible(iso: string): string {
  return new Intl.DateTimeFormat("fr-DZ", {
    timeZone: "Africa/Algiers",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

function tonStatut(s: Document["status"]): "positif" | "attention" | "neutre" {
  if (s === "voided") return "attention";
  return "positif";
}
function labelStatut(s: Document["status"]): string {
  if (s === "voided") return "Annulé";
  return "Émis";
}

export function ListeDocuments({
  documents,
  documentOuvert,
  onOuvrir,
  onImprimer,
}: {
  readonly documents: readonly Document[];
  readonly documentOuvert: string | null;
  readonly onOuvrir: (id: string) => void;
  readonly onImprimer?: (id: string) => void;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <p className="sr-only">{fr.documents.liste.titre}</p>
      {documents.map((d) => {
        const actif = d.id === documentOuvert;
        const annule = d.status === "voided";
        return (
          <Carte
            key={d.id}
            niveau={actif ? "document" : "primaire"}
            interactive={false}
          >
            <div
              className={[
                "flex flex-col gap-3 p-4",
                actif ? "border-l-4 border-action-500" : "border-l-4 border-transparent",
                annule ? "opacity-disabled" : "",
              ].join(" ")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <PastilleIcone nom="documents" ton={annule ? "neutre" : "action"} />
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <p className="truncate font-ui text-body font-medium leading-body text-ink-900">
                      {fr.documents.types[d.docType]}
                    </p>
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-ui text-label leading-label text-ink-500">
                      {d.patientNom !== null || d.patientPrenom !== null ? (
                        <span className="font-medium text-ink-700">
                          {[d.patientNom, d.patientPrenom].filter(Boolean).join(" ")}
                        </span>
                      ) : (
                        <span className="text-ink-500">—</span>
                      )}
                      <span aria-hidden>·</span>
                      <span className="font-num tabular-nums">{dateLisible(d.issuedAt)}</span>
                      <span aria-hidden>·</span>
                      <span className="font-num tabular-nums">{d.docNumber}</span>
                    </p>
                    {d.recordNumber !== null ? (
                      <span className="font-num text-label tabular-nums text-ink-500">
                        {d.recordNumber}
                      </span>
                    ) : null}
                  </div>
                </div>
                <Badge ton={tonStatut(d.status)}>{labelStatut(d.status)}</Badge>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-ui text-label text-ink-500" title={fr.documents.impression.avertissementCompteur}>
                  {fr.documents.impression.envoyees} {d.printedCount}
                  {annule && d.voidReason ? ` · ${d.voidReason}` : ""}
                </span>
                <div className="flex items-center gap-2">
                  <Bouton rang={actif ? "principal" : "secondaire"} onClick={() => onOuvrir(d.id)}>
                    {fr.documents.liste.ouvrir}
                  </Bouton>
                  {onImprimer !== undefined ? (
                    <Bouton rang="discret" onClick={() => onImprimer(d.id)}>
                      {fr.documents.impression.imprimer}
                    </Bouton>
                  ) : null}
                </div>
              </div>
            </div>
          </Carte>
        );
      })}
    </div>
  );
}
