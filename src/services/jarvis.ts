/**
 * Client de l'unique outil Jarvis de S6 — `analyze_session`.
 *
 * ⚠️ CE FICHIER NE REQUÊTE AUCUNE TABLE ET N'IMPORTE AUCUN CLIENT LLM. Il
 * n'appelle qu'`invokeFunction("jarvis-analyze-session", …)`, exactement comme
 * `consultations.ts` n'appelle que des portes RPC (026). La passerelle Deno
 * (`supabase/functions/`) est la SEULE chose qui parle à OpenRouter — voir
 * `_shared/external-call.ts`.
 *
 * `write: false` (`03-JARVIS-TOOLS.md` §3, `JARVIS-DEMO-SPEC.md` §2) : cet
 * appel ne pose AUCUNE ligne `jarvis_actions`, n'écrit rien dans la note SOAP,
 * et n'a besoin d'aucune carte de confirmation. Le résultat est un BROUILLON
 * affiché en lecture seule — `draft_clinical_note`, un outil distinct et
 * `write: true`, est ce qui préremplirait un jour l'éditeur SOAP.
 */

import type { NoteSoap } from "./consultations";
import { db } from "./db";
import {
  erreurDepuisEnveloppeEdge,
  logFieldsFor,
  offlineError,
  toAppError,
} from "./errors";
import { fr } from "@/i18n/fr";
import { log } from "./log";
import { err, ok, type Result } from "./result";

export interface AnalyseSeance {
  readonly noteStructuree: NoteSoap;
  readonly evolution: readonly string[];
  readonly pointsNonExplores: readonly string[];
  /** Identifiant de la version enregistrée — `null` si l'écriture a échoué. */
  readonly analyseId: string | null;
  readonly version: number | null;
  /**
   * L'analyse a-t-elle été RANGÉE, ou seulement calculée ?
   *
   * ⚠️ LA DISTINCTION EST VISIBLE À L'ÉCRAN, ET ELLE DOIT L'ÊTRE. Une analyse
   * non persistée disparaît au changement d'écran. La présenter comme les
   * autres ferait promettre une permanence qui n'existe pas — et c'est
   * exactement ce que faisait la version précédente, pour TOUTES les analyses.
   */
  readonly persistee: boolean;
}

interface AnalyseSeanceRow {
  readonly noteStructuree: {
    readonly subjective: string;
    readonly objective: string;
    readonly assessment: string;
    readonly plan: string;
  };
  readonly evolution: readonly string[];
  readonly pointsNonExplores: readonly string[];
  readonly analyseId?: string | null;
  readonly version?: number | null;
  readonly persistee?: boolean;
}

/** La ligne rendue par `app.get_consultation_analysis` (067). */
interface AnalyseEnregistreeRow {
  readonly id: string;
  readonly version: number;
  readonly content: unknown;
}

/**
 * Analyse la séance en cours : notes brutes + historique du patient, relus
 * depuis la base au moment de l'appel — jamais depuis une mémoire d'agent
 * (garde-fou n°1 de `JARVIS-DEMO-SPEC.md` §2 bis, « Jarvis ne se souvient
 * d'aucun fait clinique »).
 *
 * Aucun identifiant patient ici, en succès comme en échec : la trace
 * nominative légale est écrite en base par `get_consultation`, que la
 * passerelle appelle avant tout envoi au modèle (règle 1, I5).
 */
export async function analyzeSession(consultationId: string): Promise<Result<AnalyseSeance>> {
  const result = await db().invokeFunction<AnalyseSeanceRow>("jarvis-analyze-session", {
    consultationId,
  });

  if (!result.ok) {
    log.error("jarvis.analyseSeance", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok({
    noteStructuree: {
      subjective: result.data.noteStructuree.subjective,
      objective: result.data.noteStructuree.objective,
      assessment: result.data.noteStructuree.assessment,
      plan: result.data.noteStructuree.plan,
    },
    evolution: result.data.evolution,
    pointsNonExplores: result.data.pointsNonExplores,
    analyseId: result.data.analyseId ?? null,
    version: result.data.version ?? null,
    persistee: result.data.persistee ?? false,
  });
}

/**
 * Relit l'analyse déjà enregistrée pour cette consultation, s'il y en a une.
 *
 * ═══ POURQUOI CETTE FONCTION EXISTE ═══
 * L'analyse n'était RENDUE que par l'appel qui la produisait : elle vivait
 * dans l'état React et disparaissait au premier changement d'écran. Rouvrir
 * une consultation ne montrait plus rien, et rien n'indiquait qu'une analyse
 * avait seulement existé. La porte 067 la rend durable ; celle-ci la relit.
 *
 * Rend `ok(null)` quand aucune analyse n'existe — une consultation jamais
 * analysée n'est pas une erreur, c'est l'état normal d'une séance en cours.
 */
export async function chargerAnalyse(
  consultationId: string,
): Promise<Result<AnalyseSeance | null>> {
  const result = await db().rpc<AnalyseEnregistreeRow>("get_consultation_analysis", {
    p_consultation_id: consultationId,
  });

  if (!result.ok) {
    log.error("jarvis.analyseRelecture", logFieldsFor(result.error));
    return err(result.error);
  }

  const ligne = result.data[0];
  if (ligne === undefined) return ok(null);

  // Le contenu vient de NOTRE porte, mais il a été écrit par un modèle : on le
  // lit avec la même défiance qu'une entrée réseau. Une forme inattendue rend
  // `null` — « pas d'analyse » — jamais un écran cassé pendant une consultation.
  const contenu = ligne.content;
  if (typeof contenu !== "object" || contenu === null) return ok(null);
  const c = contenu as Record<string, unknown>;
  const note = c["noteStructuree"];
  if (typeof note !== "object" || note === null) return ok(null);
  const n = note as Record<string, unknown>;
  const champ = (v: unknown): string => (typeof v === "string" ? v : "");
  const liste = (v: unknown): readonly string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

  return ok({
    noteStructuree: {
      subjective: champ(n["subjective"]),
      objective: champ(n["objective"]),
      assessment: champ(n["assessment"]),
      plan: champ(n["plan"]),
    },
    evolution: liste(c["evolution"]),
    pointsNonExplores: liste(c["pointsNonExplores"]),
    analyseId: ligne.id,
    version: ligne.version,
    persistee: true,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// V2 — LE PANNEAU
// ═══════════════════════════════════════════════════════════════════════════

/** Les trois issues d'ADR-023, décidées par `_shared/routing.ts` côté serveur. */
export type CheminJarvis = "connaissance" | "patient" | "refus";

/**
 * Ce que la passerelle rend. `outil` est une PROPOSITION : le nom et les
 * arguments viennent du modèle et n'ont encore franchi aucune validation
 * stricte. C'est `jarvis-tools.validerArguments` qui décide s'ils existent.
 */
export type ReponseJarvis =
  | {
      readonly chemin: CheminJarvis;
      readonly type: "texte";
      readonly reponse: string;
      /** Présent sur le seul chemin connaissance — l'interface affiche le registre. */
      readonly registre?: "connaissance-generale";
    }
  | {
      readonly chemin: CheminJarvis;
      readonly type: "outil";
      readonly nom: string;
      readonly args: unknown;
    };

/**
 * Une question à Jarvis. Le ROUTAGE N'EST PAS FAIT ICI et ne doit jamais
 * l'être : il vit dans la passerelle, hors d'atteinte du navigateur. Un
 * classement décidé côté client serait modifiable depuis les outils de
 * développement — c'est-à-dire pas une frontière.
 */
export async function demanderAJarvis(
  message: string,
  conversationId: string,
  /**
   * Résultat du tour précédent — les identifiants que le modèle ne peut pas
   * deviner. Facultatif, et ignoré par la passerelle sur les chemins
   * CONNAISSANCE et REFUS : seul le chemin patient le lit.
   */
  /**
   * Les dossiers du tour précédent, EN CHAMPS. La passerelle masque `nom` et
   * `numero` par des jetons avant l'appel externe, puis compose le bloc et
   * réhydrate la réponse (arbitrage du 2026-08-13, branche b).
   *
   * ⚠️ CE N'EST PAS UNE FRONTIÈRE DE SÉCURITÉ, et ce commentaire existe pour
   * qu'on ne le croie pas : le message libre de l'utilisatrice part BRUT, avec
   * les noms qu'elle y écrit, et les UUID partent en clair. Ceci masque le seul
   * bloc que nous composons nous-mêmes. Réduction de l'exposition, pas
   * suppression.
   */
  contexteDossiers?: readonly {
    readonly id: string;
    readonly nom: string;
    readonly numero: string;
  }[],
  contextePraticienId?: string,
  /**
   * Patients V3 — le dossier OUVERT à l'écran, pré-résolution de CIBLE pour
   * les outils. Jamais une autorisation (L3) : la passerelle le traite comme
   * une donnée balisée pseudonymisée, et la RLS décide de tout le reste.
   */
  patientActif?: { readonly id: string; readonly nom: string; readonly numero: string },
): Promise<Result<ReponseJarvis>> {
  const result = await db().invokeFunction<ReponseJarvis>("jarvis-chat", {
    message,
    conversationId,
    ...(contexteDossiers === undefined || contexteDossiers.length === 0
      ? {}
      : { contexteDossiers, ...(contextePraticienId === undefined ? {} : { contextePraticienId }) }),
    ...(patientActif === undefined ? {} : { contextePatientActif: patientActif }),
  });

  if (!result.ok) {
    log.error("jarvis.chat", logFieldsFor(result.error));
    return err(result.error);
  }

  return ok(result.data);
}

// ═══════════════════════════════════════════════════════════════════════════
// V-JARVIS-CORE — LE FLUX
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Les cinq événements du protocole SSE de la passerelle (`jarvis-chat/index.ts`,
 * mode `flux`). CONTRAT ALIGNÉ SUR LE CODE SERVEUR DÉPLOYÉ — vérifié octet par
 * octet par `probe-sse-brut` après un premier désaccord (`v` vs `chemin`) qui
 * coûtait un écran muet :
 *   · chemin → clé `chemin` ; delta → clé `v` ; erreur → `code`+`message` ;
 *   · fin → `payload` (la RéponseJarvis COMPLÈTE, canonique) + `persiste`.
 * Le parseur rejette tout ce qui n'y entre pas : un champ renommé côté serveur
 * casse ici en erreur nommée, jamais en écran vide.
 */
export type EvenementFlux =
  | { readonly t: "chemin"; readonly chemin: CheminJarvis }
  | { readonly t: "delta"; readonly v: string }
  | { readonly t: "attente" }
  | {
      readonly t: "fin";
      /** La réponse canonique du SERVEUR — le client s'y réaligne. */
      readonly payload?: unknown;
      /** false = la persistance a échoué CÔTÉ SERVEUR ; l'écran le dit. */
      readonly persiste?: boolean;
    }
  | { readonly t: "erreur"; readonly code: string; readonly message: string };

/** Ce qu'un tour flux laisse derrière lui, quel que soit son dénouement. */
export interface TourFlux {
  /** Annoncé par le premier événement — null si la passerelle a échoué avant. */
  readonly chemin: CheminJarvis | null;
  /** Concat des deltas réellement reçus. Peut être partiel sur interruption. */
  readonly texte: string;
  /** Proposition d'outil (chemin patient) — JAMAIS validée ici. */
  readonly proposition: { readonly nom: string; readonly args: unknown } | null;
  /** L'ID conversation rendu par `fin` — fait foi pour la suite. */
  readonly conversationId: string | null;
  /** La porte 058 a-t-elle accepté l'écriture ? (absent sur interruption → false) */
  readonly persiste: boolean;
  /** Arrêté par l'utilisatrice avant `fin` : ce qui est reçu reste affiché. */
  readonly interrompu: boolean;
}

const DELAI_PREMIER_EVENEMENT_MS = 15_000;
const DELAI_INTER_FRAMES_MS = 15_000;

/**
 * Demande un tour EN FLUX. Les fragments arrivent via les rappels au fil de
 * l'eau ; la promesse se résout à la clôture avec le bilan du tour.
 *
 * Deux watchdogs, ni plus ni moins :
 *  · premier événement — la passerelle peut être morte avant ses en-têtes ;
 *  · entre frames — le silence total ne survit jamais 15 s : la passerelle
 *    émet `{t:"attente"}` pendant la réflexion modèle précisément pour
 *    alimenter ce chien. Un frame reçu réarme tout.
 *
 * Interruption (`signal`) ≠ panne : ce qui a déjà été reçu est rendu en SUCCÈS
 * avec `interrompu: true` — l'écran garde le texte affiché, exactement le
 * comportement demandé. La dégradation gracieuse (passerelle coupée au
 * streaming) est gérée dans le parseur : une réponse JSON non-SSE est lue
 * comme l'enveloppe historique.
 */
export async function demanderAJarvisEnFlux(
  params: {
    readonly message: string;
    readonly conversationId: string;
    /** Idempotence du tour — généré PAR LE CLIENT, unique par soumission. */
    readonly clientTurnId: string;
    readonly contextePatientActif?: { readonly id: string; readonly nom: string; readonly numero: string };
    /**
     * ═══ LES TROIS CHAMPS QUI RENDENT LA BOUCLE POSSIBLE ═══
     *
     * ⚠️ LEUR ABSENCE ÉTAIT LE DÉFAUT CENTRAL DE V-JARVIS-CORE. Le chemin flux
     * — le SEUL que l'interface emprunte — partait sans aucun contexte d'outil :
     * `contexteDossiers` existait dans `demanderAJarvis` (mode historique) et
     * n'a jamais été transmis ici. Le modèle ne pouvait donc rien apprendre du
     * tour précédent, et « parle-moi du prochain patient » était inatteignable
     * par construction, quelle que soit la qualité du modèle.
     *
     * ⚠️ CES TROIS CHAMPS SONT DÉJÀ ASSAINIS QUAND ILS ARRIVENT ICI. Ce fichier
     * est un TRANSPORT : il ne masque rien, ne vérifie rien, ne compose rien.
     * `preparerPourLeModele` a été appelé en amont, dans la boucle, et a levé
     * si quoi que ce soit d'identifiant subsistait. Ajouter une seconde
     * vérification ici donnerait deux vérités sur « ce qui est sûr », et celle
     * qui est trop laxiste gagnerait en silence.
     */
    readonly contexte?: unknown;
    /** Les résultats de capacité du tour, rebouclés vers le modèle. */
    readonly resultatsOutils?: readonly unknown[];
    /**
     * La description des capacités, composée depuis le REGISTRE
     * (`descriptionDesCapacites()`), jamais recopiée dans le prompt serveur.
     * Une liste écrite deux fois finit par décrire des outils qui n'existent
     * plus, et le modèle propose alors des appels que rien ne peut satisfaire.
     *
     * Ce n'est pas une frontière : ce que le modèle a le DROIT d'exécuter est
     * décidé par le registre côté client, par la RLS en base, et par
     * l'allowlist de 033 — jamais par ce texte.
     */
    readonly capacites?: string;
    /**
     * Un tour de conversation peut coûter plusieurs appels à la passerelle.
     * Chacun porte son propre `clientTurnId` — il le DOIT, sinon la contrainte
     * `UNIQUE(client_turn_id, role)` de 058 ferait taire toutes les réponses
     * sauf la première, et l'itération finale ne serait jamais écrite. Mais la
     * QUESTION n'a été posée qu'une fois : seule la première itération l'écrit.
     */
    readonly persisterDemande?: boolean;
  },
  rappels: {
    readonly onChemin?: (chemin: CheminJarvis) => void;
    readonly onDelta?: (fragment: string) => void;
  },
  signal?: AbortSignal,
): Promise<Result<TourFlux>> {
  const flux = await db().invokeFunctionStream("jarvis-chat", {
    message: params.message,
    conversationId: params.conversationId,
    clientTurnId: params.clientTurnId,
    mode: "flux",
    ...(params.contextePatientActif === undefined ? {} : { contextePatientActif: params.contextePatientActif }),
    ...(params.contexte === undefined ? {} : { contexte: params.contexte }),
    ...(params.resultatsOutils === undefined || params.resultatsOutils.length === 0
      ? {}
      : { resultatsOutils: params.resultatsOutils }),
    ...(params.capacites === undefined ? {} : { capacites: params.capacites }),
    ...(params.persisterDemande === undefined
      ? {}
      : { persisterDemande: params.persisterDemande }),
  }, signal);

  if (!flux.ok) return err(flux.error);

  let chemin: CheminJarvis | null = null;
  let texte = "";
  let proposition: TourFlux["proposition"] = null;
  // La conversation est connue du client AVANT l'appel (porte start) : la
  // passerelle ne renvoie pas d'identifiant dans `fin`.
  const conversationId: string | null = params.conversationId;
  let persiste = false;
  let finRecu = false;

  // ── Les deux chiens ──
  const controleur = new AbortController();
  const abandonnerExterne = () => controleur.abort();
  if (signal !== undefined) signal.addEventListener("abort", abandonnerExterne, { once: true });
  let minuteurPremier: ReturnType<typeof setTimeout> | undefined;
  let minuteurFrame: ReturnType<typeof setTimeout> | undefined;

  const rearmer = () => {
    if (minuteurPremier !== undefined) { clearTimeout(minuteurPremier); minuteurPremier = undefined; }
    if (minuteurFrame !== undefined) clearTimeout(minuteurFrame);
    minuteurFrame = setTimeout(() => controleur.abort(), DELAI_INTER_FRAMES_MS);
  };

  const traiter = (evenement: EvenementFlux): void => {
    switch (evenement.t) {
      case "chemin":
        chemin = evenement.chemin;
        rappels.onChemin?.(evenement.chemin);
        break;
      case "delta":
        texte += evenement.v;
        rappels.onDelta?.(evenement.v);
        break;
      case "attente":
        // Rien à afficher — il sert uniquement à réarmer le chien (déjà fait).
        break;
      case "fin": {
        finRecu = true;
        persiste = evenement.persiste === true;
        // Réalignement CANONIQUE sur la réponse du serveur : ce que le client
        // a accumulé en route n'est qu'un aperçu ; `payload.reponse` fait foi.
        if (estReponseJarvis(evenement.payload)) {
          chemin = evenement.payload.chemin;
          if (evenement.payload.type === "texte") {
            // Réalignement canonique silencieux ; l'aperçu en route reste
            // affiché tel quel jusqu'ici.
            texte = evenement.payload.reponse;
            proposition = null;
          } else {
            texte = "";
            proposition = { nom: evenement.payload.nom, args: evenement.payload.args };
          }
        }
        break;
      }
      case "erreur": {
        // La passerelle a nommé sa raison : elle devient notre erreur, sans
        // deviner davantage. Le message serveur n'est PAS affiché tel quel —
        // il pourrait porter du contenu modèle ; on classe, on traduit.
        throw new ErreurPasserelle(evenement.code);
      }
    }
  };

  try {
    const lecteur = flux.data.getReader();
    const decodeur = new TextDecoder();

    minuteurPremier = setTimeout(() => controleur.abort(), DELAI_PREMIER_EVENEMENT_MS);
    rearmer();

    let tampon = "";
    let premierMorceau = true;
    let repliJsonBrut = "";

    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      const morceau = decodeur.decode(value, { stream: true });

      // ── Dégradation gracieuse : enveloppe JSON historique ──
      // Passerelle déployée sans streaming (JARVIS_STREAMING=false) ou relais
      // ayant réécrit la réponse : le premier octet est `{`, pas un `data:`.
      // On accumule TOUT, on parse à la clôture, on mappe vers le même état
      // final que `fin`. Aucun fragment n'est perdu ni dupliqué.
      if (premierMorceau && morceau.trimStart().startsWith("{")) {
        repliJsonBrut += morceau;
        continue;
      }
      premierMorceau = false;

      tampon += morceau;
      let separateur: number;
      while ((separateur = tampon.indexOf("\n\n")) >= 0) {
        const brutEvenement = tampon.slice(0, separateur);
        tampon = tampon.slice(separateur + 2);
        for (const ligne of brutEvenement.split("\n")) {
          if (!ligne.startsWith("data:")) continue;
          const chargeUtile = ligne.slice(5).trim();
          if (chargeUtile === "") continue;
          let parse: unknown;
          try {
            parse = JSON.parse(chargeUtile);
          } catch {
            throw new ErreurPasserelle("sse-illisible");
          }
          if (!estEvenementFlux(parse)) throw new ErreurPasserelle("sse-inconnu");
          rearmer();
          traiter(parse);
        }
      }
    }

    // ── Interruption d'abord : la passerelle ferme son flux PROPREMENT dès
    // l'abort (req.signal Deno coupe la réponse) — le lecteur voit `done`,
    // pas une exception. Tester la troncature AVANT l'abandon classait donc
    // chaque Stop en panne (défaut trouvé par l'instrument N4).
    if (signal?.aborted && !finRecu) {
      return ok({ chemin, texte, proposition, conversationId, persiste: false, interrompu: true });
    }

    // Fin de flux SANS repli ni fin : corps tronqué — erreur nommée.
    if (!finRecu && repliJsonBrut === "") {
      // Silence interne (chien premier événement ou inter-frames) ?
      if (controleur.signal.aborted) {
        return err({
          code: "indisponible",
          message: fr.delaiDepasse,
          technical: "client:flux-silence",
          context: "jarvis:flux",
        });
      }
      return err({
        code: "indisponible",
        message: fr.erreurs["indisponible"],
        technical: "client:flux-tronque",
        context: "jarvis:flux",
      });
    }

    // ── Repli JSON : parse final + mapping ──
    if (repliJsonBrut !== "") {
      try {
        const enveloppe: unknown = JSON.parse(repliJsonBrut);
        if (
          typeof enveloppe === "object" && enveloppe !== null && "ok" in enveloppe &&
          (enveloppe as { ok?: unknown }).ok === true
        ) {
          const donnees = (enveloppe as { data?: unknown }).data;
          if (estReponseJarvis(donnees)) {
            persiste = false; // l'enveloppe historique ne persiste pas (pas de clientTurnId)
            chemin = donnees.chemin;
            if (donnees.type === "texte") {
              texte = donnees.reponse;
              rappels.onDelta?.(donnees.reponse);
            } else {
              proposition = { nom: donnees.nom, args: donnees.args };
            }
          } else {
            throw new ErreurPasserelle("enveloppe-illisible");
          }
        } else {
          const codeEdge =
            typeof enveloppe === "object" && enveloppe !== null && "error" in enveloppe &&
            typeof (enveloppe as { error?: { code?: unknown } }).error?.code === "string"
              ? (enveloppe as { error: { code: string } }).error.code
              : undefined;
          throw new ErreurPasserelle(codeEdge ?? "indisponible");
        }
      } catch (e) {
        if (e instanceof ErreurPasserelle) throw e;
        throw new ErreurPasserelle("enveloppe-illisible");
      }
    }

    if (signal?.aborted && !finRecu) {
      return ok({ chemin, texte, proposition, conversationId, persiste: false, interrompu: true });
    }

    if (!finRecu) {
      return err(offlineError());
    }

    return ok({ chemin, texte, proposition, conversationId, persiste, interrompu: false });
  } catch (cause) {
    // Interruption utilisateur : SUCCÈS partiel, jamais une erreur.
    if (signal?.aborted) {
      return ok({ chemin, texte, proposition, conversationId, persiste: false, interrompu: true });
    }
    if (cause instanceof ErreurPasserelle) {
      return err(erreurDepuisEnveloppeEdge(cause.code, "jarvis:flux"));
    }
    const appError = toAppError(cause, "jarvis:flux");
    log.error("jarvis.flux", logFieldsFor(appError));
    return err(appError);
  } finally {
    if (minuteurPremier !== undefined) clearTimeout(minuteurPremier);
    if (minuteurFrame !== undefined) clearTimeout(minuteurFrame);
    if (signal !== undefined) signal.removeEventListener("abort", abandonnerExterne);
    // Libère le socket si on sort sans avoir lu jusqu'à done (interruption).
    try { await flux.data.cancel(); } catch { /* déjà fermé */ }
  }
}

class ErreurPasserelle extends Error {
  constructor(readonly code: string) {
    super(`jarvis-flux:${code}`);
    this.name = "ErreurPasserelle";
  }
}

function estChemin(v: unknown): v is CheminJarvis {
  return v === "connaissance" || v === "patient" || v === "refus";
}

/** Garde-fou de FORME sur les événements SSE — rien de clinique ne passe ici. */
function estEvenementFlux(v: unknown): v is EvenementFlux {
  if (typeof v !== "object" || v === null) return false;
  const t = (v as { t?: unknown }).t;
  switch (t) {
    case "chemin": return estChemin((v as { chemin?: unknown }).chemin);
    case "delta": return typeof (v as { v?: unknown }).v === "string";
    case "attente": return true;
    case "fin": return true;
    case "erreur":
      return (
        typeof (v as { code?: unknown }).code === "string" &&
        typeof (v as { message?: unknown }).message === "string"
      );
    default:
      return false;
  }
}

/** Forme de la réponse historique, pour le repli dégradation gracieuse. */
function estReponseJarvis(v: unknown): v is ReponseJarvis {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  if (!estChemin(o["chemin"])) return false;
  if (o["type"] === "texte") return typeof o["reponse"] === "string";
  if (o["type"] === "outil") return typeof o["nom"] === "string";
  return false;
}
