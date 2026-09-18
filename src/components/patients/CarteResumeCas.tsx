/**
 * Carte « RÉSUMÉ DU CAS » — l'unique surface IA de l'espace patient.
 *
 * ⚠️ HIÉRARCHIE DES ÉTATS (05-UX-CONTRACT : un écran est dans UN état) :
 *   VIDE        → proposition professionnelle + geste « Générer »
 *   CONTENU     → sections denses, chaque item porte ses sources
 *   GÉNÉRATION  → l'ancien résumé RESTE AFFICHÉ + chip « Actualisation… »
 *   INDISPONIBLE→ bannière honnête ; repli déterministe = Point de situation
 *
 * ⚠️ PREUVES DE PREMIER RANG : chaque item expose « Pourquoi ? » qui déplie
 * ses sources navigables. Registres affichés par libellé (Documenté /
 * Synthèse IA), jamais un score de confiance (rien de tel n'existe dans
 * l'architecture).
 *
 * ⚠️ SIGNALEMENT ≠ CORRECTION : signaler enregistre un verdict+motif
 * (append-only, événement d'évaluation) et NE MUTe JAMAIS le résumé ni le
 * dossier. Le correctif passe par une régénération = nouvelle version.
 */

"use client";

import { useState } from "react";

import { Badge } from "@/components/ui";
import { Bouton } from "@/components/ui";
import { ChampTexte } from "@/components/ui";
import { PanneauInfo } from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  signalerResume,
  type ItemResume,
  type ResumeDernier,
  type SourceResume,
} from "@/services/patients";

export interface ResumeEtat {
  readonly resume: ResumeDernier | null;
  readonly generationEnCours: boolean;
  /** Dernière tentative échouée — l'écran montre alors le repli déterministe. */
  readonly indisponible: boolean;
}

export function CarteResumeCas({
  etat,
  onEtatChange,
  onOuvrirSource,
  onGenerer,
}: {
  readonly etat: ResumeEtat;
  readonly onEtatChange: (suivant: ResumeEtat) => void;
  /** Navigation vers l'onglet porteur d'une source (preuve → fait). */
  readonly onOuvrirSource: (source: SourceResume) => void;
  readonly onGenerer: () => void;
}): React.JSX.Element {
  const r = etat.resume;

  function lancer(): void {
    onEtatChange({ ...etat, generationEnCours: true, indisponible: false });
    onGenerer();
  }

  return (
    <section
      aria-busy={etat.generationEnCours}
      /* ⚠️ CE N'EST PLUS UN PANNEAU « IA ». Le fond teinté et l'orbe faisaient
         de la synthèse un objet à part, décoratif, dont on se méfie sans savoir
         quoi en faire. Ce qui compte n'est pas d'où vient le texte mais s'il
         est juste et sourcé — la provenance est dite une fois, en bas, et
         chaque affirmation porte ses preuves. */
      className="flex flex-col gap-5 rounded-2xl border border-rule bg-card px-5 py-5 shadow-carte"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-ui text-title font-bold tracking-title text-ink-900">
          {fr.patients.resume.titre}
        </h2>
        {r !== null ? <ChipFraicheur resume={r} /> : null}
      </div>

      {etat.generationEnCours ? (
        <p role="status" className="font-ui text-label tracking-label text-ink-500">
          {fr.patients.resume.generationEnCours}
        </p>
      ) : null}

      {r === null ? (
        etat.indisponible ? (
          <PanneauInfo titre={fr.patients.resume.indisponibleTitre} ton="attention">
            {fr.patients.resume.indisponibleCorps}
            <span className="mt-3 block">
              <Bouton rang="secondaire" onClick={lancer}>
                {fr.patients.resume.reessayer}
              </Bouton>
            </span>
          </PanneauInfo>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="font-ui text-body font-medium text-ink-900">
              {fr.patients.resume.videTitre}.
            </p>
            <p className="font-ui text-body text-ink-700">{fr.patients.resume.videCorps}</p>
            <span>
              <Bouton rang="principal" onClick={lancer}>
                {fr.patients.resume.generer}
              </Bouton>
            </span>
          </div>
        )
      ) : (
        <>
          {/* ⚠️ DEUX FORMES VIVENT ICI, ET C'EST VOULU. Les résumés déjà
              écrits en schéma 1 restent lisibles ; seuls les nouveaux sont
              chronologiques (069). Un rendu unique aurait affiché « aucun
              résumé » sur tous les dossiers jusqu'à leur régénération. */}
          {r.contenu.schema === 2 ? (
            <>
              {/* L'APERÇU, EN PREMIER ET TOUJOURS. Il est composé en base, pas
                  rédigé par le modèle : c'est la seule section sur laquelle on
                  peut se fier sans rouvrir le dossier. */}
              <BlocSection titre={fr.patients.resume.apercu}>
                <p className="font-ui text-body font-medium text-ink-900">
                  {[
                    r.contenu.apercu.nom,
                    r.contenu.apercu.age === null
                      ? null
                      : `${String(r.contenu.apercu.age)} ${fr.patients.ageAnnees}`,
                    r.contenu.apercu.residence,
                  ]
                    .filter((x): x is string => x !== null && x !== "")
                    .join(" · ")}
                </p>
                {r.contenu.apercu.diagnostics.map((item, idx) => (
                  <ItemPreuve key={`d${String(idx)}`} item={item} onOuvrirSource={onOuvrirSource} />
                ))}
                {r.contenu.apercu.traitements.map((item, idx) => (
                  <ItemPreuve key={`t${String(idx)}`} item={item} onOuvrirSource={onOuvrirSource} />
                ))}
                {r.contenu.apercu.contexte.map((item, idx) => (
                  <ItemPreuve key={`c${String(idx)}`} item={item} onOuvrirSource={onOuvrirSource} />
                ))}
              </BlocSection>

              {/* Le parcours, année par année, la plus récente en tête. */}
              {r.contenu.chronologie.map((periode) => (
                <BlocSection key={periode.periode} titre={periode.periode}>
                  {periode.entrees.map((item, idx) => (
                    <ItemPreuve key={idx} item={item} onOuvrirSource={onOuvrirSource} />
                  ))}
                </BlocSection>
              ))}

              {r.contenu.anterieur.length > 0 ? (
                <BlocSection titre={fr.patients.resume.anterieur}>
                  {r.contenu.anterieur.map((item, idx) => (
                    <ItemPreuve key={idx} item={item} onOuvrirSource={onOuvrirSource} />
                  ))}
                </BlocSection>
              ) : null}

              {r.contenu.etatActuel.length > 0 ? (
                <BlocSection titre={fr.patients.resume.etatActuel}>
                  {r.contenu.etatActuel.map((item, idx) => (
                    <ItemPreuve key={idx} item={item} onOuvrirSource={onOuvrirSource} />
                  ))}
                </BlocSection>
              ) : null}
            </>
          ) : (
            <>
              {/* En bref — 2 à 4 phrases maximum (garantie passerelle). */}
              <BlocSection titre={fr.patients.resume.enBref}>
                {r.contenu.enBref.map((item, idx) => (
                  <ItemPreuve key={idx} item={item} onOuvrirSource={onOuvrirSource} />
                ))}
              </BlocSection>

              {r.contenu.evolutionRecente.length > 0 ? (
                <BlocSection titre={fr.patients.resume.evolution}>
                  {r.contenu.evolutionRecente.map((item, idx) => (
                    <ItemPreuve key={idx} item={item} onOuvrirSource={onOuvrirSource} />
                  ))}
                </BlocSection>
              ) : null}

              {r.contenu.traitementsDocumentes.length > 0 ? (
                <BlocSection titre={fr.patients.resume.traitements}>
                  {r.contenu.traitementsDocumentes.map((item, idx) => (
                    <ItemPreuve key={idx} item={item} onOuvrirSource={onOuvrirSource} />
                  ))}
                </BlocSection>
              ) : null}

              {r.contenu.pointsAttention.length > 0 ? (
                <BlocSection titre={fr.patients.resume.pointsAttention}>
                  {r.contenu.pointsAttention.map((item, idx) => (
                    <ItemPreuve key={idx} item={item} onOuvrirSource={onOuvrirSource} />
                  ))}
                </BlocSection>
              ) : null}
            </>
          )}

          {!r.aJour ? (
            <p className="font-ui text-label tracking-label text-attention-ink">
              {fr.patients.resume.modifieDepuis}.{" "}
              <Bouton rang="discret" onClick={lancer}>
                {fr.patients.resume.actualiser}
              </Bouton>
            </p>
          ) : null}

          {!etat.generationEnCours ? (
            <p>
              <Bouton rang="discret" onClick={lancer}>
                {fr.patients.resume.actualiser}
              </Bouton>
            </p>
          ) : null}

          <Signalement summaryId={r.id} />
        </>
      )}

      <p className="border-t border-rule pt-3 font-ui text-label tracking-label text-ink-500">
        {fr.disclaimer}
      </p>
    </section>
  );
}

function ChipFraicheur({ resume }: { readonly resume: ResumeDernier }): React.JSX.Element {
  if (resume.aJour) {
    return <Badge ton="positif">{fr.patients.resume.aJour}</Badge>;
  }
  return <Badge ton="attention">{fr.patients.resume.modifieDepuis}</Badge>;
}

function BlocSection({
  titre,
  children,
}: {
  readonly titre: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="font-ui text-label font-semibold tracking-label text-ink-500">{titre}</h3>
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  );
}

function ItemPreuve({
  item,
  onOuvrirSource,
}: {
  readonly item: ItemResume;
  readonly onOuvrirSource: (s: SourceResume) => void;
}): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);

  return (
    <div className="flex flex-col gap-1">
      <p className="font-ui text-body text-ink-900">
        {item.texte}
        {item.sources.length > 0 ? (
          <>
            {" "}
            {/* ⚠️ LA PREUVE RESTE, SA DÉCORATION PART. Chaque fait a porté
                trois ornements — une carte, un badge « Documenté », un compteur
                « 3 × Sources » — répétés sur trente items. La preuve n'y
                gagnait rien : elle était noyée dans le même bruit qui la
                rendait illisible. Il reste UN mot, discret, dans le fil de la
                phrase, et tout ce qu'il ouvrait s'ouvre encore. */}
            <button
              type="button"
              onClick={() => setOuvert((v) => !v)}
              aria-expanded={ouvert}
              className="rounded font-ui text-label tracking-label text-ink-500 underline decoration-rule underline-offset-4 outline-none transition duration-instant ease-soft hover:text-ink-900 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
            >
              {ouvert ? fr.patients.resume.fermerPreuves : fr.patients.resume.sources}
            </button>
          </>
        ) : null}
      </p>

      {ouvert ? (
        <ul className="m-0 flex list-none flex-col gap-1 border-l border-rule py-1 pl-3">
          {item.sources.map((s, i) => (
            <li key={`${s.t}-${s.id}-${String(i)}`}>
              <button
                type="button"
                onClick={() => onOuvrirSource(s)}
                className="font-ui text-label tracking-label text-action-600 underline decoration-rule underline-offset-2 hover:decoration-action-600"
              >
                {libelleSource(s)} →
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Libellés de navigation des preuves — vers les onglets porteurs. */
function libelleSource(s: SourceResume): string {
  void s;
  switch (s.t) {
    case "diagnostic":
      return fr.patients.onglets.clinique;
    case "echelle":
      return `${fr.patients.sections.echelles} · ${fr.patients.onglets.clinique}`;
    case "prescription":
      return `${fr.patients.sections.dernierePrescription} · ${fr.patients.onglets.traitements}`;
    case "consultation":
      return `${fr.patients.sections.derniereConsultation} · ${fr.patients.onglets.chronologie}`;
    case "rdv":
      return fr.patients.onglets.rendezVous;
    default:
      return fr.patients.onglets.chronologie;
  }
}

/**
 * Signalement — formulaire inline minimal. AUCUNE mutation : un INSERT
 * append-only tracé, puis confirmation. Le motif est obligatoire.
 */
function Signalement({ summaryId }: { readonly summaryId: string }): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);
  const [verdict, setVerdict] = useState<"incorrect" | "imprecis" | "hors_sujet">("incorrect");
  const [motif, setMotif] = useState("");
  const [envoi, setEnvoi] = useState<"repos" | "encours" | "ok" | "echec">("repos");

  if (!ouvert) {
    return (
      <p>
        <Bouton rang="discret" onClick={() => setOuvert(true)}>
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
      className="flex flex-col gap-3 rounded-md border border-rule bg-sunken px-4 py-4"
      onSubmit={(e) => {
        e.preventDefault();
        envoyer();
      }}
    >
      <h3 className="font-ui text-heading font-semibold tracking-heading text-ink-900">
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

      <div className="flex items-center gap-3">
        <Bouton type="submit" disabled={motif.trim() === "" || envoi === "encours"}>
          {fr.patients.resume.signalerEnvoyer}
        </Bouton>
        <Bouton rang="discret" onClick={() => setOuvert(false)}>
          {fr.patients.modification.annuler}
        </Bouton>
      </div>

      {envoi === "ok" ? (
        <p role="status" className="font-ui text-label tracking-label text-positive">
          {fr.patients.resume.signaleOk}
        </p>
      ) : null}
      {envoi === "echec" ? (
        <p role="alert" className="font-ui text-label tracking-label text-attention-ink">
          {fr.patients.resume.signalementInvalide}
        </p>
      ) : null}
    </form>
  );
}

function ChampSelectionVerdict({
  valeur,
  onChange,
}: {
  readonly valeur: "incorrect" | "imprecis" | "hors_sujet";
  readonly onChange: (v: "incorrect" | "imprecis" | "hors_sujet") => void;
}): React.JSX.Element {
  const options = [
    { valeur: "incorrect", libelle: fr.patients.resume.verdicts.incorrect },
    { valeur: "imprecis", libelle: fr.patients.resume.verdicts.imprecis },
    { valeur: "hors_sujet", libelle: fr.patients.resume.verdicts.hors_sujet },
  ] as const;
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <label
          key={o.valeur}
          className={
            "cursor-pointer rounded-full border px-3 py-1.5 font-ui text-label tracking-label " +
            (valeur === o.valeur
              ? "border-action-600 bg-brand-50 text-ink-900"
              : "border-rule bg-card text-ink-500")
          }
        >
          <input
            type="radio"
            name="verdict-resume"
            value={o.valeur}
            checked={valeur === o.valeur}
            onChange={() => onChange(o.valeur)}
            className="sr-only"
          />
          {o.libelle}
        </label>
      ))}
    </div>
  );
}



