/**
 * Carte « RÉSUMÉ DU CAS » — la synthèse longitudinale du dossier.
 *
 * La synthèse est déterministe et sourcée (voir `case-synthesis.ts`) : elle ne
 * fabrique aucun fait. La carte ne répète donc pas les notes brutes, ne
 * réaffiche pas une chronologie par consultation et ne met pas de dégradé
 * derrière un texte clinique (§4.2). Les preuves restent accessibles, mais en
 * second : un seul dépliant de sources, groupées par domaine.
 */

"use client";

import { useState } from "react";

import { Badge, Bouton, ChampTexte, Icone, PanneauInfo, PastilleIcone } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { patientSummary } from "@/i18n/patient-summary";
import {
  signalerResume,
  type ItemResume,
  type ResumeDernier,
  type SourceResume,
  type TypeSourceResume,
} from "@/services/patients";

export interface ResumeEtat {
  readonly resume: ResumeDernier | null;
  readonly generationEnCours: boolean;
  /** Dernière tentative échouée — l'écran montre alors le repli déterministe. */
  readonly indisponible: boolean;
}

const SOURCE_ORDER: readonly TypeSourceResume[] = [
  "consultation",
  "echelle",
  "diagnostic",
  "treatment",
  "prescription",
  "rdv",
  "document",
];

function isVigilance(item: ItemResume): boolean {
  return /^(Item de risque|Les évaluations|La définition|Certaines séances)/iu.test(item.texte.trim());
}

function sourceGroups(items: readonly ItemResume[]): { type: TypeSourceResume; count: number; first: SourceResume }[] {
  const seen = new Map<TypeSourceResume, { count: number; first: SourceResume }>();
  for (const item of items) {
    for (const source of item.sources) {
      const entry = seen.get(source.t);
      if (entry === undefined) seen.set(source.t, { count: 1, first: source });
      else entry.count++;
    }
  }
  return SOURCE_ORDER.flatMap((type) => {
    const entry = seen.get(type);
    return entry === undefined ? [] : [{ type, count: entry.count, first: entry.first }];
  });
}

export function CarteResumeCas({
  etat,
  onEtatChange,
  onOuvrirSource,
  onGenerer,
  profil,
}: {
  readonly etat: ResumeEtat;
  readonly onEtatChange: (suivant: ResumeEtat) => void;
  /** Navigation vers l'onglet porteur d'une source (preuve → fait). */
  readonly onOuvrirSource: (source: SourceResume) => void;
  readonly onGenerer: () => void;
  /** Repères cliniques compacts, à droite de la synthèse sur grand écran. */
  readonly profil?: React.ReactNode;
}): React.JSX.Element {
  const r = etat.resume;
  const [sourcesOuvertes, setSourcesOuvertes] = useState(false);

  function lancer(): void {
    onEtatChange({ ...etat, generationEnCours: true, indisponible: false });
    onGenerer();
  }

  return (
    <section
      aria-busy={etat.generationEnCours}
      aria-label={patientSummary.titre}
      className="flex flex-col gap-5 rounded-2xl border border-rule bg-card p-6 shadow-carte sm:p-7"
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          <PastilleIcone nom="suivi" ton="action" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="m-0 font-ui text-eyebrow font-semibold uppercase tracking-eyebrow text-action-700">
              {patientSummary.eyebrow}
            </p>
            <h2 className="m-0 font-ui text-title font-bold tracking-title text-ink-900">
              {patientSummary.titre}
            </h2>
          </div>
        </div>
        {r === null ? null : (
          <div className="flex flex-wrap items-center gap-3">
            <ChipFraicheur resume={r} />
            <Bouton rang="secondaire" taille="compact" disabled={etat.generationEnCours} onClick={lancer}>
              {patientSummary.actualiser}
            </Bouton>
          </div>
        )}
      </div>

      {etat.generationEnCours ? (
        <p role="status" className="m-0 font-ui text-label text-ink-500">
          {patientSummary.generation}
        </p>
      ) : null}

      <div className="grid gap-6 desktop:grid-cols-resume">
        <div className="flex min-w-0 flex-col gap-5">
      {r === null ? (
        etat.indisponible ? (
          <PanneauInfo titre={patientSummary.indisponibleTitre} ton="attention">
            {patientSummary.indisponibleCorps}
            <span className="mt-3 block">
              <Bouton rang="secondaire" onClick={lancer}>
                {patientSummary.reessayer}
              </Bouton>
            </span>
          </PanneauInfo>
        ) : (
          <div className="flex flex-col items-start gap-3 rounded-xl bg-sunken px-4 py-4">
            <p className="m-0 font-ui text-body font-semibold text-ink-900">{patientSummary.videTitre}</p>
            <p className="m-0 font-ui text-body leading-relaxed text-ink-700">{patientSummary.videCorps}</p>
            <Bouton rang="principal" onClick={lancer}>
              {patientSummary.generer}
            </Bouton>
          </div>
        )
      ) : (
        <>
          {r.contenu.schema === 2 ? (
            <ContenuSchema2
              resume={r}
              onOuvrirSource={onOuvrirSource}
              sourcesOuvertes={sourcesOuvertes}
              onBasculerSources={() => setSourcesOuvertes((value) => !value)}
            />
          ) : (
            <ContenuSchema1 resume={r} />
          )}

          {r.aJour ? null : (
            <div className="flex flex-wrap items-center gap-3 rounded-xl border border-attention bg-attention-bg px-4 py-3">
              <Icone nom="alerte" taille={20} className="shrink-0 text-attention-ink" />
              <p className="m-0 font-ui text-body font-medium text-attention-ink">{patientSummary.modifieDepuis}</p>
              <Bouton rang="secondaire" taille="compact" disabled={etat.generationEnCours} onClick={lancer}>
                {patientSummary.actualiser}
              </Bouton>
            </div>
          )}

          <Signalement summaryId={r.id} />
        </>
      )}
        </div>
        {profil === undefined ? null : (
          <aside className="flex min-w-0 flex-col gap-4 border-t border-rule pt-5 desktop:border-s desktop:border-t-0 desktop:ps-5 desktop:pt-0">
            {profil}
          </aside>
        )}
      </div>

      <p className="m-0 border-t border-rule pt-3 font-ui text-label text-ink-500">{patientSummary.disclaimer}</p>
    </section>
  );
}

function ContenuSchema2({
  resume,
  onOuvrirSource,
  sourcesOuvertes,
  onBasculerSources,
}: {
  readonly resume: ResumeDernier;
  readonly onOuvrirSource: (source: SourceResume) => void;
  readonly sourcesOuvertes: boolean;
  readonly onBasculerSources: () => void;
}): React.JSX.Element {
  if (resume.contenu.schema !== 2) return <></>;
  const contenu = resume.contenu;
  const paragraphes = contenu.apercu.contexte;
  const vigilance = contenu.etatActuel.filter(isVigilance);
  const legacyEtat = contenu.etatActuel.filter((item) => !isVigilance(item));
  const groups = sourceGroups([...paragraphes, ...vigilance, ...contenu.apercu.diagnostics, ...contenu.apercu.traitements]);

  return (
      <div className="flex min-w-0 flex-col gap-5">
      {paragraphes.length === 0 ? (
        <p className="m-0 font-ui text-body text-ink-500">{patientSummary.videCorps}</p>
      ) : (
        <div className="flex flex-col gap-4">
          {paragraphes.map((item, index) => (
            <p
              key={`p-${String(index)}`}
              className="m-0 whitespace-pre-line break-words font-ui text-body leading-relaxed text-ink-900"
            >
              {item.texte}
            </p>
          ))}
        </div>
      )}

      {vigilance.length > 0 ? (
        <section aria-label={patientSummary.vigilance} className="flex flex-col gap-2 rounded-xl border border-attention bg-attention-bg px-4 py-3">
          <div className="flex items-center gap-2">
            <Icone nom="alerte" taille={20} className="shrink-0 text-attention-ink" />
            <h3 className="m-0 font-ui text-label font-semibold tracking-label text-attention-ink">
              {patientSummary.vigilance}
            </h3>
          </div>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {vigilance.map((item, index) => (
              <li key={`v-${String(index)}`} className="break-words font-ui text-body leading-relaxed text-ink-900">
                {item.texte}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {legacyEtat.length > 0 ? (
        <details>
          <summary className="cursor-pointer font-ui text-label font-medium text-ink-500">
            {patientSummary.ancienneSynthese}
          </summary>
          <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
            {legacyEtat.map((item, index) => (
              <li key={`l-${String(index)}`} className="break-words font-ui text-body leading-relaxed text-ink-700">
                {item.texte}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {groups.length === 0 ? null : (
        <div className="border-t border-rule pt-4">
          <button
            type="button"
            onClick={onBasculerSources}
            aria-expanded={sourcesOuvertes}
            className="inline-flex min-h-target items-center gap-2 rounded-lg font-ui text-label font-medium text-ink-500 outline-none transition-colors duration-quick hover:text-ink-900 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
          >
            <Icone nom="documents" taille={20} />
            {sourcesOuvertes ? patientSummary.fermerSources : patientSummary.sources}
          </button>
          {sourcesOuvertes ? (
            <ul className="m-0 mt-3 flex list-none flex-wrap gap-2 p-0">
              {groups.map((group) => (
                <li key={group.type}>
                  <button
                    type="button"
                    onClick={() => onOuvrirSource(group.first)}
                    className="inline-flex items-center gap-2 rounded-full border border-rule bg-sunken px-3 py-1.5 font-ui text-label font-medium text-ink-700 outline-none transition-colors duration-quick hover:border-action-600 hover:text-action-900 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
                  >
                    {patientSummary.sourceCount(patientSummary.sourceLabels[group.type], group.count)}
                    <span aria-hidden="true">→</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      </div>
  );
}

function ContenuSchema1({ resume }: { readonly resume: ResumeDernier }): React.JSX.Element {
  if (resume.contenu.schema !== 1) return <></>;
  const sections: readonly { titre: string; items: readonly ItemResume[] }[] = [
    { titre: fr.patients.resume.enBref, items: resume.contenu.enBref },
    { titre: fr.patients.resume.evolution, items: resume.contenu.evolutionRecente },
    { titre: fr.patients.resume.traitements, items: resume.contenu.traitementsDocumentes },
    { titre: fr.patients.resume.pointsAttention, items: resume.contenu.pointsAttention },
  ];
  return (
    <div className="flex flex-col gap-5">
      {sections.filter((section) => section.items.length > 0).map((section) => (
        <section key={section.titre} className="flex flex-col gap-2">
          <h3 className="m-0 font-ui text-label font-semibold tracking-label text-ink-500">{section.titre}</h3>
          {section.items.map((item, index) => (
            <p key={`${section.titre}-${String(index)}`} className="m-0 break-words font-ui text-body leading-relaxed text-ink-900">
              {item.texte}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}

function ChipFraicheur({ resume }: { readonly resume: ResumeDernier }): React.JSX.Element {
  return resume.aJour
    ? <Badge ton="positif">{patientSummary.aJour}</Badge>
    : <Badge ton="attention">{patientSummary.modifieDepuis}</Badge>;
}

/**
 * Signalement — formulaire inline minimal. AUCUNE mutation clinique : un INSERT
 * append-only tracé, puis confirmation. Le motif est obligatoire.
 */
function Signalement({ summaryId }: { readonly summaryId: string }): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [verdict, setVerdict] = useState<"incorrect" | "imprecis" | "hors_sujet">("incorrect");
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState<"repos" | "encours" | "ok" | "echec">("repos");

  if (!ouvert) {
    return (
      <p className="m-0">
        <Bouton rang="discret" taille="compact" onClick={() => setOuvert(true)}>
          {fr.patients.resume.signaler}
        </Bouton>
      </p>
    );
  }

  function envoyer(): void {
    setEnvoi("encours");
    void signalerResume(summaryId, verdict, motif).then((result) => {
      if (result.ok) {
        setEnvoi("ok");
        setMotif("");
      } else {
        setEnvoi("echec");
      }
    });
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-rule bg-sunken px-4 py-4"
      onSubmit={(event) => {
        event.preventDefault();
        envoyer();
      }}
    >
      <h3 className="m-0 font-ui text-heading font-semibold tracking-heading text-ink-900">
        {fr.patients.resume.signalerTitre}
      </h3>
      <ChampSelectionVerdict valeur={verdict} onChange={setVerdict} />
      <ChampTexte
        libelle={fr.patients.resume.signalerMotif}
        valeur={motif}
        onChange={setMotif}
        indication={fr.patients.resume.signalerMotifAide}
        requis
      />
      <div className="flex flex-wrap items-center gap-3">
        <Bouton type="submit" disabled={motif.trim() === "" || envoi === "encours"}>
          {fr.patients.resume.signalerEnvoyer}
        </Bouton>
        <Bouton rang="discret" onClick={() => setOuvert(false)}>
          {fr.patients.modification.annuler}
        </Bouton>
      </div>
      {envoi === "ok" ? <p role="status" className="m-0 font-ui text-label text-positive">{fr.patients.resume.signaleOk}</p> : null}
      {envoi === "echec" ? <p role="alert" className="m-0 font-ui text-label text-attention-ink">{fr.patients.resume.signalementInvalide}</p> : null}
    </form>
  );
}

function ChampSelectionVerdict({
  valeur,
  onChange,
}: {
  readonly valeur: "incorrect" | "imprecis" | "hors_sujet";
  readonly onChange: (value: "incorrect" | "imprecis" | "hors_sujet") => void;
}): React.JSX.Element {
  const options = [
    { valeur: "incorrect", libelle: fr.patients.resume.verdicts.incorrect },
    { valeur: "imprecis", libelle: fr.patients.resume.verdicts.imprecis },
    { valeur: "hors_sujet", libelle: fr.patients.resume.verdicts.hors_sujet },
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <label
          key={option.valeur}
          className={[
            "cursor-pointer rounded-full border px-3 py-1.5 font-ui text-label tracking-label",
            valeur === option.valeur
              ? "border-action-600 bg-action-50 text-ink-900"
              : "border-rule bg-card text-ink-500",
          ].join(" ")}
        >
          <input
            type="radio"
            name="verdict-resume"
            value={option.valeur}
            checked={valeur === option.valeur}
            onChange={() => onChange(option.valeur)}
            className="sr-only"
          />
          {option.libelle}
        </label>
      ))}
    </div>
  );
}
