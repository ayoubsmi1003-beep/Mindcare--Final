/**
 * `/parametres/cabinet` — le compte de l'accueil et les postes autorisés.
 *
 * ═══ POURQUOI CET ÉCRAN EXISTE ══════════════════════════════════════════════
 *
 * Sur une installation `self-hosted`, `083_purge_fixtures_015()` supprime le
 * compte d'appairage de démonstration, et `084_provision_owner_account()` ne
 * crée que le propriétaire. Sans cet écran, le second poste n'avait AUCUN
 * compte pour se connecter — la fonctionnalité « deux PC » était inutilisable
 * en cabinet réel.
 *
 * ═══ CE QUE L'ÉCRAN NE DÉCIDE PAS ═══════════════════════════════════════════
 *
 * Le rôle est vérifié par le rendu (composition), par la porte SQL
 * `app.autoriser_gestion_postes()` (décision), par la route (transport) et par
 * le proxy (machine hôte uniquement). Aucune de ces barrières n'est présentée
 * comme suffisante : elles sont indépendantes.
 *
 * ═══ AUCUN SECRET AFFICHÉ DURABLEMENT ═══════════════════════════════════════
 *
 * Le mot de passe saisi n'est jamais relu ni conservé : la porte ne rend que
 * l'identifiant et l'état. Le code d'invitation est éphémère (5 minutes) et
 * disparaît de l'écran dès qu'on le ferme.
 */

"use client";

import { useCallback, useEffect, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import {
  BlocErreur,
  Bouton,
  ChampTexte,
  LienBouton,
  PanneauInfo,
  Section,
  Squelette,
} from "@/components/ui";
import { fr } from "@/i18n/fr";
import {
  etatCompteAccueil,
  gererCompteAccueil,
  type CompteAccueil,
} from "@/services/cabinet-collaboration";
import {
  demanderInvitationAppairage,
  lirePostesAppaires,
  revoquerPosteAppaire,
  type InvitationCabinet,
  type PosteAppaire,
} from "@/services/cabinet-postes";

function formaterDate(iso: string | null): string {
  if (iso === null) return fr.collaboration.compte.jamais;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return fr.collaboration.compte.jamais;
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(t));
}

function grouperCode(code: string): string {
  const morceaux = code.match(/.{1,4}/g);
  return morceaux === null ? code : morceaux.join(" ");
}

export default function PageCabinet(): React.JSX.Element {
  const { utilisateur, sessionTranchee, horsLigne, deconnecter, reessayer } = useSessionEcran();

  const [compte, setCompte] = useState<CompteAccueil | null | undefined>(undefined);
  const [nomComplet, setNomComplet] = useState("");
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [actif, setActif] = useState(true);
  const [enregistrement, setEnregistrement] = useState(false);
  const [messageCompte, setMessageCompte] = useState<string | null>(null);
  const [erreurCompte, setErreurCompte] = useState<string | null>(null);

  const [postes, setPostes] = useState<readonly PosteAppaire[] | null | undefined>(undefined);
  const [invitation, setInvitation] = useState<InvitationCabinet | null>(null);
  const [invitationEnCours, setInvitationEnCours] = useState(false);
  const [revoquerCible, setRevoquerCible] = useState<string | null>(null);
  const [messagePostes, setMessagePostes] = useState<string | null>(null);

  const proprietaire = utilisateur?.role === "owner";

  const chargerCompte = useCallback(async (): Promise<void> => {
    const resultat = await etatCompteAccueil();
    if (!resultat.ok) {
      setCompte(null);
      setErreurCompte(resultat.error.message);
      return;
    }
    setCompte(resultat.data);
    if (resultat.data !== null) {
      setNomComplet(resultat.data.nomComplet);
      setIdentifiant(resultat.data.identifiant);
      setActif(resultat.data.actif);
    }
  }, []);

  const chargerPostes = useCallback(async (): Promise<void> => {
    const resultat = await lirePostesAppaires();
    setPostes(resultat.ok ? resultat.data : null);
  }, []);

  useEffect(() => {
    if (!proprietaire) return;
    void chargerCompte();
    void chargerPostes();
  }, [proprietaire, chargerCompte, chargerPostes]);

  async function enregistrer(): Promise<void> {
    if (enregistrement) return;
    setEnregistrement(true);
    setErreurCompte(null);
    setMessageCompte(null);

    const resultat = await gererCompteAccueil({
      nomComplet: nomComplet.trim(),
      identifiant: identifiant.trim(),
      ...(motDePasse.trim() === "" ? {} : { motDePasse }),
      actif,
    });

    setEnregistrement(false);

    if (!resultat.ok || resultat.data === null) {
      setErreurCompte(resultat.ok ? fr.erreurs["regle-metier"] : resultat.error.message);
      return;
    }

    setCompte(resultat.data);
    setMotDePasse("");
    setMessageCompte(actif ? fr.collaboration.compte.enregistre : fr.collaboration.compte.desactive);
  }

  async function genererInvitation(): Promise<void> {
    if (invitationEnCours) return;
    setInvitationEnCours(true);
    setMessagePostes(null);
    const resultat = await demanderInvitationAppairage();
    setInvitationEnCours(false);
    if (!resultat.ok) {
      setMessagePostes(fr.collaboration.compte.indisponible);
      return;
    }
    setInvitation(resultat.data);
  }

  async function confirmerRevocation(): Promise<void> {
    if (revoquerCible === null) return;
    const resultat = await revoquerPosteAppaire(revoquerCible);
    setRevoquerCible(null);
    setMessagePostes(resultat.ok && resultat.data ? fr.collaboration.compte.reveque : fr.collaboration.compte.indisponible);
    await chargerPostes();
  }

  if (sessionTranchee === false) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <BlocErreur
          message={horsLigne ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]}
          action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>}
        />
      </main>
    );
  }

  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <Squelette lignes={2} />
        <Squelette lignes={6} />
      </main>
    );
  }

  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <BlocErreur
          message={horsLigne ? fr.erreurs["hors-ligne"] : fr.tableauDeBord.profilIllisible}
          action={<Bouton onClick={reessayer}>{fr.actions.reessayer}</Bouton>}
        />
      </main>
    );
  }

  if (utilisateur.role !== "owner") {
    return (
      <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter} titre={fr.collaboration.compte.titre}>
        <PanneauInfo ton="attention">{fr.erreurs.interdit}</PanneauInfo>
      </AppShell>
    );
  }

  const premierCompte = compte === null || compte === undefined;

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      titre={fr.collaboration.compte.titre}
      sousTitre={fr.collaboration.compte.sousTitre}
    >
      <div className="flex flex-col gap-6">
        {horsLigne ? (
          <p role="status" className="m-0 rounded-xl border border-attention bg-attention-bg px-4 py-3 font-ui text-body text-attention-ink">
            {fr.erreurs["hors-ligne"]}
          </p>
        ) : null}

        <Section titre={fr.collaboration.compte.accueilTitre}>
          <div className="flex flex-col gap-4">
            <p className="m-0 font-ui text-body text-ink-700">{fr.collaboration.compte.accueilAide}</p>

            {compte === undefined ? (
              <Squelette lignes={3} />
            ) : (
              <>
                {compte === null ? (
                  <p className="m-0 font-ui text-body text-ink-500">{fr.collaboration.compte.aucun}</p>
                ) : (
                  <p className="m-0 font-ui text-body text-ink-700">
                    <span className="font-medium text-ink-900">{compte.identifiant}</span>
                    <span className="ml-2 text-ink-500">
                      {compte.actif ? fr.collaboration.compte.actif : fr.collaboration.compte.desactive}
                    </span>
                  </p>
                )}

                <ChampTexte
                  libelle={fr.collaboration.compte.nomComplet}
                  valeur={nomComplet}
                  onChange={setNomComplet}
                  disabled={enregistrement}
                />
                <ChampTexte
                  libelle={fr.collaboration.compte.identifiant}
                  valeur={identifiant}
                  onChange={setIdentifiant}
                  disabled={enregistrement}
                  indication="3 à 32 caractères : lettres minuscules, chiffres, point, tiret ou souligné."
                />
                <ChampTexte
                  libelle={fr.collaboration.compte.motDePasse}
                  valeur={motDePasse}
                  onChange={setMotDePasse}
                  type="password"
                  disabled={enregistrement}
                  indication={fr.collaboration.compte.motDePasseAide}
                />

                <label className="flex items-center gap-2 font-ui text-body text-ink-700">
                  <input
                    type="checkbox"
                    checked={actif}
                    onChange={(e) => setActif(e.target.checked)}
                    disabled={enregistrement}
                    className="h-4 w-4 accent-action-600"
                  />
                  {fr.collaboration.compte.actif}
                </label>

                <div>
                  <Bouton rang="principal" onClick={() => void enregistrer()} chargement={enregistrement} disabled={enregistrement}>
                    {premierCompte ? fr.collaboration.compte.creer : fr.collaboration.compte.enregistrer}
                  </Bouton>
                </div>

                {messageCompte !== null ? (
                  <PanneauInfo ton="positif">{messageCompte}</PanneauInfo>
                ) : null}
                {erreurCompte !== null ? (
                  <BlocErreur message={erreurCompte} />
                ) : null}
              </>
            )}
          </div>
        </Section>

        <Section titre={fr.collaboration.compte.postesTitre}>
          <div className="flex flex-col gap-4">
            <p className="m-0 font-ui text-body text-ink-700">{fr.collaboration.compte.postesAide}</p>

            {postes === undefined ? (
              <Squelette lignes={3} />
            ) : postes === null ? (
              <PanneauInfo ton="attention">{fr.collaboration.compte.indisponible}</PanneauInfo>
            ) : postes.length === 0 ? (
              <p className="m-0 font-ui text-body text-ink-500">{fr.collaboration.compte.aucunPoste}</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {postes.map((poste) => (
                  <li
                    key={poste.deviceId}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-rule bg-card px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="m-0 font-ui text-body font-medium text-ink-900">
                        {poste.label}
                        {poste.current ? (
                          <span className="ml-2 rounded-full bg-action-100 px-2 py-0.5 font-ui text-label font-semibold text-action-900">
                            Ce poste
                          </span>
                        ) : null}
                      </p>
                      <p className="m-0 font-ui text-label text-ink-500">
                        {fr.collaboration.compte.derniereConnexion} : {formaterDate(poste.lastSeenAt)}
                      </p>
                    </div>

                    {poste.revokedAt !== null ? (
                      <span className="font-ui text-label font-medium text-attention-ink">Révoqué</span>
                    ) : revoquerCible === poste.deviceId ? (
                      <span className="flex items-center gap-2">
                        <Bouton rang="secondaire" taille="compact" onClick={() => setRevoquerCible(null)}>
                          {fr.actions.annuler}
                        </Bouton>
                        <Bouton rang="principal" taille="compact" retrait onClick={() => void confirmerRevocation()}>
                          {fr.collaboration.compte.revoquer}
                        </Bouton>
                      </span>
                    ) : (
                      <Bouton
                        rang="secondaire"
                        taille="compact"
                        retrait
                        onClick={() => setRevoquerCible(poste.deviceId)}
                      >
                        {fr.collaboration.compte.revoquer}
                      </Bouton>
                    )}
                  </li>
                ))}
              </ul>
            )}

            <div>
              <Bouton rang="secondaire" onClick={() => void genererInvitation()} chargement={invitationEnCours} disabled={invitationEnCours}>
                {fr.collaboration.compte.inviter}
              </Bouton>
            </div>

            {invitation !== null ? (
              <div className="flex flex-col gap-2 rounded-xl border border-action-600 bg-action-50 px-4 py-3">
                <p className="m-0 font-ui text-body font-semibold text-ink-900">
                  {fr.collaboration.compte.invitationTitre}
                </p>
                <p className="m-0 font-num text-title font-bold tracking-title tabular-nums text-action-900">
                  {grouperCode(invitation.code)}
                </p>
                <p className="m-0 font-ui text-label text-ink-700">{fr.collaboration.compte.invitationAide}</p>
                <div>
                  <Bouton rang="discret" taille="compact" onClick={() => setInvitation(null)}>
                    {fr.collaboration.messagerie.fermer}
                  </Bouton>
                </div>
              </div>
            ) : null}

            {messagePostes !== null ? (
              <p role="status" className="m-0 font-ui text-label text-ink-700">
                {messagePostes}
              </p>
            ) : null}
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
