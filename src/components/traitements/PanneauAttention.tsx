"use client";

import { Badge, Bouton, Carte, Icone } from "@/components/ui";
import { dateCivile } from "@/components/patients/format";
import { traitements } from "@/i18n/traitements";
import type { Treatment } from "@/services/patient-treatments";

import { construireAttention, type AttentionItem } from "./modele-traitements";

function aujourdHuiAlger(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Algiers",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function contenu(item: AttentionItem): { titre: string; corps: string; pourquoi: string } {
  switch (item.code) {
    case "fin_depassee": {
      const date = String(item.params["dateFin"] ?? "");
      return traitements.attention.finDepassee(dateCivile(date) ?? date);
    }
    case "fin_proche": {
      const date = String(item.params["dateFin"] ?? "");
      const jours = Number(item.params["joursRestants"] ?? 0);
      return traitements.attention.finProche(dateCivile(date) ?? date, jours);
    }
    case "posologie_incomplete":
      return traitements.attention.posologieIncomplete(String(item.params["traitement"] ?? ""));
    case "polypharmacie":
      return traitements.attention.polypharmacie(Number(item.params["actifs"] ?? 0));
  }
}

export function PanneauAttention({
  traitements: liste,
  onOuvrir,
}: {
  readonly traitements: readonly Treatment[];
  readonly onOuvrir: (traitementId: string) => void;
}): React.JSX.Element {
  const items = construireAttention(liste, aujourdHuiAlger());

  if (items.length === 0) {
    return (
      <Carte niveau="secondaire">
        <div className="flex items-start gap-3 p-4">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-positive-bg text-positive">
            <Icone nom="valide" taille={20} />
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <p className="m-0 font-ui text-body font-semibold text-ink-900">{traitements.attention.vide}</p>
            <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{traitements.attention.videAide}</p>
          </div>
        </div>
      </Carte>
    );
  }

  return (
    <section aria-labelledby="titre-attention-traitements" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-attention-bg text-attention-ink">
              <Icone nom="alerte" taille={20} />
            </span>
            <h2 id="titre-attention-traitements" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
              {traitements.attention.titre}
            </h2>
            <Badge ton="attention">{String(items.length)}</Badge>
          </div>
          <p className="m-0 max-w-form font-ui text-label leading-relaxed text-ink-500">
            {traitements.attention.sousTitre}
          </p>
        </div>
      </div>

      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {items.map((item) => {
          const texte = contenu(item);
          return (
            <li key={`${item.code}-${item.traitementId ?? "global"}`}>
              <Carte niveau="secondaire">
                <div className="flex flex-wrap items-start justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-attention-bg text-attention-ink">
                      <Icone nom="alerte" taille={16} />
                    </span>
                    <div className="flex min-w-0 flex-col gap-1">
                      <p className="m-0 font-ui text-body font-semibold text-ink-900">{texte.titre}</p>
                      <p className="m-0 font-ui text-body text-ink-700">{texte.corps}</p>
                      <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{texte.pourquoi}</p>
                    </div>
                  </div>
                  {item.traitementId === null ? null : (
                    <Bouton
                      rang="discret"
                      taille="compact"
                      onClick={() => onOuvrir(item.traitementId ?? "")}
                    >
                      {traitements.attention.ouvrir}
                    </Bouton>
                  )}
                </div>
              </Carte>
            </li>
          );
        })}
      </ul>

      <p className="m-0 font-ui text-label leading-relaxed text-ink-500">{traitements.attention.absent}</p>
    </section>
  );
}
