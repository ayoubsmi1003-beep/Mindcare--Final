# Messagerie et envoi : parcours et constats ciblés

**Statut : analyse ciblée, installation et canaux externes NON VÉRIFIÉS.** Aucun message réel ni appel réseau fournisseur n'a été émis pour ces vérifications.

## Parcours identifié

`src/app/messages/page.tsx` charge conversations et connexions, puis messages, routage, consentement et candidats de rapprochement patient. `src/services/communication/envoi.ts`, `executerEnvoi`, appelle `/api/communication/envoyer`. La route `src/app/api/communication/envoyer/route.ts`, `POST`, vérifie l'acteur, le schéma, la capacité et l'adaptateur ; elle lit le message approuvé et son routage et revérifie le consentement lorsqu'un patient est lié. Elle effectue ces opérations dans `withCaller`, puis déclenche l'adaptateur. La présence d'une route ou d'un adaptateur n'établit pas la connexion, la qualification ou la disponibilité d'un canal sur le poste.

## Constat 1 : refus fournisseur laisse une transition sans issue

**Code et scénario.** La route effectue `comm_transition_message(..., 'sending')`, enregistre la tentative puis appelle `adaptateur.envoyer`. Si le résultat est `refus-provider`, elle retourne un résultat HTTP 422 sans demander une autre transition. `withCaller` exécute `COMMIT` lorsque sa fonction termine normalement (`src/server/db/withCaller.ts`). Dans la définition de `app.comm_transition_message` de `supabase/migrations/112_communication_kernel.sql`, `sending` ne revient pas à `approved` ; les transitions usuelles suivantes sont `sent` ou `failed`.

**Reproduction synthétique : PASS pour le constat, pas pour le comportement souhaité.** Un test Vitest temporaire a appelé `POST` avec un port SQL et un adaptateur simulés, un message synthétique approuvé et une réponse `refus-provider`. Résultat : HTTP 422 et liste des transitions égale à `['sending']`. Le test a été supprimé après exécution. Il prouve la branche applicative mais ne prouve pas la persistance réelle en PostgreSQL ni la fréquence en production. La recherche textuelle des redéfinitions de ces deux fonctions a trouvé la définition 112 ; vérifier les migrations appliquées avant toute conclusion sur une installation précise.

**Conséquence conditionnelle.** Si la transaction est validée et que la définition SQL correspond, le message peut rester en `sending`, bien que la réponse dise qu'il a été refusé ; une nouvelle tentative exigeant `approved` est alors refusée. Ce n'est pas une preuve qu'un message réel a été perdu.

**Correction à concevoir, non implémentée.** Définir un état terminal ou de reprise explicite pour chaque refus et effectuer la transition vérifiée dans une transaction adaptée ; conserver le motif non sensible. Tester la branche avec une base synthétique, y compris refus provider, panne, annulation et redémarrage, puis vérifier l'état réellement commis et l'interface.

## Constat 2 : idempotence externe non démontrée

La route construit `comm:<conversationId>:<messageId>` et appelle `comm_register_delivery`, mais elle ne vérifie pas son résultat booléen. L'adaptateur transmet la clé à `appelComposio` (`src/server/communication/adaptateurs.ts`). Dans `src/server/egress/external-call.ts`, la clé participe au contrôle de classification, mais l'interface `ComposioProvider.executer` et son appel visibles transmettent `slug`, compte, entité, version, paramètres et délai, sans champ de clé d'idempotence. `appelComposio` réessaie une fois après une erreur classée transitoire. Le code de la route maintient la transaction ouverte pendant l'appel externe.

**Risque à vérifier :** si un fournisseur accepte l'envoi mais que la réponse est perdue ou que la transaction échoue ensuite, une répétition peut produire un doublon ou un état local trompeur. La déduplication réelle assurée éventuellement par le fournisseur et le comportement du SDK ne sont pas établis ; ce point est une hypothèse de panne, pas un doublon observé. Le traitement `frontiere` appelle `passer(..., 'blocked')` après `sending`, alors que la définition 112 l'interdit ; il faut aussi vérifier le résultat de cette erreur et de la transaction réelle.

**Expérience requise.** Utiliser un fournisseur simulé qui enregistre les appels et accepte le premier avant de simuler un timeout, puis une base jetable vérifiée pour inspecter les états après refus/rollback/crash. Prouver si une clé stable est effectivement transmise et respectée de bout en bout ; aucun test ne doit contacter les comptes de messagerie réels. Concevoir une réservation durable avant transport et une réconciliation explicite après résultat incertain seulement après avoir établi les contrats fournisseur et les invariants existants.

`tests/unit/communication-routes.test.ts` teste les schémas d'entrée ; sa réussite seule ne valide ni les transitions ni le transport. La reproduction ci-dessus n'exerce pas de fournisseur réel.
