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

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import {
  BandeauHorsLigne,
  BarreActions,
  BlocErreur,
  Bouton,
  Carte,
  EnTeteEcran,
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
 * Les états de l'écran (05-UX-CONTRACT.md §1) — EXCLUSIFS, jamais superposés.
 *
 * C'est cette machine à états qui manquait avant V1.4, pas la logique de
 * chargement elle-même : l'écran gardait DEUX signaux séparés (`recette` et
 * `paiements`), et un échec sur l'un pouvait laisser l'autre affiché — une
 * erreur ET un vide en même temps, exactement le défaut que
 * `05-UX-CONTRACT.md` §1 a été écrit pour interdire.
 */
type EtatFinances = "chargement" | "hors-ligne" | "erreur" | "contenu";

/**
 * Au-delà de ce délai sans réponse, on bascule en ERREUR avec le mot
 * « délai » (05-UX-CONTRACT.md §2) — jamais un squelette qui attend
 * indéfiniment. La requête sous-jacente n'est pas annulée (les services ne le
 * permettent pas) ; `generation` ignore sa réponse si elle arrive après coup.
 */
const DELAI_CHARGEMENT_MS = 10_000;

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
  const {
    utilisateur,
    sessionTranchee,
    horsLigne: horsLigneSession,
    deconnecter,
  } = useSessionEcran();

  const [etat, setEtat] = useState<EtatFinances>("chargement");
  const [recette, setRecette] = useState<RecetteDuJour | null>(null);
  const [paiements, setPaiements] = useState<readonly Paiement[]>([]);
  const [messageErreur, setMessageErreur] = useState<string | undefined>(undefined);
  const [confirmation, setConfirmation] = useState<string | undefined>(undefined);
  const [envoi, setEnvoi] = useState<string | undefined>(undefined);

  // Compteur de génération, même motif que `generationAnalyse` en
  // consultation : un rechargement déclenché pendant qu'un précédent est en
  // vol (retour d'onglet, double clic sur Réessayer) doit voir le PLUS
  // RÉCENT gagner, jamais une réponse tardive écraser un état plus frais.
  const generation = useRef(0);

  const charger = useCallback(async () => {
    const gen = (generation.current += 1);
    const jour = jourLocal(new Date());

    // Contenu déjà affiché : rechargement SILENCIEUX (après un encaissement),
    // aucun retour au squelette. Sinon (premier chargement, ou nouvel essai
    // depuis une erreur) : l'écran redevient CHARGEMENT, un état à la fois.
    setEtat((precedent) => (precedent === "contenu" ? precedent : "chargement"));

    const minuteur = setTimeout(() => {
      if (generation.current !== gen) return;
      setEtat("erreur");
      setMessageErreur(fr.delaiDepasse);
    }, DELAI_CHARGEMENT_MS);

    const [r, l] = await Promise.all([getDayRevenue(jour), listDayPayments(jour)]);
    clearTimeout(minuteur);
    if (generation.current !== gen) return; // un appel plus récent a pris le relais

    if (!r.ok) {
      setEtat(r.error.code === "hors-ligne" ? "hors-ligne" : "erreur");
      setMessageErreur(r.error.message);
      return;
    }
    if (!l.ok) {
      setEtat(l.error.code === "hors-ligne" ? "hors-ligne" : "erreur");
      setMessageErreur(l.error.message);
      return;
    }

    setMessageErreur(undefined);
    setRecette(r.data);
    setPaiements(l.data);
    setEtat("contenu");
  }, []);

  useEffect(() => {
    // On attend la session avant d'interroger : `list_day_payments` écrit une
    // trace `liste` en base, et journaliser une lecture pour un écran qui va
    // rediriger vers la connexion serait une trace fausse. Même raisonnement
    // qu'en tête de l'écran de séance.
    //
    // V1.5 — on attend `sessionTranchee`, PAS `utilisateur` : c'est
    // `getSession()` qui tranche la session, et le profil (I12, navigation
    // seule) part désormais en parallèle de cette lecture au lieu de la
    // précéder. La trace `liste` reste conditionnée à une session existante.
    if (sessionTranchee !== true) return;
    void charger();
  }, [sessionTranchee, charger]);

  const encaisser = useCallback(
    async (paiement: Paiement) => {
      setMessageErreur(undefined);
      setConfirmation(undefined);
      setEnvoi(paiement.id);

      const result = await recordPaymentCollected(paiement.id);
      setEnvoi(undefined);

      if (!result.ok) {
        setEtat(result.error.code === "hors-ligne" ? "hors-ligne" : "erreur");
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

  // hors-ligne SESSION (useSessionEcran) et hors-ligne DONNÉES (cet écran)
  // sont deux signaux distincts qui affichent le MÊME bandeau — l'un ou
  // l'autre suffit à le déclencher, sans dupliquer l'état.
  const horsLigne = horsLigneSession || etat === "hors-ligne";

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
    >
      <div className="flex flex-col gap-8">
        {horsLigne ? <BandeauHorsLigne /> : null}

        <EnTeteEcran
          icone="finances"
          titre={fr.finances.titre}
          {...(etat === "contenu" && recette !== null ? { sousTitre: perimetre } : {})}
        />

        {confirmation === undefined ? null : (
          <PanneauInfo ton="positif">{confirmation}</PanneauInfo>
        )}

        {/* 05-UX-CONTRACT.md §1 : un SEUL état à la fois. ERREUR remplace le
            contenu — elle ne s'affiche jamais au-dessus d'un vide ou d'une
            recette obsolète. CHARGEMENT et HORS-LIGNE sont chacun rendus une
            fois, jamais empilés avec CONTENU. */}
        {etat === "chargement" ? (
          <Squelette lignes={3} />
        ) : etat === "erreur" ? (
          <BlocErreur
            message={messageErreur ?? fr.erreurs.inattendu}
            action={<Bouton onClick={() => void charger()}>{fr.actions.reessayer}</Bouton>}
          />
        ) : etat === "hors-ligne" && recette === null ? (
          // Hors ligne dès le premier chargement : rien n'a encore été lu, il
          // n'y a donc rien de « déjà chargé » à garder affiché — le bandeau
          // suffit (05-UX-CONTRACT.md §5).
          null
        ) : (
          <>
            {recette === null ? null : (
              <Carte>
                <div className="flex flex-col gap-2">
                  <p className="font-ui text-eyebrow uppercase tracking-eyebrow text-ink-500">
                    {fr.finances.recetteDuJour}
                  </p>
                  {/* Le chiffre que la praticienne doit lire en une
                      demi-seconde, avec un patient qui parle (test n°2,
                      CLAUDE.md). */}
                  <p className="font-num text-display tabular-nums text-ink-900">
                    {formaterDzd(recette.totalDzd)}
                  </p>
                  <p className="font-ui text-label text-ink-500">
                    {recette.seances} {fr.finances.seances} · {fr.finances.enAttente}{" "}
                    <span className="font-num tabular-nums">{recette.attenteNombre}</span>{" "}
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
          </>
        )}
      </div>
    </AppShell>
  );
}
