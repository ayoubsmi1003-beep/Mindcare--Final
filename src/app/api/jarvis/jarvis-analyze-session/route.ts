/**
 * `jarvis-analyze-session` — l'entrée HTTP de l'unique outil Jarvis de S6.
 * `write: false` dans les deux specs (`03-JARVIS-TOOLS.md` §3,
 * `JARVIS-DEMO-SPEC.md` §2) : aucune carte de confirmation, aucune ligne
 * `jarvis_actions` — c'est ce qui rend ce périmètre tenable en une session.
 *
 * ⚠️ RÉPONSE TOUJOURS EN HTTP 200. Le corps est le SEUL contrat de succès/échec
 * — `{ ok: true, data }` ou `{ ok: false, error }`, même convention que
 * `Result<T>` côté client (`src/services/result.ts`). Un statut HTTP non-2xx
 * ferait dépendre le diagnostic du comportement de version de `supabase-js`
 * face à une erreur de fonction, qui a changé d'une release à l'autre ; le
 * corps, lui, ne bouge pas.
 */
import { clientSql } from "@/server/jarvis/client-sql";

import { echec, identite } from "../_commun";

import { z } from "zod";

import { assertSafe, BoundaryViolation, pseudonymize, rehydrate } from "@/server/jarvis/pseudonymize";
import { llm, resolveModel } from "@/server/egress/external-call";
import { empreinteTexte, getPromptHash, PROMPT_VERSION, SYSTEM_PROMPT_V1 } from "./prompt";
import {
  assemblerContexteSeance,
  formaterDonneesStructurees,
  formaterHistoriqueNotes,
  type NoteHistorique,
  type SourceBrute,
} from "@/server/jarvis/contexte-seance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Budget de tokens (§3.4 n°4) — désormais dans `_shared/contexte-seance.ts`.
//
// ⚠️ L'ANCIENNE TRONCATURE COUPAIT PAR LA FIN, ET C'ÉTAIT LE MAUVAIS SENS. Dans
// une note clinique, la fin porte l'évaluation et le plan — ce que la
// praticienne a DÉCIDÉ. Garder les six premiers milliers de caractères et jeter
// la conclusion produisait un résumé sans décision, sur une note longue.
// L'assemblage coupe maintenant par le DÉBUT, source par source, et dit ce
// qu'il a omis.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Validation étendue (§3.4 n°6) — au-delà de la forme.
// ---------------------------------------------------------------------------
const MAX_ENTREES = 12;
const MAX_LONGUEUR_ENTREE = 400;

const ReponseSchema = z.object({
  noteStructuree: z.object({
    subjective: z.string(),
    objective: z.string(),
    assessment: z.string(),
    plan: z.string(),
  }),
  evolution: z.array(z.string().max(MAX_LONGUEUR_ENTREE)).max(MAX_ENTREES),
  pointsNonExplores: z.array(z.string().max(MAX_LONGUEUR_ENTREE)).max(MAX_ENTREES),
});

type ReponseValidee = z.infer<typeof ReponseSchema>;

function deduplique(entrees: readonly string[]): readonly string[] {
  const vues = new Set<string>();
  const resultat: string[] = [];
  for (const entree of entrees) {
    const cle = entree.trim().toLowerCase();
    if (cle === "" || vues.has(cle)) continue;
    vues.add(cle);
    resultat.push(entree.trim());
  }
  return resultat;
}

/**
 * Retire un bloc de code Markdown (```json ... ``` ou ``` ... ```) qui
 * envelopperait la réponse.
 *
 * ⚠️ TROUVÉ EN VÉRIFICATION LOCALE, PAS EN RELECTURE. Le prompt système
 * demande une réponse « STRICTEMENT en JSON, sans aucun texte avant ou
 * après » — le modèle l'a quand même enveloppée dans une clôture de code au
 * premier appel réel constaté. Sans ce nettoyage, un JSON par ailleurs
 * PARFAITEMENT VALIDE et cliniquement correct échouait au parsing, brûlait la
 * seule reformulation autorisée (§3.4 n°9), puis renvoyait « Assistant
 * indisponible » — l'échec le plus coûteux qui soit : un vrai résultat, jeté.
 * Ne PAS élargir au-delà de cette forme précise : accepter n'importe quel
 * texte autour du JSON reviendrait à abandonner la contrainte de forme que le
 * prompt impose.
 */
function retirerCloture(texte: string): string {
  const nettoye = texte.trim();
  const motif = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const trouve = motif.exec(nettoye);
  return trouve?.[1] !== undefined ? trouve[1].trim() : nettoye;
}

/**
 * Rend `null` si la réponse ne satisfait pas les règles cliniques, même quand
 * le JSON est syntaxiquement valide. `null` déclenche la reformulation unique
 * de l'appelant (§3.4 n°9) — jamais une boucle.
 */
function validerEtNettoyer(brut: string): ReponseValidee | null {
  let json: unknown;
  try {
    json = JSON.parse(retirerCloture(brut));
  } catch {
    return null;
  }

  const analyse = ReponseSchema.safeParse(json);
  if (!analyse.success) return null;

  const donnees = analyse.data;

  // Chaque point non exploré DOIT être une question — c'est la seule garantie
  // que « ce n'est qu'une question » (§9.2, jamais une conclusion).
  if (donnees.pointsNonExplores.some((p) => !p.trim().endsWith("?"))) return null;

  const evolution = deduplique(donnees.evolution);
  const pointsNonExplores = deduplique(donnees.pointsNonExplores);

  const noteVide =
    donnees.noteStructuree.subjective.trim() === "" &&
    donnees.noteStructuree.objective.trim() === "" &&
    donnees.noteStructuree.assessment.trim() === "" &&
    donnees.noteStructuree.plan.trim() === "";

  // Rien à montrer sur les trois blocs = échec, pas une case vide légitime.
  if (noteVide && evolution.length === 0 && pointsNonExplores.length === 0) return null;

  // ⚠️ COPIE EXPLICITE — second décalage de types révélé par le portage.
  // `deduplique()` rend `readonly string[]`, alors que le type inféré de
  // `ReponseSchema` (zod) attend `string[]`. Deno ne type-vérifiait pas ce
  // fichier, donc l'incohérence n'a jamais été signalée. On copie plutôt que
  // d'élargir le schéma : la valeur rendue redevient mutable comme son type le
  // promet, et rien d'autre ne bouge.
  return {
    noteStructuree: donnees.noteStructuree,
    evolution: [...evolution],
    pointsNonExplores: [...pointsNonExplores],
  };
}

// ---------------------------------------------------------------------------
// Lignes attendues des deux portes lues — mêmes noms que côté client S5/S6.
// ---------------------------------------------------------------------------
interface ConsultationRow {
  readonly patient_id: string | null;
  readonly raw_notes: string | null;
  readonly first_name: string | null;
  readonly last_name: string | null;
  readonly record_number: string | null;
}

interface PreviousNoteRow {
  readonly started_at: string;
  readonly note_status: string | null;
  readonly subjective: string | null;
  readonly objective: string | null;
  readonly assessment: string | null;
  readonly plan: string | null;
}

interface CorpsRequete {
  readonly consultationId: string;
}

function estCorpsValide(valeur: unknown): valeur is CorpsRequete {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as { consultationId?: unknown }).consultationId === "string" &&
    (valeur as { consultationId: string }).consultationId.length > 0
  );
}

export async function POST(req: Request): Promise<Response> {
  const userId = await identite();
  if (userId === null) return echec("non-authentifie", "Assistant indisponible.");

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return echec("requete-invalide", "Requête invalide.");
  }
  if (!estCorpsValide(corps)) {
    return echec("requete-invalide", "Requête invalide.");
  }

  // ── Étape 2 : client scopé au JWT de l'appelant — JAMAIS le service role. ──
  // La RLS s'applique exactement comme un appel direct depuis le navigateur
  // (L3, `03-JARVIS-TOOLS.md` §1 : « Jarvis hérite des permissions de la
  // praticienne connectée, n'élève jamais »). `db: { schema: "app" }` reprend
  // la convention historique de l'adaptateur (le fichier `db/supabase.ts`
  // n'existe plus depuis la migration pg locale, ADR-001).
  // `userId` vient du cookie de session, jamais du corps : les portes voient
  // `auth.uid()` et la RLS arbitre exactement comme pour un appel direct
  // depuis le navigateur.
  const client = clientSql(userId);

  const { data: consultationRows, error: erreurConsultation } = await client.rpc("get_consultation", {
    p_id: corps.consultationId,
  });
  if (erreurConsultation !== null) {
    return echec("indisponible", "Assistant indisponible.");
  }

  const consultation = (consultationRows as readonly ConsultationRow[] | null)?.[0];
  const patientId = consultation?.patient_id ?? null;
  const rawNotes = consultation?.raw_notes ?? null;

  // ── Étape 3 : sans patient ou sans notes, pas d'appel LLM sur du vide. ──
  if (patientId === null || rawNotes === null || rawNotes.trim() === "") {
    return echec("regle-metier", "Aucune note à analyser pour cette séance.");
  }

  const { data: previousRows } = await client.rpc("get_previous_note", {
    p_patient_id: patientId,
    p_excluding_consultation_id: corps.consultationId,
  });
  const precedente = (previousRows as readonly PreviousNoteRow[] | null)?.[0] ?? null;

  // ── Le dossier structure : diagnostics, echelles, derniere prescription. ──
  //
  // AVANT CETTE LECTURE, L'ANALYSE ETAIT AVEUGLE AU DOSSIER. Elle ne voyait que
  // les notes du jour et UNE note precedente : ni diagnostic enregistre, ni
  // score d'echelle, ni traitement. Le resume produit etait coherent avec ce
  // qu'on lui avait montre, et muet sur tout le reste.
  //
  // On passe par la porte `get_patient_workspace` -- jamais un SELECT direct
  // (regle 6) : c'est elle qui journalise la lecture du dossier et qui applique
  // `can_see_clinical`. Un echec ici n'interrompt PAS l'analyse : mieux vaut un
  // resume fonde sur les notes seules qu'aucun resume, a condition de ne rien
  // affirmer sur ce qu'on n'a pas lu.
  let donneesStructurees: string | null = null;
  const { data: workspace, error: erreurWorkspace } = await client.rpc("get_patient_workspace", {
    p_id: patientId,
  });
  if (erreurWorkspace === null && workspace !== null && typeof workspace === "object") {
    const w = workspace as { clinique?: unknown; traitements?: unknown };
    donneesStructurees = formaterDonneesStructurees(w.clinique ?? null, w.traitements ?? null);
  }

  // -- L'historique COMPLET des notes de la praticienne (migration 065). --
  //
  // AVANT CETTE LECTURE, L'ANALYSE NE VOYAIT QU'UN SEUL PAS EN ARRIERE.
  // `get_previous_note` (027) rend la consultation precedente, et elle repond
  // correctement a SA question. Mais un changement de traitement decide il y a
  // trois seances, ou une plainte qui revient a six mois d'intervalle, ne
  // l'atteignaient jamais.
  //
  // La porte 065 est paginee et plafonnee A 50 LIGNES COTE SERVEUR ; la
  // POLITIQUE de selection -- combien de notes, lesquelles, dans quel ordre --
  // reste dans `formaterHistoriqueNotes`, donc en code deterministe eprouvable
  // hors ligne. Un echec ici n'interrompt pas l'analyse : on retombe sur la
  // note precedente seule, et le modele est informe de ce qu'il n'a pas vu.
  let historique: string | null = null;
  // Compté pour `source_state` : combien de séances antérieures ont nourri
  // cette analyse. C'est une donnée d'audit — un nombre, jamais un contenu.
  let nbNotesHistorique = 0;
  const { data: notesRows, error: erreurNotes } = await client.rpc(
    "get_patient_notes_history",
    {
      p_patient_id: patientId,
      p_excluding_consultation_id: corps.consultationId,
      p_limit: 20,
      p_before: null,
    },
  );
  if (erreurNotes === null && Array.isArray(notesRows) && notesRows.length > 0) {
    historique = formaterHistoriqueNotes(notesRows as readonly NoteHistorique[]).texte;
    nbNotesHistorique = notesRows.length;
  }

  // ── Etape 4 : assemblage par PRESEANCE, budget borne, troncature DITE. ──
  //
  // L'ordre n'est plus une consigne de prompt mais une propriete du code :
  // notes finalisees > donnees structurees > transcription > longitudinal.
  // Voir `_shared/contexte-seance.ts`, et `scripts/eval-contexte-seance.mjs`
  // qui l'eprouve hors ligne.
  const noteAnterieure = precedente
    ? [precedente.subjective, precedente.objective, precedente.assessment, precedente.plan]
        .filter((champ) => champ !== null && champ.trim() !== "")
        .join("\n")
    : null;

  const sources: readonly SourceBrute[] = [
    {
      type: "notes-finalisees",
      libelle: "Notes de la praticienne pour la seance en cours",
      contenu: rawNotes,
    },
    {
      type: "donnees-structurees",
      libelle: "Donnees cliniques enregistrees au dossier",
      contenu: donneesStructurees,
    },
    {
      type: "contexte-longitudinal",
      // L'historique complet quand la porte 065 a repondu ; a defaut, la seule
      // note precedente de 027. Le libelle DIT laquelle des deux est en jeu :
      // annoncer un historique quand on n'a qu'une note serait un mensonge sur
      // l'etendue de ce qui a ete lu.
      libelle:
        historique !== null
          ? "Historique des notes de la praticienne"
          : "Consultation precedente",
      contenu: historique ?? noteAnterieure,
    },
  ];

  const contexte = assemblerContexteSeance(sources);

  const identites = [consultation?.first_name, consultation?.last_name, consultation?.record_number].filter(
    (v): v is string => typeof v === "string" && v.trim() !== "",
  );

  // ── Étape 5 : pseudonymisation, prompt anti-injection. ──
  const blocDonnees = ["<donnees_patient>", contexte.bloc, "</donnees_patient>"].join("\n");

  const { texte: bloqueSans, map } = pseudonymize(blocDonnees, identites);

  try {
    assertSafe(bloqueSans, identites);
  } catch (cause) {
    if (cause instanceof BoundaryViolation) {
      return echec("frontiere", "Assistant indisponible.");
    }
    throw cause;
  }

  const promptHash = await getPromptHash();
  const sessionToken = crypto.randomUUID();

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT_V1 },
    { role: "user" as const, content: bloqueSans },
  ];

  // ── Étape 6 : appel, validation, UNE reformulation maximum (§3.4 n°9). ──
  // `signal: req.signal` — l'annulation remonte jusqu'au fetch fournisseur :
  // un écran qui timeout, une navigation ou une analyse supersédée coupe
  // vraiment la génération (et son coût), au lieu de la laisser finir dans
  // le vide. Une issue interrompue reste une erreur nommée côté client.
  const premierAppel = await llm({
    purpose: "jarvis",
    promptVersion: PROMPT_VERSION,
    promptHash,
    messages,
    sessionToken,
    signal: req.signal,
  });

  if (!premierAppel.ok) {
    return echec(premierAppel.error.code, premierAppel.error.message);
  }

  let validee = validerEtNettoyer(premierAppel.data);

  if (validee === null) {
    // Même abandon sur la reformulation : un client déjà parti ne doit pas
    // payer un second appel modèle pour une réponse que personne ne lira.
    const reformulation = await llm({
      purpose: "jarvis",
      promptVersion: PROMPT_VERSION,
      promptHash,
      sessionToken,
      signal: req.signal,
      messages: [
        ...messages,
        { role: "user" as const, content: "Le format n'était pas respecté. Réponds STRICTEMENT au format JSON demandé, sans aucun texte hors du JSON." },
      ],
    });

    if (!reformulation.ok) {
      return echec(reformulation.error.code, reformulation.error.message);
    }
    validee = validerEtNettoyer(reformulation.data);
  }

  if (validee === null) {
    return echec("indisponible", "Assistant indisponible.");
  }

  // ── Réhydratation — les jetons redeviennent les identités d'origine. ──
  const resultat = {
    noteStructuree: {
      subjective: rehydrate(validee.noteStructuree.subjective, map),
      objective: rehydrate(validee.noteStructuree.objective, map),
      assessment: rehydrate(validee.noteStructuree.assessment, map),
      plan: rehydrate(validee.noteStructuree.plan, map),
    },
    evolution: validee.evolution.map((e) => rehydrate(e, map)),
    pointsNonExplores: validee.pointsNonExplores.map((p) => rehydrate(p, map)),
  };

  // ═══ PERSISTANCE — LE CHAÎNON QUI MANQUAIT (067) ═══
  //
  // Jusqu'ici, l'analyse était RENDUE et rien de plus : elle vivait dans l'état
  // React de l'écran. Fermer la consultation la perdait, le dossier n'en
  // gardait rien, et le résumé du cas ne pouvait pas la consommer — il
  // n'existait aucune mémoire longitudinale de ce que l'assistant avait
  // compris d'une séance.
  //
  // ⚠️ ON ÉCRIT LE TEXTE RÉHYDRATÉ, PAS LE TEXTE À JETONS. Ce qui est rangé
  // dans la base est du contenu clinique lisible par la praticienne ; la
  // pseudonymisation ne protège que le TRAJET vers le fournisseur, elle n'a
  // aucune raison d'être dans le dossier. Ranger les jetons rendrait l'analyse
  // illisible dès que la table de correspondance a disparu — c'est-à-dire
  // immédiatement, puisqu'elle ne quitte jamais cette requête.
  //
  // ⚠️ ET L'ÉCHEC D'ÉCRITURE NE DOIT PAS FAIRE PERDRE L'ANALYSE. La
  // praticienne l'a sous les yeux : la lui retirer parce qu'une écriture
  // dérivée a échoué serait pire que de ne pas l'avoir persistée. On la rend
  // avec `persistee: false`, l'écran le dit, et la relance reste possible.
  // La note clinique, elle, n'a jamais dépendu de cet appel (règle : aucune
  // panne IA ne bloque la documentation).
  const empreinteNotes = await empreinteTexte(rawNotes);
  const etatSource = {
    notes_hash: empreinteNotes,
    notes_longueur: rawNotes.length,
    historique_notes: nbNotesHistorique,
  };

  let analyseId: string | null = null;
  let version: number | null = null;
  const { data: enregistreeRows, error: erreurEnregistrement } = await client.rpc(
    "save_session_analysis",
    {
      p_consultation_id: corps.consultationId,
      p_content: JSON.stringify(resultat),
      p_source_state: JSON.stringify(etatSource),
      // Le modèle RÉELLEMENT résolu par la passerelle, pas une copie de sa
      // chaîne de repli : l'audit doit nommer ce qui a servi.
      p_model: resolveModel(),
      p_prompt_version: PROMPT_VERSION,
      p_prompt_hash: promptHash,
    },
  );
  if (erreurEnregistrement !== null) {
    // Le message des `RAISE` de 067 est écrit par nous et ne contient aucune
    // donnée patient — que des noms de champs.
    console.error(JSON.stringify({
      event: "analyse.enregistrementRefuse",
      code: erreurEnregistrement.code ?? null,
      message: erreurEnregistrement.message,
    }));
  } else {
    const ligne = (enregistreeRows as ReadonlyArray<Record<string, unknown>> | null)?.[0];
    if (ligne !== undefined) {
      analyseId = typeof ligne["id"] === "string" ? ligne["id"] : null;
      version = typeof ligne["version"] === "number" ? ligne["version"] : null;
    }
  }

  // SA-03 — la portée longitudinale voyage avec le résultat (des comptes,
  // jamais du contenu) : l'écran dit explicitement sur quoi l'analyse est
  // fondée, au lieu de laisser croire à un historique complet. La même
  // donnée est persistée (`source_state`, 067) et relue par `chargerAnalyse`.
  const sourcesPortee = { historiqueNotes: nbNotesHistorique };

  return new Response(
    JSON.stringify({
      ok: true,
      data: {
        ...resultat,
        analyseId,
        version,
        persistee: analyseId !== null,
        sources: sourcesPortee,
      },
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    },
  );
}