"use client";

/**
 * Le formulaire d'émission — choisir un type, remplir ses champs, confirmer.
 *
 * ═══ LE DÉLAI DE 400 ms ════════════════════════════════════════════════════
 *
 * Repris de `CarteConfirmation` (V2.5), avec la même mise en garde : il
 * n'empêche RIEN, il empêche seulement la main de valider avant que l'œil ait
 * lu. Ce qui protège réellement ici est l'absence de porte `update_document` et
 * les déclencheurs d'immuabilité de 030 — un certificat émis ne se corrige pas.
 *
 * On ne réutilise pas `CarteConfirmation` telle quelle : son contrat porte une
 * `CarteConfirmation` de `jarvis-tools`, avec un `actionId` d'action Jarvis.
 * Émettre un certificat n'est pas une action Jarvis, et fabriquer un faux
 * identifiant pour satisfaire un type ferait mentir la trace.
 *
 * ═══ LE BOUTON NE PART QU'UNE FOIS ═════════════════════════════════════════
 *
 * ⚠️ `issueDocument` N'EST PAS REJOUABLE. Deux appels avec les mêmes arguments
 * créent DEUX documents, numérotés chacun à sa date — le service le dit
 * explicitement. Le verrouillage du bouton dès le premier clic n'est donc pas
 * du confort : c'est ce qui empêche un double-clic de produire deux certificats
 * pour un seul geste.
 */

import { useCallback, useEffect, useState } from "react";

import { Bouton, ChampSelection, ChampTexte, ChampZoneTexte } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { nombreEnLettres, TYPES_DOCUMENT, type TypeDocument } from "@/services/documents";

import { specsPour, validerSaisie, type SpecChamp } from "./champs";

/** Anti-clic réflexe. Même chiffre que V2.5, même raison. */
const DELAI_ANTI_REFLEXE_MS = 400;

/** La conversion en lettres suit la frappe : on ne part pas à chaque touche. */
const DELAI_LETTRES_MS = 300;

export interface FormulaireEmissionProps {
  readonly type: TypeDocument;
  readonly onChangerType: (t: TypeDocument) => void;
  readonly saisie: Readonly<Record<string, string>>;
  readonly onChangerSaisie: (cle: string, valeur: string) => void;
  readonly onEmettre: () => void;
  readonly onAnnuler: () => void;
  readonly enCours: boolean;
  /** Vrai hors ligne : l'émission est refusée AVEC SA RAISON, jamais en silence. */
  readonly horsLigne: boolean;
  readonly messageErreur?: string;
}

export function FormulaireEmission({
  type,
  onChangerType,
  saisie,
  onChangerSaisie,
  onEmettre,
  onAnnuler,
  enCours,
  horsLigne,
  messageErreur,
}: FormulaireEmissionProps): React.JSX.Element {
  const [confirmation, setConfirmation] = useState(false);
  const [delaiEcoule, setDelaiEcoule] = useState(false);
  const [erreurs, setErreurs] = useState<Readonly<Record<string, string>>>({});

  // Le délai repart à zéro à chaque ouverture de la confirmation.
  useEffect(() => {
    if (!confirmation) return undefined;
    setDelaiEcoule(false);
    const minuteur = setTimeout(() => setDelaiEcoule(true), DELAI_ANTI_REFLEXE_MS);
    return () => clearTimeout(minuteur);
  }, [confirmation]);

  // `jours` → `jours_lettres`, par la MÊME fonction Postgres que celle qui
  // écrasera la valeur au rendu. Débouncée, et jamais déclenchée au montage.
  const jours = saisie["jours"] ?? "";
  useEffect(() => {
    if (type !== "suivi_medical") return undefined;
    if (!/^\d+$/.test(jours)) {
      onChangerSaisie("jours_lettres", "");
      return undefined;
    }

    let abandonne = false;
    const minuteur = setTimeout(() => {
      void nombreEnLettres(Number(jours)).then((r) => {
        if (abandonne) return;
        onChangerSaisie("jours_lettres", r.ok ? (r.data ?? "") : "");
      });
    }, DELAI_LETTRES_MS);

    return () => {
      abandonne = true;
      clearTimeout(minuteur);
    };
  }, [jours, onChangerSaisie, type]);

  const demanderConfirmation = useCallback(() => {
    const r = validerSaisie(type, saisie);
    setErreurs(r.erreurs);
    if (r.valide) setConfirmation(true);
  }, [saisie, type]);

  if (confirmation) {
    return (
      <section aria-label={fr.documents.emission.confirmerTitre} className="flex flex-col gap-3">
        <h2 className="font-ui text-heading text-ink-900">
          {fr.documents.emission.confirmerTitre}
        </h2>
        <p className="font-ui text-body text-ink-700">{fr.documents.emission.confirmerCorps}</p>

        {messageErreur === undefined ? null : (
          <p role="alert" className="font-ui text-body text-critical">
            {messageErreur}
          </p>
        )}

        <div className="flex gap-2">
          <Bouton
            rang="principal"
            onClick={onEmettre}
            disabled={!delaiEcoule || enCours || horsLigne}
          >
            {enCours ? fr.documents.emission.enCours : fr.documents.emission.confirmer}
          </Bouton>
          <Bouton rang="secondaire" onClick={() => setConfirmation(false)} disabled={enCours}>
            {fr.documents.emission.annuler}
          </Bouton>
        </div>

        {horsLigne ? (
          <p className="font-ui text-label text-attention-ink">
            {fr.documents.horsLigne.emissionBloquee}
          </p>
        ) : null}
      </section>
    );
  }

  return (
    <section aria-label={fr.documents.emission.ouvrir} className="flex flex-col gap-4">
      <ChampSelection
        libelle={fr.documents.emission.choisirType}
        valeur={type}
        onChange={(v) => onChangerType(v as TypeDocument)}
        options={TYPES_DOCUMENT.map((t) => ({ valeur: t, libelle: fr.documents.types[t] }))}
      />

      {specsPour(type).map((spec) => (
        <Champ
          key={spec.cle}
          spec={spec}
          valeur={saisie[spec.cle] ?? ""}
          {...(erreurs[spec.cle] === undefined ? {} : { erreur: erreurs[spec.cle] })}
          onChange={(v) => onChangerSaisie(spec.cle, v)}
        />
      ))}

      <div className="flex gap-2">
        <Bouton rang="principal" onClick={demanderConfirmation} disabled={horsLigne}>
          {fr.documents.emission.verifier}
        </Bouton>
        <Bouton rang="secondaire" onClick={onAnnuler}>
          {fr.documents.emission.annuler}
        </Bouton>
      </div>

      {horsLigne ? (
        <p className="font-ui text-label text-attention-ink">
          {fr.documents.horsLigne.emissionBloquee}
        </p>
      ) : null}
    </section>
  );
}

function Champ({
  spec,
  valeur,
  erreur,
  onChange,
}: {
  readonly spec: SpecChamp;
  readonly valeur: string;
  readonly erreur?: string;
  readonly onChange: (v: string) => void;
}): React.JSX.Element {
  const commun = {
    libelle: spec.libelle,
    valeur,
    onChange,
    ...(spec.aide === undefined ? {} : { indication: spec.aide }),
    ...(erreur === undefined ? {} : { erreur }),
    requis: true,
  };

  if (spec.genre === "zoneTexte") {
    return <ChampZoneTexte {...commun} lignes={4} />;
  }

  // `calcule` : affiché pour que la praticienne VOIE ce qui partira, jamais
  // pour qu'elle le règle. La base l'écrase de toute façon au rendu (043).
  if (spec.genre === "calcule") {
    return <ChampTexte {...commun} onChange={() => undefined} disabled />;
  }

  return <ChampTexte {...commun} />;
}
