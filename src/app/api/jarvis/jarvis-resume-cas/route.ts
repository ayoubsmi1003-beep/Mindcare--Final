/**
 * `jarvis-resume-cas` — génération du Résumé du cas.
 *
 * ⚠️ L'IA NE BLOQUE JAMAIS L'ÉCRAN : cette fonction est appelée APRÈS le
 * rendu du workspace, sur geste explicite (« Générer / Actualiser »). En cas
 * d'échec, l'écran garde l'ancien résumé ou affiche le Point de situation —
 * jamais une page cassée.
 *
 * Chemin de vérité (deux barrières) :
 *   1 · `_shared/resume-cas.ts` filtre les citations contre les faits réels ;
 *   2 · `app.save_case_summary` REFUSE en base toute citation non vérifiée.
 *
 * Aucune identité patient ne sort : les champs identitaires sont retirés de
 * la charge, et `pseudonymize`+`assertSafe` verrouillent ce qui reste.
 */

import { clientSql } from "@/server/jarvis/client-sql";
import { env } from "@/server/env";

import { echec, identite } from "../_commun";

import { assertSafe, BoundaryViolation, pseudonymize } from "@/server/jarvis/pseudonymize";
import { llm } from "@/server/egress/external-call";
import {
  adapterEspace,
  analyserEspacePorte,
  analysesAnterieures,
  etatSource,
  identitesDuDossier,
} from "@/server/jarvis/contrat-workspace";
import { construireCandidats } from "@/server/jarvis/resume-cas";
import {
  assemblerSchema2,
  construireApercu,
  idsAutorisesDuContexte,
} from "@/server/jarvis/resume-chronologie";
import { getPromptHash, PROMPT_VERSION, SYSTEM_PROMPT_RESUME } from "./prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CorpsRequete {
  readonly patientId: string;
}

function estCorpsValide(valeur: unknown): valeur is CorpsRequete {
  return (
    typeof valeur === "object" &&
    valeur !== null &&
    typeof (valeur as { patientId?: unknown }).patientId === "string" &&
    (valeur as { patientId: string }).patientId.length > 0
  );
}

/** Retire une clôture Markdown éventuelle (leçon jarvis-analyze-session). */
function retirerCloture(texte: string): string {
  const nettoye = texte.trim();
  const motif = /^```(?:json)?\s*\n([\s\S]*?)\n?```$/i;
  const trouve = motif.exec(nettoye);
  return trouve?.[1] !== undefined ? trouve[1].trim() : nettoye;
}

export async function POST(req: Request): Promise<Response> {
  const userId = await identite();
  if (userId === null) return echec("non-authentifie", "Résumé indisponible.");

  let corps: unknown;
  try {
    corps = await req.json();
  } catch {
    return echec("requete-invalide", "Requête invalide.");
  }
  if (!estCorpsValide(corps)) {
    return echec("requete-invalide", "Requête invalide.");
  }

  // Client scopé à l'identité de l'appelante — L3 : Jarvis n'élève jamais.
  // `userId` vient du cookie de session, jamais du corps de la requête : les
  // portes voient donc `auth.uid()` et la RLS arbitre comme avant.
  const client = clientSql(userId);

  // ── Lecture par LA PORTE auditée (trace « fiche », RLS de l'appelante). ──
  const { data: wsRows, error: erreurWs } = await client.rpc("get_patient_workspace", {
    p_id: corps.patientId,
  });
  if (erreurWs !== null) {
    return echec("indisponible", "Résumé indisponible.");
  }
  // ⚠️ get_patient_workspace retourne un jsonb SCALAIRE (047/057) : PostgREST
  // livre donc un OBJET directement — le lire comme un tableau rendait
  // `espace` indéfini et refusait chaque dossier avant tout appel LLM.
  // Tolérance tableau conservée : elle ne peut rien ouvrir de plus.
  // `wsRows` est déjà `unknown` : `ReponseRpc<T = unknown>` ne prétend rien
  // sur la forme, et c'est le typage honnête pour une porte SQL.
  const chargeWs: unknown = wsRows;
  // ⚠️ TYPÉ COMME LA PORTE L'ÉMET (snake_case), et surtout PAS comme la forme
  // interne : c'est ce faux typage qui rendait le décalage invisible au
  // compilateur. La traduction est explicite, plus bas.
  const espace = (Array.isArray(chargeWs) ? chargeWs[0] : chargeWs) as
    | Record<string, unknown>
    | null
    | undefined;

  // Introuvable OU hors périmètre OU rôle sans clinique : même réponse.
  if (
    espace === null ||
    espace === undefined ||
    espace["clinique"] === null ||
    typeof espace["identite"] !== "object"
  ) {
    return echec("regle-metier", "Ce dossier n'ouvre pas de résumé.");
  }

  // ── LA FRONTIÈRE, EN UN SEUL POINT (voir `_shared/contrat-workspace.ts`). ──
  // La porte émet du snake_case ; tout ce qui suit consomme la forme interne.
  // Avant cette adaptation, les trois lectures ci-dessous se trompaient de
  // convention EN SILENCE : aucun signal d'échelle ni de prescription, un
  // « aucun rendez-vous à venir » FAUX, des compteurs à null qui rendaient la
  // péremption incalculable, et une liste d'identités vide qui laissait
  // `assertSafe()` chercher dans le vide.
  const forme = analyserEspacePorte(espace);
  if (!forme.success) {
    // On ne devine pas une charge dont la forme a changé : on refuse, et le
    // journal porte les CHEMINS fautifs — jamais les valeurs (règle 1).
    console.error(JSON.stringify({
      event: "resume.contratWorkspace",
      chemins: forme.chemins,
    }));
    return echec("indisponible", "Résumé indisponible.");
  }

  // ⚠️ UNE SEULE TRADUCTION, RÉUTILISÉE PAR TOUS LES CONSOMMATEURS INTERNES.
  // Adapter à un seul point d'appel et laisser l'autre lire la charge brute a
  // produit un 500 en production : `validerContenuResume` teste
  // `derniereConsultation !== null`, or sur la charge de la porte ce champ vaut
  // `undefined` — le test passe, et le `.id` qui suit lève. Le compilateur ne
  // pouvait rien voir : `supabase/functions/` est hors de tout tsconfig.
  const espaceInterne = adapterEspace(espace);

  // ── Candidats déterministes (≤5) + empreinte des faits couverts. ──
  const { candidats, total } = construireCandidats(espaceInterne);

  const sourceState = etatSource(espace);

  // ═══ LA MÉMOIRE LONGITUDINALE (067) ═══
  //
  // C'est ici que la chaîne se ferme : consultation → analyse persistée →
  // résumé du cas. Jusqu'à la migration 067, l'analyse de séance mourait dans
  // l'état de l'écran et n'avait AUCUN chemin vers le résumé — les deux
  // fonctionnalités s'ignoraient.
  //
  // ⚠️ ON LIT DES RÉSUMÉS DE SÉANCE, JAMAIS 36 NOTES BRUTES. Chaque analyse a
  // déjà condensé sa séance au moment où elle était fraîche ; le coût du
  // contexte est donc borné par le nombre d'analyses relues, pas par
  // l'ancienneté du dossier. C'est ce qui permet à un dossier de trois ans de
  // tenir dans le même budget qu'un dossier de trois mois.
  //
  // Un échec n'interrompt rien : le résumé se génère alors sur les seules
  // données structurées, comme avant. Une mémoire absente appauvrit la
  // synthèse ; elle ne doit pas la supprimer.
  const { data: analysesRows } = await client.rpc("get_recent_session_analyses", {
    p_patient_id: corps.patientId,
    p_limit: 5,
  });
  const analyses = analysesAnterieures(analysesRows);

  // Les séances analysées sont citables PAR LEUR CONSULTATION — un domaine que
  // la porte 053 valide déjà. La praticienne peut donc remonter du résumé à la
  // séance d'origine, sans qu'aucune migration n'ait été nécessaire.
  const idsAnalyses = new Set(analyses.map((a) => a.consultationId));

  // ═══ LE CONTEXTE LONGITUDINAL STRATIFIÉ (068) ═══
  //
  // `build_case_context` rend un socle déterministe, les 6 dernières séances
  // détaillées, et TOUT le reste agrégé par année. C'est ce qui permet à un
  // dossier de 50 séances de tenir dans 11 Ko (mesuré :
  // `scripts/checkpoint-longitudinal.sql`) au lieu de plus de 100 Ko de notes
  // brutes — et le coût ne croît plus avec l'ancienneté du dossier.
  const { data: contexteRows, error: erreurContexte } = await client.rpc("build_case_context", {
    p_id: corps.patientId,
  });
  if (erreurContexte !== null) {
    return echec("indisponible", "Résumé indisponible.");
  }
  const contexte = (Array.isArray(contexteRows) ? contexteRows[0] : contexteRows) as
    | Record<string, unknown>
    | null;
  const socle = contexte?.["socle"] ?? null;

  // ⚠️ L'APERÇU EST DÉTERMINISTE — voir `resume-chronologie.ts`. Nom, âge,
  // résidence, diagnostics et posologies sont RECOPIÉS du socle SQL. Les faire
  // rédiger par le modèle aurait été plus court à écrire et indéfendable : une
  // posologie approximative en tête d'un dossier de psychiatrie n'est pas une
  // imprécision, c'est une donnée fictive (règle 8).
  const apercu = construireApercu(socle);
  if (apercu === null) {
    return echec("regle-metier", "Ce dossier n'ouvre pas de résumé.");
  }

  // Les identifiants citables viennent de la PORTE, pas d'une reconstitution
  // côté passerelle : la base revalidera exactement la même liste (069).
  const idsCitables = idsAutorisesDuContexte(contexte);
  for (const id of idsAnalyses) idsCitables.add(id);

  // ── Charge SANS identité patient : zéro Tier-0 chez le fournisseur. ──
  const charge = {
    // Le socle part AUSSI au modèle : il ne le rédige pas, mais il doit le
    // connaître pour ne pas répéter dans le récit ce que l'aperçu porte déjà.
    socle,
    // Les 6 dernières séances, extraits tronqués EN BASE, avec leur analyse.
    seances_recentes: contexte?.["recentes"] ?? [],
    // Les années antérieures, agrégées — une ligne par année, pas 44 séances.
    annees_anterieures: contexte?.["anterieures"] ?? [],
    // Les faits déjà condensés séance par séance (067).
    seances_analysees: analyses.map((a) => ({
      consultation_id: a.consultationId,
      date: a.date,
      evaluation: a.assessment,
      plan: a.plan,
      evolution: a.evolution,
    })),
    // Signaux DÉTERMINISTES conservés du schéma 1 : ils ne sont pas rédigés
    // par le modèle et valent d'être posés à l'écran tels quels.
    signaux_possibles: candidats.map((c) => ({
      cle: c.cle,
      libelle: c.libelle,
      sources: c.sources,
    })),
    consignes: {
      total_signaux: total,
    },
  };

  // ⚠️ MÊME FRONTIÈRE, ET C'EST ICI QU'ELLE COMPTE LE PLUS. Cette liste était
  // TOUJOURS VIDE (`firstName` contre `first_name`) : `pseudonymize()` n'avait
  // rien à masquer et `assertSafe()` rien à chercher. Le filet de la règle 1
  // était tendu sur du vide et déclarait « conforme » à chaque appel.
  // Les identités viennent du SOCLE, qui porte les mêmes clés snake_case que
  // le workspace. Voir le motif complet dans `contrat-workspace.ts`.
  const identites = identitesDuDossier({ identite: (socle as Record<string, unknown> | null)?.["identite"] });

  const blocDonnees = [
    "<<<DONNEES_DOSSIER>>>",
    JSON.stringify(charge),
    "<<<FIN_DONNEES_DOSSIER>>>",
  ].join("\n");

  const { texte: bloqueSans, map } = pseudonymize(blocDonnees, identites);
  try {
    assertSafe(bloqueSans, identites);
  } catch (cause) {
    if (cause instanceof BoundaryViolation) {
      return echec("frontiere", "Résumé indisponible.");
    }
    throw cause;
  }

  const promptHash = await getPromptHash();
  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT_RESUME },
    {
      role: "system" as const,
      content:
        "Date du jour (Africa/Algiers) : " +
        new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Algiers", dateStyle: "long" }).format(
          new Date(),
        ),
    },
    { role: "user" as const, content: bloqueSans },
  ];

  const modele = env().OPENROUTER_MODEL ?? "google/gemini-2.5-flash";

  const premier = await llm({
    purpose: "resume-cas",
    promptVersion: PROMPT_VERSION,
    promptHash,
    sessionToken: crypto.randomUUID(),
    messages,
  });
  if (!premier.ok) {
    return echec(premier.error.code, premier.error.message);
  }

  let brut: unknown;
  try {
    brut = JSON.parse(retirerCloture(premier.data));
  } catch {
    brut = null;
  }
  let contenu = assemblerSchema2(apercu, brut, idsCitables);

  if (contenu === null) {
    const reformulation = await llm({
      purpose: "resume-cas",
      promptVersion: PROMPT_VERSION,
      promptHash,
      sessionToken: crypto.randomUUID(),
      messages: [
        ...messages,
        {
          role: "user" as const,
          content:
            "Le format n'était pas respecté. Réponds STRICTEMENT avec l'objet JSON demandé, sans texte hors du JSON.",
        },
      ],
    });
    if (!reformulation.ok) {
      return echec(reformulation.error.code, reformulation.error.message);
    }
    try {
      brut = JSON.parse(retirerCloture(reformulation.data));
    } catch {
      brut = null;
    }
    contenu = assemblerSchema2(apercu, brut, idsCitables);
  }

  if (contenu === null) {
    return echec("indisponible", "Résumé indisponible.");
  }

  // ── Écriture par LA PORTE (versions monotones, citations revérifiées). ──
  const { data: sauvegardeRows, error: erreurSauvegarde } = await client.rpc(
    "save_case_summary",
    {
      p_patient_id: corps.patientId,
      p_content: JSON.stringify(contenu),
      p_source_state: JSON.stringify(sourceState),
      p_model: modele,
      p_prompt_version: PROMPT_VERSION,
      p_prompt_hash: promptHash,
    },
  );
  if (erreurSauvegarde !== null) {
    // ⚠️ LA PORTE REFUSE, ET IL FAUT SAVOIR POURQUOI. Sans cette trace, un
    // refus légitime (le modèle a cité une référence inexistante — la double
    // barrière fait son travail) est indiscernable d'un défaut de forme dans
    // notre propre charge. Les deux rendaient le même écran, et c'est ce qui a
    // fait chercher au mauvais endroit.
    // Le message des `RAISE` de 053/055 est écrit par NOUS et ne contient
    // aucune donnée patient — que des noms de sections et de domaines.
    console.error(JSON.stringify({
      event: "resume.sauvegardeRefusee",
      code: erreurSauvegarde.code ?? null,
      message: erreurSauvegarde.message,
    }));
    return echec("regle-metier", "Le résumé a été refusé par une règle du dossier.");
  }
  const resume = (sauvegardeRows as ReadonlyArray<unknown> | null)?.[0];
  if (resume === undefined || resume === null) {
    return echec("regle-metier", "Ce dossier n'ouvre pas de résumé.");
  }

  return new Response(
    JSON.stringify({
      ok: true,
      data: { resume, totalSignaux: total, plafondSignaux: candidats.length },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}