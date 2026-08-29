"use client";

/**
 * Onglet 2 — CHARGES. Le tableau, et la modale de saisie.
 *
 * ═══ DEUX TOTAUX, JAMAIS ADDITIONNÉS ═══════════════════════════════════════
 *
 * ⚠️ L'en-tête montre le RYTHME MENSUEL RÉCURRENT et les DÉPENSES PONCTUELLES
 * de la période comme deux chiffres SÉPARÉS. Ce ne sont pas les mêmes unités :
 * l'un est « par mois, tant que ça dure », l'autre « une fois, ce mois-ci ».
 * Les additionner donnerait un nombre sans signification — et la médecin
 * déciderait quand même sur ce nombre, parce qu'il est gros et qu'il est là.
 *
 * ═══ DÉSACTIVER, JAMAIS SUPPRIMER ══════════════════════════════════════════
 *
 * Règle 3 : aucun DELETE sur une donnée financière. `app.delete_charge` pose
 * `actif = false`. La charge sort des totaux à venir ; l'historique qu'elle a
 * déjà produit reste lisible.
 *
 * ═══ LA FRÉQUENCE SUIT LE TYPE ═════════════════════════════════════════════
 *
 * Sur « ponctuelle », le sélecteur de fréquence est désactivé ET VIDÉ. Le
 * laisser rempli mais grisé enverrait une valeur que la contrainte
 * `charge_type_coherent` (038) rejetterait — le refus serait juste, le message
 * incompréhensible. La barrière reste en base ; l'écran s'y conforme.
 */

import { useCallback, useState } from "react";

import { fr } from "@/i18n/fr";
import { Badge, Bouton, ChampSelection, ChampTexte } from "@/components/ui";
import {
  formaterDzd,
  type LigneCharge,
  type ListeCharges,
  type SaisieCharge,
} from "@/services/finance-cash";

const CATEGORIES = ["local", "personnel", "outils", "assurance", "autre"] as const;
const FREQUENCES = ["mensuelle", "trimestrielle", "annuelle"] as const;

function libelleCategorie(cle: string): string {
  const table = fr.finances.categories as Record<string, string | undefined>;
  return table[cle] ?? cle;
}

function libelleFrequence(cle: string | null): string {
  if (cle === null) return fr.finances.tableauCharges.sansEcheance;
  const table = fr.finances.frequences as Record<string, string | undefined>;
  return table[cle] ?? cle;
}

// ---------------------------------------------------------------------------
// La modale de saisie
// ---------------------------------------------------------------------------
export function ModaleCharge({
  charge,
  onEnregistrer,
  onAnnuler,
  enCours,
  messageErreur,
}: {
  readonly charge: LigneCharge | null;
  readonly onEnregistrer: (s: SaisieCharge) => void;
  readonly onAnnuler: () => void;
  readonly enCours: boolean;
  readonly messageErreur?: string | undefined;
}): React.JSX.Element {
  const t = fr.finances.formulaireCharge;

  const [intitule, setIntitule] = useState(charge?.intitule ?? "");
  const [montant, setMontant] = useState(charge === null ? "" : String(charge.montant));
  const [type, setType] = useState<"recurrente" | "ponctuelle">(
    charge?.type === "ponctuelle" ? "ponctuelle" : "recurrente",
  );
  const [frequence, setFrequence] = useState(charge?.frequence ?? "mensuelle");
  const [categorie, setCategorie] = useState(charge?.categorie ?? "local");
  const [date, setDate] = useState(
    charge?.date_charge ?? new Date().toISOString().slice(0, 10),
  );

  const changerType = useCallback((valeur: string) => {
    const t2 = valeur === "ponctuelle" ? "ponctuelle" : "recurrente";
    setType(t2);
    // VIDÉE, pas seulement grisée — voir l'en-tête de fichier.
    if (t2 === "ponctuelle") setFrequence("");
    else setFrequence((f) => (f === "" ? "mensuelle" : f));
  }, []);

  const soumettre = useCallback(() => {
    const valeur = Number.parseInt(montant, 10);
    if (!Number.isFinite(valeur)) return;
    onEnregistrer({
      intitule,
      montantDzd: valeur,
      categorie,
      type,
      frequence: type === "recurrente" ? frequence : null,
      dateCharge: date,
    });
  }, [categorie, date, frequence, intitule, montant, onEnregistrer, type]);

  const valide = intitule.trim().length > 0 && Number.parseInt(montant, 10) > 0;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: "var(--z-panneau)", background: "var(--voile)" }}
      role="dialog"
      aria-modal="true"
      aria-label={charge === null ? t.titreCreer : t.titreModifier}
    >
      <div
        className="w-full rounded-xl bg-card p-6 shadow-lift3"
        style={{ maxWidth: "var(--width-form)" }}
      >
        <h2 className="mb-4 font-ui text-title font-semibold text-ink-900">
          {charge === null ? t.titreCreer : t.titreModifier}
        </h2>

        <div className="flex flex-col gap-4">
          <ChampTexte
            libelle={t.intitule}
            valeur={intitule}
            onChange={setIntitule}
            placeholder={t.intitulePlaceholder}
          />

          <div className="grid grid-cols-deux gap-3">
            <ChampTexte
              libelle={t.montant}
              valeur={montant}
              type="number"
              onChange={setMontant}
              indication={t.montantIndication}
            />
            <ChampSelection
              libelle={t.type}
              valeur={type}
              onChange={changerType}
              options={[
                { valeur: "recurrente", libelle: fr.finances.tableauCharges.recurrente },
                { valeur: "ponctuelle", libelle: fr.finances.tableauCharges.ponctuelle },
              ]}
            />
          </div>

          <div className="grid grid-cols-deux gap-3">
            {/* Désactivée ET VIDÉE sur « ponctuelle » — voir l'en-tête. */}
            <ChampSelection
              libelle={t.frequence}
              valeur={frequence}
              disabled={type === "ponctuelle"}
              onChange={setFrequence}
              options={
                type === "ponctuelle"
                  ? [{ valeur: "", libelle: "—" }]
                  : FREQUENCES.map((f) => ({ valeur: f, libelle: libelleFrequence(f) }))
              }
              {...(type === "ponctuelle" ? { indication: t.frequenceDesactivee } : {})}
            />
            <ChampTexte libelle={t.date} type="date" valeur={date} onChange={setDate} />
          </div>

          <fieldset>
            <legend className="mb-2 font-ui text-label font-medium text-ink-500">
              {t.categorie}
            </legend>
            <div className="flex flex-wrap gap-2">
              {CATEGORIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={categorie === c}
                  onClick={() => setCategorie(c)}
                  className={[
                    "rounded-full px-3 py-2 font-ui text-label transition-colors",
                    "duration-quick ease-out",
                    categorie === c
                      ? "bg-brand-600 text-on-brand"
                      : "bg-sunken text-ink-700 hover:bg-brand-100",
                  ].join(" ")}
                >
                  {libelleCategorie(c)}
                </button>
              ))}
            </div>
          </fieldset>

          {messageErreur === undefined ? null : (
            <p className="font-ui text-label text-critical">{messageErreur}</p>
          )}

          <div className="flex items-center justify-between gap-3">
            <Bouton rang="principal" onClick={soumettre} disabled={!valide || enCours}>
              {t.enregistrer}
            </Bouton>
            <Bouton rang="discret" onClick={onAnnuler}>
              {t.annuler}
            </Bouton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Le tableau
// ---------------------------------------------------------------------------
export function TableauCharges({
  liste,
  onAjouter,
  onModifier,
  onDesactiver,
}: {
  readonly liste: ListeCharges;
  readonly onAjouter: () => void;
  readonly onModifier: (c: LigneCharge) => void;
  readonly onDesactiver: (c: LigneCharge) => void;
}): React.JSX.Element {
  const t = fr.finances.tableauCharges;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <span className="rounded-full bg-sunken px-3 py-2 font-ui text-label text-ink-700">
            {t.totalRecurrent}{" "}
            <span className="font-num tabular-nums text-ink-900">
              {formaterDzd(liste.total_recurrent_mensuel)}
            </span>
          </span>
          <span className="rounded-full bg-sunken px-3 py-2 font-ui text-label text-ink-700">
            {t.totalPonctuel}{" "}
            <span className="font-num tabular-nums text-ink-900">
              {formaterDzd(liste.total_ponctuel_periode)}
            </span>
          </span>
        </div>
        <Bouton rang="principal" onClick={onAjouter}>
          {t.ajouter}
        </Bouton>
      </div>

      {liste.lignes.length === 0 ? (
        <p className="font-ui text-body text-ink-500">{t.aucune}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg bg-card shadow-lift1">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-rule">
                {[t.intitule, t.categorie, t.montant, t.type, t.frequence, t.echeance].map((h) => (
                  <th
                    key={h}
                    scope="col"
                    className="px-4 py-3 text-left font-ui text-label font-medium text-ink-500"
                  >
                    {h}
                  </th>
                ))}
                <th scope="col" className="px-4 py-3 text-right">
                  <span className="sr-only">{t.actions}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {liste.lignes.map((c) => (
                <tr key={c.id} className="border-b border-rule last:border-0">
                  <td className="px-4 py-3 font-ui text-body text-ink-900">{c.intitule}</td>
                  <td className="px-4 py-3">
                    <Badge ton="neutre">{libelleCategorie(c.categorie)}</Badge>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 font-num text-body tabular-nums text-ink-900">
                    {formaterDzd(c.montant)}
                  </td>
                  <td className="px-4 py-3 font-ui text-label text-ink-700">
                    {c.type === "recurrente" ? t.recurrente : t.ponctuelle}
                  </td>
                  <td className="px-4 py-3 font-ui text-label text-ink-700">
                    {libelleFrequence(c.frequence)}
                  </td>
                  <td className="px-4 py-3 font-num text-label tabular-nums text-ink-700">
                    {c.date_prochaine_echeance ?? t.sansEcheance}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <Bouton rang="discret" onClick={() => onModifier(c)}>
                      {t.modifier}
                    </Bouton>
                    <Bouton rang="discret" onClick={() => onDesactiver(c)}>
                      {t.desactiver}
                    </Bouton>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-rule bg-sunken">
                <td className="px-4 py-3 font-ui text-label font-medium text-ink-700">
                  {t.totalRecurrent}
                </td>
                <td />
                <td className="whitespace-nowrap px-4 py-3 font-num text-body font-medium tabular-nums text-ink-900">
                  {formaterDzd(liste.total_recurrent_mensuel)}
                </td>
                <td colSpan={4} />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
