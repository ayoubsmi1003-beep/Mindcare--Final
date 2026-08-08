/**
 * Finances — la recette du jour et les encaissements en attente.
 *
 * ⚠️ AUCUNE DÉCISION DE RÔLE DANS CE FICHIER. On ne lira jamais ici
 * `if (role === 'owner')` pour choisir quel montant montrer : la cloison ADR-005
 * est décidée par `app.day_revenue` et `app.list_day_payments` (029 §4, §5), en
 * SQL, par `app.current_role()`. Le contrôle 6 du checkpoint S5 vérifie
 * mécaniquement l'absence de ce motif dans les écrans, et le contrôle
 * équivalent de S7 le fait pour celui-ci.
 *
 * Le sous-titre de périmètre vient de la BASE (colonne `perimetre`), pas d'une
 * déduction locale. Afficher « cabinet » à qui ne voit que sa part serait un
 * chiffre juste sous un mot faux — le genre d'erreur qu'on ne remarque qu'en
 * comparant deux écrans, six mois plus tard.
 *
 * L'assistante reçoit zéro ligne des deux portes, et voit donc l'état vide. Ce
 * n'est pas un message d'interdiction : lui dire « accès refusé » lui
 * apprendrait qu'il y a un chiffre à ne pas voir.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import {
  BandeauHorsLigne,
  BarreActions,
  BlocErreur,
  Bouton,
  Carte,
  EnTetePage,
  EtatVide,
  LienBouton,
  PanneauInfo,
  Section,
  Squelette,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  formaterDzd,
  getDayRevenue,
  listDayPayments,
  recordPaymentCollected,
  type Paiement,
  type RecetteDuJour,
} from "@/services/finance";

/**
 * La journée à afficher, au format `AAAA-MM-JJ`.
 *
 * C'est un ARGUMENT DE LECTURE, pas une source de temps : il choisit la journée
 * montrée, il n'horodate RIEN (029 §2quater). Toute écriture financière —
 * `created_at`, `collected_at`, la période du compteur de reçus — est datée par
 * `now()` en base. Si l'horloge du poste dérive, cet écran affiche la mauvaise
 * journée ; il n'écrit jamais une pièce comptable fausse.
 *
 * Construit à la main plutôt que par `toISOString()`, qui bascule en UTC : à
 * Alger, un soir après 23 h, la date UTC est déjà celle du lendemain, et la
 * recette du jour s'afficherait vide alors qu'elle ne l'est pas.
 */
function jourLocal(maintenant: Date): string {
  const a = maintenant.getFullYear();
  const m = String(maintenant.getMonth() + 1).padStart(2, "0");
  const j = String(maintenant.getDate()).padStart(2, "0");
  return `${a}-${m}-${j}`;
}

export default function FinancesPage(): React.JSX.Element {
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [recette, setRecette] = useState<RecetteDuJour | null | undefined>(undefined);
  const [paiements, setPaiements] = useState<readonly Paiement[]>([]);
  const [horsLigne, setHorsLigne] = useState(false);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  const [envoi, setEnvoi] = useState<string | undefined>(undefined);

  const charger = useCallback(async () => {
    const jour = jourLocal(new Date());

    const [r, l] = await Promise.all([getDayRevenue(jour), listDayPayments(jour)]);

    if (!r.ok) {
      setHorsLigne(r.error.code === "hors-ligne");
      setMessageErreur(r.error.message);
      setRecette(null);
      return;
    }
    if (!l.ok) {
      setHorsLigne(l.error.code === "hors-ligne");
      setMessageErreur(l.error.message);
      setRecette(r.data);
      return;
    }

    setHorsLigne(false);
    setMessageErreur(undefined);
    setRecette(r.data);
    setPaiements(l.data);
  }, []);

  useEffect(() => {
    // On attend la session avant d'interroger : `list_day_payments` écrit une
    // trace `liste` en base, et journaliser une lecture pour un écran qui va
    // rediriger vers la connexion serait une trace fausse. Même raisonnement
    // qu'en tête de l'écran de séance.
    if (utilisateur === undefined) return;
    void charger();
  }, [utilisateur, charger]);

  const encaisser = useCallback(
    async (paiement: Paiement) => {
      setMessageErreur(undefined);
      setConfirmation(undefined);
      setEnvoi(paiement.id);

      const result = await recordPaymentCollected(paiement.id);
      setEnvoi(undefined);

      if (!result.ok) {
        setHorsLigne(result.error.code === "hors-ligne");
        setMessageErreur(result.error.message);
        return;
      }

      if (result.data === null) {
        // Ni succès, ni incident : la ligne n'est plus dans le périmètre. On
        // relit plutôt que d'inventer un message — l'écran doit montrer l'état
        // réel de la caisse.
        void charger();
        return;
      }

      setConfirmation(fr.finances.encaissementEnregistre);
      void charger();
    },
    [charger],
  );

  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <Squelette lignes={4} />
      </main>
    );
  }

  // « Échec de lecture de la session » n'est PAS « aucune session » : hors
  // ligne, on reste sur place et on le dit, on n'éjecte pas vers la connexion
  // (I20). Motif repris tel quel de l'écran de séance.
  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  const perimetre =
    recette?.perimetre === "cabinet"
      ? fr.finances.perimetreCabinet
      : fr.finances.perimetrePraticienne;

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
    >
      <div className="flex flex-col gap-8">
        {horsLigne || horsLigneSession ? <BandeauHorsLigne /> : null}

        <EnTetePage
          titre={fr.finances.titre}
          {...(recette === null || recette === undefined ? {} : { sousTitre: perimetre })}
        />

        {confirmation === undefined ? null : (
          <PanneauInfo ton="positif">{confirmation}</PanneauInfo>
        )}

        {messageErreur === undefined ? null : (
          <BlocErreur
            message={messageErreur}
            action={<Bouton onClick={() => void charger()}>{fr.actions.reessayer}</Bouton>}
          />
        )}

        {recette === undefined ? (
          <Squelette lignes={3} />
        ) : recette === null ? null : (
          <Carte>
            <div className="flex flex-col gap-2">
              <p className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">
                {fr.finances.recetteDuJour}
              </p>
              {/* Le chiffre que la praticienne doit lire en une demi-seconde,
                  avec un patient qui parle (le test n°2 de CLAUDE.md). */}
              <p className="font-num text-display tabular-nums text-ink-900">
                {formaterDzd(recette.totalDzd)}
              </p>
              <p className="font-ui text-label text-ink-500">
                {recette.seances} {fr.finances.seances} · {fr.finances.enAttente}{" "}
                <span className="font-num tabular-nums">
                  {recette.attenteNombre}
                </span>{" "}
                ({formaterDzd(recette.attenteDzd)})
              </p>
            </div>
          </Carte>
        )}

        <Section titre={fr.finances.paiementsDuJour}>
          {paiements.length === 0 ? (
            <EtatVide message={fr.finances.aucunPaiement} />
          ) : (
            <div className="flex flex-col gap-3">
              {paiements.map((p) => (
                <Carte key={p.id}>
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-col gap-1">
                      <p className="font-ui text-body text-ink-900">
                        {[p.patientPrenom, p.patientNom].filter(Boolean).join(" ") ||
                          fr.etats.texteAbsent}
                      </p>
                      <p className="font-ui text-label text-ink-500">
                        {fr.finances.numeroRecu} {p.receiptNumber}
                        {p.practitionerName === null ? "" : ` · ${p.practitionerName}`}
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
                            onClick={() => void encaisser(p)}
                            disabled={envoi !== undefined}
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
          )}
        </Section>
      </div>
    </AppShell>
  );
}
