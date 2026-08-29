/**
 * LE FIL DE LA JOURNÉE — la section héros du tableau de bord.
 *
 * C'est le bloc qu'on lit le plus longtemps, donc celui qui a le droit d'être
 * dense. Une lecture verticale doit suffire à comprendre toute la journée :
 * ce qui est fait, ce qui vient, qui attend déjà, et où l'on en est.
 *
 * POURQUOI PAS UN TABLEAU. `Tableau` a été écrit puis retiré en V3 faute
 * d'appelant, et V4 aurait pu le lui donner. Il ne le fait pas : chaque ligne
 * porte une ACTION et un avatar, ce qui en fait une liste de cartes, pas une
 * grille de valeurs. Un `<table>` ici aurait la sémantique fausse — et le
 * report de la primitive reste noté dans `ui/index.ts`.
 *
 * LE RAIL. Un trait vertical continu relie les créneaux ; chaque pastille s'y
 * pose. Le curseur « maintenant » y glisse à sa vraie place, entre deux
 * créneaux, et pas en tête de liste — c'est ce qui fait qu'on voit d'un coup
 * d'œil ce qui est derrière soi.
 *
 * LA COULEUR DIT LE TYPE DE SÉANCE, LE TEXTE DIT LE STATUT. Jamais l'inverse,
 * et jamais la couleur seule (§11) : un statut porte toujours son mot.
 */

import { Fragment } from "react";

import { Avatar, Badge, Bouton, Carte, EtatVide, LienBouton } from "@/components/ui";
import { FAMILLE_PAR_TYPE } from "@/components/GrilleSemaine";
import { fr } from "@/i18n/fr";

import type { AppointmentStatus, ConsultationKind } from "@/services/appointments";
import type { CreneauDuJour } from "@/services/dashboard";
import { heureCabinet, minutesDansLaJournee } from "./heures";

/**
 * L'accent d'un créneau, dérivé du type de séance.
 *
 * On COMPOSE le nom du jeton au lieu de recopier la table de `GrilleSemaine` :
 * les familles (`suivi`, `premiere`, `psychotherapie`, `entretien`,
 * `administratif`) portent exactement les noms des jetons `--kind-*`. Une
 * seconde table serait une seconde vérité, qui divergerait au premier ajout.
 */
function accentDe(kind: ConsultationKind | null): string {
  const famille = kind === null ? "administratif" : FAMILLE_PAR_TYPE[kind];
  return `var(--kind-${famille}-accent)`;
}

/** Le ton de la pastille de statut. Aucun rouge : le rouge est un budget (§4). */
const TON_STATUT: Readonly<
  Record<AppointmentStatus, "neutre" | "attention" | "positif" | "information">
> = {
  requested: "neutre",
  confirmed: "neutre",
  arrived: "attention",
  in_session: "information",
  completed: "positif",
  no_show: "attention",
  cancelled: "neutre",
};

/** Ce qui est derrière nous se lit en retrait — la journée avance visuellement. */
function estPasse(statut: AppointmentStatus): boolean {
  return statut === "completed" || statut === "no_show";
}

function libelleStatut(statut: AppointmentStatus): string {
  const table = fr.tableauDeBord.fil.statut;
  switch (statut) {
    case "confirmed":
      return table.confirmed;
    case "arrived":
      return table.arrived;
    case "in_session":
      return table.in_session;
    case "completed":
      return table.completed;
    case "no_show":
      return table.no_show;
    default:
      // `requested` et `cancelled` ne franchissent pas la porte 059. Le défaut
      // existe pour que l'exhaustivité ne dépende pas d'un commentaire.
      return table.confirmed;
  }
}

function LigneCreneau({
  creneau,
  onDemarrer,
  demarrageEnCours,
}: {
  readonly creneau: CreneauDuJour;
  readonly onDemarrer: (creneau: CreneauDuJour) => void;
  readonly demarrageEnCours: boolean;
}): React.JSX.Element {
  const passe = estPasse(creneau.status);
  const nomConnu = creneau.firstName !== null && creneau.lastName !== null;
  const demarrable =
    (creneau.status === "confirmed" || creneau.status === "arrived") &&
    creneau.patientId !== null;

  return (
    <li className="relative flex gap-4">
      {/* La pastille sur le rail. Sa couleur dit le TYPE de séance ; le badge
          à droite dit le statut, en toutes lettres. */}
      {/* ⚠️ PAS DE `ring-2` ICI. `ringWidth` ne déclare que `DEFAULT` et `0`
          (tailwind.config.ts) : `ring-2` ne produirait AUCUNE règle CSS, en
          silence — le piège exact que `minHeight.0` documente dans ce même
          fichier. On masque donc le rail avec un halo de `--card` porté par un
          conteneur, ce qui n'utilise que des classes réellement déclarées. */}
      <span
        aria-hidden
        className="relative z-10 mt-4 inline-flex shrink-0 rounded-full bg-card p-1"
      >
        <span
          className="block h-3 w-3 rounded-full"
          style={{ backgroundColor: accentDe(creneau.kind) }}
        />
      </span>

      <div className={["min-w-0 flex-1", passe ? "opacity-disabled" : ""].join(" ")}>
        <Carte niveau={passe ? "secondaire" : "clinique"} interactive={creneau.patientId !== null}>
          <div className="flex flex-wrap items-center gap-3 p-4">
            <span className="rounded-lg bg-sunken px-2.5 py-1 font-num text-label font-bold tabular-nums text-ink-700">
              {heureCabinet(creneau.startsAt)}
            </span>

            {nomConnu ? (
              <Avatar prenom={creneau.firstName ?? ""} nom={creneau.lastName ?? ""} />
            ) : null}

            <span className="min-w-0 flex-1 truncate font-ui text-body font-semibold text-ink-900">
              {nomConnu ? `${creneau.firstName} ${creneau.lastName}` : "—"}
            </span>

            <Badge ton={TON_STATUT[creneau.status]}>{libelleStatut(creneau.status)}</Badge>

            {demarrable ? (
              <Bouton
                rang="secondaire"
                onClick={() => onDemarrer(creneau)}
                disabled={demarrageEnCours}
              >
                {fr.tableauDeBord.maintenant.demarrer}
              </Bouton>
            ) : creneau.patientId === null ? null : (
              <LienBouton href={`/patients/${creneau.patientId}`} rang="discret">
                {fr.tableauDeBord.maintenant.ouvrirDossier}
              </LienBouton>
            )}
          </div>
        </Carte>
      </div>
    </li>
  );
}

/** Le repère « maintenant », posé entre deux créneaux à sa vraie place. */
function CurseurMaintenant(): React.JSX.Element {
  return (
    <li className="relative flex items-center gap-4" aria-hidden>
      <span className="relative z-10 inline-flex shrink-0 rounded-full bg-card p-1">
        <span className="block h-3 w-3 rounded-full bg-action-600 shadow-glow-brand" />
      </span>
      <span className="font-ui text-label font-medium tracking-label text-action-700">
        {fr.tableauDeBord.fil.maintenant}
      </span>
      <span className="flex-1 border-t border-action-100" />
    </li>
  );
}

export function FilDeLaJournee({
  journee,
  maintenant,
  onDemarrer,
  demarrageEnCours,
}: {
  readonly journee: readonly CreneauDuJour[];
  readonly maintenant: Date;
  readonly onDemarrer: (creneau: CreneauDuJour) => void;
  readonly demarrageEnCours: boolean;
}): React.JSX.Element {
  if (journee.length === 0) {
    return (
      <EtatVide
        icone="agenda"
        message={fr.tableauDeBord.fil.vide}
        action={
          <LienBouton href="/agenda" rang="secondaire">
            {fr.tableauDeBord.fil.videAction}
          </LienBouton>
        }
      />
    );
  }

  const minutesMaintenant = minutesDansLaJournee(maintenant);

  // Le curseur se pose AVANT le premier créneau encore à venir. S'il n'y en a
  // plus, il n'est pas rendu : une ligne « maintenant » en fin de journée
  // n'apprend rien, elle ajoute du bruit sous le dernier patient.
  const indexCurseur = journee.findIndex(
    (c) => minutesDansLaJournee(new Date(c.startsAt)) >= minutesMaintenant,
  );

  return (
    <div className="relative">
      {/* Le rail. Décoratif, sous les pastilles, et il ne se lit pas.
          Il occupe une colonne de la LARGEUR EXACTE d'une pastille (`w-3`) et
          y centre son trait : aucun décalage en pixels à maintenir à la main le
          jour où la pastille change de taille. */}
      <span
        aria-hidden
        className="absolute bottom-2 left-0 top-2 flex w-5 justify-center"
      >
        {/* `border-l`, pas `w-px` : l'échelle `spacing` est REMPLACÉE dans
            tailwind.config.ts et ne contient pas `px`, donc `w-px` ne
            produirait rien. `borderWidth.DEFAULT` vaut 1px et existe. */}
        <span className="h-full border-l border-rule" />
      </span>
      <ul className="flex flex-col gap-3">
        {journee.map((creneau, i) => (
          <Fragment key={creneau.id}>
            {i === indexCurseur ? <CurseurMaintenant /> : null}
            <LigneCreneau
              creneau={creneau}
              onDemarrer={onDemarrer}
              demarrageEnCours={demarrageEnCours}
            />
          </Fragment>
        ))}
      </ul>
    </div>
  );
}
