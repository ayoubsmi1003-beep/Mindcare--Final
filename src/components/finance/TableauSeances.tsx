"use client";

/**
 * Onglet 3 — SÉANCES & PAIEMENTS.
 *
 * ═══ LA SEULE LISTE OÙ UN IMPAYÉ EST VISIBLE ═══════════════════════════════
 *
 * La porte `app.get_sessions_payments_list` fenêtre sur `created_at`, et non
 * sur `collected_at` comme le reste de l'écran. Ce n'est pas une incohérence :
 * un impayé n'a PAS de date d'encaissement, donc le fenêtrer sur l'encaissement
 * le ferait disparaître précisément de la liste qui existe pour le montrer.
 *
 * ═══ CETTE LISTE NOMME DES PATIENTES ═══════════════════════════════════════
 *
 * Elle est donc servie par une porte qui écrit une trace `liste` dans
 * `audit.log` AVANT de lire le moindre nom (règle 6). C'est aussi pourquoi elle
 * vit dans un ONGLET et n'est pas chargée avec la vue d'ensemble : ouvrir
 * l'écran des finances ne doit pas produire une lecture de dossiers.
 */

import { fr } from "@/i18n/fr";
import { Badge, Bouton } from "@/components/ui";
import { formaterDzd, type ListeSeances } from "@/services/finance-cash";

function libelleMode(cle: string): string {
  const table = fr.finances.modes as Record<string, string | undefined>;
  return table[cle] ?? cle;
}

function libelleType(cle: string): string {
  if (cle === "") return "—";
  const mot = cle.replace(/_/g, " ");
  return mot.charAt(0).toUpperCase() + mot.slice(1);
}

export function TableauSeances({
  liste,
  onRecu,
  onRelancer,
}: {
  readonly liste: ListeSeances;
  readonly onRecu: (id: string) => void;
  readonly onRelancer: (id: string) => void;
}): React.JSX.Element {
  const t = fr.finances.tableauSeances;

  // Le nombre et le total d'impayés arrivent de la base — aucun `.filter().length`.
  const badge =
    liste.impayes_count === 0
      ? t.aucunImpaye
      : (liste.impayes_count === 1 ? t.badgeUn : t.badge)
          .replace("{n}", String(liste.impayes_count))
          .replace("{montant}", formaterDzd(liste.impayes_total));

  return (
    <div className="flex flex-col gap-4">
      <div>
        <span
          className={[
            "rounded-full px-3 py-2 font-ui text-label",
            liste.impayes_count === 0
              ? "bg-sunken text-ink-700"
              : "bg-attention-bg text-attention-ink",
          ].join(" ")}
        >
          {badge}
        </span>
      </div>

      {liste.lignes.length === 0 ? (
        <p className="font-ui text-body text-ink-500">{t.aucune}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-card shadow-lift1">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-rule">
                {[t.date, t.patient, t.type, t.montant, t.mode, t.statut].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left font-ui text-eyebrow font-medium uppercase text-ink-500"
                  >
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">{t.action}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {liste.lignes.map((l) => (
                <tr key={l.id} className="border-b border-rule last:border-0">
                  <td className="whitespace-nowrap px-4 py-3 font-num text-label tabular-nums text-ink-700">
                    {l.date.replace("T", " · ")}
                  </td>
                  <td className="px-4 py-3 font-ui text-body text-ink-900">{l.patient}</td>
                  <td className="px-4 py-3 font-ui text-label text-ink-700">
                    {libelleType(l.type)}
                  </td>
                  <td className="px-4 py-3 font-num text-body tabular-nums text-ink-900">
                    {formaterDzd(l.montant)}
                  </td>
                  <td className="px-4 py-3 font-ui text-label text-ink-700">{libelleMode(l.mode)}</td>
                  <td className="px-4 py-3">
                    <Badge ton={l.paye ? "positif" : "attention"}>
                      {l.paye ? t.paye : t.impaye}
                    </Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    {l.paye ? (
                      <Bouton rang="discret" onClick={() => onRecu(l.id)}>
                        {t.recu}
                      </Bouton>
                    ) : (
                      <Bouton rang="secondaire" onClick={() => onRelancer(l.id)}>
                        {t.relancer}
                      </Bouton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
