/**
 * Tableau de bord — DEUX écrans sous une seule route, un par rôle.
 *
 * ⚠️ COMPOSITION PAR RÔLE (I12), jamais des champs masqués. Chaque rôle reçoit
 * un écran dont la DONNÉE a été demandée pour lui :
 *   · assistante  → `CockpitReception`, sur `app.reception_board` (046), un
 *     contrat de lecture qui ne PORTE aucun champ clinique ni aucun agrégat de
 *     recette — rien n'est caché, rien n'est absent du réseau par filtrage ;
 *   · praticienne → `TableauDeBordPraticienne` (V4), sur `app.dashboard_today`
 *     (059), dont la caisse est cloisonnée en base (ADR-005, D-14).
 *
 * Deux portes distinctes, deux écrans distincts : c'est la RLS qui décide, pas
 * un `if` de ce fichier. Le rôle ne sert ici qu'à choisir une COMPOSITION.
 *
 * La racine `/` n'est PAS touchée : elle redirige vers /patients comme avant
 * (règle 10 — le moindre geste hors périmètre coûte plus cher qu'il ne rend).
 *
 * LES CINQ ÉTATS (05-UX §1) sont portés par chaque écran, zone par zone ; le
 * garde de session ci-dessous suit le patron exact de `/agenda`.
 */

"use client";

/**
 * ⚠️ IMPORTS STATIQUES, ET C'EST UNE MESURE QUI L'A DÉCIDÉ — PAS UN RÉFLEXE.
 *
 * Les deux écrans étant exclusifs par rôle, `next/dynamic` semblait évident :
 * il fait tomber la route de 13,2 kB à 1,94 kB, et le premier chargement de
 * 240 kB à 221 kB. Relevé au navigateur le 2026-08-25, `next start`, 1440×900,
 * médiane de trois passages :
 *
 *            premier contenu   écran complet   route
 *   dynamic      1067 ms          1105 ms      1,94 kB / 221 kB
 *   statique      489 ms           518 ms      13,2 kB / 240 kB
 *
 * Le découpage PLUS QUE DOUBLE la latence. La cause : le rôle n'est connu
 * qu'après `useSessionEcran`, donc le morceau ne peut être demandé qu'APRÈS
 * l'hydratation — un aller-retour de plus, en série, sur l'écran dont le budget
 * est le plus serré (PERF : 100 ms de premier contenu). Dix-neuf kilo-octets
 * économisés contre six cents millisecondes perdues : le marché est mauvais.
 *
 * Le jour où le rôle sera résolu côté serveur, le découpage redeviendra
 * gratuit et cette décision sera à reprendre — avec une nouvelle mesure, pas
 * avec un raisonnement.
 */
import { CockpitReception } from "@/components/reception/CockpitReception";
import { TableauDeBordPraticienne } from "@/components/tableauDeBord/TableauDeBordPraticienne";

import {
  BandeauHorsLigne,
  BlocErreur,
  LienBouton,
  Squelette,
} from "@/components/ui";
import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import { fr } from "@/i18n/fr";

export default function PageTableauDeBord(): React.JSX.Element {
  const { utilisateur, sessionTranchee, horsLigne: horsLigneSession, deconnecter } =
    useSessionEcran();

  // Session tranchée NÉGATIVEMENT : sortie explicite, pas un vide muet.
  if (sessionTranchee === false) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur
          message={
            horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]
          }
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  if (utilisateur === undefined) {
    // Le squelette a la FORME de ce qui arrive (05-UX §2) : en-tête + corps.
    return (
      <main className="flex flex-col gap-8 p-8">
        <Squelette lignes={1} />
        <Squelette lignes={8} />
      </main>
    );
  }

  // Profil ILLISIBLE mais session valide : le défaut sûr d'/agenda — on
  // affiche avec la composition la plus étroite plutôt que de bloquer un
  // écran qui marche. La RLS reste la seule frontière sur la donnée.
  const role = utilisateur?.role ?? "assistant";

  // Praticiennes : V4 est livrée. L'écran du matin, en UN appel serveur
  // (`app.dashboard_today`, 059) — le placeholder honnête qui tenait ici depuis
  // le lot cockpit a enfin son écran.
  if (role !== "assistant") {
    return (
      <AppShell
        role={role}
        nomComplet={utilisateur?.fullName ?? ""}
        onDeconnexion={deconnecter}
        titre={fr.tableauDeBord.salutation}
        sousTitre={fr.tableauDeBord.sousTitre}
        actions={
          <LienBouton href="/agenda" rang="secondaire">
            {fr.tableauDeBord.ouvrirAgenda}
          </LienBouton>
        }
      >
        <TableauDeBordPraticienne horsLigneSession={horsLigneSession} />
      </AppShell>
    );
  }

  return (
    <AppShell
      role={role}
      nomComplet={utilisateur?.fullName ?? ""}
      onDeconnexion={deconnecter}
      sansGouttiere
    >
      {/* Le cockpit se dimensionne lui-même : hauteur pleine du main, défilement
          interne par zone, zéro défilement de page à 1440×900. */}
      <div className="flex h-full min-h-0 flex-col">
        <CockpitReception horsLigneSession={horsLigneSession} />
      </div>
    </AppShell>
  );
}
