/**
 * Le premier lancement — SERVEUR UNIQUEMENT.
 *
 * Symétrique de `session.ts` : deux portes pré-authentification (070/084/085),
 * appelées sous `mindcare_app` directement (`withAuthGate`), jamais sous
 * `authenticated` — personne n'est encore connecté à ce moment.
 *
 * Les DEUX exceptions que `app.provision_owner_account()` peut lever (compte
 * déjà provisionné, environnement pas encore basculé en self-hosted) ne sont
 * PAS distinguées ici, à dessein : au moment où cette fonction est appelée,
 * `etatProvisionnement()` a déjà dû confirmer les deux conditions — un échec à
 * cet instant est donc une course (double soumission, deux onglets) plutôt
 * qu'une saisie fautive, et un seul code suffit à la traiter (§4.8 du dépôt,
 * même choix que `ouvrirSession` pour ses quatre causes de refus).
 */

import { withAuthGate } from "@/server/db/withCaller";

export interface EtatInstallation {
  readonly environment: string | null;
  readonly provisionne: boolean;
}

export async function etatProvisionnement(): Promise<EtatInstallation> {
  return withAuthGate(async (q) => {
    const r = await q.query<{ environment: string | null; compte_reel_existe: boolean }>(
      "SELECT environment, compte_reel_existe FROM app.etat_provisionnement()",
    );
    const ligne = r[0];
    return {
      environment: ligne?.environment ?? null,
      provisionne: ligne?.compte_reel_existe ?? false,
    };
  });
}

export interface EntreeProvisionnement {
  readonly cabinetNom: string;
  readonly cabinetAdresse: string;
  readonly cabinetTelephone: string;
  readonly praticienNomComplet: string;
  readonly praticienTitre: string;
  readonly praticienNumeroOrdre: string;
  readonly praticienTelephone: string;
  readonly email: string;
  readonly motDePasse: string;
}

/**
 * Rend l'identifiant du compte créé, ou `null` en cas de REFUS MÉTIER —
 * exactement la distinction que `ouvrirSession` fait déjà entre un `null`
 * (refus qu'on peut traiter) et une exception (base injoignable, qu'on ne
 * peut pas). `app.provision_owner_account()` lève toujours avec le code
 * générique `P0001` (`RAISE EXCEPTION` sans `ERRCODE` explicite) : c'est ce
 * qui distingue un refus métier d'une vraie panne de connexion, dont le code
 * PostgreSQL est différent.
 */
export async function provisionnerCompteReel(
  entree: EntreeProvisionnement,
): Promise<string | null> {
  return withAuthGate(async (q) => {
    // Un `RAISE EXCEPTION` avorte la transaction PostgreSQL : sans point de
    // sauvegarde, le `COMMIT` que `withAuthGate` tente ensuite échouerait à
    // son tour (« current transaction is aborted »), et ce serait CETTE
    // erreur-là — pas le refus métier — qui remonterait à l'appelant.
    await q.query("SAVEPOINT tentative_provisionnement");
    try {
      const r = await q.query<{ provision_owner_account: string }>(
        "SELECT app.provision_owner_account($1,$2,$3,$4,$5,$6,$7,$8,$9) AS provision_owner_account",
        [
          entree.cabinetNom,
          entree.cabinetAdresse,
          entree.cabinetTelephone,
          entree.praticienNomComplet,
          entree.praticienTitre,
          entree.praticienNumeroOrdre,
          entree.praticienTelephone,
          entree.email,
          entree.motDePasse,
        ],
      );
      const id = r[0]?.provision_owner_account;
      if (id === undefined) {
        throw new Error("provision_owner_account n'a rendu aucun identifiant.");
      }
      return id;
    } catch (erreur) {
      const code = erreur instanceof Object ? (erreur as { code?: unknown }).code : undefined;
      if (code === "P0001") {
        await q.query("ROLLBACK TO SAVEPOINT tentative_provisionnement");
        return null;
      }
      throw erreur;
    }
  });
}
