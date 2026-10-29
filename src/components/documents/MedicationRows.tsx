"use client";

import { useId, useState } from "react";

import { Icone } from "@/components/ui";
import { ListeSuggestions, surligner } from "@/components/recherche/ListeSuggestions";
import { useRechercheInstantane } from "@/components/recherche/use-recherche-instantanee";
import { documentsEditor as t } from "@/i18n/documents-editor";
import { recherche } from "@/i18n/recherche";
import { searchMedicationsPage, type MedicationCatalogItem } from "@/services/medications";
import type { DocumentContent, DocumentNode } from "@/shared/documents/types";

import {
  dailyFrequency,
  prescribedDose,
  setDailyFrequency,
  setMedicationName,
  setPrescribedDose,
} from "./prescription-fields";

function chercherMedicament(
  q: string,
  limit: number,
  offset: number,
): ReturnType<typeof searchMedicationsPage> {
  return searchMedicationsPage(q, limit, offset);
}

function MedicationRow({
  node,
  change,
  remove,
}: {
  readonly node: DocumentNode;
  readonly change: (attrs: DocumentNode["attrs"]) => void;
  readonly remove: () => void;
}): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [actif, setActif] = useState(0);
  const idListe = useId();
  const attrs = node.attrs ?? {};
  const frequency = dailyFrequency(attrs);

  const { etat, chargerPlus, reinitialiser } = useRechercheInstantane<MedicationCatalogItem>({
    requete: query,
    chercher: chercherMedicament,
    minimum: 2,
    taille: 50,
    cle: (item) => item.id,
  });

  const choisir = (item: MedicationCatalogItem): void => {
    change({
      ...attrs,
      source: "catalogue",
      medicationId: item.id,
      designation: item.rawName,
      strength: "",
    });
    setQuery("");
    setActif(0);
    reinitialiser();
  };

  const surTouche = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActif((index) => Math.min(index + 1, Math.max(etat.resultats.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActif((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      const choisi = etat.resultats[actif];
      if (choisi !== undefined) {
        event.preventDefault();
        choisir(choisi);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setQuery("");
      reinitialiser();
    }
  };

  const approximatif =
    etat.resultats.length > 0 && etat.resultats.every((item) => item.rank >= 4);

  return (
    <div className="doc2-med-row">
      <div className="doc2-med-inputs">
        <label>
          {t.medication}
          <input
            autoComplete="off"
            role="combobox"
            aria-expanded={etat.resultats.length > 0}
            aria-controls={etat.resultats.length > 0 ? idListe : undefined}
            aria-activedescendant={
              etat.resultats.length > 0 ? `${idListe}-option-${actif}` : undefined
            }
            aria-autocomplete="list"
            value={String(attrs["designation"] ?? "")}
            onKeyDown={surTouche}
            onChange={(event) => {
              setQuery(event.target.value);
              setActif(0);
              change(setMedicationName(attrs, event.target.value));
            }}
          />
        </label>
        <label>
          {t.strength}
          <input
            value={String(attrs["strength"] ?? "")}
            onChange={(event) => change({ ...attrs, strength: event.target.value })}
          />
        </label>
        <label>
          {t.prescribedDose}
          <input
            value={prescribedDose(attrs)}
            onChange={(event) => change(setPrescribedDose(attrs, event.target.value))}
          />
        </label>
        <label>
          {t.dailyCount}
          <input
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={frequency}
            onChange={(event) => change(setDailyFrequency(attrs, event.target.value))}
          />
        </label>
        <label>
          {t.frequency}
          <input
            value={String(attrs["frequency"] ?? "")}
            onChange={(event) => change({ ...attrs, frequency: event.target.value })}
          />
        </label>
        <button
          className="doc2-remove"
          type="button"
          aria-label={t.remove}
          title={t.remove}
          onClick={remove}
        >
          <Icone nom="croix" taille={16} />
        </button>
      </div>

      {frequency === "" ? <p className="doc2-hint is-warning">{t.frequencyMissing}</p> : null}

      {query.trim().length === 1 ? (
        <p className="doc2-hint">{recherche.minimum}</p>
      ) : null}

      {approximatif ? (
        <p role="status" className="doc2-hint">
          {recherche.approximatif}
        </p>
      ) : null}

      {query.trim().length >= 2 ? (
        <ListeSuggestions
          idListe={idListe}
          items={etat.resultats}
          actif={actif}
          onChoisir={choisir}
          rendre={(item) => (
            <span className="flex flex-col gap-0.5">
              <span className="font-medium">{surligner(item.rawName, query)}</span>
              <span className="font-ui text-label text-ink-500">
                {[item.strength, item.form].filter(Boolean).join(" · ") || item.inn}
              </span>
            </span>
          )}
          requete={query}
          total={etat.total}
          chargement={etat.chargement}
          chargementPlus={etat.chargementPlus}
          erreur={etat.erreur}
          vide={recherche.aucunMedicament}
          onPlus={chargerPlus}
        />
      ) : null}
    </div>
  );
}

export function MedicationRows({
  content,
  onChange,
}: {
  readonly content: DocumentContent;
  readonly onChange: (content: DocumentContent) => void;
}): React.JSX.Element {
  const rows = content.content.filter((node) => node.type === "medication");
  const change = (index: number, node: DocumentNode | null): void => {
    const next = [...content.content];
    if (node !== null) next[index] = node;
    else next.splice(index, 1);
    onChange({ ...content, content: next });
  };

  return (
    <section className="doc2-medications">
      <div className="doc2-panel-heading">
        <h3>{t.prescription}</h3>
        <p>{t.prescriptionHint}</p>
      </div>
      {rows.length === 0 ? <p className="doc2-med-empty">{t.noMedication}</p> : null}
      {content.content.map((node, index) =>
        node.type === "medication" ? (
          <MedicationRow
            key={String(node.attrs?.["rowId"])}
            node={node}
            change={(attrs) => change(index, { ...node, attrs: attrs ?? {} })}
            remove={() => change(index, null)}
          />
        ) : null,
      )}
      <button
        className="doc2-add"
        type="button"
        disabled={rows.length >= 50}
        onClick={() =>
          onChange({
            ...content,
            content: [
              ...content.content,
              {
                type: "medication",
                attrs: {
                  rowId: crypto.randomUUID(),
                  medicationId: null,
                  source: "free-text",
                  designation: "",
                  strength: "",
                  posology: "",
                  quantity: "",
                  frequency: "",
                  duration: "",
                  administration: "",
                  instructions: "",
                },
              },
            ],
          })
        }
      >
        <Icone nom="plus" taille={16} />
        {t.addMedication}
      </button>
    </section>
  );
}
