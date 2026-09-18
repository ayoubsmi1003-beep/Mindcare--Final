"use client";

/**
 * LE BANDEAU D'ACCUEIL — V8 « Aurora ».
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CE N'EST PAS LE RETOUR DE LA BANNIÈRE HÉROS DE V6
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * V7 avait supprimé `EnTeteEcran` pour une raison juste : le même bloc de
 * 120 px en dégradé ouvrait TOUS les écrans à l'identique, et le travail réel
 * commençait sous la ligne de flottaison. C'était la cause première du « c'est
 * la même interface avec d'autres couleurs ».
 *
 * Ce bandeau-ci existe sur UN SEUL écran, et il porte de l'INFORMATION, pas
 * une identité de page :
 *   · la salutation et la date — le seul écran du produit qui s'adresse à
 *     quelqu'un plutôt que d'afficher une donnée ;
 *   · l'état de la séance en cours, avec le chrono qui court ;
 *   · les deux gestes du matin — reprendre, ou ouvrir l'agenda.
 *
 * L'identité de l'écran reste dans la barre supérieure de la coquille. Un
 * autre écran qui reprendrait ce bandeau reproduirait le défaut de V6 ; la
 * garantie tient au fait qu'il vit dans `components/tableauDeBord/`, pas dans
 * `components/ui/`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * §4.2 — CE QUI PEUT ET NE PEUT PAS ÊTRE ÉCRIT DESSUS
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Le dégradé porte une salutation, une date, un décompte et un chrono. Aucune
 * donnée clinique nominative. LE NOM DU PATIENT DE LA SÉANCE EN COURS N'EST
 * PAS ICI — il est dans la carte « Séance en cours », sur une surface opaque.
 * Le bandeau dit qu'une séance est ouverte et depuis combien de temps ; c'est
 * un état de l'agenda, pas une information sur une personne.
 */

import { LienBouton } from "@/components/ui";
import { fr } from "@/i18n/fr";
import type { SeanceOuverte } from "@/services/dashboard";

import { dateLongueCabinet } from "./heures";

/**
 * Le chrono d'une séance ouverte, en `HH:MM`.
 *
 * ⚠️ IL EST CALCULÉ À PARTIR DE `maintenant`, PROP REÇUE, ET NON DE
 * `new Date()`. L'écran fait avancer une seule horloge, par un tick de 30 s,
 * et la passe à ses enfants. Lire l'heure ici créerait une seconde source de
 * temps : deux chronos du même écran finiraient par afficher deux durées, et
 * le désaccord serait irréparable puisque les deux seraient « justes ».
 */
function dureeDepuis(debutIso: string, maintenant: Date): string {
  const debut = new Date(debutIso).getTime();
  if (Number.isNaN(debut)) return fr.etats.texteAbsent;
  const minutes = Math.max(0, Math.floor((maintenant.getTime() - debut) / 60_000));
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function BandeauAccueil({
  maintenant,
  seanceOuverte,
  nombreSeances,
  nombreTerminees,
}: {
  readonly maintenant: Date;
  readonly seanceOuverte: SeanceOuverte | null;
  readonly nombreSeances: number;
  readonly nombreTerminees: number;
}): React.JSX.Element {
  const t = fr.tableauDeBord;

  return (
    /* ⚠️ RETOUR UTILISATEUR : LE BANDEAU PRENAIT TROP DE HAUTEUR.
         padding et titre resserrés — c'est un bandeau de CONTEXTE, pas
         l'écran lui-même. Il doit se lire en une fraction de seconde et
         laisser le maximum de hauteur au travail réel en dessous. */
      <section className="relative overflow-hidden rounded-2xl bg-vedette-vert p-3 shadow-vedette lg:p-4">
      {/* Le reflet — une source de lumière, donc une épaisseur. Décor pur,
          dans sa propre couche : il ne touche à aucune encre. */}
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-reflet" />

      <div className="relative flex flex-col gap-3 desktop:flex-row desktop:items-center desktop:justify-between">
        <div className="flex min-w-0 flex-col gap-1">
          {/* LA SALUTATION EN FRAUNCES. C'est le seul endroit du tableau de
              bord où le produit parle plutôt qu'il n'affiche, et la fonte le
              dit avant que la phrase ne soit lue. */}
          <h2 className="font-editorial text-title font-bold tracking-title text-on-brand">
            {t.salutation}
          </h2>
          <p className="font-ui text-body font-medium text-on-brand">{t.v8.accueilSousTitre}</p>

          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1.5 font-ui text-label font-medium text-on-brand">
            <span className="rounded-full bg-on-brand-surface px-2.5 py-1 shadow-filet">
              {dateLongueCabinet(maintenant)}
            </span>
            {nombreSeances === 0 ? null : (
              <>
                <span className="rounded-full bg-on-brand-surface px-2.5 py-1 shadow-filet">
                  {t.fil.seances.replace("{nombre}", String(nombreSeances))}
                </span>
                <span className="rounded-full bg-on-brand-surface px-2.5 py-1 shadow-filet">
                  {t.fil.terminees.replace("{nombre}", String(nombreTerminees))}
                </span>
              </>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-start gap-3 desktop:items-end">
          {seanceOuverte === null ? null : (
            <div className="flex items-center gap-3 rounded-2xl bg-on-brand-surface px-4 py-3 shadow-filet">
              <span
                aria-hidden="true"
                className="h-2.5 w-2.5 shrink-0 rounded-full bg-emeraude-400"
              />
              <div className="flex min-w-0 flex-col">
                <span className="font-ui text-eyebrow uppercase tracking-eyebrow text-on-brand">
                  {t.maintenant.seanceEnCours}
                </span>
                {/* LE CHRONO EN MONOSPACE À CHASSE FIXE : sans lui, les
                    chiffres changent de largeur à chaque minute et la ligne
                    entière tressaute. Une donnée affichée ne bouge jamais. */}
                <span className="font-num text-heading font-semibold tabular-nums text-on-brand">
                  {dureeDepuis(seanceOuverte.startedAt, maintenant)}
                </span>
              </div>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            {seanceOuverte === null ? null : (
              <LienBouton href={`/consultation/${seanceOuverte.id}`} rang="secondaire">
                {t.maintenant.reprendre}
              </LienBouton>
            )}
            <LienBouton href="/agenda" rang="secondaire">
              {t.ouvrirAgenda}
            </LienBouton>
          </div>
        </div>
      </div>
    </section>
  );
}
