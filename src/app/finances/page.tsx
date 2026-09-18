"use client";

/**
 * /finances — LE TABLEAU DE BORD FINANCIER, en comptabilité de CAISSE.
 *
 * ═══ CE QUE CET ÉCRAN DOIT RÉPONDRE, SANS DÉFILEMENT ═══════════════════════
 *
 * Combien ai-je encaissé aujourd'hui, cette semaine, ce mois ? Combien ai-je de
 * charges ? Quel est mon résultat net ? Qu'est-ce qui reste impayé ? Comment la
 * situation évolue-t-elle ? D'où vient l'argent, où part-il ? Qu'est-ce qui
 * demande un geste ?
 *
 * L'onglet « Vue d'ensemble » répond à TOUT cela SANS QU'ON OUVRE UN AUTRE
 * ONGLET. Les onglets servent la PROFONDEUR (le détail des charges, la liste
 * nominative des séances), jamais à découper l'histoire principale.
 *
 * ═══ UNE SEULE REQUÊTE PAR ONGLET ══════════════════════════════════════════
 *
 * ⚠️ La vue d'ensemble appelle `app.get_finance_overview` UNE FOIS, et rien
 * d'autre — pas « une, plus un petit appel pour les charges ». Chaque appel
 * supplémentaire est un aller-retour vers Alger sur une liaison qui n'est pas
 * toujours bonne, et deux appels peuvent rendre deux instants différents : deux
 * chiffres à l'écran qui ne se recoupent pas.
 *
 * L'onglet Charges et l'onglet Séances ont chacun LEUR porte, chargée
 * seulement quand on l'ouvre. Celui des séances NOMME des patientes et écrit
 * donc une trace d'audit : ouvrir les finances ne doit pas produire une lecture
 * de dossiers (règle 6).
 *
 * ═══ AUCUNE ARITHMÉTIQUE FINANCIÈRE ICI ════════════════════════════════════
 *
 * Pas de `.reduce`, pas de `.filter().length`, pas de `/ 100`. Chaque nombre
 * affiché est arrivé de Postgres sous cette forme. Les seuls calculs de ce lot
 * sont GÉOMÉTRIQUES (hauteur d'une barre, palier d'une cellule) et vivent dans
 * les composants de graphique, où ils ne peuvent pas s'afficher comme un
 * montant.
 *
 * ═══ LES CINQ ÉTATS, PAR PANNEAU ═══════════════════════════════════════════
 *
 * `EtatDonnees` est une union discriminée : un panneau est dans UN état, jamais
 * dans deux. L'écran précédent pouvait afficher « erreur » ET « vide »
 * simultanément — deux booléens indépendants. Ce n'est plus exprimable.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import {
  BandeauHorsLigne,
  BlocErreur,
  LienBouton,
  Squelette,
} from "@/components/ui";
import { Icone, type NomIcone } from "@/components/ui/Icones";
import { PanneauEtat, type EtatDonnees } from "@/components/finance/EtatPanneau";
import { PanneauAttention } from "@/components/finance/PanneauAttention";
import {
  CompositionV8,
  EvolutionV8,
  PoulsV8,
  SerieJournaliereV8,
} from "@/components/finance/PanneauxV8";
import { SelecteurPeriode } from "@/components/finance/SelecteurPeriode";
import { TableauSeances } from "@/components/finance/TableauSeances";
import { ModaleCharge, TableauCharges } from "@/components/finance/TableauCharges";
import { fr } from "@/i18n/fr";
import {
  aujourdHuiCabinet,
  bornesDePeriode,
  createCharge,
  deleteCharge,
  getChargesList,
  getFinanceOverview,
  getSessionsPaymentsList,
  periodeEstValide,
  updateCharge,
  type ApercuCaisse,
  type LigneCharge,
  type ListeCharges,
  type ListeSeances,
  type Periode,
  type SaisieCharge,
} from "@/services/finance-cash";

const PERIODE_INITIALE = "mois" as const;
const DELAI_CHARGEMENT_MS = 10_000;

type Onglet = "apercu" | "charges" | "seances";

/**
 * La période lue dans l'URL, pour qu'un rechargement et le bouton Précédent
 * retrouvent le même écran.
 *
 * ⚠️ `window.location`, PAS `useSearchParams`. Le hook de Next impose une
 * frontière `<Suspense>` au rendu statique, et l'oublier fait échouer le BUILD
 * avec un message qui parle de préfixation, jamais de finances.
 */
function periodeDepuisUrl(): Periode {
  const parDefaut = bornesDePeriode(PERIODE_INITIALE, aujourdHuiCabinet());
  if (typeof window === "undefined") return parDefaut;

  const p = new URLSearchParams(window.location.search);
  const du = p.get("du");
  const au = p.get("au");
  if (du === null || au === null || !periodeEstValide(du, au)) return parDefaut;
  return { nom: "personnalise", du, au };
}

export default function FinancesPage(): React.JSX.Element {
  const {
    utilisateur,
    horsLigne: horsLigneSession,
    deconnecter,
  } = useSessionEcran();

  const [periode, setPeriode] = useState<Periode>(() => periodeDepuisUrl());
  const [onglet, setOnglet] = useState<Onglet>("apercu");

  const [apercu, setApercu] = useState<EtatDonnees<ApercuCaisse>>({ statut: "chargement" });
  const [charges, setCharges] = useState<EtatDonnees<ListeCharges>>({ statut: "chargement" });
  const [seances, setSeances] = useState<EtatDonnees<ListeSeances>>({ statut: "chargement" });

  // La modale de charge : `undefined` = fermée, `null` = création,
  // un objet = modification. Trois états dans UNE variable, donc jamais
  // « ouverte en création ET en modification ».
  const [modale, setModale] = useState<LigneCharge | null | undefined>(undefined);
  const [envoi, setEnvoi] = useState(false);
  const [erreurModale, setErreurModale] = useState<string | undefined>(undefined);

  // Un rechargement déclenché pendant qu'un précédent est en vol (changement
  // rapide de période) doit voir le PLUS RÉCENT gagner.
  const generation = useRef(0);

  const chargerApercu = useCallback(async (p: Periode) => {
    const gen = (generation.current += 1);
    setApercu((prec) => (prec.statut === "charge" ? prec : { statut: "chargement" }));

    const minuteur = setTimeout(() => {
      if (generation.current !== gen) return;
      setApercu({ statut: "erreur", message: fr.delaiDepasse });
    }, DELAI_CHARGEMENT_MS);

    const r = await getFinanceOverview(p.du, p.au);
    clearTimeout(minuteur);
    if (generation.current !== gen) return;

    if (!r.ok) {
      setApercu({ statut: "erreur", message: r.error.message });
      return;
    }
    // `null` = hors périmètre. Ce n'est pas une erreur, et surtout pas un
    // « accès refusé » : le dire apprendrait qu'il y a un chiffre à ne pas voir.
    if (r.data === null) {
      setApercu({ statut: "vide" });
      return;
    }
    setApercu({ statut: "charge", donnees: r.data });
  }, []);

  const chargerCharges = useCallback(async (p: Periode) => {
    setCharges({ statut: "chargement" });
    const r = await getChargesList(p.du, p.au);
    if (!r.ok) {
      setCharges({ statut: "erreur", message: r.error.message });
      return;
    }
    if (r.data === null) {
      setCharges({ statut: "vide" });
      return;
    }
    setCharges({ statut: "charge", donnees: r.data });
  }, []);

  const chargerSeances = useCallback(async (p: Periode) => {
    setSeances({ statut: "chargement" });
    const r = await getSessionsPaymentsList(p.du, p.au);
    if (!r.ok) {
      setSeances({ statut: "erreur", message: r.error.message });
      return;
    }
    if (r.data === null) {
      setSeances({ statut: "vide" });
      return;
    }
    setSeances({ statut: "charge", donnees: r.data });
  }, []);

  useEffect(() => {
    void chargerApercu(periode);
  }, [chargerApercu, periode]);

  // Les onglets secondaires ne se chargent QU'À L'OUVERTURE.
  useEffect(() => {
    if (onglet === "charges") void chargerCharges(periode);
    if (onglet === "seances") void chargerSeances(periode);
  }, [chargerCharges, chargerSeances, onglet, periode]);

  const changerPeriode = useCallback((p: Periode) => {
    setPeriode(p);
    const url = new URL(window.location.href);
    url.searchParams.set("du", p.du);
    url.searchParams.set("au", p.au);
    window.history.replaceState(null, "", url.toString());
  }, []);

  const enregistrerCharge = useCallback(
    async (saisie: SaisieCharge) => {
      setEnvoi(true);
      setErreurModale(undefined);
      const enCours = modale;
      const r =
        enCours === null || enCours === undefined
          ? await createCharge(saisie)
          : await updateCharge(enCours.id, saisie);
      setEnvoi(false);

      if (!r.ok) {
        setErreurModale(r.error.message);
        return;
      }
      setModale(undefined);
      // Perf: les deux lectures sont indépendantes → parallèle.
      await Promise.all([chargerCharges(periode), chargerApercu(periode)]);
    },
    [chargerApercu, chargerCharges, modale, periode],
  );

  const desactiverCharge = useCallback(
    async (c: LigneCharge) => {
      if (!window.confirm(fr.finances.tableauCharges.confirmerDesactivation)) return;
      const r = await deleteCharge(c.id);
      if (!r.ok) {
        setCharges({ statut: "erreur", message: r.error.message });
        return;
      }
      await Promise.all([chargerCharges(periode), chargerApercu(periode)]);
    },
    [chargerApercu, chargerCharges, periode],
  );

  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <Squelette lignes={4} />
      </main>
    );
  }

  // « Échec de lecture de la session » n'est PAS « aucune session » : hors
  // ligne, on reste sur place et on le dit, on n'éjecte pas vers la connexion.
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

  const t = fr.finances.onglets;
  const onglets: ReadonlyArray<readonly [Onglet, string]> = [
    ["apercu", t.apercu],
    ["charges", t.charges],
    ["seances", t.seances],
  ];

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      actions={<SelecteurPeriode periode={periode} onChange={changerPeriode} compact />}
      sansGouttiere
    >
      {/* `h-full` + `overflow-hidden` : la page NE DÉFILE PAS. Ce qui ne tient
          pas se comprime (rangée 3) ou défile DANS son panneau (Anatomie). */}
      {/* La gouttiere est POSEE ICI, pas par la coquille (`sansGouttiere`) :
          cette page ne defile pas, et `h-full` additionne a un `padding`
          exterieur deborderait de la hauteur disponible d'exactement ce
          padding. La rentrer dans le conteneur qui porte `h-full` fait que
          les deux se composent au lieu de s'additionner. */}
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden px-6 py-5">
        {horsLigneSession ? <BandeauHorsLigne /> : null}

        {/* v9 — LES ONGLETS EN SEGMENTÉ. Le souligné flottant sous un trait
            plein laissait l'onglet actif à moitié posé ; ici le conteneur
            creusé porte les trois vues, et l'onglet actif est une pastille
            blanche ELEVÉE : l'état actif se lit comme un objet posé, pas
            comme une couleur. `role="tablist"` et `aria-selected` ne bougent
            pas — l'habillage change, le contrat non. */}
        <div
          role="tablist"
          aria-label={fr.finances.titre}
          className="flex w-max max-w-full gap-1 rounded-full border border-rule bg-sunken p-1"
        >
          {onglets.map(([cle, libelle]) => (
            <button
              key={cle}
              role="tab"
              type="button"
              aria-selected={onglet === cle}
              onClick={() => setOnglet(cle)}
              className={[
                "min-h-target rounded-full px-5 py-2 font-ui text-body transition duration-quick ease-soft",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2",
                "focus-visible:outline-action-600",
                onglet === cle
                  ? "bg-card font-semibold text-ink-900 shadow-lift1"
                  : "text-ink-500 hover:text-ink-700",
              ].join(" ")}
            >
              {libelle}
            </button>
          ))}
        </div>

        {onglet === "apercu" ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
            <PanneauEtat
              etat={apercu}
              onReessayer={() => void chargerApercu(periode)}
              lignesSquelette={6}
            >
              {(a) => (
                <div className="flex h-full min-h-0 flex-col gap-3">
                  <TuilesEtRangees apercu={a} />
                </div>
              )}
            </PanneauEtat>
          </div>
        ) : null}

        {onglet === "charges" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PanneauEtat etat={charges} onReessayer={() => void chargerCharges(periode)}>
              {(c) => (
                <TableauCharges
                  liste={c}
                  onAjouter={() => {
                    setErreurModale(undefined);
                    setModale(null);
                  }}
                  onModifier={(l) => {
                    setErreurModale(undefined);
                    setModale(l);
                  }}
                  onDesactiver={(l) => void desactiverCharge(l)}
                />
              )}
            </PanneauEtat>
          </div>
        ) : null}

        {onglet === "seances" ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <PanneauEtat etat={seances} onReessayer={() => void chargerSeances(periode)}>
              {(s) => (
                <TableauSeances
                  liste={s}
                  onRecu={() => undefined}
                  onRelancer={() => undefined}
                />
              )}
            </PanneauEtat>
          </div>
        ) : null}
      </div>

      {modale === undefined ? null : (
        <ModaleCharge
          charge={modale}
          enCours={envoi}
          messageErreur={erreurModale}
          onAnnuler={() => setModale(undefined)}
          onEnregistrer={(s) => void enregistrerCharge(s)}
        />
      )}
    </AppShell>
  );
}

/**
 * Les trois rangées de la vue d'ensemble.
 *
 * ⚠️ LE BUDGET VERTICAL EST LE CONTRAT. À 1440×900, l'en-tête, les onglets et
 * le sélecteur consomment ~140 px ; il reste ~760 px. Rangée 1 ~130,
 * rangée 2 ~380, rangée 3 ~150, plus les gouttières : ça tient, et ça ne tient
 * QUE parce que chaque rangée a une hauteur bornée. Un panneau qui grandit avec
 * son contenu ferait réapparaître le défilement que ce lot supprime — c'est
 * pourquoi Anatomie défile À L'INTÉRIEUR d'elle-même.
 *
 * À 1280×720, la rangée 3 passe en mode compact (`compact`) : mêmes cellules,
 * hauteur réduite, sans numéro de jour. La rangée 1 ne se replie JAMAIS.
 */
function TuilesEtRangees({ apercu }: { readonly apercu: ApercuCaisse }): React.JSX.Element {
  const t = fr.finances;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-2">
      {/* RANGÉE 1 — LE POULS. Cinq tuiles, dont une vedette. Ne se replie
          JAMAIS sous cinq colonnes au-dessus de `desktop` : c'est la ligne
          que la médecin lit en premier le matin. */}
      <div className="shrink-0">
        <PoulsV8 pulse={apercu.pulse} calendrier={apercu.calendrier} />
      </div>

      {/* RANGÉE 2 — LA SÉRIE JOURNALIÈRE, EN DOMINANTE.
          Elle remplace la bande de 31 cases du bas de l'écran V6, qui disait
          « plus » ou « moins » sans jamais dire COMBIEN. Elle passe en tête
          parce qu'elle répond à la question du mois en cours ; l'évolution
          sur six mois, elle, répond à une question de saison. */}
      <PanneauFinance
        titre={t.calendrier.titre}
        aide={t.calendrier.aide}
        icone="finances"
        ton="menthe"
      >
        <SerieJournaliereV8 jours={apercu.calendrier} />
      </PanneauFinance>

      {/* RANGÉE 3 — 40 / 32 / 28. Évolution · Composition · Attention.
          Une seule colonne sous 1280 : trois panneaux de ~300 px côte à côte
          deviennent illisibles avant de devenir petits. */}
      <div className="grid grid-cols-un gap-4 desktop:grid-cols-finance">
        <PanneauFinance
          titre={t.evolution.titre}
          aide={t.evolution.aide}
          icone="statistiques"
          ton="azur"
        >
          <EvolutionV8 serie={apercu.evolution} />
        </PanneauFinance>

        <PanneauFinance titre={t.anatomie.titre} icone="suivi" ton="lavande">
          <CompositionV8
            revenus={apercu.composition.revenus_par_type}
            charges={apercu.composition.charges_par_categorie}
            totalRevenus={apercu.pulse.revenu_periode}
            totalCharges={apercu.pulse.charges_periode}
          />
        </PanneauFinance>

        <PanneauFinance titre={t.attention.titre} icone="documents" ton="ambre">
          <PanneauAttention
            impayesTotal={apercu.attention.impayes_total}
            impayesCount={apercu.attention.impayes_count}
            plusAncienJours={apercu.attention.plus_ancien_impaye_jours}
            echeances={apercu.attention.echeances_a_venir}
          />
        </PanneauFinance>
      </div>
    </div>
  );
}

/**
 * UN PANNEAU DE FINANCES.
 *
 * Même grammaire que le panneau du tableau de bord — pastille de famille,
 * titre dans la surface, aide sur la même ligne — parce que deux écrans du
 * même produit qui encadrent leurs graphiques de deux façons différentes se
 * lisent comme deux produits.
 *
 * ⚠️ LA PASTILLE PORTE UNE FAMILLE, PAS UN STATUT. `ambre` sur « À votre
 * attention » ne dit pas « alerte » : le rouge est un budget réservé à la
 * perte de donnée (§4 règle 1), et un impayé de huit jours n'en est pas une.
 */
function PanneauFinance({
  titre,
  aide,
  icone,
  ton,
  children,
}: {
  readonly titre: string;
  readonly aide?: string;
  readonly icone: NomIcone;
  readonly ton: "menthe" | "azur" | "lavande" | "ambre";
  readonly children: React.ReactNode;
}): React.JSX.Element {
  // Écrites en toutes lettres : Tailwind balaye le source et ne résout aucune
  // interpolation. `bg-tuile-${ton}` ne serait jamais émis.
  const pastilles = {
    menthe: "bg-tuile-menthe text-emeraude-700",
    azur: "bg-tuile-azur text-azure-700",
    lavande: "bg-tuile-lavande text-violet-700",
    ambre: "bg-tuile-ambre text-ambre-700",
  } as const;

  return (
    <section className="flex min-w-0 flex-col gap-4 rounded-2xl border border-rule bg-card p-5 shadow-carte">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className={[
              "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-douce",
              pastilles[ton],
            ].join(" ")}
          >
            <Icone nom={icone} taille={20} />
          </span>
          <h2 className="min-w-0 truncate font-ui text-heading font-bold tracking-heading text-ink-900">
            {titre}
          </h2>
        </div>
        {aide === undefined ? null : (
          <p className="min-w-0 truncate font-ui text-label text-ink-500">{aide}</p>
        )}
      </div>
      {children}
    </section>
  );
}
