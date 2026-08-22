"use client";

/**
 * /documents — ÉMETTRE, RELIRE, IMPRIMER un certificat.
 *
 * ═══ POURQUOI TOUT EST CLIENT, COMME /finances ═════════════════════════════
 *
 * Aucun Server Action, aucun composant serveur. Les quatre portes de `030`
 * écrivent une trace d'audit liée à `auth.uid()`, et un rendu serveur
 * produirait ces lectures AU CHARGEMENT DE LA ROUTE — avant tout geste de la
 * praticienne. Une trace « elle a consulté ce dossier » écrite parce qu'une URL
 * a été ouverte est une trace fausse, et c'est plus grave qu'une trace absente.
 *
 * ═══ LE BUDGET : 2 APPELS ══════════════════════════════════════════════════
 *
 * `/documents?patient=<id>` → `list_patient_documents` (1). Le sélecteur ne
 * cherche QUE sur soumission : ouvrir l'écran sans dossier ne lit rien.
 * Ouvrir un document ajoute `get_document`, mais c'est un GESTE, hors du budget
 * de chargement.
 *
 * ═══ DEUX ÉTATS D'ERREUR, PAS UN ═══════════════════════════════════════════
 *
 * ⚠️ Une émission refusée NE DOIT PAS effacer l'historique affiché. Un champ
 * mal rempli ferait alors disparaître la liste des certificats déjà émis, et
 * la praticienne croirait avoir perdu quelque chose. L'erreur d'émission vit
 * donc dans `erreurEmission`, à côté du formulaire ; celle de la liste vit dans
 * l'état du panneau.
 *
 * ═══ L'IMPRESSION ══════════════════════════════════════════════════════════
 *
 * La section « feuille de document » de `tokens.css` masque
 * `body > *:not(.doc-racine)`. Un élément imbriqué dans la
 * coquille ne serait jamais ce `.doc-racine` : la feuille est donc rendue par
 * un PORTAIL vers `document.body`, où elle devient un enfant direct. Sans lui,
 * la règle ne s'applique à rien et l'impression sort le rail de navigation.
 *
 * ⚠️ `markDocumentPrinted` APRÈS `window.print()`, jamais avant — et le
 * compteur mesure des ENVOIS, pas des feuilles : le navigateur ne dit pas si la
 * boîte de dialogue a été validée ou annulée. Les libellés le disent.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import {
  BandeauHorsLigne,
  BlocErreur,
  Bouton,
  EnTeteEcran,
  EtatVide,
  LienBouton,
  Squelette,
} from "@/components/ui";
import { PanneauEtat, type EtatDonnees } from "@/components/finance/EtatPanneau";
import {
  contientMarqueurNonResolu,
  FeuilleApercu,
  FeuilleEmise,
} from "@/components/documents/FeuilleDocument";
import { FormulaireEmission } from "@/components/documents/FormulaireEmission";
import { ListeDocuments } from "@/components/documents/ListeDocuments";
import { SelecteurPatient } from "@/components/documents/SelecteurPatient";
import { isoVersFr, payloadPour } from "@/components/documents/champs";
import { fr } from "@/i18n/fr";
import {
  getDocument,
  issueDocument,
  listPatientDocuments,
  markDocumentPrinted,
  type Document,
  type TypeDocument,
} from "@/services/documents";
import { getPatient } from "@/services/patients";

const DELAI_CHARGEMENT_MS = 10_000;
const TYPE_INITIAL: TypeDocument = "bonne_sante_mentale";

interface DossierChoisi {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly recordNumber: string;
  readonly birthDate: string | null;
}

/**
 * L'état de dérivation, pour rendre les cinq états DÉCLENCHABLES À LA DEMANDE
 * (CLAUDE.md §7.4) sans débrancher le réseau ni renommer un RPC.
 *
 * ⚠️ INERTE EN PRODUCTION. Un paramètre d'URL qui force un écran vide serait,
 * en cabinet, un moyen de faire croire à une praticienne qu'un dossier n'a
 * aucun certificat. Le garde est sur `NODE_ENV`, pas sur une convention de
 * nommage — une convention se contourne par distraction.
 */
function etatForce(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("etat");
}

function patientDepuisUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("patient");
}

/**
 * Le document à ouvrir d'emblée, quand on arrive depuis la fiche patient.
 *
 * ⚠️ LU UNE SEULE FOIS, au premier rendu. Le relire à chaque rendu rouvrirait
 * le même document — donc réécrirait une trace `fiche` dans `audit.log` — à
 * chaque changement d'état de l'écran. Une trace d'audit par frappe au clavier
 * est un journal qu'on cesse de lire.
 */
function documentDepuisUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("document");
}

export default function DocumentsPage(): React.JSX.Element {
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [dossier, setDossier] = useState<DossierChoisi | null>(null);
  const [liste, setListe] = useState<EtatDonnees<readonly Document[]>>({ statut: "vide" });

  const [ouvert, setOuvert] = useState<Document | null>(null);
  const [erreurOuverture, setErreurOuverture] = useState<string | undefined>(undefined);

  const [emission, setEmission] = useState(false);
  const [type, setType] = useState<TypeDocument>(TYPE_INITIAL);
  const [saisie, setSaisie] = useState<Readonly<Record<string, string>>>({});
  const [envoi, setEnvoi] = useState(false);
  const [erreurEmission, setErreurEmission] = useState<string | undefined>(undefined);

  const generation = useRef(0);

  // ── Chargement de la liste ────────────────────────────────────────────────
  const chargerListe = useCallback(async (patientId: string) => {
    const gen = (generation.current += 1);

    const force = etatForce();
    if (force === "chargement") {
      setListe({ statut: "chargement" });
      return;
    }
    if (force === "vide") {
      setListe({ statut: "charge", donnees: [] });
      return;
    }
    if (force === "erreur") {
      setListe({ statut: "erreur", message: fr.documents.erreurs.chargementListe });
      return;
    }

    setListe({ statut: "chargement" });

    // Au-delà de 10 s, ERREUR avec le mot « délai » (05-UX-CONTRACT §4) : un
    // squelette qui tourne indéfiniment n'apprend rien à qui le regarde.
    const minuteur = setTimeout(() => {
      if (generation.current !== gen) return;
      setListe({ statut: "erreur", message: fr.delaiDepasse });
    }, DELAI_CHARGEMENT_MS);

    const r = await listPatientDocuments(patientId);
    clearTimeout(minuteur);
    if (generation.current !== gen) return;

    if (!r.ok) {
      setListe({ statut: "erreur", message: r.error.message });
      return;
    }
    setListe({ statut: "charge", donnees: r.data });
  }, []);

  // ── Le dossier passé en paramètre d'URL ───────────────────────────────────
  //
  // ⚠️ LES DEUX APPELS PARTENT ENSEMBLE, ET C'EST MESURÉ, PAS SUPPOSÉ.
  // Une première version attendait `get_patient` avant de lancer
  // `list_patient_documents` : deux allers-retours EN SÉRIE vers Alger, soit
  // ~546 ms relevés en `next start` pour un budget de 500 (06-PERF-BUDGET:44).
  // Or la liste ne dépend pas du dossier — elle ne veut que l'identifiant, qui
  // vient de l'URL. Les enchaîner était une dépendance IMAGINAIRE, payée à
  // chaque ouverture. `get_patient` ne sert qu'à afficher le nom en en-tête.
  const listeChargeePour = useRef<string | null>(null);

  useEffect(() => {
    const id = patientDepuisUrl();
    if (id === null) return;

    listeChargeePour.current = id;
    void chargerListe(id);

    void getPatient(id).then((r) => {
      if (!r.ok || r.data === null) return;
      setDossier({
        id: r.data.id,
        firstName: r.data.firstName,
        lastName: r.data.lastName,
        recordNumber: r.data.recordNumber,
        birthDate: r.data.birthDate,
      });
    });
  }, [chargerListe]);

  // Le dossier choisi À LA MAIN dans le sélecteur : là, il n'y a pas d'URL, et
  // c'est ce changement d'état qui déclenche la lecture. Le garde empêche de
  // relire ce que l'effet ci-dessus vient déjà de charger — une seconde
  // lecture, c'est une seconde ligne d'audit pour un seul geste.
  useEffect(() => {
    if (dossier === null) return;
    if (listeChargeePour.current === dossier.id) return;
    listeChargeePour.current = dossier.id;
    void chargerListe(dossier.id);
  }, [chargerListe, dossier]);


  // ── Ouvrir un document déjà émis ──────────────────────────────────────────
  const ouvrir = useCallback(async (documentId: string) => {
    setErreurOuverture(undefined);
    const r = await getDocument(documentId);
    if (!r.ok) {
      setErreurOuverture(r.error.message);
      return;
    }
    if (r.data === null) {
      setErreurOuverture(fr.documents.erreurs.chargementDocument);
      return;
    }
    setOuvert(r.data);
    setEmission(false);
  }, []);

  // Le document nommé dans l'URL, ouvert UNE fois. `dejaOuvert` est un ref et
  // non un état : le remettre dans le cycle de rendu rouvrirait le document au
  // rendu suivant, et chaque ouverture coûte une ligne d'audit.
  const dejaOuvert = useRef(false);
  useEffect(() => {
    if (dossier === null || dejaOuvert.current) return;
    const id = documentDepuisUrl();
    if (id === null) return;
    dejaOuvert.current = true;
    void ouvrir(id);
  }, [dossier, ouvrir]);

  // ── Émettre ───────────────────────────────────────────────────────────────
  const ouvrirEmission = useCallback(() => {
    setOuvert(null);
    setErreurEmission(undefined);
    setEmission(true);
    // `date_naissance` est exigée en saisie par le contrat gelé de 030, alors
    // que la base connaît déjà la date du dossier. On la PRÉ-REMPLIT : la
    // praticienne confirme au lieu de retaper, et la valeur soumise reste
    // tracée dans `variables` comme sa confirmation explicite.
    setSaisie(
      dossier === null ? {} : { date_naissance: isoVersFr(dossier.birthDate) },
    );
  }, [dossier]);

  const changerType = useCallback(
    (t: TypeDocument) => {
      setType(t);
      setErreurEmission(undefined);
      setSaisie(dossier === null ? {} : { date_naissance: isoVersFr(dossier.birthDate) });
    },
    [dossier],
  );

  const changerSaisie = useCallback((cle: string, valeur: string) => {
    setSaisie((p) => ({ ...p, [cle]: valeur }));
  }, []);

  const emettre = useCallback(async () => {
    if (dossier === null || envoi) return;

    setEnvoi(true);
    setErreurEmission(undefined);
    // ⚠️ `payloadPour`, PAS `saisie`. Le contrat de 030 exige le jeu de clés
    // EXACT ; un champ jamais touché n'existe pas dans l'état du formulaire et
    // sa clé serait absente. Depuis 045, `traitement_2` a le droit d'être vide
    // — envoyer `saisie` ferait donc échouer le cas NOMINAL du certificat
    // médical à une seule ligne de traitement.
    const r = await issueDocument(dossier.id, type, payloadPour(type, saisie));
    setEnvoi(false);

    if (!r.ok) {
      setErreurEmission(r.error.message);
      return;
    }
    if (r.data === null) {
      // Dossier introuvable OU hors périmètre : la base ne distingue pas les
      // deux (ADR-003), l'écran non plus.
      setErreurEmission(fr.documents.erreurs.dossierIntrouvable);
      return;
    }

    setEmission(false);
    await chargerListe(dossier.id);
    await ouvrir(r.data);
  }, [chargerListe, dossier, envoi, ouvrir, saisie, type]);

  // ── Imprimer ──────────────────────────────────────────────────────────────
  //
  // ⚠️ L'INVARIANT DE SORTIE, ÉVALUÉ UNE SEULE FOIS ET PARTAGÉ PAR LES TROIS
  // CHEMINS D'IMPRESSION : la colonne de droite, le portail vers `<body>`, et
  // `window.print()` lui-même. Les trois doivent rendre le MÊME verdict — un
  // écran qui masque la feuille mais laisse le portail la poser dans `<body>`
  // imprimerait quand même la pièce trouée, sans que rien ne se voie.
  //
  // `null` (liste sans HTML) n'est pas « troué » : c'est une ligne de liste,
  // qui n'a jamais prétendu porter la pièce.
  const imprimable =
    ouvert !== null &&
    ouvert.renderedHtml !== null &&
    !contientMarqueurNonResolu(ouvert.renderedHtml);

  const imprimer = useCallback(async () => {
    if (ouvert === null) return;
    // La troisième garde. Le bouton n'est pas rendu quand la pièce est trouée,
    // mais un bouton absent n'est pas une garantie : `imprimer` reste une
    // fonction appelable, et c'est ELLE qui déclenche le tirage.
    if (ouvert.renderedHtml === null || contientMarqueurNonResolu(ouvert.renderedHtml)) return;

    // ⚠️ `window.print()` EST BLOQUANT, ET NE DIT RIEN. Le navigateur rend la
    // main quand la boîte de dialogue se ferme — sans jamais indiquer si la
    // feuille est partie ou si l'utilisatrice a annulé. Le compteur mesure
    // donc des ENVOIS à l'impression, ce que les libellés disent.
    window.print();

    const r = await markDocumentPrinted(ouvert.id);
    if (!r.ok) return;

    // `null` = document introuvable ou hors périmètre. Ni l'un ni l'autre
    // n'est une erreur à afficher ici : la feuille est déjà partie.
    const compte = r.data;
    if (compte !== null) {
      setOuvert((p) => (p === null ? p : { ...p, printedCount: compte }));
    }
    if (dossier !== null) await chargerListe(dossier.id);
  }, [chargerListe, dossier, ouvert]);

  // ── Garde de session ──────────────────────────────────────────────────────
  if (utilisateur === undefined) {
    return (
      <main className="flex flex-col gap-4 p-8">
        <Squelette lignes={4} />
      </main>
    );
  }

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

  const horsLigne = horsLigneSession || etatForce() === "horsligne";

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
    >
      <div className="flex h-full min-h-0 flex-col gap-3 overflow-hidden">
        {horsLigne ? <BandeauHorsLigne /> : null}

        <div className="flex flex-wrap items-end justify-between gap-3">
          <EnTeteEcran icone="documents" titre={fr.documents.titre} />
          {dossier === null ? null : (
            <div className="flex items-center gap-3">
              <p className="font-ui text-body text-ink-700">
                {dossier.lastName} {dossier.firstName}{" "}
                <span className="font-num text-label text-ink-500">{dossier.recordNumber}</span>
              </p>
              <Bouton
                rang="discret"
                onClick={() => {
                  setDossier(null);
                  setOuvert(null);
                  setEmission(false);
                }}
              >
                {fr.documents.selecteur.changer}
              </Bouton>
            </div>
          )}
        </div>

        {dossier === null ? (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <SelecteurPatient
              onChoisir={(p) =>
                setDossier({
                  id: p.id,
                  firstName: p.firstName,
                  lastName: p.lastName,
                  recordNumber: p.recordNumber,
                  birthDate: p.birthDate,
                })
              }
            />
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-un gap-3 overflow-hidden desktop:grid-cols-deux">
            {/* Colonne gauche : historique + émission. */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <PanneauEtat
                etat={liste}
                onReessayer={() => void chargerListe(dossier.id)}
                lignesSquelette={3}
              >
                {(docs) =>
                  docs.length === 0 ? (
                    // ⚠️ L'ACTION DISPARAÎT QUAND LE FORMULAIRE EST DÉJÀ OUVERT.
                    // Sinon l'écran affiche deux fois « Générer un certificat » :
                    // le bouton qui a servi à ouvrir, et le formulaire ouvert
                    // juste en dessous. Deux appels au même geste font douter
                    // qu'il ait été pris en compte.
                    <EtatVide
                      message={fr.documents.vide.phrase}
                      {...(emission
                        ? {}
                        : {
                            action: (
                              <Bouton rang="principal" onClick={ouvrirEmission}>
                                {fr.documents.vide.action}
                              </Bouton>
                            ),
                          })}
                    />
                  ) : (
                    <div className="flex flex-col gap-3">
                      <ListeDocuments
                        documents={docs}
                        documentOuvert={ouvert === null ? null : ouvert.id}
                        onOuvrir={(id) => void ouvrir(id)}
                      />
                      {emission ? null : (
                        <Bouton rang="principal" onClick={ouvrirEmission}>
                          {fr.documents.emission.ouvrir}
                        </Bouton>
                      )}
                    </div>
                  )
                }
              </PanneauEtat>

              {erreurOuverture === undefined ? null : (
                <BlocErreur message={erreurOuverture} />
              )}

              {emission ? (
                <FormulaireEmission
                  type={type}
                  onChangerType={changerType}
                  saisie={saisie}
                  onChangerSaisie={changerSaisie}
                  onEmettre={() => void emettre()}
                  onAnnuler={() => setEmission(false)}
                  enCours={envoi}
                  horsLigne={horsLigne}
                  {...(erreurEmission === undefined ? {} : { messageErreur: erreurEmission })}
                />
              ) : null}
            </div>

            {/* Colonne droite : la feuille. */}
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
              {emission ? (
                <>
                  <p className="font-ui text-label text-ink-500">
                    {fr.documents.emission.apercuAvertissement}
                  </p>
                  <FeuilleApercu type={type} patient={dossier} saisie={saisie} />
                </>
              ) : ouvert === null ? (
                <EtatVide message={fr.documents.vide.aucunDocumentOuvert} />
              ) : imprimable ? (
                <>
                  <div className="flex items-center justify-between gap-3">
                    <p
                      className="font-ui text-label text-ink-500"
                      title={fr.documents.impression.avertissementCompteur}
                    >
                      {fr.documents.impression.envoyees} {ouvert.printedCount}
                    </p>
                    <Bouton rang="principal" onClick={() => void imprimer()}>
                      {fr.documents.impression.imprimer}
                    </Bouton>
                  </div>
                  <FeuilleEmise html={ouvert.renderedHtml ?? ""} />
                </>
              ) : (
                /* ⚠️ NI FEUILLE, NI BOUTON « IMPRIMER » — et pas seulement un
                   avertissement au-dessus d'une feuille trouée. Laisser la
                   pièce affichée avec son bouton, si abîmée soit-elle, c'est
                   laisser un chemin d'une seule frappe vers un certificat
                   médico-légal portant « {{praticien.full_name_ar}} ». Le
                   document reste dans la liste à gauche, il n'a pas disparu du
                   dossier : il n'est pas TIRABLE. */
                <BlocErreur
                  message={fr.documents.erreurs.marqueurNonResolu}
                  action={
                    <p className="font-ui text-label text-ink-500">
                      {fr.documents.erreurs.marqueurNonResoluAide}
                    </p>
                  }
                />
              )}
            </div>
          </div>
        )}
      </div>

      {/* Le portail d'impression. Enfant DIRECT de `<body>`, seul endroit où la
          règle `body > *:not(.doc-racine)` de tokens.css puisse mordre. Il ne
          contient que le document ÉMIS : on n'imprime jamais un aperçu. */}
      <PortailImpression>
        {ouvert === null || ouvert.renderedHtml === null || !imprimable ? null : (
          <FeuilleEmise html={ouvert.renderedHtml} />
        )}
      </PortailImpression>
    </AppShell>
  );
}

/**
 * ⚠️ MONTÉ APRÈS L'HYDRATATION, DÉLIBÉRÉMENT. `document.body` n'existe pas au
 * rendu serveur ; créer le portail dès le premier rendu ferait diverger le HTML
 * serveur et client, et Next signale l'écart au lieu d'afficher l'écran.
 *
 * Le conteneur porte `impression-cachee` EN PLUS de `doc-racine` : à l'écran il
 * ne doit rien montrer (la feuille est déjà dans la colonne de droite), et à
 * l'impression c'est LUI qui reste. Les deux règles vivent dans tokens.css.
 */
function PortailImpression({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element | null {
  const [pret, setPret] = useState(false);
  useEffect(() => setPret(true), []);
  if (!pret) return null;

  return createPortal(
    <div className="doc-racine ecran-cache">{children}</div>,
    document.body,
  );
}
