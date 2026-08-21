/**
 * Champs de saisie.
 *
 * UN LIBELLÉ, TOUJOURS, ET LIÉ. Pas de placeholder en guise de libellé : il
 * disparaît dès la première frappe, et c'est précisément au moment de la
 * relecture qu'on a besoin de savoir ce qu'on est en train de remplir. Le
 * placeholder sert d'exemple de format, rien d'autre.
 *
 * L'ERREUR EST SOUS LE CHAMP, PAS À LA PLACE DU LIBELLÉ, et le champ la
 * référence par `aria-describedby` — sinon un lecteur d'écran annonce un champ
 * invalide sans jamais dire pourquoi.
 *
 * `ton attention` et non `critical` pour un champ mal rempli : une saisie à
 * corriger n'est pas une perte de données (§4 règle 1).
 */

import { useId } from "react";

const SOCLE_CHAMP = [
  "w-full min-h-target rounded-md border bg-card px-4 py-3",
  "font-ui text-body text-ink-900",
  "placeholder:text-ink-300",
  "transition duration-quick ease-soft",
  "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-disabled",
].join(" ");

function bordure(enErreur: boolean): string {
  return enErreur
    ? "border-attention hover:border-attention"
    : "border-rule hover:border-ink-300";
}

interface BaseProps {
  readonly libelle: string;
  /** Phrase d'aide permanente — le format attendu, une contrainte à connaître. */
  readonly indication?: string;
  readonly erreur?: string;
  readonly requis?: boolean;
  readonly disabled?: boolean;
}

function Habillage({
  libelle,
  indication,
  erreur,
  idChamp,
  idAide,
  children,
}: {
  readonly libelle: string;
  readonly indication?: string;
  readonly erreur?: string;
  readonly idChamp: string;
  readonly idAide: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={idChamp}
        className="font-ui text-label font-medium tracking-label text-ink-700"
      >
        {libelle}
      </label>
      {children}
      {indication === undefined && erreur === undefined ? null : (
        <p
          id={idAide}
          className={[
            "font-ui text-label",
            erreur === undefined ? "text-ink-500" : "text-attention-ink",
          ].join(" ")}
        >
          {erreur ?? indication}
        </p>
      )}
    </div>
  );
}

export function ChampTexte({
  libelle,
  valeur,
  onChange,
  type = "text",
  placeholder,
  indication,
  erreur,
  requis = false,
  disabled = false,
}: BaseProps & {
  readonly valeur: string;
  readonly onChange: (v: string) => void;
  readonly type?: "text" | "email" | "password" | "number" | "date" | "datetime-local";
  readonly placeholder?: string;
}): React.JSX.Element {
  const idChamp = useId();
  const idAide = useId();
  const enErreur = erreur !== undefined;

  return (
    <Habillage
      libelle={libelle}
      idChamp={idChamp}
      idAide={idAide}
      {...(indication === undefined ? {} : { indication })}
      {...(erreur === undefined ? {} : { erreur })}
    >
      <input
        id={idChamp}
        type={type}
        value={valeur}
        required={requis}
        disabled={disabled}
        aria-invalid={enErreur}
        aria-describedby={indication === undefined && erreur === undefined ? undefined : idAide}
        onChange={(e) => onChange(e.target.value)}
        className={[SOCLE_CHAMP, bordure(enErreur)].join(" ")}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
    </Habillage>
  );
}

export function ChampSelection({
  libelle,
  valeur,
  onChange,
  options,
  indication,
  erreur,
  disabled = false,
}: BaseProps & {
  readonly valeur: string;
  readonly onChange: (v: string) => void;
  readonly options: readonly { readonly valeur: string; readonly libelle: string }[];
}): React.JSX.Element {
  const idChamp = useId();
  const idAide = useId();
  const enErreur = erreur !== undefined;

  return (
    <Habillage
      libelle={libelle}
      idChamp={idChamp}
      idAide={idAide}
      {...(indication === undefined ? {} : { indication })}
      {...(erreur === undefined ? {} : { erreur })}
    >
      <select
        id={idChamp}
        value={valeur}
        disabled={disabled}
        aria-invalid={enErreur}
        aria-describedby={indication === undefined && erreur === undefined ? undefined : idAide}
        onChange={(e) => onChange(e.target.value)}
        className={[SOCLE_CHAMP, bordure(enErreur), "cursor-pointer"].join(" ")}
      >
        {options.map((o) => (
          <option key={o.valeur} value={o.valeur}>
            {o.libelle}
          </option>
        ))}
      </select>
    </Habillage>
  );
}

/**
 * Zone de texte.
 *
 * `lignes` vaut 4 par défaut pour une note administrative. La note CLINIQUE
 * de S5 en demandera bien plus et emploie l'échelle `notes` (15/1.7, plus
 * grande exprès) : on écrit et on relit ces champs-là pendant des heures.
 */
export function ChampZoneTexte({
  libelle,
  valeur,
  onChange,
  lignes = 4,
  clinique = false,
  placeholder,
  indication,
  erreur,
  disabled = false,
}: BaseProps & {
  readonly valeur: string;
  readonly onChange: (v: string) => void;
  readonly lignes?: number;
  /** Typographie de note clinique — plus grande, plus aérée. */
  readonly clinique?: boolean;
  readonly placeholder?: string;
}): React.JSX.Element {
  const idChamp = useId();
  const idAide = useId();
  const enErreur = erreur !== undefined;

  return (
    <Habillage
      libelle={libelle}
      idChamp={idChamp}
      idAide={idAide}
      {...(indication === undefined ? {} : { indication })}
      {...(erreur === undefined ? {} : { erreur })}
    >
      <textarea
        id={idChamp}
        value={valeur}
        rows={lignes}
        disabled={disabled}
        aria-invalid={enErreur}
        aria-describedby={indication === undefined && erreur === undefined ? undefined : idAide}
        onChange={(e) => onChange(e.target.value)}
        className={[
          SOCLE_CHAMP,
          bordure(enErreur),
          "resize-y",
          clinique ? "text-notes" : "",
        ].join(" ")}
        {...(placeholder === undefined ? {} : { placeholder })}
      />
    </Habillage>
  );
}
