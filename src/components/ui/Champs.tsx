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

import { Icone } from "./Icones";

const SOCLE_CHAMP = [
  "w-full min-h-target rounded-xl border bg-card px-4 py-3",
  "font-ui text-body font-regular text-ink-900",
  "placeholder:text-ink-300",
  "transition duration-quick ease-out",
  "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
  "focus-within:border-action-600 focus-within:shadow-lift2",
  "disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-disabled",
  "shadow-lift1",
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
  action,
  children,
}: {
  readonly libelle: string;
  readonly indication?: string;
  readonly erreur?: string;
  readonly idChamp: string;
  readonly idAide: string;
  /**
   * Commande propre à CE champ, posée sur la ligne du libellé.
   *
   * ⚠️ SA PLACE EST SON SENS. Un micro rangé à côté de « Subjectif » dit
   * « dicter dans Subjectif » sans avoir besoin de l'écrire. Le sortir de
   * cette ligne — une barre d'outils commune, par exemple — rendrait sa cible
   * ambiguë au moment précis où elle doit être évidente.
   */
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <label
          htmlFor={idChamp}
          className="font-ui text-label font-semibold tracking-label text-ink-700"
        >
          {libelle}
        </label>
        {action ?? null}
      </div>
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
  action,
  zoneRef,
}: BaseProps & {
  readonly valeur: string;
  readonly onChange: (v: string) => void;
  readonly lignes?: number;
  /** Typographie de note clinique — plus grande, plus aérée. */
  readonly clinique?: boolean;
  readonly placeholder?: string;
  /** Commande posée sur la ligne du libellé — voir `Habillage`. */
  readonly action?: React.ReactNode;
  /**
   * Accès à la zone réelle, pour lire la position du curseur.
   *
   * L'appelant NE DOIT PAS écrire la valeur par cette référence : elle sert à
   * SAVOIR où insérer, la valeur restant écrite par `onChange` comme toute
   * autre saisie — donc soumise à l'enregistrement automatique existant.
   */
  readonly zoneRef?: React.Ref<HTMLTextAreaElement>;
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
      {...(action === undefined ? {} : { action })}
    >
      <textarea
        id={idChamp}
        ref={zoneRef}
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

/**
 * La barre de recherche d'un annuaire — une COMMANDE, pas un champ de
 * formulaire.
 *
 * v9 : le champ nu avec sa bordure grise se fondait dans la page ; la
 * recherche est pourtant le premier geste de l'écran. La barre prend la
 * forme d'un pupitre : la loupe à gauche, le champ sans bordure propre au
 * milieu, la barre entière portant le focus. `role="search"` reste posé PAR
 * L'APPELANT (le `form` qui l'entoure) — ce composant ne fait que l'habiller.
 *
 * Le libellé reste OBLIGATOIRE et visuellement masqué : un champ sans nom
 * n'existe pas pour un lecteur d'écran, et le placeholder n'est pas un nom.
 */
export function ChampRecherche({
  libelle,
  valeur,
  onChange,
  placeholder,
}: {
  readonly libelle: string;
  readonly valeur: string;
  readonly onChange: (v: string) => void;
  readonly placeholder?: string;
}): React.JSX.Element {
  const idChamp = useId();

  return (
    <div
      className={[
        "flex min-h-target-lg w-full items-center gap-3 rounded-xl border border-rule bg-card px-4",
        "shadow-lift1 transition duration-quick ease-out",
        "focus-within:border-action-500 focus-within:shadow-lift2 focus-within:ring-4 focus-within:ring-action-50",
      ].join(" ")}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-action-50 text-action-600">
        <Icone nom="recherche" taille={16} className="shrink-0" />
      </span>
      <label htmlFor={idChamp} className="sr-only">
        {libelle}
      </label>
      <input
        id={idChamp}
        type="search"
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        {...(placeholder === undefined ? {} : { placeholder })}
        className="min-h-target-lg w-full border-0 bg-transparent font-ui text-body font-regular text-ink-900 outline-none placeholder:text-ink-500"
      />
    </div>
  );
}
