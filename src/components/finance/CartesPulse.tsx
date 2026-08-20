/**
 * La pulsation financière — les quatre chiffres à lire en cinq secondes.
 *
 * ⚠️ « FACTURÉ » N'EST PAS « ENCAISSÉ ». C'est la correction centrale de ce lot,
 * et elle vaut d'être répétée là où le chiffre s'affiche : l'écran montrait
 * `day_revenue.total_dzd` — la somme de TOUS les tarifs du jour, reçus ou non —
 * sous le titre « Recette du jour », juste au-dessus d'« Encaissements en
 * attente ». Une recette est de l'argent reçu. Le chiffre était juste, le mot
 * était faux, et un mot faux sur une caisse se recopie dans un carnet.
 *
 * ⚠️ DEUX « ENCAISSÉ » COEXISTENT, ET LES CONFONDRE ÉTAIT UN DÉFAUT DE CETTE
 * CARTE — corrigé ici, écrit pour ne pas être refait :
 *
 *   « Encaissé » (carte 2)  fenêtre sur `collected_at` — l'argent ENTRÉ sur la
 *                           période, y compris pour des séances plus anciennes.
 *                           C'est la question de caisse, et c'est celle qu'une
 *                           praticienne pose. Il peut DÉPASSER le facturé.
 *   « dont … encaissé »     fenêtre sur `created_at` — de ce qui a été facturé
 *                           sur la période, ce qui a été reçu.
 *
 * Seul le SECOND se soustrait du facturé : `facturé = encaissé(assiette) +
 * en attente` (invariant I-1). Il est donc affiché en décomposition SUR la
 * carte « Facturé », dont il est la ventilation — et non comme une troisième
 * carte voisine. Poser les trois côte à côte donnerait trois grands chiffres
 * qui ne s'additionnent pas, sans que rien à l'écran ne dise pourquoi.
 *
 * ⚠️ AUCUN DÉGRADÉ, AUCUNE LUEUR, AUCUN VERRE DERRIÈRE UN MONTANT (ADR-022).
 * `Carte niveau="financier"` l'impose AU NIVEAU DU TYPE — `lueur` y est
 * déclarée `never`, donc une lueur posée ici ne compile pas. La règle ne
 * dépend plus de la vigilance du relecteur.
 */

import { Carte } from "@/components/ui";
import { fr } from "@/i18n/fr";
import { formaterDzd } from "@/services/finance";
import type { Pulse } from "@/services/finance-periode";

import { IndicateurVariation } from "./IndicateurVariation";

function CarteKpi({
  libelle,
  aide,
  valeur,
  detail,
  variation,
}: {
  readonly libelle: string;
  readonly aide: string;
  readonly valeur: string;
  readonly detail?: React.ReactNode;
  readonly variation?: React.ReactNode;
}): React.JSX.Element {
  return (
    <Carte niveau="financier">
      <div className="flex h-full flex-col gap-2 p-5">
        <p className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">
          {libelle}
        </p>
        {/* Le chiffre que la praticienne doit lire en une demi-seconde, avec un
            patient qui parle (test n°2, CLAUDE.md). `tabular-nums` obligatoire :
            une colonne de montants qui ne s'aligne pas se lit mal. */}
        <p className="font-num text-display tabular-nums text-ink-900">{valeur}</p>
        {detail}
        {variation}
        {/* L'explication du terme reste lisible à l'écran, pas seulement au
            survol : un mot de comptabilité qu'on ne peut pas survoler (au
            clavier, au lecteur d'écran) serait un mot non défini. */}
        <p className="mt-auto pt-2 font-ui text-label text-ink-500">{aide}</p>
      </div>
    </Carte>
  );
}

export function CartesPulse({ pulse }: { readonly pulse: Pulse }): React.JSX.Element {
  const t = fr.finances.kpi;

  return (
    <div className="grid grid-cols-1 gap-4 tablet:grid-cols-2 desktop:grid-cols-4">
      <CarteKpi
        libelle={t.facture}
        aide={t.factureAide}
        valeur={formaterDzd(pulse.factureDzd)}
        detail={
          <div className="flex flex-col gap-1">
            <p className="font-ui text-label text-ink-500">
              <span className="font-num tabular-nums">{pulse.seancesTarifees}</span>{" "}
              {t.seancesTarifees}
            </p>
            {/* ⚠️ L'INVARIANT I-1, RENDU VISIBLE LÀ OÙ IL EST VRAI.
                `facturé = encaissé(assiette) + en attente` ne vaut QUE sur
                l'assiette de la période. Il se lit donc ici, sur la carte du
                facturé dont il est la décomposition — jamais entre trois cartes
                voisines dont l'une compte sur une autre fenêtre. */}
            <p className="font-ui text-label text-ink-500">
              {t.decomposition
                .replace("{encaisse}", formaterDzd(pulse.encaisseAssietteDzd))
                .replace("{attente}", formaterDzd(pulse.attenteDzd))}
            </p>
          </div>
        }
        variation={<IndicateurVariation variation={pulse.varFacture} />}
      />

      <CarteKpi
        libelle={t.encaisse}
        aide={t.encaisseAide}
        valeur={formaterDzd(pulse.encaissePeriodeDzd)}
        variation={<IndicateurVariation variation={pulse.varEncaisse} />}
      />

      {/* AUCUNE VARIATION ICI, ET C'EST DÉLIBÉRÉ. La porte n'émet pas de
          comparaison pour les impayés, et en fabriquer une côté écran serait
          une seconde vérité. Le nombre de séances concernées dit déjà l'essentiel :
          une dette de 6 000 DZD sur une séance et sur douze ne se traite pas
          pareil. */}
      <CarteKpi
        libelle={t.attente}
        aide={t.attenteAide}
        valeur={formaterDzd(pulse.attenteDzd)}
        detail={
          <p className="font-ui text-label text-ink-500">
            <span className="font-num tabular-nums">{pulse.attenteNombre}</span>{" "}
            {pulse.attenteNombre === 1 ? fr.finances.resume.seance : fr.finances.resume.seances}
          </p>
        }
      />

      <CarteKpi
        libelle={t.taux}
        aide={t.tauxAide}
        // `null` — jamais 0 % — quand rien n'a été facturé : « 0 % » se lirait
        // « elle n'a rien encaissé » là où la vérité est « elle n'a rien
        // facturé ». Deux phrases différentes, deux états différents.
        valeur={
          pulse.tauxEncaissement === null
            ? t.absent
            : `${pulse.tauxEncaissement.toFixed(1).replace(".", ",")} %`
        }
        detail={
          pulse.revenuMoyenDzd === null ? undefined : (
            <p className="font-ui text-label text-ink-500">
              {t.revenuMoyen} :{" "}
              <span className="font-num tabular-nums">
                {formaterDzd(pulse.revenuMoyenDzd)}
              </span>
            </p>
          )
        }
        variation={<IndicateurVariation variation={pulse.varTaux} unite="pt" />}
      />
    </div>
  );
}
