/**
 * Les champs saisis à l'émission — MIROIR d'un contrat gelé en base.
 *
 * ⚠️ CE FICHIER NE DÉCIDE RIEN. `app.issue_document` (030 §2) valide le jeu de
 * clés EXACT de chaque type — ni clé en trop, ni clé manquante — puis exige de
 * chaque valeur qu'elle soit un scalaire non vide. Ce qui est écrit ici ne fait
 * que permettre au formulaire de demander les bons champs AVANT l'aller-retour,
 * et de refuser une saisie vide sans déranger Alger. Si les deux divergent un
 * jour, c'est la BASE qui a raison et l'écran qui tombe — jamais l'inverse.
 *
 * ⚠️ LES DATES SONT DU TEXTE EN JJ/MM/AAAA, PAS DES `<input type="date">`.
 * Ce n'est pas un oubli d'ergonomie. Le modèle imprime `{{vars.date_debut}}`
 * TEL QUEL : un champ de date natif rendrait « 2026-09-01 », et c'est cette
 * chaîne-là qui partirait sur le papier d'un employeur algérien. La base ne
 * peut pas le rattraper — elle ne vérifie que « scalaire non vide ». Le format
 * se tient donc ici, et il se voit dans l'aperçu avant l'émission.
 *
 * ⚠️ `jours_lettres` EST DANS LE CONTRAT MAIS N'EST PAS SAISI. 030 l'exige
 * dans le jeu de clés ; 043 l'ÉCRASE au moment du rendu par le résultat de
 * `app.nombre_en_lettres`. Ce qui s'imprime ne peut donc pas contredire le
 * nombre en chiffres, quoi que l'écran envoie. Le champ est affiché en lecture
 * seule pour que la praticienne voie ce qui partira, pas pour qu'elle le règle.
 */

import { z } from "zod";

import { fr } from "@/i18n/fr";
import { CHAMPS_PAR_TYPE, type TypeDocument } from "@/services/documents";

/** Ce qu'un champ est à l'écran. Le genre décide du contrôle rendu. */
export type GenreChamp = "texte" | "zoneTexte" | "date" | "entier" | "calcule";

export interface SpecChamp {
  /** La clé exacte attendue par `app.issue_document`. */
  readonly cle: string;
  readonly genre: GenreChamp;
  readonly libelle: string;
  readonly aide?: string;
  /**
   * ⚠️ FACULTATIF VEUT DIRE « PEUT ÊTRE VIDE », JAMAIS « PEUT ÊTRE ABSENT ».
   * `app.issue_document` (045) continue d'exiger la clé dans le JSON — c'est
   * seulement le contrôle « non vide » qu'elle exempte. Une clé absente ferait
   * rendre NULL à `#>>`, donc laisserait le marqueur LITTÉRAL sur le papier.
   * Le payload est construit à partir de ce tableau, précisément pour que
   * l'absence soit impossible.
   */
  readonly facultatif?: boolean;
}

const LIB = fr.documents.champs;

const SPECS: Readonly<Record<TypeDocument, readonly SpecChamp[]>> = {
  bonne_sante_mentale: [
    { cle: "id_document_number", genre: "texte", libelle: LIB.id_document_number },
    { cle: "mairie", genre: "texte", libelle: LIB.mairie },
  ],
  suivi_medical: [
    { cle: "jours", genre: "entier", libelle: LIB.jours },
    { cle: "jours_lettres", genre: "calcule", libelle: LIB.jours_lettres, aide: LIB.aideJoursLettres },
    { cle: "date_debut", genre: "date", libelle: LIB.date_debut, aide: LIB.formatDate },
  ],
  // DOCUMENT-TEMPLATES-v2 §3 : deux lignes de traitement, la SECONDE
  // facultative — « don't force two lines ». Vide, sa puce est masquée par
  // `li:empty` (tokens.css) et rien ne s'imprime.
  certificat_medical: [
    { cle: "date_naissance", genre: "date", libelle: LIB.date_naissance, aide: LIB.aideDateNaissance },
    { cle: "traitement_1", genre: "texte", libelle: LIB.traitement_1, aide: LIB.aideTraitement },
    { cle: "traitement_2", genre: "texte", libelle: LIB.traitement_2, aide: LIB.aideTraitement2, facultatif: true },
  ],
  justification: [
    { cle: "date_consultation", genre: "date", libelle: LIB.date_consultation, aide: LIB.formatDate },
  ],
};

/**
 * Contrôle de cohérence exécuté AU CHARGEMENT DU MODULE, pas en test.
 *
 * Si un jour quelqu'un ajoute un champ ici sans l'ajouter au contrat, ou
 * l'inverse, l'écran doit tomber tout de suite et bruyamment — pas produire un
 * formulaire dont chaque envoi sera refusé par la base avec un message que la
 * praticienne ne peut pas interpréter.
 */
for (const [type, specs] of Object.entries(SPECS) as [TypeDocument, readonly SpecChamp[]][]) {
  const attendues = [...CHAMPS_PAR_TYPE[type]].sort();
  const declarees = specs.map((s) => s.cle).sort();
  if (attendues.join(",") !== declarees.join(",")) {
    throw new Error(
      `champs.ts : le formulaire de « ${type} » déclare [${declarees.join(", ")}] ` +
        `alors que la base attend [${attendues.join(", ")}].`,
    );
  }
}

export function specsPour(type: TypeDocument): readonly SpecChamp[] {
  return SPECS[type];
}

/**
 * Le JSON envoyé à `app.issue_document`, construit À PARTIR DU CONTRAT.
 *
 * ⚠️ NE JAMAIS ENVOYER `saisie` DIRECTEMENT. Un champ jamais touché n'existe
 * pas dans l'état du formulaire : la clé serait ABSENTE du JSON, et 030 refuse
 * l'émission pour jeu de clés incorrect — message que la praticienne ne peut
 * pas interpréter, sur un formulaire qui lui paraît complet. Depuis 045 c'est
 * pire encore pour `traitement_2`, qu'elle a le DROIT de laisser vide : sans
 * cette construction, le cas nominal serait précisément celui qui échoue.
 *
 * Chaque clé du contrat part donc, vide ou non. Une clé en trop serait refusée
 * aussi — d'où la dérivation depuis `specsPour`, jamais depuis les touches
 * frappées.
 */
export function payloadPour(
  type: TypeDocument,
  saisie: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const payload: Record<string, string> = {};
  for (const spec of specsPour(type)) {
    payload[spec.cle] = (saisie[spec.cle] ?? "").trim();
  }
  return payload;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const RE_DATE_FR = /^(\d{2})\/(\d{2})\/(\d{4})$/;

/**
 * Vrai si la chaîne est une date JJ/MM/AAAA qui EXISTE. Le contrôle du calendrier
 * compte : « 31/02/2026 » passe une simple expression régulière et n'est pas une
 * date — sur un arrêt de travail, ce serait une pièce contestable.
 */
export function dateFrEstValide(v: string): boolean {
  const m = RE_DATE_FR.exec(v);
  if (m === null) return false;
  const [, jj, mm, aaaa] = m;
  if (jj === undefined || mm === undefined || aaaa === undefined) return false;

  const jour = Number(jj);
  const mois = Number(mm);
  const annee = Number(aaaa);
  const d = new Date(Date.UTC(annee, mois - 1, jour));
  return (
    d.getUTCFullYear() === annee && d.getUTCMonth() === mois - 1 && d.getUTCDate() === jour
  );
}

/** `2022-01-01` (ce que rend `app.patients`) → `01/01/2022` (ce que lit un notaire). */
export function isoVersFr(iso: string | null): string {
  if (iso === null) return "";
  const partie = iso.slice(0, 10).split("-");
  const [aaaa, mm, jj] = partie;
  if (aaaa === undefined || mm === undefined || jj === undefined) return "";
  return `${jj}/${mm}/${aaaa}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const E = fr.documents.erreurs;

/**
 * Le schéma d'un champ. Zod sur CHAQUE entrée (CLAUDE.md §2), y compris celles
 * que la base revalidera : un refus qui n'a pas quitté la machine est un refus
 * qui n'a rien coûté, et son message est en français plutôt qu'en SQLSTATE.
 */
function schemaDe(spec: SpecChamp): z.ZodType<string> {
  // Un champ facultatif accepte le vide, et RIEN D'AUTRE ne change : s'il est
  // rempli, il est validé comme les autres. C'est le seul endroit où la
  // distinction existe côté écran — la clé, elle, part toujours (§payload).
  if (spec.facultatif === true) return z.string();

  switch (spec.genre) {
    case "entier":
      return z
        .string()
        .trim()
        .min(1, E.champRequis)
        .regex(/^\d+$/, E.joursNonEntier)
        .refine((v) => Number(v) >= 1 && Number(v) <= 365, E.joursHorsBornes);

    case "date":
      return z.string().trim().min(1, E.champRequis).refine(dateFrEstValide, E.dateInvalide);

    // `calcule` n'est pas saisi : il est rempli par le serveur au moment du
    // rendu. On exige quand même une valeur non vide, parce que le CONTRAT de
    // 030 l'exige — le formulaire ne peut pas envoyer moins que ce que la base
    // demande, même si la base l'écrase ensuite.
    case "calcule":
    case "texte":
    case "zoneTexte":
      return z.string().trim().min(1, E.champRequis);
  }
}

export interface ResultatValidation {
  readonly valide: boolean;
  /** Clé du champ → message. Vide si tout passe. */
  readonly erreurs: Readonly<Record<string, string>>;
}

export function validerSaisie(
  type: TypeDocument,
  saisie: Readonly<Record<string, string>>,
): ResultatValidation {
  const erreurs: Record<string, string> = {};

  for (const spec of specsPour(type)) {
    const r = schemaDe(spec).safeParse(saisie[spec.cle] ?? "");
    if (!r.success) {
      erreurs[spec.cle] = r.error.issues[0]?.message ?? E.champRequis;
    }
  }

  return { valide: Object.keys(erreurs).length === 0, erreurs };
}
