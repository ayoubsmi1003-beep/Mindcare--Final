/**
 * L'en-tête du dossier — qui est cette personne, en une bande.
 *
 * ⚠️ NI `EnTeteEcran`, NI DÉGRADÉ, NI VERRE, NI LUEUR DERRIÈRE UN NOM DE
 * PATIENT. ADR-022 réserve `--grad-brand` au mobilier de l'application ; le
 * design system interdit le verre et la lueur sur une surface qui porte une
 * donnée (§4 règle 2), parce que tous deux modulent le contraste du texte
 * posé dessus. Un nom de patient est une donnée, pas une bannière. La carte
 * est donc opaque, sur `--card`, avec un filet.
 *
 * ⚠️ COMPACT PAR CONTRAT. Le héros décoratif qui occupe le tiers supérieur d'un
 * écran est le réflexe le plus courant sur une page « profil ». Ici, ce qui est
 * en dessous — la clinique, la chronologie — est ce pour quoi la praticienne a
 * ouvert le dossier. L'en-tête établit l'identité et s'efface.
 *
 * ═══ PAS DE BOUTON « DÉMARRER CONSULTATION », ET C'EST DÉLIBÉRÉ ═══════════
 *
 * Une consultation se démarre depuis un RENDEZ-VOUS (`start_consultation`,
 * 026), et l'index unique `one_open_consult` n'en tolère qu'une ouverte par
 * praticienne. Un bouton ici mènerait, une fois sur deux, à un refus de la
 * base — une affordance qui ment. Le geste reste sur l'agenda, où il aboutit.
 */

import Link from "next/link";

import { Avatar, Badge, LienBouton } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { PatientWorkspace } from "@/services/patients";

import { etatCivil, heure, jourEtHeure, jourLong } from "./format";

export function EnTetePatient({
  espace,
  onModifier,
}: {
  readonly espace: PatientWorkspace;
  readonly onModifier: () => void;
}): React.JSX.Element {
  const { identite, contact, agenda, clinique } = espace;

  const civil = etatCivil(identite.age, identite.sex, identite.birthDate);
  const prochain = jourEtHeure(agenda.prochainRendezVous?.startsAt ?? null);
  const derniere = jourLong(
    clinique?.derniereConsultation?.startedAt ?? null,
  );
  const actualise = heure(espace.genereA);

  return (
    <header className="rounded-lg border border-rule bg-card px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar prenom={identite.firstName} nom={identite.lastName} taille="grande" />

          <div className="flex min-w-0 flex-col gap-1">
            {/* Le nom DOMINE : c'est la seule chose qu'on cherche des yeux en
                revenant sur l'écran. `break-words` parce qu'un nom composé
                algérien dépasse volontiers la colonne. */}
            <h1 className="min-w-0 break-words font-ui text-display font-semibold leading-display tracking-display text-ink-900">
              {identite.lastName} {identite.firstName}
            </h1>

            {civil === null ? null : (
              <p className="font-ui text-body text-ink-700">{civil}</p>
            )}

            <p className="font-ui text-body text-ink-500">
              <span className="tabular-nums">{identite.recordNumber}</span>
              {" · "}
              {/* `tel:` — sur le poste du cabinet le lien ne fait rien, mais
                  il rend le numéro sélectionnable d'un geste et lisible par un
                  lecteur d'écran comme un téléphone. */}
              <a
                href={`tel:${contact.phone}`}
                className="tabular-nums text-brand-600 underline-offset-2 hover:underline"
              >
                {contact.phone}
              </a>
            </p>

            {/* Statut porté par un TEXTE, jamais par la couleur seule. Ton
                `attention` et non `critical` : un dossier inactif n'est pas une
                perte de données (§4 règle 1). */}
            {identite.isActive ? null : (
              <span className="mt-1">
                <Badge ton="attention">{fr.patients.dossierInactif}</Badge>
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <LienBouton href="/agenda/nouveau" rang="secondaire">
            {fr.patients.actions.nouveauRendezVous}
          </LienBouton>
          <button
            type="button"
            onClick={onModifier}
            className="inline-flex min-h-target-lg items-center rounded-md border border-rule bg-card px-4 font-ui text-body text-ink-700 transition-colors duration-quick ease-out hover:bg-sunken"
          >
            {fr.patients.actions.modifier}
          </button>
        </div>
      </div>

      {/* La ligne de contexte : ce qu'on veut savoir avant de faire entrer
          quelqu'un. Elle n'apparaît que si elle a quelque chose à dire. */}
      {prochain === null && derniere === null ? null : (
        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1 border-t border-rule pt-4">
          {prochain === null ? null : (
            <p className="font-ui text-body text-ink-700">
              <span className="text-ink-500">{fr.patients.sections.prochainRendezVous} : </span>
              {prochain}
            </p>
          )}
          {derniere === null ? null : (
            <p className="font-ui text-body text-ink-700">
              <span className="text-ink-500">{fr.patients.sections.derniereConsultation} : </span>
              {derniere}
            </p>
          )}
        </div>
      )}

      {/* La fraîcheur, UNE SEULE FOIS sur l'écran. Un espace de travail
          agrège sept sources : savoir de quand date l'ensemble vaut mieux que
          sept horodatages qui obligeraient à comparer. */}
      {actualise === null ? null : (
        <p className="mt-3 font-ui text-label tracking-label text-ink-500">
          {fr.patients.actualiseA} {actualise}
        </p>
      )}
    </header>
  );
}

/**
 * Le lien de retour. Extrait ici pour que l'écran n'ait pas à le recomposer et
 * que sa cible tactile soit garantie.
 */
export function RetourListe(): React.JSX.Element {
  return (
    <Link
      href="/patients"
      className="inline-flex min-h-target items-center font-ui text-body text-brand-600 underline-offset-2 hover:underline"
    >
      {fr.patients.retourALaListe}
    </Link>
  );
}
