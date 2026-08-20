/**
 * Le journal des paiements d'une période — la SEULE surface nominative.
 *
 * ⚠️ SON OUVERTURE ÉCRIT UNE TRACE DE LECTURE EN BASE, une par patient distinct
 * de la page affichée (`app.list_period_payments`, 036 §4). C'est pour cette
 * raison qu'il est REPLIÉ par défaut et qu'il n'est jamais chargé avec l'écran :
 * l'ouvrir est un geste explicite, et le geste est journalisé (ADR-019).
 * Le dire à l'écran plutôt que de le taire — la praticienne a le droit de
 * savoir ce que son application enregistre de ses propres consultations.
 *
 * ⚠️ C'EST AUSSI LE SECOND ET DERNIER APPEL RÉSEAU DE L'ÉCRAN. Il ne compte pas
 * contre le budget d'un appel (`06-PERF-BUDGET.md` §2) parce qu'il dépend d'un
 * choix de l'utilisatrice — §3 l'autorise nommément.
 *
 * ⚠️ AUCUNE DÉCISION DE RÔLE ICI. La porte a déjà filtré : une praticienne
 * reçoit ses seules lignes, l'assistante n'en reçoit aucune. Ce composant
 * affiche ce qu'il a reçu, sans jamais se demander qui regarde.
 */

"use client";

import {
  BarreActions,
  Bouton,
  Carte,
  EtatVide,
  Squelette,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import { formaterDzd, type Paiement } from "@/services/finance";

export const TAILLE_PAGE = 50;

export function JournalPaiements({
  ouvert,
  onBasculer,
  chargement,
  lignes,
  total,
  page,
  onPage,
  onEncaisser,
  envoiEnCours,
}: {
  readonly ouvert: boolean;
  readonly onBasculer: () => void;
  readonly chargement: boolean;
  readonly lignes: readonly Paiement[];
  readonly total: number;
  readonly page: number;
  readonly onPage: (p: number) => void;
  readonly onEncaisser: (p: Paiement) => void;
  readonly envoiEnCours: string | undefined;
}): React.JSX.Element {
  const t = fr.finances.journal;
  const pages = Math.max(1, Math.ceil(total / TAILLE_PAGE));

  return (
    <section className="flex flex-col gap-3" aria-label={t.titre}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-ui text-heading font-semibold text-ink-900">{t.titre}</h2>
        <Bouton onClick={onBasculer} deploye={ouvert}>
          {ouvert ? t.fermer : t.ouvrir}
        </Bouton>
      </div>

      {/* La trace est annoncée AVANT l'ouverture, pas après : une information
          qui n'arrive qu'une fois le geste fait n'est pas un avertissement. */}
      <p className="font-ui text-label text-ink-500">{t.traceAide}</p>

      {!ouvert ? null : chargement ? (
        <Squelette lignes={4} />
      ) : lignes.length === 0 ? (
        <EtatVide message={t.aucun} />
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {lignes.map((p) => (
              <Carte key={p.id} niveau="financier">
                <div className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div className="flex flex-col gap-1">
                    <p className="font-ui text-body text-ink-900">
                      {[p.patientPrenom, p.patientNom].filter(Boolean).join(" ") ||
                        fr.etats.texteAbsent}
                    </p>
                    <p className="font-ui text-label text-ink-500">
                      {fr.finances.numeroRecu} {p.receiptNumber}
                      {p.practitionerName === null ? "" : ` · ${p.practitionerName}`}
                      {" · "}
                      <span className="font-num tabular-nums">
                        {p.createdAt.slice(0, 10)}
                      </span>
                    </p>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="font-num text-num tabular-nums text-ink-900">
                      {formaterDzd(p.montantDzd)}
                    </span>
                    {p.collectedAt === null ? (
                      <BarreActions>
                        <Bouton
                          rang="principal"
                          onClick={() => onEncaisser(p)}
                          disabled={envoiEnCours !== undefined}
                        >
                          {fr.finances.encaisser}
                        </Bouton>
                      </BarreActions>
                    ) : (
                      <span className="font-ui text-label text-positive">
                        {fr.finances.encaisse}
                      </span>
                    )}
                  </div>
                </div>
              </Carte>
            ))}
          </div>

          {/* La pagination n'apparaît que s'il y a plus d'une page : deux
              boutons inertes sous une liste de trois lignes sont du mobilier. */}
          {pages > 1 ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Bouton onClick={() => onPage(page - 1)} disabled={page <= 0}>
                {t.precedente}
              </Bouton>
              <span className="font-ui text-label text-ink-500">
                {t.pageSur
                  .replace("{n}", String(page + 1))
                  .replace("{total}", String(pages))}
              </span>
              <Bouton onClick={() => onPage(page + 1)} disabled={page + 1 >= pages}>
                {t.suivante}
              </Bouton>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
