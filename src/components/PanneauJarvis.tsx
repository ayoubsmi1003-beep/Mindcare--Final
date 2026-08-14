/**
 * `PanneauJarvis` — le panneau latéral. `SPRINT-V1.md` §V2.1 et §V2.5.
 *
 * ═══ CE COMPOSANT NE DÉCIDE D'AUCUNE FRONTIÈRE ═══
 * Il n'appelle pas `classer()` : le routage d'ADR-023 vit dans la passerelle,
 * hors d'atteinte du navigateur. Un classement décidé ici serait modifiable
 * depuis les outils de développement, donc ne serait pas une frontière. Le
 * panneau se contente d'AFFICHER le chemin que le serveur a choisi.
 *
 * ═══ L'ORDRE DES TROIS APPELS EST LA GARANTIE ═══
 * Pour une écriture : `proposerAction` → carte → `confirmerAction` →
 * `executerAction`. Trois allers-retours, donc TROIS TRANSACTIONS. Les réunir
 * ferait coïncider `confirmed_at` et `executed_at` — mesuré au rejeu de 033 —
 * et l'ordre « confirmé puis exécuté » cesserait d'être démontrable dans
 * l'audit. Ce n'est pas de la prudence, c'est ce qui donne sa valeur à la trace.
 */

"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fr } from "@/i18n/fr";
import { getSession } from "@/services/auth";
import { demanderAJarvis, type ReponseJarvis } from "@/services/jarvis";
import {
  confirmerAction,
  estOutilConnu,
  estOutilEcriture,
  executerAction,
  outilGetAgenda,
  outilSearchPatients,
  proposerAction,
  refuserAction,
  validerArguments,
  type CarteConfirmation as DonneesCarte,
  type ToolEcriture,
} from "@/services/jarvis-tools";

import { CarteConfirmation } from "./CarteConfirmation";

const LARGEUR_PANNEAU = "380px";

/**
 * V1.5 — aucun chargement sans plafond. Au-delà, on bascule en erreur nommée
 * plutôt que de laisser tourner un indicateur (05-UX-CONTRACT.md §2 :
 * « le spinner sans fin est interdit »).
 */
const PLAFOND_MS = 15_000;

/**
 * Identifiant de conversation — AVEC REPLI, ET LE REPLI N'EST PAS DÉCORATIF.
 *
 * `crypto.randomUUID()` n'existe QUE dans un contexte sécurisé. Sur
 * `http://localhost` il est là ; sur l'adresse RÉSEAU que Next.js affiche au
 * démarrage (`http://172.23.112.1:3000`), `window.isSecureContext` vaut `false`
 * et la fonction vaut `undefined` — mesuré des deux côtés, pas supposé. Or
 * c'est précisément par cette adresse qu'on ouvre l'application depuis un autre
 * poste du cabinet. Sans ce repli, le premier message envoyé à Jarvis lève
 * `crypto.randomUUID is not a function`, et le panneau meurt sans rien dire.
 *
 * `getRandomValues`, lui, est disponible hors contexte sécurisé. On compose
 * donc un UUID v4 conforme à la main : les deux nibbles de version et de
 * variante sont posés explicitement, sinon la valeur passerait le cast
 * `::uuid` de Postgres mais échouerait à une validation stricte plus tard.
 */
function nouvelIdentifiantConversation(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const o = new Uint8Array(16);
  crypto.getRandomValues(o);
  o[6] = ((o[6] ?? 0) & 0x0f) | 0x40; // version 4
  o[8] = ((o[8] ?? 0) & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(o, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type Tour =
  | { readonly qui: "humain"; readonly texte: string }
  | {
      readonly qui: "jarvis";
      readonly texte: string;
      readonly registre?: "connaissance-generale";
    }
  | { readonly qui: "systeme"; readonly texte: string };

interface EtatEcriture {
  readonly carte: DonneesCarte;
  readonly enCours: boolean;
}

export function PanneauJarvis(): React.JSX.Element {
  const [ouvert, setOuvert] = useState(false);

  /**
   * Identifiant de conversation, stable pour la durée du panneau : il regroupe
   * les propositions d'un même échange dans `app.jarvis_actions`.
   *
   * Créé À LA PREMIÈRE DEMANDE, pas au rendu. En le générant dans un
   * initialiseur d'état, le serveur et le client en produiraient deux
   * différents au même instant — un décalage d'hydratation invisible ici, mais
   * qui rattacherait les propositions à deux conversations distinctes.
   */
  const conversationRef = useRef<string | null>(null);
  const obtenirConversationId = useCallback((): string => {
    conversationRef.current ??= nouvelIdentifiantConversation();
    return conversationRef.current;
  }, []);
  const [tours, setTours] = useState<readonly Tour[]>([]);
  const [saisie, setSaisie] = useState("");
  const [enAttente, setEnAttente] = useState(false);
  const [ecriture, setEcriture] = useState<EtatEcriture | null>(null);
  const champRef = useRef<HTMLInputElement | null>(null);

  /**
   * CONTEXTE D'OUTIL — les identifiants du tour précédent, joints au tour
   * suivant. Sans lui, `create_appointment` était INATTEIGNABLE : le modèle ne
   * peut pas deviner un UUID, proposait donc toujours des arguments invalides,
   * et Zod les refusait. Constaté au navigateur le 2026-08-13, pas en relecture.
   *
   * ⚠️ Une `ref` et non un `state` : ce contexte ne s'affiche pas et ne doit
   * déclencher aucun rendu. Il ne survit pas au rechargement de la page, ce qui
   * est voulu — il n'existe que le temps d'un échange.
   *
   * ⚠️ Ce qu'il contient SORT vers le modèle sur le chemin patient (arbitrage
   * du 2026-08-13). On n'y met donc QUE ce qu'un outil d'écriture réclame :
   * identifiant, nom, numéro de dossier. Ni téléphone, ni date de naissance,
   * ni adresse — la passerelle n'a aucune raison de les voir.
   *
   * ⚠️ EN CHAMPS, PAS EN TEXTE COMPOSÉ, et ce n'est pas un choix de style.
   * Le bloc était composé ici puis pseudonymisé là-bas ; mesuré au navigateur,
   * un prénom (« Patient », dans le jeu d'essai) a matché à l'intérieur du
   * libellé `patientId=` et le bloc partait avec `P3Id=` — structure corrompue,
   * réhydratation inexacte. La passerelle masque désormais les VALEURS puis
   * compose le texte autour : un libellé n'existe pas encore au moment du
   * masquage, il ne peut donc plus être atteint.
   */
  const contexteDossiersRef = useRef<
    readonly { readonly id: string; readonly nom: string; readonly numero: string }[]
  >([]);
  const contextePraticienIdRef = useRef<string | null>(null);

  // ── ⌘K / Ctrl+K ──────────────────────────────────────────────────────────
  useEffect(() => {
    function surTouche(evenement: KeyboardEvent): void {
      if ((evenement.metaKey || evenement.ctrlKey) && evenement.key.toLowerCase() === "k") {
        evenement.preventDefault();
        setOuvert((precedent) => !precedent);
        return;
      }
      // Échap ferme, sauf si une carte attend une décision : refermer le
      // panneau sur une proposition en attente la laisserait `proposed` sans
      // que personne ne sache qu'elle existe.
      if (evenement.key === "Escape" && ecriture === null) setOuvert(false);
    }
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [ecriture]);

  useEffect(() => {
    if (ouvert) champRef.current?.focus();
  }, [ouvert]);

  const ajouter = useCallback((tour: Tour) => {
    setTours((precedents) => [...precedents, tour]);
  }, []);

  /**
   * Construit la carte à partir des arguments DÉJÀ VALIDÉS. Chaque champ y
   * figure : ce que la carte ne montre pas est ce que la praticienne n'a pas
   * validé et qui partira pourtant en base.
   */
  const construireCarte = useCallback(
    (actionId: string, outil: ToolEcriture, args: Record<string, unknown>): DonneesCarte => {
      const champs = Object.entries(args).map(([cle, valeur]) => ({
        libelle: cle,
        valeur: valeur === undefined || valeur === null ? "—" : String(valeur),
      }));
      return {
        actionId,
        outil,
        titre:
          outil === "create_appointment"
            ? fr.jarvis.carte.creerRendezVous
            : fr.jarvis.carte.fixerTarif,
        champs,
      };
    },
    [],
  );

  /** Un outil de LECTURE s'exécute immédiatement — aucune confirmation (L2). */
  const executerLecture = useCallback(
    async (nom: string, args: unknown): Promise<void> => {
      if (nom === "search_patients") {
        const valides = validerArguments("search_patients", args);
        if (!valides.ok) return ajouter({ qui: "systeme", texte: valides.error.message });

        const resultat = await outilSearchPatients(valides.data);
        if (!resultat.ok) return ajouter({ qui: "systeme", texte: resultat.error.message });

        const r = resultat.data;
        if (r.type === "aucun") {
          contexteDossiersRef.current = [];
          contextePraticienIdRef.current = null;
          return ajouter({ qui: "jarvis", texte: fr.jarvis.aucunPatient });
        }

        // Les identifiants que le prochain tour devra citer. `practitionerId`
        // vaut l'utilisatrice connectée : `app.create_appointment` (024) le
        // reçoit de l'appelant et la RLS décide s'il est légitime — ce n'est
        // pas au modèle de le choisir, seulement de le recopier.
        const session = await getSession();
        const praticienId = session.ok && session.data !== null ? session.data.userId : null;
        const dossiers = r.type === "unique" ? [r.patient] : r.candidats;
        //
        // `nom` et `numero` sont les DEUX seuls champs qui nomment quelqu'un :
        // la passerelle les masque. `id` reste en clair — c'est la poignée dont
        // la boucle d'écriture de 033 a besoin, et un UUID ne nomme personne
        // sans la base. La distinction est documentée là où elle s'applique,
        // dans `jarvis-chat/index.ts`.
        contextePraticienIdRef.current = praticienId;
        contexteDossiersRef.current = dossiers.map((p) => ({
          id: p.id,
          nom: `${p.lastName} ${p.firstName}`.trim(),
          numero: p.recordNumber,
        }));

        if (r.type === "unique") {
          return ajouter({
            qui: "jarvis",
            texte: `${r.patient.lastName} ${r.patient.firstName} — ${r.patient.recordNumber}`,
          });
        }
        // PLUSIEURS : on DEMANDE. Il n'existe aucune branche qui choisisse —
        // `ResultatRecherche` ne comporte pas de variante « le plus probable ».
        return ajouter({
          qui: "jarvis",
          texte: `${fr.jarvis.plusieursPatients}\n${r.candidats
            .map((c) => `· ${c.lastName} ${c.firstName} — ${c.recordNumber}`)
            .join("\n")}`,
        });
      }

      if (nom === "get_agenda") {
        const valides = validerArguments("get_agenda", args);
        if (!valides.ok) return ajouter({ qui: "systeme", texte: valides.error.message });

        const resultat = await outilGetAgenda(valides.data);
        if (!resultat.ok) return ajouter({ qui: "systeme", texte: resultat.error.message });

        const lignes = resultat.data;
        // « Aucun rendez-vous VISIBLE » et non « aucun rendez-vous » : la RLS a
        // pu masquer la journée d'une autre praticienne, et annoncer un agenda
        // vide serait faux (cloison ADR-003).
        if (lignes.length === 0) return ajouter({ qui: "jarvis", texte: fr.agenda.aucunVisible });
        return ajouter({
          qui: "jarvis",
          texte: lignes
            .map((l) => {
              const nomPatient =
                l.lastName === null ? "—" : `${l.lastName} ${l.firstName ?? ""}`.trim();
              return `· ${new Date(l.startsAt).toLocaleString("fr-DZ")} — ${nomPatient}`;
            })
            .join("\n"),
        });
      }

      // `analyze_session` reste piloté par l'écran de consultation, inchangé de
      // bout en bout (D-10). Le panneau ne le déclenche pas : il faudrait un
      // identifiant de séance que la conversation n'a pas.
      ajouter({ qui: "systeme", texte: fr.jarvis.argumentsInvalides });
    },
    [ajouter],
  );

  /** Un outil d'ÉCRITURE ne s'exécute PAS : il se propose. */
  const proposerEcriture = useCallback(
    async (nom: ToolEcriture, args: unknown, demande: string): Promise<void> => {
      const valides =
        nom === "create_appointment"
          ? validerArguments("create_appointment", args)
          : validerArguments("set_consultation_price", args);
      if (!valides.ok) return ajouter({ qui: "systeme", texte: valides.error.message });

      const propose = await proposerAction({
        conversationId: obtenirConversationId(),
        demandeUtilisateur: demande,
        outil: nom,
        args: valides.data,
      });
      if (!propose.ok) return ajouter({ qui: "systeme", texte: propose.error.message });

      setEcriture({
        carte: construireCarte(propose.data, nom, valides.data),
        enCours: false,
      });
    },
    [ajouter, obtenirConversationId, construireCarte],
  );

  const envoyer = useCallback(async (): Promise<void> => {
    const message = saisie.trim();
    if (message === "" || enAttente) return;

    setSaisie("");
    ajouter({ qui: "humain", texte: message });
    setEnAttente(true);

    const plafond = new Promise<null>((resoudre) => setTimeout(() => resoudre(null), PLAFOND_MS));
    const reponse = await Promise.race([
      demanderAJarvis(
        message,
        obtenirConversationId(),
        contexteDossiersRef.current,
        contextePraticienIdRef.current ?? undefined,
      ),
      plafond,
    ]);

    if (reponse === null) {
      ajouter({ qui: "systeme", texte: fr.delaiDepasse });
      setEnAttente(false);
      return;
    }
    if (!reponse.ok) {
      // Jarvis indisponible n'empêche RIEN d'autre : le message le dit, et le
      // reste de l'application n'est pas touché — le panneau est un panneau.
      ajouter({ qui: "systeme", texte: fr.jarvis.indisponible });
      setEnAttente(false);
      return;
    }

    const donnees: ReponseJarvis = reponse.data;

    if (donnees.type === "texte") {
      ajouter(
        donnees.registre === undefined
          ? { qui: "jarvis", texte: donnees.reponse }
          : { qui: "jarvis", texte: donnees.reponse, registre: donnees.registre },
      );
      setEnAttente(false);
      return;
    }

    // ── PROPOSITION D'OUTIL ──────────────────────────────────────────────
    // Le nom vient du modèle : il est vérifié contre l'allowlist AVANT tout.
    // Un sixième outil inventé s'arrête ici — puis, s'il passait, en base.
    if (!estOutilConnu(donnees.nom)) {
      ajouter({ qui: "systeme", texte: fr.jarvis.argumentsInvalides });
      setEnAttente(false);
      return;
    }

    if (estOutilEcriture(donnees.nom)) {
      await proposerEcriture(donnees.nom, donnees.args, message);
    } else {
      await executerLecture(donnees.nom, donnees.args);
    }
    setEnAttente(false);
  }, [ajouter, obtenirConversationId, enAttente, executerLecture, proposerEcriture, saisie]);

  /** Confirmer PUIS exécuter — deux appels, jamais un seul. */
  const confirmer = useCallback(async (): Promise<void> => {
    if (ecriture === null) return;
    setEcriture({ ...ecriture, enCours: true });

    const confirmation = await confirmerAction(ecriture.carte.actionId);
    if (!confirmation.ok) {
      ajouter({ qui: "systeme", texte: confirmation.error.message });
      setEcriture(null);
      return;
    }

    const execution = await executerAction(ecriture.carte.actionId);
    setEcriture(null);
    ajouter(
      execution.ok
        ? { qui: "jarvis", texte: `${ecriture.carte.titre} — ${fr.feedback.enregistre}` }
        : { qui: "systeme", texte: execution.error.message },
    );
  }, [ajouter, ecriture]);

  const annuler = useCallback(async (): Promise<void> => {
    if (ecriture === null) return;
    await refuserAction(ecriture.carte.actionId);
    setEcriture(null);
    ajouter({ qui: "systeme", texte: fr.actions.annuler });
  }, [ajouter, ecriture]);

  if (!ouvert) {
    return (
      <button
        type="button"
        onClick={() => setOuvert(true)}
        aria-label={fr.jarvis.ouvrir}
        style={{
          position: "fixed",
          right: "var(--s-4)",
          bottom: "var(--s-4)",
          minHeight: "var(--target-min)",
          padding: "0 var(--s-4)",
          borderRadius: "var(--r-full)",
          border: "none",
          background: "var(--teal-600)",
          color: "var(--paper)",
          fontSize: "var(--text-body-size)",
          cursor: "pointer",
        }}
      >
        {fr.jarvis.ouvrir} · ⌘K
      </button>
    );
  }

  return (
    <aside
      aria-label={fr.jarvis.titre}
      style={{
        position: "fixed",
        top: "var(--size-0)",
        right: "var(--size-0)",
        bottom: "var(--size-0)",
        width: LARGEUR_PANNEAU,
        maxWidth: "100vw",
        background: "var(--card)",
        borderLeft: "var(--rule-width) solid var(--rule)",
        display: "flex",
        flexDirection: "column",
        zIndex: "var(--z-panneau)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "var(--s-3) var(--s-4)",
          borderBottom: "var(--rule-width) solid var(--rule)",
        }}
      >
        <strong style={{ color: "var(--ink-900)", fontSize: "var(--text-body-size)" }}>
          {fr.jarvis.titre}
        </strong>
        <button
          type="button"
          onClick={() => setOuvert(false)}
          style={{
            minHeight: "var(--target-min)",
            border: "none",
            background: "transparent",
            color: "var(--ink-500)",
            cursor: "pointer",
            fontSize: "var(--text-body-size)",
          }}
        >
          {fr.jarvis.fermer}
        </button>
      </header>

      <div style={{ flex: "1 1 auto", overflowY: "auto", padding: "var(--s-4)", display: "grid", gap: "var(--s-3)" }}>
        {tours.length === 0 && (
          <p style={{ margin: "var(--size-0)", color: "var(--ink-500)", fontSize: "var(--text-body-size)" }}>
            {fr.jarvis.invite}
          </p>
        )}

        {tours.map((tour, index) => (
          <div key={index} style={{ display: "grid", gap: "var(--s-1)" }}>
            {tour.qui === "jarvis" && tour.registre === "connaissance-generale" && (
              // LE REGISTRE EST RENDU PAR L'INTERFACE, jamais produit par le
              // modèle : une mention que le modèle peut oublier d'écrire n'est
              // pas une mention (ADR-023).
              <span
                style={{
                  fontSize: "var(--text-label-size)",
                  letterSpacing: "var(--text-label-tracking)",
                  color: "var(--ink-500)",
                }}
              >
                {fr.jarvis.registreConnaissance}
              </span>
            )}
            <p
              style={{
                margin: "var(--size-0)",
                whiteSpace: "pre-wrap",
                fontSize: "var(--text-body-size)",
                lineHeight: "var(--text-body-leading)",
                color: tour.qui === "systeme" ? "var(--ink-500)" : "var(--ink-900)",
                fontStyle: tour.qui === "systeme" ? "italic" : "normal",
                textAlign: tour.qui === "humain" ? "right" : "left",
              }}
            >
              {tour.texte}
            </p>
          </div>
        ))}

        {ecriture !== null && (
          <CarteConfirmation
            carte={ecriture.carte}
            enCours={ecriture.enCours}
            onConfirmer={() => void confirmer()}
            onAnnuler={() => void annuler()}
          />
        )}
      </div>

      <footer style={{ borderTop: "var(--rule-width) solid var(--rule)", padding: "var(--s-3) var(--s-4)", display: "grid", gap: "var(--s-2)" }}>
        <div style={{ display: "flex", gap: "var(--s-2)" }}>
          <input
            ref={champRef}
            value={saisie}
            onChange={(e) => setSaisie(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void envoyer();
            }}
            disabled={enAttente || ecriture !== null}
            placeholder={fr.jarvis.invite}
            style={{
              flex: "1 1 auto",
              minHeight: "var(--target-min)",
              padding: "0 var(--s-3)",
              borderRadius: "var(--r-md)",
              border: "var(--rule-width) solid var(--rule)",
              background: "var(--paper)",
              color: "var(--ink-900)",
              fontSize: "var(--text-body-size)",
            }}
          />
          {/* ⚠️ COMMANDE VOCALE — INDISPONIBLE, ET LE BOUTON LE DIT.
              La passerelle voix existe (`jarvis-voice-in`, ADR-024), mais son
              transport demande un canal BINAIRE que `DbPort.invokeFunction` —
              JSON uniquement (ADR-020) — n'expose pas. Étendre le port est une
              décision de contrat, hors du périmètre de ce lot (règle 10).
              Le bouton est rendu INERTE et nommé : un bouton qui n'écoute pas
              apprend à la praticienne que les commandes mentent, ce qui coûte
              plus cher que le bouton manquant — même raisonnement que la
              troisième colonne d'`AppShell`. */}
          <button
            type="button"
            disabled
            title={fr.jarvis.voix.indisponible}
            aria-label={fr.jarvis.voix.indisponible}
            style={{
              minHeight: "var(--target-min)",
              padding: "0 var(--s-3)",
              borderRadius: "var(--r-md)",
              border: "var(--rule-width) solid var(--rule)",
              background: "var(--sunken)",
              color: "var(--ink-300)",
              fontSize: "var(--text-label-size)",
              cursor: "default",
            }}
          >
            {fr.jarvis.voix.parler}
          </button>
        </div>

        {/* MENTION PERMANENTE — ADR-023, garde-fou 3. Elle ne se masque pas. */}
        <p
          style={{
            margin: "var(--size-0)",
            fontSize: "var(--text-label-size)",
            lineHeight: "var(--text-label-leading)",
            color: "var(--ink-500)",
          }}
        >
          {fr.disclaimer}
        </p>
      </footer>
    </aside>
  );
}
