# Analyse, tableau de bord et accueil — contrats observés

**Statut : lecture statique ciblée ; base installée, politiques SQL finales et expérience utilisateur non vérifiées.**

## Statistiques : données du contrat

`src/app/statistiques/page.tsx` charge `getAnalyseOverview(du, au)` et présente des panneaux d'activité, de délais, de jours et heures, de nouveaux patients et retours, de statuts, de diagnostics, d'échelles, de traitements, de qualité du dossier, de durée et de continuité. La page refuse une plage supérieure à 366 jours, mémorise les dates dans l'URL et affiche un délai de chargement de 45 secondes. Ce délai est une limite UI, pas une mesure de performance.

`src/services/analyse.ts` appelle les portes `get_analysis_overview` et `get_analysis_drilldown`. Le schéma de la vue d'ensemble comprend :

- période, période précédente, granularité et couverture temporelle ;
- séances, patientes vues, retours, nouveaux, absences, annulations, notes signées/manquantes, échelles et changements de traitement ;
- stock de patients, suivis, rendez-vous futurs et non clôturés, traitements actifs ;
- séries chronologiques, statuts et types, jours et heures, délais ;
- diagnostics enregistrés et échelles, bandes d'âge, durées et médiane, continuité, stock de diagnostics ;
- montant encaissé et son périmètre si la porte le rend visible.

Le contrat conserve des valeurs nulles pour certains résultats. Une valeur nulle ne peut pas automatiquement devenir zéro. Les clés du détail nominatif sont limitées par le type `CleDetail` dans le même fichier. Les calculs exacts de « nouveaux », « retours », « notes manquantes » et des cohortes doivent être tracés dans la dernière version des fonctions SQL avant d'être réutilisés par Alexa.

La lecture de `supabase/migrations/207_analysis_gates.sql`, `analysis_flow`, précise les définitions de cette version : `patientes_vues` compte les identifiants distincts associés à une consultation clôturée commencée dans la fenêtre ; `retours` retient parmi ces consultations les dossiers créés avant le début de la fenêtre ; `nouveaux` compte les dossiers créés dans la fenêtre, qu'ils aient ou non eu une consultation clôturée dans celle-ci. Une demande « combien parmi les patientes vues étaient nouvelles » requiert donc une intersection : il serait faux de substituer simplement le compteur `nouveaux`. `notes_manquantes` compte les consultations clôturées dans la fenêtre sans note signée ; `notes_signees` utilise quant à lui la date de signature. `208_analysis_charts.sql`, `get_analysis_overview`, appelle `analysis_flow`. Vérifier les éventuelles redéfinitions ultérieures et les migrations effectivement appliquées avant d'utiliser ces définitions comme état installé.

**Raccordement Alexa :** aucune référence textuelle aux noms `get_analysis_overview` ou `get_analysis_drilldown` n'a été trouvée dans `src/server/alexa` et `src/shared/alexa` lors de cette recherche. Ce constat ne prouve pas une absence totale de possibilité indirecte. Les schémas natifs `src/shared/alexa/agent.ts` exposent d'autres lectures patients, consultations, finance et application, qui peuvent couvrir certains comptes. Il faut une matrice de correspondance et des tests de définition avant de promettre tous les graphiques ou calculs de l'écran.

## Tableau de bord de la praticienne

`src/app/tableauDeBord/page.tsx` choisit une composition selon le rôle. `src/services/dashboard.ts`, `getDashboardToday`, décrit la porte `dashboard_today` et projette séance ouverte, rendez-vous de la journée, prochain rendez-vous, nombre en attente, caisse si visible, nouveaux patients du mois et propositions Jarvis, avec heure de génération. Le type `CaisseDuJour` distingue `montantDzd`, nombre de séances et périmètre cabinet/praticienne. Le service documente que la caisse concerne les paiements encaissés. Les règles SQL finales et la couverture par rôle restent à vérifier.

## Accueil

`src/services/reception.ts`, `getReceptionBoard`, définit un contrat avec trois tableaux : journée, demandes et paiements. `RdvAccueil` porte notamment horaires, statut, source, notes administratives, identité visible et praticienne ; `PaiementAccueil` porte montant entier, date d'encaissement éventuelle et identité visible. Les services `markAppointmentArrived` et `markAppointmentNoShow` représentent les transitions d'accueil.

`src/server/alexa/application-reads.ts`, `readApplication`, vue `reception`, appelle `reception_board` pour la date, filtre localement la file demandée, calcule une révision sur le résultat et renvoie des pages de vingt éléments avec état partiel lorsque nécessaire. Cette branche prouve un raccordement de lecture dans le code ; les droits SQL effectifs et les tests de confidentialité multi-rôles ne sont pas établis par ce seul constat.

## Risques d'interprétation à tester

1. Une statistique d'activité, un rendez-vous prévu et un paiement encaissé ne décrivent pas la même population ni la même date métier.
2. Une somme de lignes visibles par un rôle ne représente pas nécessairement le cabinet entier.
3. Une absence d'autorisation, un indicateur non défini et un résultat zéro doivent rester distincts.
4. Les comparaisons de périodes doivent utiliser les définitions SQL, une zone `Africa/Algiers` et des bornes explicites.

Ces points sont des exigences de validation ; aucun défaut de calcul réel n'est affirmé ici sans exemple et résultat d'exécution.

## Finance : définition du panier et du périmètre temporel

Dans la dernière définition textuelle repérée de `get_finance_overview` (`supabase/migrations/180_charge_prorata_start_date.sql`), `revenu_periode` additionne les paiements dont `collected_at` est dans la période et `nb_seances_periode` compte ces lignes de paiement ; `panier_moyen` divise le montant encaissé par ce nombre et vaut `null` lorsqu'il est nul. Ce n'est pas automatiquement la recette moyenne par consultation réalisée pendant la même période : une date de séance peut différer de la date d'encaissement et une consultation peut être sans paiement. `src/i18n/alexa-application.ts` décrit d'ailleurs ce nombre comme des paiements encaissés et ce panier comme un montant moyen par paiement encaissé. Tester tout autre sens demandé par la praticienne au lieu de remplacer silencieusement une population par l'autre.

La même fonction calcule les impayés à partir des paiements non encaissés **toutes dates** et l'évolution sur six mois relatifs à la date courante ; leurs libellés et périodes doivent être conservés lors de la réponse. Ces définitions sont établies sur le code SQL trouvé, pas sur la base installée. Un test synthétique devrait couvrir une consultation de janvier payée en février, une consultation non tarifée et deux périodes distinctes.
