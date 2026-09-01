/**
 * Formulaire de premier lancement — PUREMENT PRÉSENTATIONNEL, même règle que
 * `FormulaireConnexion` : aucun `src/services/*` importé ici, l'appelant
 * décide comment provisionner. Neuf champs, deux sections (cabinet / compte),
 * mêmes jetons visuels que la connexion pour que ce soit reconnaissable comme
 * la même application, à une carte plus large.
 */

"use client";

import { useId, useState } from "react";

import { fr } from "@/i18n/fr";
import { Icone, MarqueMindCare } from "./ui/Icones";

export interface EntreeFormulairePremierLancement {
  readonly cabinetNom: string;
  readonly cabinetAdresse: string;
  readonly cabinetTelephone: string;
  readonly praticienNomComplet: string;
  readonly praticienTitre: string;
  readonly praticienNumeroOrdre: string;
  readonly praticienTelephone: string;
  readonly email: string;
  readonly motDePasse: string;
}

export interface FormulairePremierLancementProps {
  readonly onSubmit: (entree: EntreeFormulairePremierLancement) => void;
  readonly enCours: boolean;
  readonly messageErreur?: string | undefined;
}

const CHAMP_CLASSES =
  "min-h-target-lg w-full rounded-md border border-rule bg-card px-4 py-3 font-ui text-body text-ink-900 outline-none transition duration-quick ease-soft placeholder:text-ink-300 hover:border-ink-300 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-disabled";

const LABEL_CLASSES = "font-ui text-label font-medium tracking-label text-ink-700";

function Champ({
  id,
  label,
  type = "text",
  required = false,
  disabled,
  value,
  onChange,
  aide,
  minLength,
}: {
  readonly id: string;
  readonly label: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly disabled: boolean;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly aide?: string | undefined;
  readonly minLength?: number | undefined;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className={LABEL_CLASSES}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        disabled={disabled}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={CHAMP_CLASSES}
        {...(minLength !== undefined && { minLength })}
      />
      {aide !== undefined ? (
        <span className="font-ui text-label text-ink-500">{aide}</span>
      ) : null}
    </div>
  );
}

export function FormulairePremierLancement({
  onSubmit,
  enCours,
  messageErreur,
}: FormulairePremierLancementProps): React.JSX.Element {
  const [cabinetNom, setCabinetNom] = useState("");
  const [cabinetAdresse, setCabinetAdresse] = useState("");
  const [cabinetTelephone, setCabinetTelephone] = useState("");
  const [praticienNomComplet, setPraticienNomComplet] = useState("");
  const [praticienTitre, setPraticienTitre] = useState("Dr.");
  const [praticienNumeroOrdre, setPraticienNumeroOrdre] = useState("");
  const [praticienTelephone, setPraticienTelephone] = useState("");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");

  const erreurId = useId();
  const ids = {
    cabinetNom: useId(),
    cabinetAdresse: useId(),
    cabinetTelephone: useId(),
    praticienNomComplet: useId(),
    praticienTitre: useId(),
    praticienNumeroOrdre: useId(),
    praticienTelephone: useId(),
    email: useId(),
    motDePasse: useId(),
  };

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (enCours) return;
    onSubmit({
      cabinetNom,
      cabinetAdresse,
      cabinetTelephone,
      praticienNomComplet,
      praticienTitre,
      praticienNumeroOrdre,
      praticienTelephone,
      email,
      motDePasse,
    });
  }

  return (
    <div className="flex w-full max-w-form flex-col gap-6 rounded-xl border border-rule bg-card p-10 shadow-lift3">
      <div className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-grad-orb text-on-brand shadow-glow-brand"
        >
          <MarqueMindCare taille={28} />
        </span>
        <div className="flex min-w-0 flex-col">
          <h1 className="m-0 font-ui text-title font-semibold text-ink-900">
            {fr.premierLancement.titre}
          </h1>
          <p className="m-0 font-ui text-label text-ink-500">{fr.premierLancement.accroche}</p>
        </div>
      </div>

      {messageErreur !== undefined ? (
        <div
          id={erreurId}
          role="alert"
          className="m-0 flex items-start gap-3 rounded-md border border-attention bg-attention-bg px-4 py-3"
        >
          <span aria-hidden="true" className="mt-0.5 inline-flex shrink-0 text-attention-ink">
            <Icone nom="alerte" taille={20} />
          </span>
          <span className="flex min-w-0 flex-col gap-1">
            <strong className="font-ui text-label font-semibold uppercase tracking-label text-attention-ink">
              {fr.erreur.titre}
            </strong>
            <span className="font-ui text-body text-ink-700">{messageErreur}</span>
          </span>
        </div>
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-6"
        aria-describedby={messageErreur !== undefined ? erreurId : undefined}
      >
        <div className="flex flex-col gap-4">
          <h2 className="m-0 font-ui text-label font-semibold uppercase tracking-label text-ink-500">
            {fr.premierLancement.sectionCabinet}
          </h2>
          <Champ
            id={ids.cabinetNom}
            label={fr.premierLancement.champCabinetNom}
            required
            disabled={enCours}
            value={cabinetNom}
            onChange={setCabinetNom}
          />
          <Champ
            id={ids.cabinetAdresse}
            label={fr.premierLancement.champCabinetAdresse}
            disabled={enCours}
            value={cabinetAdresse}
            onChange={setCabinetAdresse}
          />
          <Champ
            id={ids.cabinetTelephone}
            label={fr.premierLancement.champCabinetTelephone}
            type="tel"
            disabled={enCours}
            value={cabinetTelephone}
            onChange={setCabinetTelephone}
          />
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="m-0 font-ui text-label font-semibold uppercase tracking-label text-ink-500">
            {fr.premierLancement.sectionPraticien}
          </h2>
          <Champ
            id={ids.praticienNomComplet}
            label={fr.premierLancement.champPraticienNomComplet}
            required
            disabled={enCours}
            value={praticienNomComplet}
            onChange={setPraticienNomComplet}
          />
          <Champ
            id={ids.praticienTitre}
            label={fr.premierLancement.champPraticienTitre}
            disabled={enCours}
            value={praticienTitre}
            onChange={setPraticienTitre}
          />
          <Champ
            id={ids.praticienNumeroOrdre}
            label={fr.premierLancement.champPraticienNumeroOrdre}
            disabled={enCours}
            value={praticienNumeroOrdre}
            onChange={setPraticienNumeroOrdre}
          />
          <Champ
            id={ids.praticienTelephone}
            label={fr.premierLancement.champPraticienTelephone}
            type="tel"
            disabled={enCours}
            value={praticienTelephone}
            onChange={setPraticienTelephone}
          />
          <Champ
            id={ids.email}
            label={fr.premierLancement.champEmail}
            type="email"
            required
            disabled={enCours}
            value={email}
            onChange={setEmail}
          />
          <Champ
            id={ids.motDePasse}
            label={fr.premierLancement.champMotDePasse}
            type="password"
            required
            disabled={enCours}
            value={motDePasse}
            onChange={setMotDePasse}
            aide={fr.premierLancement.aideMotDePasse}
            minLength={10}
          />
        </div>

        <button
          type="submit"
          disabled={enCours}
          aria-busy={enCours}
          className={[
            "mt-2 flex min-h-target-lg w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 px-5 py-3",
            "font-ui text-body font-semibold text-paper shadow-lift1",
            "transition duration-quick ease-soft",
            enCours
              ? "cursor-default bg-brand-500 shadow-none"
              : "bg-action-600 hover:bg-action-700 hover:shadow-lift2 active:bg-action-900 active:shadow-lift1",
          ].join(" ")}
        >
          {enCours ? fr.premierLancement.enCours : fr.premierLancement.boutonValider}
        </button>
      </form>
    </div>
  );
}
