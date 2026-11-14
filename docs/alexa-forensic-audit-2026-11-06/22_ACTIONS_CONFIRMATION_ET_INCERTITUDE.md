# Actions Alexa : confirmation, exécution et résultat incertain

**Statut : analyse statique et reproduction locale avec transport simulé.** Aucune écriture réelle ni simulation contre une base de cabinet. Les garanties SQL ci-dessous décrivent les fichiers présents, pas l'état appliqué en production.

## Cycle observé

`src/services/conversation.ts`, `accepterCarte`, appelle `confirmerAction` puis `executerEcritureConfirmee` si la confirmation réussit. Le tableau de bord utilise également ce chemin partagé (`src/components/tableauDeBord/ColonneContexte.tsx`). `src/services/jarvis-tools.ts`, `proposerAction`, sérialise les arguments ; `confirmerAction` appelle `confirm_jarvis_action` ; `executerAction` appelle `execute_jarvis_action` avec l'identifiant de l'action seul et refuse un résultat nul.

La dernière définition textuelle repérée de `confirm_jarvis_action` dans `supabase/migrations/182_alexa_clinical_actions.sql` verrouille la ligne, exige `proposed`, vérifie l'expiration puis écrit `confirmed_at`. La dernière définition repérée de `execute_jarvis_action` (`190_alexa_treatment_charge_actions.sql`) verrouille la ligne, exige `confirmed` et `confirmed_at`, vérifie l'expiration, appelle une branche métier déterminée et marque l'action `executed` ou `failed`. Plusieurs actions vérifient la version du traitement ou l'état attendu de la charge et du brouillon. L'exécution passe par les portes et permissions de la base ; les garanties effectives RLS et audit nécessitent une base synthétique et une vérification de l'installation.

`src/services/jarvis-execution.ts`, `executerEcritureConfirmee`, limite le temps d'attente, tente une réconciliation de résultat pour un dépassement ou une exception de transport, puis relit via le vérificateur de la capacité avant d'autoriser un message de succès. Il ne relance pas automatiquement l'écriture. Cette stratégie vise à ne pas annoncer « fait » sans preuve.

## Constat confirmé : rupture réseau convertie en échec certain

**Chemin précis.** `src/services/db/http.ts`, `poster`, intercepte les exceptions de `fetch` et les convertit en `Result` d'erreur, notamment `hors-ligne`. `src/services/jarvis-tools.ts`, `executerAction`, relaie ce résultat sans lever. Dans `src/services/jarvis-execution.ts`, `executerAvecDelai` marque `rupture: true` seulement lorsqu'une promesse **lève** ; un `Result` d'erreur normal devient `rupture: false`. `executerEcritureConfirmee` le classe alors `issue: 'echec'`, `raison: 'ECHEC_PORTE'`, sans passer par la réconciliation réservée au délai ou à `rupture`.

**Reproduction synthétique : PASS pour le constat, pas pour le comportement souhaité.** Un test Vitest temporaire a utilisé les vrais `httpDbPort`, `executerAction` et `executerEcritureConfirmee`, avec `fetch` simulé qui rejette par `TypeError('Failed to fetch')` et une action d'encaissement fictive. Le résultat observé était `echec / ECHEC_PORTE` et un seul appel fetch simulé. Le test a été supprimé après exécution. Aucun paiement, serveur ou réseau réel n'a été sollicité.

**Impact et limite.** Une exception de transport peut se produire avant l'arrivée au serveur **ou après** l'enregistrement de l'action lorsque la réponse est perdue. La classification observée ne distingue pas ces cas et ne tente pas la réconciliation à cet endroit. Elle ne constitue pas une preuve qu'un paiement réel a été perdu, rejoué ou incorrect ; le code n'effectue pas de rejeu automatique dans ce chemin. Le message exact affiché selon l'erreur et la réaction de l'opératrice nécessitent une vérification de bout en bout.

**Écart de tests.** `tests/unit/jarvis-execution.test.ts` couvre une dépendance qui *lève* une exception ; la reproduction ci-dessus passe par l'adaptateur réel qui la transforme en `Result`. Ce sont deux contrats distincts. Aucun test d'intégration complet sur la base et une rupture après commit n'a été exécuté ici.

Les suites ciblées `jarvis-execution.test.ts` et `alexa-action-reconciliation.test.ts` ont passé lors du lot de sept fichiers (54 tests au total, comprenant également la voix). Ces tests existants ne réfutent pas la reproduction de l'adaptateur HTTP, car la forme d'échec injectée diffère.

Un second lot ciblé de sept fichiers d'actions et confirmation a passé **78 tests** (`alexa-action-write-contract`, `alexa-action-terminal`, `alexa-action-preparation-executor`, `jarvis-confirmation-logging`, `alexa-clinical-actions-sql`, `alexa-action-catalogue`, `alexa-action-reconciliation`). Certains tests inspectent les contrats ou utilisent des doublures ; ce résultat ne remplace pas l'essai transactionnel multi-rôles sur une base jetable. Le test de réconciliation est commun aux deux lots et ne doit pas être additionné deux fois pour compter les cas uniques.

**Correction proposée, non implémentée.** Conserver une distinction fiable entre refus métier prouvé et résultat de transport incertain ; pour ce dernier, relire l'issue authentifiée de l'action, puis ne déclarer un succès qu'après vérification de l'effet et sinon conserver `inconnue`. Ne jamais rejouer automatiquement l'écriture. Ajouter une régression qui couvre l'adaptateur HTTP réel, les deux moments de rupture (avant et après commit), la réconciliation inaccessible et les actions financières. Respecter les invariants de rôles, d'audit et d'idempotence en base.

## Travaux restants

Tracer chaque action déclarée depuis sa compréhension et son affichage jusqu'à la branche SQL, son vérificateur, ses versions/empreintes et son audit. Exécuter les cas de concurrence, expiration, refus, reprise et permissions sur une base synthétique isolée ; distinguer états `executed`, `failed`, `unknown` et refus explicite. Vérifier séparément les impressions et les envois externes, dont les effets ne sont pas transactionnels avec PostgreSQL.
