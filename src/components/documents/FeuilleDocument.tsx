"use client";

/**
 * La feuille A5 — À L'ÉCRAN ET SUR LE PAPIER, la même.
 *
 * ═══ DEUX MODES, ET ILS NE SONT PAS DE MÊME NATURE ═════════════════════════
 *
 * `emise`  — le `rendered_html` FIGÉ par la base au moment de l'émission.
 *            C'est LA PIÈCE : ce qui a été remis au patient, et ce qui
 *            ressortira à l'identique si on la réimprime en décembre.
 *
 * `apercu` — ce que l'écran reconstitue AVANT l'émission.
 *
 * ⚠️ L'APERÇU N'EST PAS LE DOCUMENT, ET NE PRÉTEND PAS L'ÊTRE. Le corps du
 * certificat est rendu EN BASE par `app.render_template` (030 §1quater) — « la
 * base rend, la base fige » — et cette décision est de sécurité : un HTML
 * composé côté client puis posté comme « le certificat émis » ne serait plus
 * dérivé du modèle. L'aperçu montre donc ce que l'écran SAIT avec certitude :
 * l'en-tête exact, la mise en page exacte, et CHAQUE valeur qui partira. Il ne
 * recompose pas le texte du corps — écrire un second moteur de substitution en
 * TypeScript créerait une seconde vérité, qui divergerait un jour en silence
 * sans que rien ne le signale.
 *
 * ⚠️ `dangerouslySetInnerHTML` EST ICI LE CHEMIN CORRECT, pas une entorse.
 * Chaque valeur de `rendered_html` est passée par `app.html_escape` (030
 * §1ter), qui échappe même `{` et `}` pour qu'une donnée ne puisse pas
 * fabriquer un marqueur ; le seul HTML libre vient du modèle, écrit à la main
 * dans 044. Assainir à nouveau ici ne protégerait de rien et retirerait de la
 * mise en forme légitime.
 */

import { fr } from "@/i18n/fr";
import { aujourdHuiCabinet } from "@/services/finance-calendrier";
import type { TypeDocument } from "@/services/documents";

import { isoVersFr, specsPour } from "./champs";

export interface IdentitePatient {
  readonly firstName: string;
  readonly lastName: string;
  readonly birthDate: string | null;
}

/**
 * L'âge, calculé EXACTEMENT comme `043` le calcule en base :
 * années révolues entre la naissance et AUJOURD'HUI DANS LE FUSEAU DU CABINET.
 *
 * ⚠️ `aujourdHuiCabinet()` et non `new Date()`. Le poste peut être réglé sur
 * n'importe quel fuseau ; Postgres tourne en UTC et convertit en
 * `Africa/Algiers`. Un âge calculé sur l'heure locale du poste différerait d'un
 * an le jour d'un anniversaire, à une heure près — et l'aperçu annoncerait
 * alors un chiffre que le certificat ne porterait pas.
 */
export function ageCabinet(birthDate: string | null): number | null {
  if (birthDate === null) return null;

  const [an, mn, jn] = birthDate.slice(0, 10).split("-").map(Number);
  const [aa, ma, ja] = aujourdHuiCabinet().split("-").map(Number);
  if (an === undefined || mn === undefined || jn === undefined) return null;
  if (aa === undefined || ma === undefined || ja === undefined) return null;

  let age = aa - an;
  if (ma < mn || (ma === mn && ja < jn)) age -= 1;
  return age < 0 ? null : age;
}

/**
 * L'en-tête, reconstitué à l'identique de celui que `044` sème.
 *
 * ⚠️ LES QUATRE VALEURS DU BLOC PRATICIENNE NE SONT PAS AFFICHÉES ICI, et ce
 * n'est pas un oubli : elles vivent dans `app.profiles`, l'aperçu ne les lit
 * pas, et les inventer produirait un en-tête faux. La zone est donc marquée
 * comme rendue par le serveur — visible, plutôt que remplie d'à-peu-près.
 */
function EnteteApercu({
  patient,
  dateAffichee,
}: {
  readonly patient: IdentitePatient;
  readonly dateAffichee: string;
}): React.JSX.Element {
  const age = ageCabinet(patient.birthDate);

  return (
    <header className="doc-entete">
      <div className="doc-entete__identite">
        <p className="doc-entete__nom">{fr.documents.apercu.enTetePraticienne}</p>
        <hr className="doc-entete__filet" />
        <hr className="doc-entete__filet" />
      </div>

      <div className="doc-entete__marque" aria-hidden="true" />

      <div className="doc-entete__patient">
        <p>
          <span>{fr.documents.enTete.date}</span> {dateAffichee}
        </p>
        <p>
          <span>{fr.documents.enTete.nom}</span> {patient.lastName}
        </p>
        <p>
          <span>{fr.documents.enTete.prenom}</span> {patient.firstName}
        </p>
        <p>
          <span>{fr.documents.enTete.age}</span>{" "}
          {age === null ? fr.etats.texteAbsent : `${age} ${fr.documents.enTete.ans}`}
        </p>
      </div>
    </header>
  );
}

export function FeuilleApercu({
  type,
  patient,
  saisie,
}: {
  readonly type: TypeDocument;
  readonly patient: IdentitePatient;
  readonly saisie: Readonly<Record<string, string>>;
}): React.JSX.Element {
  // La date de l'en-tête suit exactement la règle de 043 §5bis : celle de la
  // consultation pour une justification, celle du jour pour les trois autres.
  const dateAffichee =
    type === "justification"
      ? (saisie["date_consultation"] ?? "")
      : isoVersFr(aujourdHuiCabinet());

  return (
    <article className="doc-feuille">
      <EnteteApercu patient={patient} dateAffichee={dateAffichee} />

      <h1 className="doc-titre">{fr.documents.types[type]}</h1>

      <div className="doc-corps">
        <p>{fr.documents.apercu.corpsRenduParServeur}</p>

        <dl className="flex flex-col gap-2">
          {specsPour(type).map((spec) => (
            <div key={spec.cle} className="flex flex-col gap-1">
              <dt className="font-ui text-label text-ink-500">{spec.libelle}</dt>
              <dd className="whitespace-pre-wrap font-doc text-body text-ink-900">
                {saisie[spec.cle] === undefined || saisie[spec.cle] === ""
                  ? fr.etats.texteAbsent
                  : saisie[spec.cle]}
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </article>
  );
}

/**
 * ═══ VIEW ≠ PRINT — le correctif architectural central ══════════════════════
 *
 * `app.render_template` (030 §1quater) laisse LITTÉRAL tout marqueur sans
 * valeur: un trou invisible est pire qu'un marqueur visible EN BASE.
 * Mais sur le papier, un {{…}} est une pièce abîmée.
 *
 * AVANT: le viewer bloquait l'affichage si {{ présent → l'historique devenait
 * illisible dès que le profil était incomplet.
 * APRÈS: VIEW affiche TOUJOURS le snapshot immuable (même troué), avec un
 * bandeau ambre explicatif hors papier. PRINT est seul à être bloqué.
 *
 * Le test reste grossier (présence de {{) : une liste fermée de 25 clés
 * prendrait du retard et laisserait passer le marqueur nouveau.
 */
export function contientMarqueurNonResolu(html: string): boolean {
  return html.includes("{{");
}

export function extractUnresolvedMarkers(html: string): readonly string[] {
  if (!html.includes("{{")) return [];
  const re = /\{\{([^}]+)\}\}/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const key = m[1]?.trim();
    if (key !== undefined && key !== "" && !out.includes(key)) out.push(key);
  }
  return out;
}

/**
 * La pièce émise — TOUJOURS affichée (même trouée).
 * Le bandeau d'incomplétude est rendu PAR L'APPELANTE, hors papier,
 * pour ne jamais muter le HTML figé ni le masquer.
 */
export function FeuilleEmise({ html }: { readonly html: string }): React.JSX.Element {
  return (
    <article className="doc-feuille doc-corps" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
