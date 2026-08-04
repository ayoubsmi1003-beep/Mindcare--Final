"use client";

/**
 * Grille hebdomadaire de l'agenda — présentation pure.
 *
 * Ce composant ne requête rien : il reçoit `entrees` déjà filtrées par
 * l'appelant (RLS appliquée en base, cf. `src/services/appointments.ts`) et se
 * contente de les répartir dans une grille jour × heure. Un rendez-vous
 * `cancelled` est ignoré ICI AUSSI, par défense — pas parce que l'appelant en
 * laisserait passer, mais parce qu'un composant de présentation ne doit jamais
 * supposer que son entrée est déjà nettoyée.
 */

import Link from "next/link";

import { heure, nomPatient, plage } from "@/components/AgendaPieces";
import { fr } from "@/i18n/fr";
import type { AgendaEntry, ConsultationKind } from "@/services/appointments";

/** Les cinq familles de la légende (§ tokens.css, bloc FAMILLES DE CONSULTATION). */
export type FamilleConsultation =
  | "suivi"
  | "premiere"
  | "psychotherapie"
  | "entretien"
  | "administratif";

/**
 * Type → famille. Couverture EXHAUSTIVE des treize valeurs de `ConsultationKind` :
 * le compilateur signale tout type ajouté au schéma qu'on aurait oublié de
 * classer ici, plutôt que de le laisser tomber silencieusement dans une famille
 * par défaut.
 */
export const FAMILLE_PAR_TYPE: Readonly<Record<ConsultationKind, FamilleConsultation>> = {
  suivi: "suivi",
  teleconsultation: "suivi",
  premiere_consultation: "premiere",
  evaluation_psychiatrique: "premiere",
  psychotherapie_individuelle: "psychotherapie",
  therapie_couple: "psychotherapie",
  therapie_familiale: "psychotherapie",
  therapie_groupe: "psychotherapie",
  entretien_famille: "entretien",
  entretien_tiers: "entretien",
  certificat_medical: "administratif",
  renouvellement_ordonnance: "administratif",
  bilan_psychologique: "administratif",
};

const JETONS_FAMILLE: Readonly<Record<FamilleConsultation, { readonly accent: string; readonly fond: string }>> = {
  suivi: { accent: "var(--kind-suivi-accent)", fond: "var(--kind-suivi-bg)" },
  premiere: { accent: "var(--kind-premiere-accent)", fond: "var(--kind-premiere-bg)" },
  psychotherapie: { accent: "var(--kind-psychotherapie-accent)", fond: "var(--kind-psychotherapie-bg)" },
  entretien: { accent: "var(--kind-entretien-accent)", fond: "var(--kind-entretien-bg)" },
  administratif: { accent: "var(--kind-administratif-accent)", fond: "var(--kind-administratif-bg)" },
};

const FORMAT_JOUR_ABREGE = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const FORMAT_JOUR_NUMERO = new Intl.DateTimeFormat("fr-FR", { day: "numeric" });

export interface GrilleSemaineProps {
  readonly debutSemaine: Date;
  readonly jours: number;
  readonly heureDebut: number;
  readonly heureFin: number;
  readonly entrees: readonly AgendaEntry[];
  readonly onCreneauLibre?: (debut: Date) => void;
}

function ajouterJours(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/**
 * Ce que la grille va RÉELLEMENT rendre : les entrées placées, et les bornes
 * horaires nécessaires pour toutes les contenir.
 *
 * Exporté parce que l'écran affiche des compteurs au-dessus de la grille
 * (« N séances cette semaine », « N créneaux libres »). Ces compteurs se
 * calculaient jadis à part, sur la liste brute et sur une plage horaire figée ;
 * ils annonçaient donc six séances au-dessus d'une grille qui en montrait
 * quatre. Un chiffre que l'écran contredit juste en dessous est pire qu'aucun
 * chiffre : il fait douter de l'écran entier.
 *
 * Une seule fonction décide, deux affichages la lisent.
 */
export function repartition(
  entrees: readonly AgendaEntry[],
  debutSemaine: Date,
  jours: number,
  heureDebut: number,
  heureFin: number,
): {
  readonly colonnesJours: readonly Date[];
  readonly lignesHeures: readonly number[];
  readonly parCase: ReadonlyMap<string, readonly AgendaEntry[]>;
  readonly placees: readonly AgendaEntry[];
} {
  // Rendez-vous annulé : jamais dans la grille, même si l'appelant en a laissé
  // passer un (défense en profondeur, cf. entête du fichier).
  const visibles = entrees.filter((e) => e.status !== "cancelled");
  const colonnesJours = Array.from({ length: jours }, (_, i) => ajouterJours(debutSemaine, i));

  const parCase = new Map<string, AgendaEntry[]>();
  const placees: AgendaEntry[] = [];
  const heuresOccupees: number[] = [];

  for (const entree of visibles) {
    const debut = new Date(Date.parse(entree.startsAt));
    if (Number.isNaN(debut.getTime())) continue;
    const iJour = colonnesJours.findIndex((j) => memeJour(j, debut));
    if (iJour === -1) continue;

    const cle = `${iJour}-${debut.getHours()}`;
    const liste = parCase.get(cle);
    if (liste === undefined) parCase.set(cle, [entree]);
    else liste.push(entree);
    placees.push(entree);
    heuresOccupees.push(debut.getHours());
  }

  // LA PLAGE HORAIRE S'ÉTEND POUR COUVRIR CE QU'IL Y A À MONTRER.
  //
  // `heureDebut`/`heureFin` décrivent la journée de travail HABITUELLE, pas une
  // autorisation d'affichage. La version antérieure ne rendait que les heures de
  // cette plage : un rendez-vous à 21:47 ne trouvait aucune cellule et
  // DISPARAISSAIT — sans erreur, sans compteur, avec un en-tête de colonne
  // affichant « 0 séances » sur un lundi qui en portait deux. Mesuré à l'écran
  // le 2026-08-04 : six séances annoncées, quatre rendues.
  //
  // Masquer une séance, c'est manquer un patient ou provoquer un double
  // booking. La plage s'élargit donc à la demande, et reste à la journée de
  // travail quand rien n'en sort.
  const borneBasse = Math.min(heureDebut, ...heuresOccupees);
  const borneHaute = Math.max(heureFin, ...heuresOccupees.map((h) => h + 1));
  const lignesHeures = Array.from(
    { length: Math.max(0, borneHaute - borneBasse) },
    (_, i) => borneBasse + i,
  );

  return { colonnesJours, lignesHeures, parCase, placees };
}

/**
 * Le créneau `h` du jour donné, en heure locale.
 *
 * On POSE l'heure au lieu de l'additionner : `debutSemaine` n'est pas garanti à
 * minuit, et un décalage de quelques heures dans la prop aurait glissé toute la
 * grille d'autant de lignes — sans rien casser de visible, ce qui est le pire
 * mode de défaillance pour un agenda.
 */
function creneau(jour: Date, h: number): Date {
  const d = new Date(jour);
  d.setHours(h, 0, 0, 0);
  return d;
}

/** Deux instants tombent-ils le même jour civil, en heure locale ? */
function memeJour(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Famille d'affichage d'une entrée. `kind === null` → administratif neutre. */
function familleDe(kind: ConsultationKind | null): FamilleConsultation {
  return kind === null ? "administratif" : FAMILLE_PAR_TYPE[kind];
}

/** Libellé du type. `kind === null` reste honnête plutôt que de deviner. */
function libelleType(kind: ConsultationKind | null): string {
  return kind === null ? fr.etats.texteAbsent : fr.agenda.types[kind];
}

/** Monogramme du patient — première lettre du nom, ou rien si l'identité n'est pas rendue. */
function monogramme(nom: string | null): string {
  return nom === null ? "" : nom.charAt(0).toUpperCase();
}

export function GrilleSemaine({
  debutSemaine,
  jours,
  heureDebut,
  heureFin,
  entrees,
  onCreneauLibre,
}: GrilleSemaineProps): React.JSX.Element {
  // Le placement, les bornes horaires et le comptage sortent d'UNE fonction,
  // que l'écran appelle lui aussi pour ses compteurs (cf. `repartition`).
  const { colonnesJours, lignesHeures, parCase } = repartition(
    entrees,
    debutSemaine,
    jours,
    heureDebut,
    heureFin,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-4)" }}>
      {/* Le tableau scrolle dans SON conteneur : la page, elle, ne défile jamais
          horizontalement (règle 9). */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            width: "var(--size-full)",
            minWidth: "var(--card-column-min)",
            tableLayout: "fixed",
          }}
        >
          <colgroup>
            <col style={{ width: "var(--s-16)" }} />
            {colonnesJours.map((_, i) => (
              <col key={i} />
            ))}
          </colgroup>

          <thead>
            <tr>
              <th
                scope="col"
                style={{
                  minWidth: "var(--size-0)",
                  border: "var(--rule-width) solid var(--rule)",
                  background: "var(--sunken)",
                }}
              />
              {colonnesJours.map((jourColonne, i) => {
                const nbSeances = lignesHeures.reduce((total, h) => {
                  const c = parCase.get(`${i}-${h}`);
                  return total + (c?.length ?? 0);
                }, 0);
                return (
                  <th
                    key={i}
                    scope="col"
                    style={{
                      minWidth: "var(--size-0)",
                      padding: "var(--s-3)",
                      border: "var(--rule-width) solid var(--rule)",
                      background: "var(--sunken)",
                      textAlign: "left",
                      fontWeight: "var(--weight-semibold)",
                    }}
                  >
                    <div
                      style={{
                        fontSize: "var(--text-label-size)",
                        lineHeight: "var(--text-label-leading)",
                        letterSpacing: "var(--text-label-tracking)",
                        color: "var(--ink-900)",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {FORMAT_JOUR_ABREGE.format(jourColonne)} {FORMAT_JOUR_NUMERO.format(jourColonne)}
                    </div>
                    <div
                      style={{
                        marginTop: "var(--s-1)",
                        fontSize: "var(--text-label-size)",
                        lineHeight: "var(--text-label-leading)",
                        fontWeight: "var(--weight-regular)",
                        color: "var(--ink-500)",
                      }}
                    >
                      {nbSeances} {fr.agenda.semaine.seances}
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>

          <tbody>
            {lignesHeures.map((h) => (
              <tr key={h}>
                <th
                  scope="row"
                  style={{
                    minWidth: "var(--size-0)",
                    padding: "var(--s-2) var(--s-3)",
                    border: "var(--rule-width) solid var(--rule)",
                    background: "var(--sunken)",
                    textAlign: "left",
                    fontWeight: "var(--weight-medium)",
                    fontFamily: "var(--font-num)",
                    fontVariantNumeric: "tabular-nums",
                    color: "var(--ink-700)",
                    fontSize: "var(--text-num-size)",
                    lineHeight: "var(--text-num-leading)",
                  }}
                >
                  {String(h).padStart(2, "0")}:00
                </th>

                {colonnesJours.map((jourColonne, i) => {
                  const cle = `${i}-${h}`;
                  const casesOccupees = parCase.get(cle) ?? [];
                  const debutCreneau = creneau(jourColonne, h);

                  return (
                    <td
                      key={i}
                      style={{
                        minWidth: "var(--size-0)",
                        verticalAlign: "top",
                        padding: "var(--s-1)",
                        border: "var(--rule-width) solid var(--rule)",
                      }}
                    >
                      {casesOccupees.length === 0 ? (
                        <CelluleLibre
                          debut={debutCreneau}
                          {...(onCreneauLibre === undefined ? {} : { onCreneauLibre })}
                        />
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)" }}>
                          {casesOccupees.map((entree) => (
                            <CarteRendezVous key={entree.id} entree={entree} />
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Legende />
    </div>
  );
}

function CelluleLibre({
  debut,
  onCreneauLibre,
}: {
  readonly debut: Date;
  readonly onCreneauLibre?: (debut: Date) => void;
}): React.JSX.Element {
  const commun = {
    display: "flex" as const,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    minHeight: "var(--target-comfort)",
    width: "var(--size-full)",
    minWidth: "var(--size-0)",
    borderRadius: "var(--r-sm)",
    border: "var(--rule-width) dashed var(--rule)",
    background: "transparent",
    color: "var(--ink-300)",
    fontSize: "var(--text-label-size)",
    lineHeight: "var(--text-label-leading)",
  };

  if (onCreneauLibre === undefined) {
    return <div style={commun}>{fr.agenda.semaine.libre}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onCreneauLibre(debut)}
      style={{ ...commun, cursor: "pointer", font: "inherit" }}
    >
      {fr.agenda.semaine.libre}
    </button>
  );
}

function CarteRendezVous({ entree }: { readonly entree: AgendaEntry }): React.JSX.Element {
  const famille = familleDe(entree.kind);
  const jetons = JETONS_FAMILLE[famille];
  const nom = nomPatient(entree.lastName, entree.firstName);
  // La plage, pas l'instant : la case porte l'heure PLEINE, la carte doit dire
  // le vrai début ET la vraie fin. Repli sur le seul début si la fin est
  // illisible — mieux vaut une information partielle qu'aucune.
  const quand = plage(entree.startsAt, entree.endsAt) ?? heure(entree.startsAt);

  return (
    <Link
      href={`/agenda/${entree.id}`}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "var(--s-2)",
        minHeight: "var(--target-comfort)",
        minWidth: "var(--size-0)",
        padding: "var(--s-2) var(--s-2) var(--s-2) var(--s-3)",
        borderRadius: "var(--r-sm)",
        borderLeft: `var(--kind-accent-width) solid ${jetons.accent}`,
        background: jetons.fond,
        color: "var(--ink-900)",
        textDecoration: "none",
        overflowWrap: "anywhere",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: "var(--size-0)",
          width: "var(--s-6)",
          height: "var(--s-6)",
          borderRadius: "var(--r-full)",
          background: "var(--card)",
          color: jetons.accent,
          fontSize: "var(--text-label-size)",
          fontWeight: "var(--weight-semibold)",
        }}
      >
        {monogramme(nom)}
      </span>

      <span style={{ display: "flex", flexDirection: "column", gap: "var(--s-1)", minWidth: "var(--size-0)" }}>
        <span
          style={{
            fontSize: "var(--text-label-size)",
            lineHeight: "var(--text-label-leading)",
            fontFamily: "var(--font-num)",
            fontVariantNumeric: "tabular-nums",
            color: "var(--ink-500)",
          }}
        >
          {quand ?? fr.etats.texteAbsent}
        </span>
        <span
          style={{
            fontSize: "var(--text-body-size)",
            lineHeight: "var(--text-body-leading)",
            fontWeight: "var(--weight-semibold)",
            color: nom === null ? "var(--ink-300)" : "var(--ink-900)",
          }}
        >
          {nom ?? fr.agenda.patientNonRattache}
        </span>
        <span
          style={{
            fontSize: "var(--text-label-size)",
            lineHeight: "var(--text-label-leading)",
            color: "var(--ink-500)",
          }}
        >
          {libelleType(entree.kind)}
        </span>

        {/* La praticienne n'apparaît que si la base l'a rendue. Sur l'agenda du
            cabinet, deux séances au même créneau appartiennent souvent à deux
            praticiennes : sans cette ligne, la pile se lit comme un conflit
            d'horaire alors qu'il n'y en a aucun. La cloison ADR-003 fait que ce
            champ est déjà NULL quand il ne doit pas se voir — rien n'est décidé
            ici (I4/§6). */}
        {entree.practitionerName === null ? null : (
          <span
            style={{
              fontSize: "var(--text-label-size)",
              lineHeight: "var(--text-label-leading)",
              color: "var(--ink-300)",
            }}
          >
            {entree.practitionerName}
          </span>
        )}

        {/* LE STATUT NE S'AFFICHE QUE QUAND IL SORT DE L'ORDINAIRE.
            `confirmed` est le cas normal d'un agenda : l'écrire sur chaque carte
            ajouterait une ligne de bruit à toutes, et noierait précisément celles
            qui demandent une réaction. Un patient arrivé, en séance ou non
            présenté, lui, doit se voir depuis l'autre bout de la pièce.

            Le statut est écrit en TOUTES LETTRES, jamais porté par la seule
            couleur de la carte — celle-ci code déjà la famille de consultation,
            et un même signal ne peut pas dire deux choses (§4 règle 4). */}
        {entree.status === "confirmed" ? null : (
          <span
            style={{
              fontSize: "var(--text-label-size)",
              lineHeight: "var(--text-label-leading)",
              letterSpacing: "var(--text-label-tracking)",
              fontWeight: "var(--weight-medium)",
              // `--attention` pour ce qui réclame un geste, jamais `--critical` :
              // le rouge est un budget réservé au disque critique et à la perte
              // de données (§4 règle 1). Un patient non présenté n'en fait pas
              // partie, même si la journée est mal partie.
              color:
                entree.status === "no_show" || entree.status === "requested"
                  ? "var(--attention)"
                  : "var(--ink-700)",
            }}
          >
            {fr.agenda.statuts[entree.status]}
          </span>
        )}
      </span>
    </Link>
  );
}

function Legende(): React.JSX.Element {
  const familles: readonly FamilleConsultation[] = [
    "suivi",
    "premiere",
    "psychotherapie",
    "entretien",
    "administratif",
  ];

  return (
    <ul
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: "var(--s-5)",
        margin: "var(--size-0)",
        padding: "var(--size-0)",
        listStyle: "none",
      }}
    >
      {familles.map((f) => (
        <li key={f} style={{ display: "inline-flex", alignItems: "center", gap: "var(--s-2)" }}>
          <span
            aria-hidden="true"
            style={{
              width: "var(--s-2)",
              height: "var(--s-2)",
              borderRadius: "var(--r-full)",
              background: JETONS_FAMILLE[f].accent,
            }}
          />
          <span
            style={{
              fontSize: "var(--text-label-size)",
              lineHeight: "var(--text-label-leading)",
              color: "var(--ink-700)",
            }}
          >
            {fr.agenda.familles[f]}
          </span>
        </li>
      ))}
    </ul>
  );
}
