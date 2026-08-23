/**
 * La frise du jour — colonnes par praticienne, cartes positionnées à la minute,
 * ligne « maintenant » recalculée par le tick parent (30 s), jamais animée :
 * elle CHANGE de position, elle ne glisse pas (§4 règle 5).
 *
 * ⚠️ CE N'EST PAS `GrilleSemaine`. Le composant partagé reste intact (risque
 * R2 du lot) ; ici la densité est celle de l'accueil : hauteur fixe par
 * minute, défilement interne, sélection au clic. Les mêmes utilitaires sont
 * consommés (`Statut`, formats d'`AgendaPieces`) pour qu'un statut ait la
 * même forme partout.
 *
 * AUCUNE DÉCISION D'AUTORISATION ICI : les lignes existent déjà selon la RLS
 * de 006. Un RDV sans nom reste affiché — le masquer cacherait une heure
 * occupée, donc fabriquerait un double booking.
 */

"use client";

import { fr } from "@/i18n/fr";

import { heure, plage, Statut } from "@/components/AgendaPieces";
import type { RdvAccueil } from "@/services/reception";

const HEURE_DEBUT = 8;
const HEURE_FIN = 19;
/** Deux pixels par minute : 30 min = 60 px, lisible sans être encombrant. */
const PX_PAR_MINUTE = 2;

function minutesDepuisOuverture(dateIso: string): number {
  const t = Date.parse(dateIso);
  if (Number.isNaN(t)) return 0;
  const d = new Date(t);
  return (d.getHours() - HEURE_DEBUT) * 60 + d.getMinutes();
}

interface FriseJourProps {
  readonly journee: readonly RdvAccueil[];
  readonly maintenant: Date;
  readonly estAujourdhui: boolean;
  readonly selectionId: string | null;
  readonly onSelectRdv: (id: string) => void;
}

export function FriseJour({
  journee,
  maintenant,
  estAujourdhui,
  selectionId,
  onSelectRdv,
}: FriseJourProps): React.JSX.Element {
  const hauteurZone = (HEURE_FIN - HEURE_DEBUT) * 60 * PX_PAR_MINUTE;

  // Colonnes : une par praticienne PRÉSENTE dans les données — on n'invente
  // ni praticienne ni horaires d'ouverture (règle 8).
  const praticiennes = new Map<string, string>();
  for (const rdv of journee) {
    if (!praticiennes.has(rdv.practitionerId)) {
      praticiennes.set(rdv.practitionerId, rdv.practitionerName ?? fr.etats.texteAbsent);
    }
  }
  const colonnes = [...praticiennes.entries()];

  const minutesMaintenant =
    (maintenant.getHours() - HEURE_DEBUT) * 60 + maintenant.getMinutes();
  const ligneVisible =
    estAujourdhui && minutesMaintenant >= 0 && minutesMaintenant <= (HEURE_FIN - HEURE_DEBUT) * 60;

  const heures = Array.from({ length: HEURE_FIN - HEURE_DEBUT }, (_, i) => HEURE_DEBUT + i);

  return (
    <div className="flex min-h-0 flex-col">
      {/* En-têtes de colonnes — le retrait suit la règle horaire (`w-12`). */}
      <div className="flex border-b border-rule pb-1 pl-12">
        {colonnes.map(([id, nom]) => (
          <div key={id} className="min-w-0 flex-1 truncate px-1 font-ui text-label font-semibold text-ink-700">
            {nom}
          </div>
        ))}
        {colonnes.length === 0 ? (
          <div className="flex-1 font-ui text-label text-ink-500">{fr.reception.frise.videJournee}</div>
        ) : null}
      </div>

      {/* Zone défilante */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: `${hauteurZone}px` }}>
          {/* Règle horaire */}
          <div className="w-12 shrink-0">
            {heures.map((h) => (
              <span
                key={h}
                className="absolute left-0 w-10 text-right font-num text-label tabular-nums text-ink-500"
                style={{ top: `${(h - HEURE_DEBUT) * 60 * PX_PAR_MINUTE - 8}px` }}
              >
                {String(h).padStart(2, "0")}:00
              </span>
            ))}
          </div>

          {/* Colonnes de RDV */}
          {colonnes.map(([id]) => (
            <div key={id} className="relative min-w-0 flex-1 border-l border-rule">
              {/* Lignes horaires discrètes */}
              {heures.map((h) => (
                <span
                  key={h}
                  aria-hidden="true"
                  className="absolute inset-x-0 border-t border-rule"
                  style={{ top: `${(h - HEURE_DEBUT) * 60 * PX_PAR_MINUTE}px` }}
                />
              ))}

              {journee
                .filter((rdv) => rdv.practitionerId === id)
                .map((rdv) => {
                  const debut = minutesDepuisOuverture(rdv.startsAt);
                  const dureeMin = Math.max(
                    15,
                    Math.round(
                      (Date.parse(rdv.endsAt) - Date.parse(rdv.startsAt)) / 60000 || 30,
                    ),
                  );
                  const selectionne = selectionId === rdv.id;
                  return (
                    <button
                      key={rdv.id}
                      type="button"
                      onClick={() => onSelectRdv(rdv.id)}
                      aria-pressed={selectionne}
                      className={[
                        "absolute left-1 right-1 overflow-hidden rounded-md border px-2 py-1 text-left",
                        "outline-none transition duration-instant ease-out",
                        "focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset",
                        selectionne
                          ? "border-brand-600 bg-brand-100 shadow-lift1"
                          : "border-rule bg-card hover:border-ink-300 hover:shadow-lift1",
                      ].join(" ")}
                      style={{
                        top: `${Math.max(0, debut) * PX_PAR_MINUTE}px`,
                        height: `${dureeMin * PX_PAR_MINUTE - 2}px`,
                      }}
                    >
                      <span className="flex items-baseline gap-2">
                        <span className="font-num text-label font-medium tabular-nums text-ink-700">
                          {plage(rdv.startsAt, rdv.endsAt) ?? heure(rdv.startsAt) ?? fr.etats.texteAbsent}
                        </span>
                        <span className="truncate font-ui text-body font-medium text-ink-900">
                          {[rdv.lastName, rdv.firstName].filter(Boolean).join(" ") ||
                            fr.agenda.patientNonRattache}
                        </span>
                      </span>
                      <span className="mt-1 flex items-center gap-2">
                        <Statut statut={rdv.status} />
                        {rdv.kind !== null ? (
                          <span className="truncate font-ui text-label text-ink-500">
                            {fr.agenda.types[rdv.kind]}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
            </div>
          ))}

          {/* Ligne « maintenant » — positionnée, jamais animée */}
          {ligneVisible ? (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute left-12 right-0 z-10 flex items-center"
              style={{ top: `${minutesMaintenant * PX_PAR_MINUTE}px` }}
            >
              <span className="h-0 flex-1 border-t-2 border-dashed border-attention" />
              <span className="rounded-sm bg-attention-bg px-1 font-ui text-label font-semibold text-attention-ink">
                {fr.reception.frise.maintenant}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
