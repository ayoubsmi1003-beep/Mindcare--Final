"use client";

import { useEffect, useState } from "react";

import { Bouton, ChampSelection, ChampTexte, Icone, PastilleIcone } from "@/components/ui";
import { cliniqueUi } from "@/i18n/clinical-ui";
import { DIAGNOSTICS_FREQUENTS } from "@/i18n/diagnostics-referentiel";
import { enregistrerDiagnostic, resoudreDiagnostic } from "@/services/diagnoses";
import type { Diagnostic } from "@/services/patients";

function dateCourte(value: string | null): string | null {
  if (value === null || value.trim() === "") return null;
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("fr-DZ", { day: "numeric", month: "long", year: "numeric" }).format(parsed);
}

function LigneDiagnostic({
  diagnostic,
  onResoudre,
  resolutionEnCours,
}: {
  readonly diagnostic: Diagnostic;
  readonly onResoudre: (diagnostic: Diagnostic) => void;
  readonly resolutionEnCours: boolean;
}): React.JSX.Element {
  const actif = diagnostic.resolvedAt === null;
  const debut = dateCourte(diagnostic.onsetDate);
  const fin = dateCourte(diagnostic.resolvedAt);

  return (
    <li
      className={[
        "group relative flex min-w-0 flex-col gap-3 rounded-2xl border px-4 py-4",
        "transition duration-quick ease-out",
        actif
          ? "border-action-100 bg-action-50 hover:border-action-500 hover:shadow-douce"
          : "border-rule bg-sunken hover:border-ink-300",
      ].join(" ")}
    >
      <div className="flex min-w-0 items-start gap-3">
        <PastilleIcone nom="diagnostic" ton={actif ? "action" : "neutre"} />
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="min-w-0 break-words font-ui text-body font-semibold text-ink-900">
              {diagnostic.label}
            </span>
            {diagnostic.isPrimary ? <BadgePrincipal /> : null}
            <span
              className={[
                "inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5",
                "font-ui text-label font-medium tracking-label",
                actif
                  ? "border-positive bg-positive-bg text-positive"
                  : "border-rule bg-card text-ink-500",
              ].join(" ")}
            >
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
              {actif ? cliniqueUi.diagnostics.actif : cliniqueUi.diagnostics.resolu}
            </span>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-ui text-label text-ink-500">
            {diagnostic.code === null ? null : (
              <span className="rounded-md border border-rule bg-card px-2 py-0.5 font-num text-label tracking-wide">
                {diagnostic.codeSystem} {diagnostic.code}
              </span>
            )}
            {debut === null ? null : <span>{cliniqueUi.diagnostics.depuis(debut)}</span>}
            {fin === null ? null : <span>{cliniqueUi.diagnostics.resoluLe(fin)}</span>}
          </div>
        </div>
        {actif ? (
          <Bouton
            rang="discret"
            taille="compact"
            disabled={resolutionEnCours}
            onClick={() => onResoudre(diagnostic)}
          >
            {cliniqueUi.diagnostics.resoudre}
          </Bouton>
        ) : null}
      </div>
    </li>
  );
}

function BadgePrincipal(): React.JSX.Element {
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-azure-200 bg-azure-050 px-2 py-0.5 font-ui text-label font-medium tracking-label text-azure-700">
      <Icone nom="diagnostic" taille={16} />
      {cliniqueUi.diagnostics.principal}
    </span>
  );
}

export function CarteDiagnostics({
  patientId,
  diagnostics,
  onMisAJour,
  encadre = true,
}: {
  readonly patientId: string;
  readonly diagnostics: readonly Diagnostic[];
  readonly onMisAJour?: () => void;
  /** Faux quand la carte est déjà portée par la surface « État clinique ». */
  readonly encadre?: boolean;
}): React.JSX.Element {
  const [liste, setListe] = useState<readonly Diagnostic[]>(diagnostics);
  const [formulaire, setFormulaire] = useState(false);
  const [modele, setModele] = useState("");
  const [libelle, setLibelle] = useState("");
  const [codeSysteme, setCodeSysteme] = useState("ICD-10");
  const [code, setCode] = useState("");
  const [principal, setPrincipal] = useState(false);
  const [debut, setDebut] = useState("");
  const [enregistrement, setEnregistrement] = useState(false);
  const [erreur, setErreur] = useState<string | undefined>(undefined);
  const [resolutionId, setResolutionId] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);

  useEffect(() => {
    setListe(diagnostics);
  }, [diagnostics]);

  const actifs = liste.filter((diagnostic) => diagnostic.resolvedAt === null);
  const resolus = liste.filter((diagnostic) => diagnostic.resolvedAt !== null);

  function ouvrirFormulaire(): void {
    setErreur(undefined);
    setConfirmation(undefined);
    setFormulaire(true);
    // Le premier diagnostic actif est principal par défaut : un dossier ne
    // doit pas commencer par une comorbidité sans diagnostic de référence.
    // S'il en existe déjà un, le nouveau est secondaire par défaut.
    setPrincipal(!actifs.some((diagnostic) => diagnostic.isPrimary));
  }

  function appliquerModele(valeur: string): void {
    setModele(valeur);
    const trouve = DIAGNOSTICS_FREQUENTS.find((entry) => entry.code === valeur);
    if (trouve === undefined) return;
    setLibelle(trouve.label);
    setCode(trouve.code);
    setCodeSysteme("ICD-10");
  }

  function enregistrer(): void {
    setErreur(undefined);
    setConfirmation(undefined);
    if (debut !== "") {
      const aujourdhui = new Date().toLocaleDateString("fr-CA", { timeZone: "Africa/Algiers" });
      if (debut > aujourdhui) {
        setErreur(cliniqueUi.diagnostics.dateFuture);
        return;
      }
    }
    setEnregistrement(true);
    void enregistrerDiagnostic({
      patientId,
      label: libelle,
      codeSystem: codeSysteme,
      code: code === "" ? null : code,
      isPrimary: principal,
      onsetDate: debut === "" ? null : debut,
    }).then((resultat) => {
      setEnregistrement(false);
      if (!resultat.ok) {
        setErreur(resultat.error.code === "regle-metier" ? resultat.error.message : cliniqueUi.diagnostics.erreur);
        return;
      }
      if (resultat.data === null) {
        setErreur(cliniqueUi.diagnostics.erreur);
        return;
      }
      const ajoute = resultat.data;
      setListe((courant) => {
        const suivant = [
          ...(principal ? courant.map((item) => ({ ...item, isPrimary: false })) : courant),
          ajoute,
        ];
        return suivant.sort(
          (a, b) =>
            Number(b.isPrimary) - Number(a.isPrimary)
            || a.label.localeCompare(b.label, "fr"),
        );
      });
      setModele("");
      setLibelle("");
      setCode("");
      setDebut("");
      setPrincipal(false);
      setFormulaire(false);
      setConfirmation(cliniqueUi.diagnostics.enregistre);
      onMisAJour?.();
    });
  }

  function resoudre(diagnostic: Diagnostic): void {
    if (!window.confirm(cliniqueUi.diagnostics.resoudreConfirmation)) return;
    setErreur(undefined);
    setConfirmation(undefined);
    setResolutionId(diagnostic.id);
    void resoudreDiagnostic(diagnostic.id).then((resultat) => {
      setResolutionId(null);
      if (!resultat.ok || resultat.data === null) {
        setErreur(cliniqueUi.diagnostics.erreurResolution);
        return;
      }
      const misAJour = resultat.data;
      setListe((courant) => courant.map((item) => (item.id === misAJour.id ? misAJour : item)));
      setConfirmation(cliniqueUi.diagnostics.resoluOk);
      onMisAJour?.();
    });
  }

  return (
    <section
      aria-labelledby="titre-diagnostics"
      className={encadre
        ? "flex min-w-0 flex-col gap-5 rounded-3xl border border-rule bg-card p-5 shadow-carte sm:p-6"
        : "flex min-w-0 flex-col gap-5"}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-action-100 bg-gradient-to-br from-action-50 via-card to-azure-050 text-action-700 shadow-douce">
            <Icone nom="diagnostic" taille={24} />
            <span aria-hidden="true" className="absolute -right-1 -top-1 h-3 w-3 rounded-full bg-action-100 blur-sm" />
          </span>
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <h2 id="titre-diagnostics" className="m-0 font-ui text-heading font-bold tracking-heading text-ink-900">
                {cliniqueUi.diagnostics.titre}
              </h2>
              <span className="font-ui text-label tabular-nums text-ink-500">
                {actifs.length === 0 ? cliniqueUi.diagnostics.aucunActif : `${String(actifs.length)} actif${actifs.length > 1 ? "s" : ""}`}
              </span>
            </div>
            <p className="m-0 max-w-prose font-ui text-label leading-relaxed text-ink-500">
              {cliniqueUi.diagnostics.sousTitre}
            </p>
          </div>
        </div>
        {formulaire || liste.length > 0 ? (
          <Bouton
            rang={formulaire ? "secondaire" : "principal"}
            taille="compact"
            onClick={() => {
              if (formulaire) {
                setFormulaire(false);
                setModele("");
                return;
              }
              ouvrirFormulaire();
            }}
          >
            {formulaire ? cliniqueUi.diagnostics.annuler : cliniqueUi.diagnostics.consigner}
          </Bouton>
        ) : null}
      </header>

      {erreur === undefined ? null : (
        <p role="alert" className="m-0 rounded-xl border border-attention bg-attention-bg px-4 py-3 font-ui text-label text-attention-ink">
          {erreur}
        </p>
      )}
      {confirmation === undefined ? null : (
        <p role="status" className="m-0 rounded-xl border border-positive bg-positive-bg px-4 py-3 font-ui text-label text-positive">
          {confirmation}
        </p>
      )}

      {formulaire ? (
        <div className="flex flex-col gap-4 rounded-2xl border border-action-100 bg-action-50 p-4">
          <div className="flex items-start gap-2 rounded-xl border border-action-100 bg-card px-3 py-2.5">
            <Icone nom="diagnostic" taille={16} className="mt-0.5 shrink-0 text-action-700" />
            <p className="m-0 font-ui text-label leading-relaxed text-ink-700">{cliniqueUi.diagnostics.saisieProfessionnelle}</p>
          </div>
          <div className="grid gap-4">
            <div>
              <ChampSelection
                libelle={cliniqueUi.diagnostics.modele}
                valeur={modele}
                onChange={appliquerModele}
                indication={cliniqueUi.diagnostics.modeleAide}
                options={[
                  { valeur: "", libelle: cliniqueUi.diagnostics.modeleVide },
                  ...DIAGNOSTICS_FREQUENTS.map((entry) => ({
                    valeur: entry.code,
                    libelle: `${entry.code} — ${entry.label}`,
                  })),
                ]}
              />
            </div>
            <div>
              <ChampTexte
                libelle={cliniqueUi.diagnostics.libelle}
                valeur={libelle}
                onChange={setLibelle}
                indication={cliniqueUi.diagnostics.libelleAide}
                requis
              />
            </div>
            <ChampSelection
              libelle={cliniqueUi.diagnostics.codeSysteme}
              valeur={codeSysteme}
              onChange={setCodeSysteme}
              options={[
                { valeur: "ICD-10", libelle: "ICD-10" },
                { valeur: "DSM-5", libelle: "DSM-5" },
                { valeur: "CIM-11", libelle: "CIM-11" },
              ]}
            />
            <ChampTexte
              libelle={cliniqueUi.diagnostics.codeValeur}
              valeur={code}
              onChange={setCode}
              indication={cliniqueUi.diagnostics.codeAide}
              placeholder="F41.1"
            />
            <ChampTexte
              libelle={cliniqueUi.diagnostics.dateDebut}
              valeur={debut}
              onChange={setDebut}
              indication={cliniqueUi.diagnostics.dateDebutAide}
              type="date"
            />
            <fieldset className="flex min-w-0 flex-col gap-2 rounded-xl border border-rule bg-card px-4 py-3">
              <legend className="px-1 font-ui text-label font-semibold tracking-label text-ink-700">
                {cliniqueUi.diagnostics.role}
              </legend>
              <div className="flex flex-wrap gap-2">
                <Bouton
                  rang="secondaire"
                  taille="compact"
                  enfonce={!principal}
                  onClick={() => setPrincipal(false)}
                >
                  {cliniqueUi.diagnostics.secondaire}
                </Bouton>
                <Bouton
                  rang="secondaire"
                  taille="compact"
                  enfonce={principal}
                  onClick={() => setPrincipal(true)}
                >
                  {cliniqueUi.diagnostics.principal}
                </Bouton>
              </div>
              <p className="m-0 font-ui text-label leading-relaxed text-ink-500">
                {cliniqueUi.diagnostics.principalAide} {cliniqueUi.diagnostics.statutAide}
              </p>
            </fieldset>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Bouton
              rang="principal"
              onClick={enregistrer}
              disabled={enregistrement || libelle.trim() === ""}
            >
              {enregistrement ? cliniqueUi.commun.chargement : cliniqueUi.diagnostics.enregistrer}
            </Bouton>
            <Bouton
              rang="discret"
              onClick={() => {
                setFormulaire(false);
                setModele("");
              }}
              disabled={enregistrement}
            >
              {cliniqueUi.diagnostics.annuler}
            </Bouton>
          </div>
        </div>
      ) : null}

      {liste.length === 0 ? (
        formulaire ? null : <div className="relative flex flex-1 flex-col justify-center overflow-hidden rounded-3xl border border-dashed border-action-100 bg-gradient-to-br from-action-50 via-card to-azure-050 px-5 py-8">
          <div aria-hidden="true" className="pointer-events-none absolute -right-12 -top-16 h-44 w-44 rounded-full bg-action-100 blur-2xl" />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-20 -left-16 h-48 w-48 rounded-full bg-azure-100 blur-2xl" />
          <div className="relative flex flex-col items-start gap-4">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-2xl border border-action-100 bg-card text-action-700 shadow-douce">
              <Icone nom="diagnostic" taille={24} />
            </span>
            <div className="flex max-w-prose flex-col gap-1.5">
              <p className="m-0 font-ui text-title font-semibold tracking-title text-ink-900">{cliniqueUi.diagnostics.videTitre}</p>
              <p className="m-0 font-ui text-body leading-relaxed text-ink-700">{cliniqueUi.diagnostics.videCorps}</p>
            </div>
            {formulaire ? null : (
              <Bouton rang="principal" onClick={ouvrirFormulaire}>
                {cliniqueUi.diagnostics.consigner}
              </Bouton>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-1 flex-col gap-5">
          {actifs.length === 0 ? null : (
            <div className="flex flex-col gap-2">
              <p className="m-0 font-ui text-label font-semibold tracking-label text-ink-500">{cliniqueUi.diagnostics.groupeActifs}</p>
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {actifs.map((diagnostic) => (
                  <LigneDiagnostic
                    key={diagnostic.id}
                    diagnostic={diagnostic}
                    onResoudre={resoudre}
                    resolutionEnCours={resolutionId === diagnostic.id}
                  />
                ))}
              </ul>
            </div>
          )}
          {resolus.length === 0 ? null : (
            <details className="border-t border-rule pt-3">
              <summary className="cursor-pointer font-ui text-label font-medium text-ink-500">
                {cliniqueUi.diagnostics.groupeResolus} ({resolus.length})
              </summary>
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {resolus.map((diagnostic) => (
                  <LigneDiagnostic
                    key={diagnostic.id}
                    diagnostic={diagnostic}
                    onResoudre={resoudre}
                    resolutionEnCours={resolutionId === diagnostic.id}
                  />
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
    </section>
  );
}
