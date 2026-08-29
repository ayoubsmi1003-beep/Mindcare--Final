"use client";

/**
 * Rangée 2, droite — À VOTRE ATTENTION.
 *
 * ═══ LE SEUL PANNEAU AUTORISÉ À PORTER UNE COULEUR D'ALERTE ════════════════
 *
 * `--attention` (ambre) est réservé ici. Un écran où plusieurs blocs alertent
 * n'alerte plus : la médecin apprend à ignorer la couleur. Le rouge
 * (`--critical`) reste pour les VRAIES erreurs — un chargement qui échoue —
 * jamais pour un impayé, qui est un fait de gestion, pas une panne.
 *
 * ═══ CE QUE CE PANNEAU RASSEMBLE ═══════════════════════════════════════════
 *
 * Les impayés (total + nombre + âge du plus ancien) et les trois prochaines
 * échéances de charges. Ce sont les deux seules choses de cet écran qui
 * appellent un GESTE — tout le reste est de la lecture.
 *
 * Aucun de ces nombres n'est calculé ici : `plus_ancien_impaye_jours` et
 * `jours_restants` arrivent de la base, où « aujourd'hui » se calcule en
 * Africa/Algiers. Recalculer un âge en JavaScript le ferait dépendre de
 * l'horloge du poste, qui n'est pas la référence du cabinet.
 */

import { fr } from "@/i18n/fr";
import { Icone } from "@/components/ui/Icones";
import { formaterDzd, type Echeance } from "@/services/finance-cash";

export function PanneauAttention({
  impayesTotal,
  impayesCount,
  plusAncienJours,
  echeances,
}: {
  readonly impayesTotal: number;
  readonly impayesCount: number;
  readonly plusAncienJours: number;
  readonly echeances: readonly Echeance[];
}): React.JSX.Element {
  const t = fr.finances.attention;
  const aucun = impayesCount === 0;

  function quand(jours: number): string {
    if (jours === 0) return t.aujourdhui;
    if (jours === 1) return t.demain;
    return t.dansJours.replace("{n}", String(jours));
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-3" aria-label={t.titre}>
      <h2 className="font-ui text-heading font-semibold text-ink-900">{t.titre}</h2>

      <div
        className={[
          "rounded-lg border px-3 py-3",
          aucun ? "border-rule bg-sunken" : "border-attention bg-attention-bg",
        ].join(" ")}
      >
        <p className="flex items-center gap-2 font-ui text-eyebrow font-medium uppercase text-ink-500">
          {/* La forme double la couleur (§4 règle 4) : l'icône ne dit pas
              « erreur », elle dit « cette zone réclame un regard ». Un jour
              sans impayé, elle s'efface avec le fond ambre. */}
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-6 w-6 items-center justify-center rounded-md",
              aucun ? "bg-card text-positive" : "bg-card text-attention-ink",
            ].join(" ")}
          >
            <Icone nom={aucun ? "finances" : "alerte"} taille={16} />
          </span>
          {t.impayes}
        </p>
        {aucun ? (
          <p className="mt-1 font-ui text-body text-ink-700">{t.aucunImpaye}</p>
        ) : (
          <>
            <p className="mt-1 font-display text-title font-semibold leading-tight text-attention-ink">
              {formaterDzd(impayesTotal)}
            </p>
            <p className="font-ui text-label text-ink-700">
              {impayesCount === 1
                ? t.impayeUn
                : t.impayesDetail.replace("{n}", String(impayesCount))}
              {plusAncienJours > 0
                ? ` · ${
                    plusAncienJours === 1
                      ? t.plusAncienUn
                      : t.plusAncien.replace("{n}", String(plusAncienJours))
                  }`
                : ""}
            </p>
          </>
        )}
      </div>

      <div className="min-h-0 flex-1">
        <h3 className="mb-2 font-ui text-eyebrow font-medium uppercase text-ink-500">
          {t.echeances}
        </h3>
        {echeances.length === 0 ? (
          <p className="font-ui text-label text-ink-500">{t.aucuneEcheance}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {echeances.map((e) => (
              <li
                key={`${e.intitule}-${e.date_echeance}`}
                className="flex items-baseline justify-between gap-2 border-b border-rule pb-2 last:border-0"
              >
                <span className="min-w-0 truncate font-ui text-label text-ink-700">
                  {e.intitule}
                </span>
                <span className="shrink-0 text-right">
                  <span className="font-num text-label tabular-nums text-ink-900">
                    {formaterDzd(e.montant)}
                  </span>
                  {/* Espace insécable : « 45 000 DZDdans 11 j » a été mesuré —
                      une marge inline ne sépare pas deux <span> collés. */}
                  <span className="ml-2 font-ui text-label text-ink-500">
                    {" "}
                    {quand(e.jours_restants)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
