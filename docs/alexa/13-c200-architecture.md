# 13 — Alexa : architecture de compréhension (livrable A)

Branche `claude/alexa-clinical-conversational-ai-97e2d6`, partie de `claude/alexa-intelligence-transformation-9fc1d1` (152e806).
Aucune poussée, aucune fusion, aucune construction de l'application Windows. Français uniquement (consigne du 2026-11-08).

## 1. Ce qui n'a pas changé

`/api/alexa/turn` → `runAlexa` → pré-routeur déterministe → constructeurs `direct*` (`agent-loop.ts`) → modèle MiniCPM 1B seulement en
dernier recours. Le texte lu par la médecin vient toujours de gabarits serveur, jamais du modèle. Les lectures passent par les portes SQL
fermées sous RLS (`search_patients`, `get_patient`, `get_consultation`, `query_alexa_records`, `get_finance_overview`, `dashboard_today`,
`get_analysis_overview`, `app.search_knowledge_lexical`). Aucune migration, aucune table, aucun `fetch` hors `external-call.ts`, aucun
`if (role)` dans un service, aucune écriture nouvelle (propose → confirme → exécute → journalise reste inchangé).

## 2. Ce qui a été ajouté — trois leviers sur l'existant

### (A) Compréhension par le sens : des « cadres » (frames)
Un cadre ne décide rien. Il **réécrit une formulation libre vers une question canonique fermée** que l'admission existante
(`frenchRequestAdmission`) comprend déjà. Les portes, les périodes et les droits sont ceux d'avant.

| Cadre | Fichier | Rôle |
|---|---|---|
| Patient | `src/shared/alexa/patient-question.ts` | résumé, historique, traitements, changements, bornes, nombre, dernière/première date, dernière note, précédente, prochain RDV, documents, échelles, diagnostics, évolution |
| Agenda | `src/shared/alexa/agenda-frame.ts` | nombre, liste, annulés, prochain, premier, dernier, libre, passé ; périodes canoniques ; suivis « Et demain ? » |
| Pratique | `src/shared/alexa/practice-frame.ts` | encaissé/gagné/reçu, recettes, dépenses, résultat net, modes de paiement, comparaisons, activité (patients vus, nouveaux, jours chargés) |

Ordre dans l'orchestrateur : agenda → pratique (ignorée si l'admission fermée comprend déjà) → bascule de patient (vérifiée par
`resolvePatient`) → patient. Un prénom seul passe par `firstNameMatches` : 1 résultat → nom complet ; plusieurs ou tronqué → question
« lequel ? » ; aucun → mot ignoré. **Jamais de devinette** : l'ambiguïté est posée à la médecin.

### (B) Contexte patient serveur-autoritaire
`src/server/alexa/consultation-context.ts` : sur `/consultation/[id]`, le client ne transmet que `consultationId`. Le serveur lit
`get_consultation` puis `get_patient` **avec les droits de l'appelant** ; le patient ainsi vérifié remplace `appContext.patientId`
(trace de tour `consultation-context`). Consultation introuvable ou hors périmètre → pas de patient, pas de devinette
(même message pour « introuvable » et « hors périmètre », pas d'oracle d'existence). L'état conversationnel
(`WorkingReference`, `selectedPatientId`, `patients`, `agendaDay`, `lastRequest`) est celui d'avant ; après une liste de choix, la question
d'origine est reposée (`reaskForSelectedPatient`). « Patient suivant » reste sur le chemin agenda existant, nomme maintenant le patient et
le retient comme patient de travail.

### (C) Réponses : « la réponse est le passage »
- Résumé de dossier et résumé de dernière consultation : **sans modèle**, depuis les champs enregistrés
  (`buildStructuredSummaryNarrative`, `buildConsultationNoteDetails`). Avant : jusqu'à 500 s. `ALEXA_SUMMARY_MODEL=1` rétablit l'ancien chemin.
  Lorsqu'un dossier dépasse une lecture, la réponse le dit (`boundsPartial`).
- Livres : les termes français du manuel remplacent la requête française quand aucun livre n'est nommé (`frenchManualTerms`) ; la requête anglaise
  est conservée ; alias FR→EN complétés. Un passage long est présenté en entier jusqu'à 10 000 caractères (octets de passage 12 000, budget de
  recherche 10 000). Aucun résumé, aucune traduction, aucun livre modifié.
- Finance : base de caisse seulement (ADR-010) — la réponse « mode de paiement » le dit (`practiceReadCopy.cashOnly`). Statistiques : jours les plus chargés ajoutés.

## 3. Défauts de fond corrigés en chemin (hors cadres)
- `request-contract.ts` : « dépression majeure » était lue comme le nom « pression majeure » (préfixe `de`) ; noms de 4 mots ; `howToQuestion` restreint pour qu'une question « comment arrêter un médicament » ne soit pas une écriture.
- `agent-loop.ts` : « prochain rendez-vous » partait du début de journée au lieu de l'horloge.
- Écran consultation : n'avait aucun patient.

## 4. Limites assumées (voir le rapport de résultats)
Modèle 1B ; français seulement ; pas de revue clinique ; aucun horaire d'ouverture n'existe donc « créneaux libres » = liste honnête ; le
mode de paiement est unique (espèces) ; la « période précédente » de la porte statistique est une fenêtre de même durée, pas le mois civil.
