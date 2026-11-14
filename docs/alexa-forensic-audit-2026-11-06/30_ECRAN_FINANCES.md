# Écran Finances — données, commandes et limites observées

**Périmètre : lecture statique de l’arbre de travail ; aucun accès à la caisse réelle.** Les comportements UI ci-dessous sont établis sur les chemins indiqués, pas sur l’application installée. Les garanties et commentaires sur les portes SQL ne remplacent pas une vérification de leurs versions et autorisations effectives.

## Structure et données

`src/app/finances/page.tsx` propose trois onglets : aperçu, charges et séances. La période initiale est le mois du cabinet ; une période valide `du`/`au` de l’URL peut la remplacer. `SelecteurPeriode` propose jour, semaine, mois, année et personnalisé. L’aperçu appelle `getFinanceOverview` ; les deux autres listes ne sont chargées qu’à l’ouverture de leur onglet via `getChargesList` et `getSessionsPaymentsList`. Les services dans `src/services/finance-cash.ts` appellent respectivement les portes `get_finance_overview`, `get_charges_list` et `get_sessions_payments_list` et valident les résultats avec Zod.

L’aperçu transmet aux panneaux les encaissements aujourd’hui/semaine/mois/période, charges, résultat net, nombre de lignes qualifiées de séances, panier moyen nullable, impayés ; une série mensuelle ; les répartitions par type et catégorie ; une ventilation journalière et des échéances. Les fenêtres de date ne sont pas interchangeables : voir les définitions observées dans `16_ANALYSE_ET_ACCUEIL.md`. Notamment, le panier moyen de la version SQL examinée est par paiement encaissé et ne prouve pas une moyenne par consultation réalisée.

Les charges montrent les lignes, rythme mensuel récurrent et total ponctuel de période comme unités distinctes. La modale contient intitulé, montant en DZD, type récurrent/ponctuel, fréquence mensuelle/trimestrielle/annuelle, date et catégories local/personnel/outils/assurance/autre. Une dépense ponctuelle vide et désactive la fréquence. Création et modification appellent `createCharge` / `updateCharge` ; une confirmation précède `deleteCharge`. Malgré le nom, l’écran décrit une désactivation ; l’effet réel de la porte n’est pas vérifié ici.

La liste des séances expose date, nom du patient, type, montant, mode, état payé/impayé et action ; son contrat transporte également le numéro de reçu, sans l’afficher dans la table lue. Le composant indique un filtre par date de création plutôt que d’encaissement : c’est un commentaire à confirmer sur la version de porte effectivement utilisée. Une liste nominative nécessite de vérifier le rôle et la trace d’accès effectifs avant toute réutilisation par Alexa.

## Contrôles visibles mais sans effet dans ce branchement

**Confirmé par le code :** `TableauSeances.tsx` rend un bouton pour le reçu si la ligne est payée, et un bouton de relance sinon ; les clics invoquent respectivement `onRecu(id)` et `onRelancer(id)`. Or `FinancesPage` fournit `onRecu={() => undefined}` et `onRelancer={() => undefined}`. Ainsi, dans cette composition précise, ces clics ne déclenchent aucune action via ces callbacks. Cela ne dit rien d’autres parcours de reçu ou de communication ailleurs dans l’application. Test proposé : rendre la page avec les services simulés pour une ligne payée et une impayée, cliquer et vérifier l’absence actuelle d’appel ; définir ensuite le comportement produit souhaité avant toute correction.

## Période personnalisée : variante compacte

**Confirmé par le code :** la page transmet `compact` au sélecteur. Dans `SelecteurPeriode.tsx`, cette branche retourne immédiatement après les boutons et le texte de dates ; les deux champs de saisie des bornes se trouvent uniquement dans la branche non compacte. Choisir « personnalisé » conserve les bornes courantes mais, dans cette composition, aucun champ de dates personnalisé n’est rendu. Une URL valide peut initialiser une période personnalisée : cela ne rend pas la saisie disponible dans ce sélecteur. Tester le rendu de la page et les contraintes de navigation avant de généraliser à d’autres écrans.

## Actualisation concurrente : hypothèse à reproduire

`chargerApercu` vérifie une génération pour ignorer un résultat ancien. `chargerCharges` et `chargerSeances` ne possèdent pas cette vérification : un changement rapide de période peut produire deux requêtes et, si l’ancienne répond en dernier, son résultat peut remplacer celui de la période affichée. C’est une conséquence plausible de l’ordre asynchrone, **non reproduite en interface** ; les adaptateurs ou conditions effectives peuvent affecter sa fréquence. Test proposé : réponses différées contrôlées, période A puis B, résoudre B puis A et comparer dates affichées et lignes ; répéter pour les deux onglets.

## Autres limites et vérification

La modale initialise une nouvelle date par `new Date().toISOString().slice(0, 10)`, donc selon le jour UTC et non explicitement le jour civil d’Alger. À la frontière de minuit, les deux jours peuvent différer ; fuseau, fréquence et incidence réelle NON VÉRIFIÉS. Le montant passe par `parseInt` ; le comportement du champ numérique avec saisie fractionnaire, la validation serveur et une éventuelle troncature doivent être reproduits avant de conclure à un défaut utilisateur. Aucun test d’interface, de permissions, de calcul SQL actuel ou d’impression physique n’a été exécuté pour ce document.
