/**
 * LA RANGÉE « MAINTENANT » — les trois cartes du haut.
 *
 * Elle répond à la première moitié du checkpoint V4 : « qui est là, qui est le
 * suivant, combien attendent ». Tout ce qui est ici se lit sans effort, à trois
 * mètres, avant le premier café.
 *
 * HIÉRARCHIE DÉLIBÉRÉMENT INÉGALE. La séance en cours est la carte HÉROS de la
 * rangée : c'est le seul bloc qui parle d'un geste déjà commencé, et il porte
 * l'accent de marque. Les deux autres sont des cartes porteuses ordinaires. Une
 * rangée de trois cartes identiques n'aurait dit à l'œil aucune priorité.
 *
 * ⚠️ AUCUNE DE CES CARTES N'INVENTE UN CHIFFRE. Pas de « taux d'occupation »,
 * pas de « 7/9 créneaux » : la base ne connaît aucune notion de capacité, et
 * une fraction plausible sur un écran médical est un mensonge (règle 8).
 */

import { Avatar, Badge, Bouton, Carte, EtatVide, LienBouton, PastilleIcone } from "@/components/ui";
import { fr } from "@/i18n/fr";

import type { CreneauDuJour, SeanceOuverte } from "@/services/dashboard";
import { dureeDepuis, heureCabinet } from "./heures";

/**
 * Un intitulé de bloc. Petit, capitalisé, encre secondaire — il nomme la carte
 * sans jamais concurrencer la valeur qu'elle porte.
 */
function Intitule({ children }: { readonly children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="font-ui text-eyebrow font-bold uppercase tracking-eyebrow text-ink-500">
      {children}
    </p>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA SÉANCE EN COURS — la carte héros de la rangée
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ LE NOM DU PATIENT N'EST PAS SUR UN DÉGRADÉ. ADR-022 interdit un fond dont
 * le contraste varie derrière la donnée la plus identifiante de l'application,
 * au même titre que derrière une dose ou un montant. La carte est donc de
 * niveau `clinique` — blanc franc — et l'accent de marque passe par un LISERÉ
 * vertical et la pastille, jamais par le fond du nom.
 */
export function CarteSeanceEnCours({
  seance,
  maintenant,
}: {
  readonly seance: SeanceOuverte | null;
  readonly maintenant: Date;
}): React.JSX.Element {
  if (seance === null) {
    return (
      <EtatVide
        icone="horloge"
        message={fr.tableauDeBord.maintenant.aucuneSeance}
        action={
          <LienBouton href="/agenda" rang="secondaire">
            {fr.tableauDeBord.maintenant.demarrerSeance}
          </LienBouton>
        }
      />
    );
  }

  return (
    <Carte niveau="clinique">
      <div className="flex h-full items-stretch">
        <span
          aria-hidden
          className="shrink-0 rounded-l-xl border-l-kind bg-grad-tile-brand"
          style={{ borderColor: "var(--brand-600)" }}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-4 p-6">
          <div className="flex items-center justify-between gap-3">
            <Intitule>{fr.tableauDeBord.maintenant.seanceEnCours}</Intitule>
            <span className="rounded-full bg-action-50 px-2.5 py-1 font-num text-label font-bold tabular-nums text-action-600">
              {fr.tableauDeBord.maintenant.depuis.replace(
                "{duree}",
                dureeDepuis(seance.startedAt, maintenant),
              )}
            </span>
          </div>

          <div className="flex min-w-0 items-center gap-4">
            <Avatar prenom={seance.firstName} nom={seance.lastName} taille="grande" />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="truncate font-ui text-title font-bold tracking-tight text-ink-900">
                {seance.firstName} {seance.lastName}
              </p>
              <p className="font-num text-label font-medium tabular-nums text-ink-500">
                {seance.recordNumber}
              </p>
            </div>
          </div>

          <LienBouton href={`/consultation/${seance.id}`} rang="principal">
            {fr.tableauDeBord.maintenant.reprendre}
          </LienBouton>
        </div>
      </div>
    </Carte>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LE PATIENT SUIVANT
 * ═══════════════════════════════════════════════════════════════════════════ */

export function CarteSuivant({
  suivant,
  onDemarrer,
  demarrageEnCours,
}: {
  readonly suivant: CreneauDuJour | null;
  readonly onDemarrer: (creneau: CreneauDuJour) => void;
  readonly demarrageEnCours: boolean;
}): React.JSX.Element {
  if (suivant === null) {
    return (
      <EtatVide icone="agenda" message={fr.tableauDeBord.maintenant.aucunSuivant} />
    );
  }

  // Le patient peut être absent de la ligne : une demande web non validée n'a
  // pas encore de dossier. On ne fabrique pas de nom — on rend ce qu'on a.
  const nomConnu = suivant.firstName !== null && suivant.lastName !== null;

  return (
    <Carte niveau="clinique">
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <Intitule>{fr.tableauDeBord.maintenant.suivant}</Intitule>
          {suivant.status === "arrived" ? (
            <Badge ton="positif">{fr.tableauDeBord.maintenant.dejaLa}</Badge>
          ) : (
            <span className="rounded-full bg-sunken px-2.5 py-1 font-num text-label font-bold tabular-nums text-ink-700">
              {fr.tableauDeBord.maintenant.aSonHeure.replace(
                "{heure}",
                heureCabinet(suivant.startsAt),
              )}
            </span>
          )}
        </div>

        <div className="flex min-w-0 items-center gap-3">
          {nomConnu ? (
            <Avatar prenom={suivant.firstName ?? ""} nom={suivant.lastName ?? ""} />
          ) : (
            <PastilleIcone nom="patients" ton="neutre" />
          )}
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="truncate font-ui text-heading font-bold tracking-tight text-ink-900">
              {nomConnu ? `${suivant.firstName} ${suivant.lastName}` : "—"}
            </p>
            {suivant.recordNumber === null ? null : (
              <p className="font-num text-label font-medium tabular-nums text-ink-500">
                {suivant.recordNumber}
              </p>
            )}
          </div>
        </div>

        <div className="mt-auto flex flex-wrap gap-2.5">
          <Bouton
            rang="principal"
            onClick={() => onDemarrer(suivant)}
            disabled={demarrageEnCours || suivant.patientId === null}
          >
            {fr.tableauDeBord.maintenant.demarrer}
          </Bouton>
          {suivant.patientId === null ? null : (
            <LienBouton href={`/patients/${suivant.patientId}`} rang="discret">
              {fr.tableauDeBord.maintenant.ouvrirDossier}
            </LienBouton>
          )}
        </div>
      </div>
    </Carte>
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * LA SALLE D'ATTENTE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Un seul chiffre, et ce qu'il compte. Pas de liste : la file nominative est le
 * travail de l'accueil (`reception_board`, 046), pas celui de l'écran du matin.
 * La praticienne a besoin de savoir COMBIEN, pas QUI — elle le verra entrer.
 */
export function CarteSalleAttente({
  nombre,
}: {
  readonly nombre: number;
}): React.JSX.Element {
  return (
    <Carte niveau={nombre > 0 ? "action" : "clinique"}>
      <div className="flex h-full flex-col gap-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <Intitule>{fr.tableauDeBord.maintenant.salleAttente}</Intitule>
          <PastilleIcone nom="patients" ton={nombre > 0 ? "action" : "neutre"} />
        </div>

        {nombre === 0 ? (
          <p className="mt-auto font-ui text-body font-regular leading-relaxed text-ink-500">
            {fr.tableauDeBord.maintenant.personneAttend}
          </p>
        ) : (
          <div className="mt-auto flex items-baseline gap-3">
            <span className="font-display text-display font-bold tabular-nums tracking-tight text-ink-900">
              {nombre}
            </span>
            <span className="font-ui text-body font-regular text-ink-500">
              {nombre === 1
                ? fr.tableauDeBord.maintenant.attendUn
                : fr.tableauDeBord.maintenant.attendPlusieurs}
            </span>
          </div>
        )}
      </div>
    </Carte>
  );
}
