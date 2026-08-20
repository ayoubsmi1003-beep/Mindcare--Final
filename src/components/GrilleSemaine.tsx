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
import { Badge } from "@/components/ui";
import type { TonBadge } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { AgendaEntry, AppointmentStatus, ConsultationKind } from "@/services/appointments";

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
    <div className="flex flex-col gap-4">
      {/* La grille est posée dans une carte : elle EST la surface principale de
          l'écran, et un tableau nu au milieu d'une page flotte sans se poser.
          Le tableau scrolle dans SON conteneur — la page, elle, ne défile
          jamais horizontalement (règle 9). */}
      <div className="overflow-x-auto rounded-lg border border-rule bg-card shadow-lift1">
        <table
          className="w-full table-fixed border-collapse"
          // La largeur plancher dépend du NOMBRE de colonnes, qui est une
          // donnée d'affichage (7 en semaine, 1 en jour) et non une valeur de
          // design : elle se calcule donc ici, à partir de deux jetons. En
          // dessous, le conteneur défile au lieu d'écraser les colonnes.
          style={{
            minWidth: `calc(var(--s-16) + ${colonnesJours.length} * var(--grid-day-min))`,
          }}
        >
          <colgroup>
            <col className="w-16" />
            {colonnesJours.map((_, i) => (
              <col key={i} />
            ))}
          </colgroup>

          <thead>
            <tr>
              {/* L'angle mort en haut à gauche reste vide et discret : il ne
                  porte rien, il ne doit donc rien attirer. */}
              <th scope="col" className="border-b border-rule bg-sunken" />
              {colonnesJours.map((jourColonne, i) => {
                const nbSeances = lignesHeures.reduce((total, h) => {
                  const c = parCase.get(`${i}-${h}`);
                  return total + (c?.length ?? 0);
                }, 0);
                const estAujourdhui = memeJour(jourColonne, new Date());
                return (
                  <th
                    key={i}
                    scope="col"
                    className={[
                      "min-w-0 border-b border-l border-rule px-3 py-3 text-left align-top",
                      // AUJOURD'HUI SE DISTINGUE PAR LE FOND, PAS PAR UNE
                      // COULEUR D'ACCENT. La colonne du jour est celle qu'on
                      // cherche en premier vingt fois par jour ; la teinter en
                      // teal la ferait concurrencer les cartes, qui codent déjà
                      // la famille de consultation.
                      estAujourdhui ? "bg-brand-50" : "bg-sunken",
                    ].join(" ")}
                  >
                    <div className="flex flex-col gap-1">
                      <span
                        className={[
                          "font-ui text-label font-semibold tracking-label break-words",
                          estAujourdhui ? "text-brand-700" : "text-ink-900",
                        ].join(" ")}
                      >
                        {FORMAT_JOUR_ABREGE.format(jourColonne)}{" "}
                        {FORMAT_JOUR_NUMERO.format(jourColonne)}
                      </span>
                      <span
                        className={[
                          "font-ui text-label font-regular tabular-nums",
                          // Un jour chargé se lit d'un coup d'œil ; un jour vide
                          // s'efface au lieu de répéter « 0 séances » en noir.
                          nbSeances === 0 ? "text-ink-500" : "text-ink-700",
                        ].join(" ")}
                      >
                        {nbSeances}{" "}
                        {nbSeances > 1 ? fr.agenda.semaine.seances : fr.agenda.semaine.seance}
                      </span>
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
                  className={[
                    "min-w-0 border-t border-rule bg-sunken px-3 py-2 text-left align-top",
                    // L'heure est en chasse fixe et tabulaire : la colonne des
                    // heures doit s'aligner au pixel sur toute la hauteur,
                    // sinon l'œil ne peut pas la suivre verticalement.
                    "font-num text-num font-medium tabular-nums text-ink-500",
                  ].join(" ")}
                >
                  {String(h).padStart(2, "0")}:00
                </th>

                {colonnesJours.map((jourColonne, i) => {
                  const cle = `${i}-${h}`;
                  const casesOccupees = parCase.get(cle) ?? [];
                  const debutCreneau = creneau(jourColonne, h);
                  const estAujourdhui = memeJour(jourColonne, new Date());

                  return (
                    <td
                      key={i}
                      className={[
                        "min-w-0 border-l border-t border-rule p-1 align-top",
                        estAujourdhui ? "bg-brand-50" : "",
                      ].join(" ")}
                    >
                      {casesOccupees.length === 0 ? (
                        <CelluleLibre
                          debut={debutCreneau}
                          {...(onCreneauLibre === undefined ? {} : { onCreneauLibre })}
                        />
                      ) : (
                        <div className="flex flex-col gap-1">
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
  // UN CRÉNEAU LIBRE DOIT SE FAIRE OUBLIER. C'est la majorité des cellules
  // d'une semaine ; écrit en pleine encre, « libre » répété soixante-dix fois
  // devient le motif dominant de l'écran et noie les cinq cartes qui comptent.
  // Le mot n'apparaît donc qu'au survol quand la case est cliquable, et reste
  // en `ink-500` sinon.
  //
  // ⚠️ C'ÉTAIT `ink-300`, ET C'ÉTAIT ILLISIBLE — 2.43:1, mesuré au navigateur le
  // 2026-08-20. L'intention (« se faire oublier ») était juste ; le jeton ne
  // l'était pas. `ink-500` reste nettement plus calme que l'encre de contenu
  // tout en tenant le plancher : on s'efface DANS la plage lisible.
  const commun = [
    "flex w-full min-w-0 items-center justify-center rounded-sm",
    "min-h-target border border-dashed border-transparent",
    "font-ui text-label text-ink-500",
  ].join(" ");

  if (onCreneauLibre === undefined) {
    return <div className={commun}>{fr.agenda.semaine.libre}</div>;
  }

  return (
    <button
      type="button"
      onClick={() => onCreneauLibre(debut)}
      className={[
        commun,
        "cursor-pointer transition duration-quick ease-soft",
        "hover:border-brand-400 hover:bg-brand-50 hover:text-brand-700",
        "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
      ].join(" ")}
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
      // LA CARTE EST L'OBJET LE PLUS LU DU PRODUIT. Sa hiérarchie est donc
      // fixée par ce qu'on cherche, dans l'ordre : l'heure (« qu'est-ce qui
      // vient ? »), le nom (« qui ? »), le type (« pour quoi ? »), la
      // praticienne (« chez qui ? »). Trois niveaux d'encre suffisent à rendre
      // cet ordre lisible sans lire.
      //
      // Le liseré de famille reste à gauche : c'est le seul repère qui survit à
      // la vision périphérique quand on balaie une semaine entière.
      className={[
        "group flex min-h-target min-w-0 flex-col gap-1 rounded-sm py-2 pl-3 pr-2",
        "border-l-kind no-underline",
        // Pas de translation au survol : une carte qui se soulève déplace la
        // cible qu'on vise, et sur une grille dense on vise beaucoup.
        "transition duration-quick ease-soft hover:shadow-lift2",
        "outline-none focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
      ].join(" ")}
      style={{ borderLeftColor: jetons.accent, background: jetons.fond }}
    >
      {/* L'HEURE D'ABORD, en chasse fixe et tabulaire : empilées, deux cartes
          doivent aligner leurs chiffres pour qu'on lise la succession sans
          relire chaque ligne. */}
      <span className="font-num text-label font-medium tabular-nums text-ink-700">
        {quand ?? fr.etats.texteAbsent}
      </span>

      {/* PAS DE MONOGRAMME ICI, ET C'EST DÉLIBÉRÉ. Une colonne de semaine fait
          environ 140 px ; la pastille en consommait 32, soit près d'un quart,
          au profit d'une seule lettre déjà présente au début du nom juste à
          côté. Mesuré à l'écran : « DE TEST DEUX Patient » tombait sur trois
          lignes. Le nom est ce qu'on lit, il prend toute la largeur.
          Le monogramme garde son sens sur la fiche et les listes, où la place
          existe et où il sert de point d'ancrage vertical. */}
      <span
        className={[
          "min-w-0 font-ui text-body font-semibold break-words",
          nom === null ? "text-ink-500" : "text-ink-900",
        ].join(" ")}
      >
        {nom ?? fr.agenda.patientNonRattache}
      </span>

      <span className="font-ui text-label text-ink-500 break-words">
        {libelleType(entree.kind)}
      </span>

      {/* La praticienne n'apparaît que si la base l'a rendue. Sur l'agenda du
          cabinet, deux séances au même créneau appartiennent souvent à deux
          praticiennes : sans cette ligne, la pile se lit comme un conflit
          d'horaire alors qu'il n'y en a aucun. La cloison ADR-003 fait que ce
          champ est déjà NULL quand il ne doit pas se voir — rien n'est décidé
          ici (I4/§6). */}
      {entree.practitionerName === null ? null : (
        <span className="font-ui text-label text-ink-500 break-words">
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
        <span className="mt-1">
          <Badge ton={tonStatut(entree.status)}>{fr.agenda.statuts[entree.status]}</Badge>
        </span>
      )}
    </Link>
  );
}

/**
 * Ton d'une pastille de statut.
 *
 * `attention` pour ce qui réclame un geste, jamais `critical` : le rouge est un
 * budget réservé au disque critique et à la perte de données (§4 règle 1). Un
 * patient non présenté n'en fait pas partie, même si la journée est mal partie.
 */
export function tonStatut(statut: AppointmentStatus): TonBadge {
  switch (statut) {
    case "no_show":
    case "requested":
      return "attention";
    case "in_session":
    case "arrived":
      return "information";
    case "completed":
      return "positif";
    default:
      return "neutre";
  }
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
    // La légende est une note de bas de grille, pas un titre : encre secondaire
    // et taille de libellé. On la consulte les premiers jours, puis les couleurs
    // se retiennent d'elles-mêmes — elle ne doit pas continuer à peser ensuite.
    <ul className="m-0 flex list-none flex-wrap gap-5 p-0">
      {familles.map((f) => (
        <li key={f} className="inline-flex items-center gap-2">
          <span
            aria-hidden="true"
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: JETONS_FAMILLE[f].accent }}
          />
          <span className="font-ui text-label text-ink-500">{fr.agenda.familles[f]}</span>
        </li>
      ))}
    </ul>
  );
}
