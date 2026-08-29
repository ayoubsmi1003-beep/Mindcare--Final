"use client";

/**
 * /documents — Poste de documents médicaux.
 *
 * ARCHITECTURE VIEW≠PRINT≠ISSUE.
 * VIEW: affiche toujours le snapshot immuable (même avec {{}}), avec bandeau ambre.
 * PRINT: bloqué si marqueur; ISSUE: bloqué AVANT next_number si en-tête incomplet.
 * Historique immuable: rendered_html figé, hash, snapshot_header.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { AppShell } from "@/components/AppShell";
import { useSessionEcran } from "@/components/useSessionEcran";
import {
  BandeauHorsLigne,
  BlocErreur,
  Bouton,
  EtatVide,
  LienBouton,
  Squelette,
} from "@/components/ui";
import { Badge } from "@/components/ui/Badge";
import { Carte } from "@/components/ui/Surfaces";
import { PanneauEtat, type EtatDonnees } from "@/components/finance/EtatPanneau";
import {
  FeuilleApercu,
  FeuilleEmise,
  contientMarqueurNonResolu,
  extractUnresolvedMarkers,
} from "@/components/documents/FeuilleDocument";
import { FormulaireEmission } from "@/components/documents/FormulaireEmission";
import { ListeDocuments } from "@/components/documents/ListeDocuments";
import { SelecteurPatient } from "@/components/documents/SelecteurPatient";
import { isoVersFr, payloadPour } from "@/components/documents/champs";
import { fr } from "@/i18n/fr";
import {
  getDocument,
  getDocumentReadiness,
  issueDocument,
  listDocuments,
  listPatientDocuments,
  markDocumentPrinted,
  voidDocument,
  type Document,
  type DocumentReadiness,
  type TypeDocument,
  type StatutDocument,
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

function etatForce(): string | null {
  if (process.env.NODE_ENV === "production") return null;
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("etat");
}
function patientDepuisUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("patient");
}
function documentDepuisUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("document");
}

export default function DocumentsPage(): React.JSX.Element {
  const { utilisateur, horsLigne: horsLigneSession, deconnecter } = useSessionEcran();

  const [dossier, setDossier] = useState<DossierChoisi | null>(null);
  const [liste, setListe] = useState<EtatDonnees<readonly Document[]>>({ statut: "vide" });
  const [listeGlobal, setListeGlobal] = useState<EtatDonnees<readonly Document[]>>({ statut: "vide" });

  const [ouvert, setOuvert] = useState<Document | null>(null);
  const [erreurOuverture, setErreurOuverture] = useState<string | undefined>(undefined);

  const [emission, setEmission] = useState(false);
  const [type, setType] = useState<TypeDocument>(TYPE_INITIAL);
  const [saisie, setSaisie] = useState<Readonly<Record<string, string>>>({});
  const [envoi, setEnvoi] = useState(false);
  const [erreurEmission, setErreurEmission] = useState<string | undefined>(undefined);
  const [succesCreation, setSuccesCreation] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [filtreType, setFiltreType] = useState<TypeDocument | "">("");
  const [filtreStatut, setFiltreStatut] = useState<StatutDocument | "">("");
  const [readiness, setReadiness] = useState<DocumentReadiness | null>(null);
  const [zoom, setZoom] = useState<90 | 100 | 110>(100);
  const [raisonAnnulation, setRaisonAnnulation] = useState("");
  const [showVoid, setShowVoid] = useState(false);

  const generation = useRef(0);

  // ---- readiness (CTA avant échec) ----
  useEffect(() => {
    void getDocumentReadiness().then((r) => {
      if (r.ok) setReadiness(r.data);
    });
  }, [ouvert, dossier]);

  // ---- listes ----
  const chargerListe = useCallback(async (patientId: string) => {
    const gen = (generation.current += 1);
    const force = etatForce();
    if (force === "chargement") { setListe({ statut: "chargement" }); return; }
    if (force === "vide") { setListe({ statut: "charge", donnees: [] }); return; }
    if (force === "erreur") { setListe({ statut: "erreur", message: fr.documents.erreurs.chargementListe }); return; }
    setListe({ statut: "chargement" });
    const minuteur = setTimeout(() => {
      if (generation.current !== gen) return;
      setListe({ statut: "erreur", message: fr.delaiDepasse });
    }, DELAI_CHARGEMENT_MS);
    const r = await listPatientDocuments(patientId);
    clearTimeout(minuteur);
    if (generation.current !== gen) return;
    if (!r.ok) { setListe({ statut: "erreur", message: r.error.message }); return; }
    setListe({ statut: "charge", donnees: r.data });
  }, []);

  const chargerGlobal = useCallback(async () => {
    setListeGlobal({ statut: "chargement" });
    const r = await listDocuments({
      query: query.trim() === "" ? null : query.trim(),
      type: filtreType === "" ? null : filtreType,
      status: filtreStatut === "" ? null : filtreStatut,
      limit: 20,
      offset: 0,
    });
    if (!r.ok) { setListeGlobal({ statut: "erreur", message: r.error.message }); return; }
    setListeGlobal({ statut: "charge", donnees: r.data });
  }, [query, filtreType, filtreStatut]);

  // init: global list
  useEffect(() => {
    void chargerGlobal();
  }, [chargerGlobal]);

  // dossier depuis URL — deux appels en parallèle
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

  useEffect(() => {
    if (dossier === null) return;
    if (listeChargeePour.current === dossier.id) return;
    listeChargeePour.current = dossier.id;
    void chargerListe(dossier.id);
  }, [chargerListe, dossier]);

  // ouvrir document
  const ouvrir = useCallback(async (documentId: string) => {
    setErreurOuverture(undefined);
    setSuccesCreation(null);
    const r = await getDocument(documentId);
    if (!r.ok) { setErreurOuverture(r.error.message); return; }
    if (r.data === null) { setErreurOuverture(fr.documents.erreurs.chargementDocument); return; }
    setOuvert(r.data);
    setEmission(false);
  }, []);

  const dejaOuvert = useRef(false);
  useEffect(() => {
    if (dossier === null || dejaOuvert.current) return;
    const id = documentDepuisUrl();
    if (id === null) return;
    dejaOuvert.current = true;
    void ouvrir(id);
  }, [dossier, ouvrir]);

  // emission
  const ouvrirEmission = useCallback(() => {
    setOuvert(null);
    setErreurEmission(undefined);
    setSuccesCreation(null);
    setEmission(true);
    setSaisie(dossier === null ? {} : { date_naissance: isoVersFr(dossier.birthDate) });
  }, [dossier]);

  const changerType = useCallback((t: TypeDocument) => {
    setType(t);
    setErreurEmission(undefined);
    setSaisie(dossier === null ? {} : { date_naissance: isoVersFr(dossier.birthDate) });
  }, [dossier]);

  const changerSaisie = useCallback((cle: string, valeur: string) => {
    setSaisie((p) => ({ ...p, [cle]: valeur }));
  }, []);

  const emettre = useCallback(async () => {
    if (dossier === null || envoi) return;
    if (dossier.birthDate === null) return;
    setEnvoi(true);
    setErreurEmission(undefined);
    const r = await issueDocument(dossier.id, type, payloadPour(type, saisie));
    setEnvoi(false);
    if (!r.ok) {
      const code = r.error.code as string;
      const isHeader = r.error.message.includes("En-tête") || code === "regle-metier";
      setErreurEmission(isHeader ? r.error.message : (code === "regle-metier" ? fr.documents.erreurs.emissionRefusee : r.error.message));
      return;
    }
    if (r.data === null) { setErreurEmission(fr.documents.erreurs.dossierIntrouvable); return; }
    setEmission(false);
    setSuccesCreation(r.data);
    // recharger les deux listes en parallèle
    void chargerListe(dossier.id);
    void chargerGlobal();
    await ouvrir(r.data);
  }, [chargerGlobal, chargerListe, dossier, envoi, ouvrir, saisie, type]);

  // imprimer — VIEW toujours, PRINT bloqué si marqueur
  const dossierIncomplet = dossier !== null && dossier.birthDate === null;
  const markers = ouvert?.renderedHtml ? extractUnresolvedMarkers(ouvert.renderedHtml) : [];
  const imprimable = ouvert !== null && ouvert.renderedHtml !== null && markers.length === 0 && ouvert.status !== "voided";

  const imprimer = useCallback(async () => {
    if (ouvert === null || ouvert.renderedHtml === null) return;
    if (!imprimable) return;
    // Impression via iframe isolé — SEULE voie d'impression.
    // Pourquoi iframe about:blank : le header/footer du navigateur (date + URL
    // en haut, URL + pagination en bas — capture 1) vient de la marge du @page.
    // Avec `margin:0` il disparaît, mais si l'utilisateur a coché
    // "En-têtes et pieds" le navigateur affiche QUAND MÊME l'URL du document
    // imprimé. En imprimant un iframe dont l'URL est `about:blank`, même ce
    // cas affiche `about:blank` (invisible à l'œil) au lieu de
    // `localhost:3000/documents?patient=...` — capture 1 définitivement close.
    // AUCUN fallback `window.print()` : il réimprimerait la coquille entière
    // avec son URL visible.
    const html = ouvert.renderedHtml;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.setAttribute("title", "");
    // L'URL de l'iframe reste about:blank — jamais l'URL de l'app.
    iframe.style.position = "fixed";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.left = "-9999px";
    iframe.style.top = "0";
    document.body.appendChild(iframe);
    const idoc = iframe.contentDocument ?? iframe.contentWindow?.document;
    const win = iframe.contentWindow;
    if (idoc === null || idoc === undefined || win === null || win === undefined) {
      if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      return;
    }
    const headStyles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map((el) => el.outerHTML)
      .join("\n");
    // Page A5 propre : le HTML figé est enveloppé sans autre chrome.
    // Le style injecté force `margin:0` à la fois sur @page ET sur html/body,
    // garantissant zéro texte automatique même si la feuille globale tarde.
    idoc.open();
    idoc.write(
      `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title></title>${headStyles}<style>@page{size:A5 portrait;margin:0 !important}html,body{margin:0 !important;padding:0 !important;background:white !important} .doc-feuille{box-shadow:none !important;border-radius:0 !important;margin:0 auto !important}</style></head><body>${html}</body></html>`,
    );
    idoc.close();
    // Attendre le chargement des styles puis imprimer depuis l'iframe uniquement.
    // Le focus sur win garantit que le dialogue porte sur about:blank.
    setTimeout(() => {
      try {
        win.focus();
        win.print();
      } catch {
        // Silencieux : l'échec d'impression ne doit pas marquer le doc comme imprimé.
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        return;
      }
      setTimeout(() => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 1000);
    }, 350);
    const r = await markDocumentPrinted(ouvert.id);
    if (!r.ok) return;
    const compte = r.data;
    if (compte !== null) setOuvert((p) => (p === null ? p : { ...p, printedCount: compte }));
    if (dossier !== null) void chargerListe(dossier.id);
    void chargerGlobal();
  }, [chargerGlobal, chargerListe, dossier, imprimable, ouvert]);

  const annulerDoc = useCallback(async () => {
    if (ouvert === null) return;
    if (raisonAnnulation.trim() === "") return;
    const r = await voidDocument(ouvert.id, raisonAnnulation.trim());
    if (!r.ok) { setErreurOuverture(r.error.message); return; }
    setShowVoid(false);
    setRaisonAnnulation("");
    void chargerGlobal();
    if (dossier) void chargerListe(dossier.id);
    // recharger ouvert
    const re = await getDocument(ouvert.id);
    if (re.ok && re.data) setOuvert(re.data);
  }, [chargerGlobal, chargerListe, dossier, ouvert, raisonAnnulation]);

  if (utilisateur === undefined) {
    return <main className="flex flex-col gap-4 p-8"><Squelette lignes={4} /></main>;
  }
  if (utilisateur === null) {
    return (
      <main className="flex flex-col gap-4 p-8">
        {horsLigneSession ? <BandeauHorsLigne /> : null}
        <BlocErreur message={horsLigneSession ? fr.erreurs["hors-ligne"] : fr.erreurs["non-authentifie"]} action={<LienBouton href="/connexion">{fr.actions.seConnecter}</LienBouton>} />
      </main>
    );
  }
  const horsLigne = horsLigneSession || etatForce() === "horsligne";

  // filtrage client pour liste patient
  const listeFiltree = ((): readonly Document[] | null => {
    if (liste.statut !== "charge") return null;
    let docs = liste.donnees;
    if (filtreType !== "") docs = docs.filter((d) => d.docType === filtreType);
    if (filtreStatut !== "") docs = docs.filter((d) => d.status === filtreStatut);
    if (query.trim() !== "") {
      const q = query.trim().toLowerCase();
      docs = docs.filter((d) => d.docNumber.toLowerCase().includes(q) || fr.documents.types[d.docType].toLowerCase().includes(q));
    }
    return docs;
  })();

  return (
    <AppShell
      role={utilisateur.role}
      nomComplet={utilisateur.fullName}
      onDeconnexion={deconnecter}
      sousTitre={fr.documents.sousTitre}
      actions={
        dossier === null ? null : (
          <Bouton rang="principal" onClick={ouvrirEmission}>{fr.documents.emission.ouvrir}</Bouton>
        )
      }
      sansGouttiere
    >
      {/* Trois volets bord a bord : selecteur, liste/formulaire, feuille. La
          gouttiere est portee par chaque volet, pas par la coquille — une
          feuille A5 doit pouvoir toucher le bord de son volet. */}
      <div className="flex h-full min-h-0 flex-col gap-4 overflow-hidden px-6 py-5">
        {horsLigne ? <BandeauHorsLigne /> : null}

        {/* Readiness banner */}
        {readiness !== null && !readiness.canIssue ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-attention bg-attention-bg p-4">
            <div className="flex flex-col gap-1">
              <p className="font-ui text-body font-semibold text-attention-ink">En-tête incomplet</p>
              <p className="font-ui text-body text-ink-700">
                {readiness.missing.map((m) => m.label).join(" · ") || fr.documents.erreurs.marqueurNonResolu}
              </p>
            </div>
            <LienBouton href="/parametres/documents" rang="secondaire">Compléter les paramètres</LienBouton>
          </div>
        ) : readiness !== null && readiness.canIssue ? (
          <div className="flex items-center gap-2 rounded-lg border border-positive bg-positive-bg px-4 py-3 font-ui text-body text-positive">
            <span className="h-2 w-2 rounded-full bg-positive" aria-hidden /> Prêt à émettre · Cabinet configuré
          </div>
        ) : null}

        {/*
          LA BARRE D'OUTILS — UNE RANGEE, PAS UNE CARTE.
          C'etait une `Carte` contenant trois champs a libelles empiles : un
          bloc de 90 px de haut, avec sa propre bordure et son ombre, pose
          au-dessus de la liste qu'il filtre. Un filtre n'est pas un contenu :
          il appartient au meuble. Les libelles passent en visuellement-cache
          (ils restent lus par un lecteur d'ecran), et les trois commandes
          s'alignent sur une seule ligne a hauteur constante.
        */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-card flex-1">
            <label className="cache-visuellement" htmlFor="doc-recherche">
              {fr.documents.recherche.libelle}
            </label>
            <input
              id="doc-recherche"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={fr.documents.recherche.indication}
              className="min-h-target w-full rounded-lg border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none transition duration-quick ease-out placeholder:text-ink-300 focus-visible:border-action-600 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
            />
          </div>

          <label className="cache-visuellement" htmlFor="doc-type">
            {fr.documents.filtres.type}
          </label>
          <select
            id="doc-type"
            value={filtreType}
            onChange={(e) => setFiltreType(e.target.value as TypeDocument | "")}
            className="min-h-target rounded-lg border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none transition duration-quick ease-out focus-visible:border-action-600 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
          >
            <option value="">{fr.documents.filtres.tousTypes}</option>
            <option value="bonne_sante_mentale">{fr.documents.types.bonne_sante_mentale}</option>
            <option value="suivi_medical">{fr.documents.types.suivi_medical}</option>
            <option value="certificat_medical">{fr.documents.types.certificat_medical}</option>
            <option value="justification">{fr.documents.types.justification}</option>
          </select>

          <label className="cache-visuellement" htmlFor="doc-statut">
            {fr.documents.filtres.statut}
          </label>
          <select
            id="doc-statut"
            value={filtreStatut}
            onChange={(e) => setFiltreStatut(e.target.value as StatutDocument | "")}
            className="min-h-target rounded-lg border border-rule bg-card px-3 py-2 font-ui text-body text-ink-900 outline-none transition duration-quick ease-out focus-visible:border-action-600 focus-visible:outline focus-visible:outline-action-600 focus-visible:outline-offset"
          >
            <option value="">{fr.documents.filtres.tousStatuts}</option>
            <option value="issued">{fr.documents.statuts.issued}</option>
            <option value="voided">{fr.documents.statuts.voided}</option>
          </select>

          {dossier === null ? null : (
            <div className="flex items-center gap-2">
              <span className="font-ui text-body text-ink-700">
                {dossier.lastName} {dossier.firstName}{" "}
                <span className="font-num text-ink-500">{dossier.recordNumber}</span>
              </span>
              <Bouton
                rang="discret"
                onClick={() => {
                  setDossier(null);
                  setOuvert(null);
                  setEmission(false);
                }}
              >
                {fr.documents.changerDossier}
              </Bouton>
            </div>
          )}
        </div>

        {dossier === null ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-espace-liste">
            {/* Global recent */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <h2 className="font-ui text-heading font-semibold text-ink-900">Documents récents</h2>
              <PanneauEtat etat={listeGlobal} onReessayer={() => void chargerGlobal()} lignesSquelette={3}>
                {(docs) => docs.length === 0 ? (
                  <EtatVide message="Aucun document pour le moment" icone="documents" action={<p className="font-ui text-label text-ink-500">Choisissez un dossier pour créer votre premier certificat.</p>} />
                ) : (
                  <ListeDocuments documents={docs} documentOuvert={ouvert?.id ?? null} onOuvrir={(id) => void ouvrir(id)} />
                )}
              </PanneauEtat>
              <div className="pt-2">
                <h3 className="font-ui text-body font-semibold text-ink-900">Choisir un dossier</h3>
                <div className="mt-2">
                  <SelecteurPatient onChoisir={(p) => setDossier({ id: p.id, firstName: p.firstName, lastName: p.lastName, recordNumber: p.recordNumber, birthDate: p.birthDate })} />
                </div>
              </div>
            </div>
            {/* Viewer */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              {succesCreation ? (
                <div className="rounded-lg border border-positive bg-positive-bg p-4">
                  <p className="font-ui text-body font-medium text-positive">Document créé</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Bouton rang="principal" onClick={() => succesCreation && void ouvrir(succesCreation)}>Ouvrir le document</Bouton>
                    <Bouton rang="secondaire" onClick={() => void imprimer()}>Imprimer</Bouton>
                    <LienBouton href="/patients" rang="discret">Retour au dossier</LienBouton>
                  </div>
                </div>
              ) : null}
              {erreurOuverture ? <BlocErreur message={erreurOuverture} /> : null}
              {ouvert === null ? (
                <EtatVide message={fr.documents.vide.aucunDocumentOuvert} icone="documents" />
              ) : (
                <>
                  <ViewerHeader
                    doc={ouvert}
                    zoom={zoom}
                    onZoom={setZoom}
                    imprimable={imprimable}
                    onImprimer={() => void imprimer()}
                    onVoid={() => setShowVoid(true)}
                    markers={markers}
                  />
                  {markers.length > 0 ? (
                    <div className="rounded-md border border-attention bg-attention-bg px-4 py-3">
                      <p className="font-ui text-label font-semibold text-attention-ink">Document incomplet</p>
                      <p className="font-ui text-body text-ink-700">Certaines informations n&apos;étaient pas disponibles lors de l&apos;émission : {markers.join(", ")}</p>
                      <p className="font-ui text-label text-ink-500">Ce document reste lisible tel qu&apos;émis. Pour les prochains, complétez les paramètres.</p>
                    </div>
                  ) : null}
                  {ouvert.status === "voided" ? (
                    <div className="rounded-md border border-attention bg-attention-bg px-4 py-3">
                      <p className="font-ui text-label font-semibold text-attention-ink">Annulé</p>
                      <p className="font-ui text-body text-ink-700">{ouvert.voidReason ?? "—"}</p>
                    </div>
                  ) : null}
                  <div className="flex justify-center overflow-auto rounded-xl border border-rule bg-sunken p-6 shadow-lift0">
                    <div style={{ transform: `scale(${zoom/100})`, transformOrigin: "top center" }}>
                      <FeuilleEmise html={ouvert.renderedHtml ?? ""} />
                    </div>
                  </div>
                  {showVoid ? (
                    <Carte niveau="primaire">
                      <div className="flex flex-col gap-3 p-4">
                        <p className="font-ui text-heading font-semibold">Annuler ce document ?</p>
                        <p className="font-ui text-body text-ink-500">Le numéro ne sera jamais réutilisé. Le contenu reste auditable.</p>
                        <input value={raisonAnnulation} onChange={(e) => setRaisonAnnulation(e.target.value)} placeholder="Motif d'annulation (obligatoire)" className="rounded-md border border-rule px-3 py-2 font-ui text-body" />
                        <div className="flex gap-2">
                          <Bouton rang="principal" retrait onClick={() => void annulerDoc()} disabled={raisonAnnulation.trim()===""}>Annuler le document</Bouton>
                          <Bouton rang="secondaire" onClick={() => setShowVoid(false)}>Fermer</Bouton>
                        </div>
                      </div>
                    </Carte>
                  ) : null}
                </>
              )}
            </div>
          </div>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-hidden lg:grid-cols-espace-liste">
            {/* Colonne gauche: Liste patient + émission */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              <PanneauEtat etat={liste} onReessayer={() => void chargerListe(dossier.id)} lignesSquelette={3}>
                {(docs) => {
                  const filt = listeFiltree ?? docs;
                  if (filt.length === 0) {
                    return <EtatVide message={fr.documents.vide.phrase} icone="documents" {...(emission || dossierIncomplet ? {} : { action: <Bouton rang="principal" onClick={ouvrirEmission}>{fr.documents.vide.action}</Bouton> })} />;
                  }
                  return <ListeDocuments documents={filt} documentOuvert={ouvert?.id ?? null} onOuvrir={(id) => void ouvrir(id)} />;
                }}
              </PanneauEtat>
              {erreurOuverture ? <BlocErreur message={erreurOuverture} /> : null}
              {succesCreation ? (
                <div className="rounded-lg border border-positive bg-positive-bg p-3">
                  <p className="font-ui text-body font-medium text-positive">Document créé avec succès</p>
                  <div className="mt-2 flex gap-2">
                    <Bouton rang="principal" onClick={() => succesCreation && void ouvrir(succesCreation)}>Ouvrir le document</Bouton>
                    <Bouton rang="secondaire" onClick={() => void imprimer()}>Imprimer</Bouton>
                  </div>
                </div>
              ) : null}
              {dossierIncomplet ? <BlocErreur message={fr.documents.erreurs.dossierIncomplet} /> : null}
              {emission && !dossierIncomplet ? (
                <FormulaireEmission type={type} onChangerType={changerType} saisie={saisie} onChangerSaisie={changerSaisie} onEmettre={() => void emettre()} onAnnuler={() => setEmission(false)} enCours={envoi} horsLigne={horsLigne} {...(erreurEmission === undefined ? {} : { messageErreur: erreurEmission })} />
              ) : null}
              {!emission && !dossierIncomplet ? (
                <Bouton rang="principal" onClick={ouvrirEmission}>{fr.documents.emission.ouvrir}</Bouton>
              ) : null}
            </div>

            {/* Colonne droite: Viewer */}
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
              {emission && !dossierIncomplet ? (
                <>
                  <p className="font-ui text-label text-ink-500">{fr.documents.emission.apercuAvertissement}</p>
                  <FeuilleApercu type={type} patient={dossier} saisie={saisie} />
                </>
              ) : ouvert === null ? (
                <EtatVide message={fr.documents.vide.aucunDocumentOuvert} icone="documents" />
              ) : (
                <>
                  <ViewerHeader doc={ouvert} zoom={zoom} onZoom={setZoom} imprimable={imprimable} onImprimer={() => void imprimer()} onVoid={() => setShowVoid(true)} markers={markers} />
                  {markers.length > 0 ? (
                    <div className="rounded-md border border-attention bg-attention-bg px-4 py-3">
                      <p className="font-ui text-label font-semibold text-attention-ink">Document incomplet</p>
                      <p className="font-ui text-body text-ink-700">Marqueurs non résolus : {markers.join(", ")}</p>
                    </div>
                  ) : null}
                  {ouvert.status === "voided" ? (
                    <div className="rounded-md border border-attention bg-attention-bg px-4 py-3">
                      <p className="font-ui text-label font-semibold text-attention-ink">Annulé — {ouvert.voidReason ?? ""}</p>
                    </div>
                  ) : null}
                  {!imprimable && markers.length>0 ? (
                    <div className="rounded-md border border-rule bg-card p-3 font-ui text-body text-ink-700">
                      Impression bloquée : complétez les paramètres manquants puis émettez un nouveau document.
                      <span className="ml-2"><LienBouton href="/parametres/documents" rang="discret">Compléter les paramètres</LienBouton></span>
                    </div>
                  ) : null}
                  <div className="flex justify-center overflow-auto rounded-xl border border-rule bg-sunken p-6 shadow-lift0">
                    <div style={{ transform: `scale(${zoom/100})`, transformOrigin: "top center" }}>
                      <FeuilleEmise html={ouvert.renderedHtml ?? ""} />
                    </div>
                  </div>
                  {showVoid ? (
                    <Carte niveau="primaire">
                      <div className="flex flex-col gap-3 p-4">
                        <p className="font-ui text-heading font-semibold">Annuler ce document ?</p>
                        <input value={raisonAnnulation} onChange={(e) => setRaisonAnnulation(e.target.value)} placeholder="Motif (obligatoire)" className="rounded-md border border-rule px-3 py-2 font-ui text-body" />
                        <div className="flex gap-2">
                          <Bouton rang="principal" retrait onClick={() => void annulerDoc()} disabled={raisonAnnulation.trim()===""}>Annuler</Bouton>
                          <Bouton rang="secondaire" onClick={() => setShowVoid(false)}>Fermer</Bouton>
                        </div>
                      </div>
                    </Carte>
                  ) : null}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      <PortailImpression>
        {ouvert === null || ouvert.renderedHtml === null || !imprimable ? null : <FeuilleEmise html={ouvert.renderedHtml} />}
      </PortailImpression>
    </AppShell>
  );
}

function ViewerHeader({ doc, zoom, onZoom, imprimable, onImprimer, onVoid, markers }: {
  readonly doc: Document;
  readonly zoom: number;
  readonly onZoom: (z: 90|100|110)=>void;
  readonly imprimable: boolean;
  readonly onImprimer: ()=>void;
  readonly onVoid: ()=>void;
  readonly markers: readonly string[];
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rule bg-card p-3 shadow-lift1">
      <div className="flex flex-col gap-1">
        <p className="font-ui text-body font-medium text-ink-900">{fr.documents.types[doc.docType]} <span className="font-num text-label text-ink-500">{doc.docNumber}</span></p>
        <p className="font-ui text-label text-ink-500">{new Intl.DateTimeFormat("fr-DZ", { timeZone: "Africa/Algiers", day:"2-digit", month:"2-digit", year:"numeric"}).format(new Date(doc.issuedAt))} · {doc.patientNom ?? ""} {doc.patientPrenom ?? ""} · <Badge ton={doc.status==="voided"?"attention":"positif"}>{doc.status==="voided"?"Annulé":"Émis"}</Badge></p>
        {doc.contentHash ? <span className="font-num text-label tabular-nums text-ink-500">SHA256 {doc.contentHash.slice(0,8)}…</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-full border border-rule bg-sunken p-1">
          {[90,100,110].map((z) => (
            <button key={z} onClick={()=> onZoom(z as 90|100|110)} className={["rounded-full px-3 py-1 font-ui text-label", zoom===z ? "bg-card shadow-lift1 text-ink-900" : "text-ink-500"].join(" ")}>{z}%</button>
          ))}
        </div>
        <Bouton rang="principal" onClick={onImprimer} disabled={!imprimable}>{fr.documents.impression.imprimer}</Bouton>
        {doc.status==="issued" ? <Bouton rang="discret" retrait onClick={onVoid}>Annuler</Bouton> : null}
      </div>
      {markers.length>0 ? <p className="w-full font-ui text-label text-attention-ink">Attention: marqueurs {markers.join(", ")}</p> : null}
      <p className="w-full font-ui text-label text-ink-500" title={fr.documents.impression.avertissementCompteur}>{fr.documents.impression.envoyees} {doc.printedCount}</p>
    </div>
  );
}

function PortailImpression({ children }: { readonly children: React.ReactNode }): React.JSX.Element | null {
  const [pret, setPret] = useState(false);
  useEffect(() => setPret(true), []);
  if (!pret) return null;
  return createPortal(<div className="doc-racine ecran-cache">{children}</div>, document.body);
}
