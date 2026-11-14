# Accueil, paramètres et observabilité — audit ciblé

**Statut : partiel.** Analyse des sources et reproduction d'un calcul de date synthétique ; pas de navigateur connecté, de données du cabinet ou de configuration de poste consultés.

## Accueil : jour affiché selon le fuseau du poste

**Chemin observé.** `src/components/reception/CockpitReception.tsx`, `versJourIso`, utilise `Date.getFullYear/getMonth/getDate`. L'état initial `ancre` est `versJourIso(new Date())` ; `rechargerBoard` transmet cette valeur à `getReceptionBoard(jourIso)`. Le retour au jour courant et `aujourdhuiIso` utilisent également cette conversion locale. Le code de `src/services/finance-calendrier.ts`, `aujourdHuiCabinet`, prévoit une date dans `Africa/Algiers` pour les autres calculs du cabinet.

**Cas concret : reproduction PASS du calcul.** Avec `TZ=UTC` et l'instant fictif `2026-11-05T23:30:00Z`, les accesseurs locaux donnent `2026-11-05` alors que `Intl.DateTimeFormat` dans `Africa/Algiers` donne `2026-11-06`. Un poste configuré sur UTC à cet instant initialiserait donc l'accueil sur la veille, et le paramètre envoyé à la porte correspondrait à cette date. Cela ne démontre pas que le poste du cabinet est configuré ainsi ni que l'incident s'y est produit. Une horloge incorrecte est un problème distinct du fuseau.

**Correction proposée, non implémentée.** Utiliser la date civile du cabinet pour l'initialisation et « aujourd'hui », puis vérifier la navigation entre dates sans appliquer deux fois un décalage. Test de régression : même instant sous au moins UTC et Africa/Algiers, avec passage de jour et chargement de la porte attendue. Vérifier également le décalage serveur déjà calculé par le composant pour les durées ; il ne corrige pas à lui seul le jour initial.

## Accueil : éléments présentés

`CockpitReception.tsx` compose notamment la frise, l'agenda compact, la file d'arrivées, les demandes, les paiements, les notifications, l'appel de la médecin, la recherche et le déplacement de rendez-vous. Il appelle `getReceptionBoard`, les transitions arrivée/absence, la confirmation de rendez-vous et les services de collaboration/notifications. Un cliché du tableau est conservé dans `sessionStorage` par jour pour affichage en cas de coupure ; il est annoncé comme non autoritaire et ne doit pas être utilisé pour autoriser une écriture. L'isolation effective des données et la validité des actions hors ligne restent à tester pour chaque rôle.

**Risque de changement de session à vérifier.** La clé du cliché est `mindcare:accueil:<jour>` ; elle ne porte pas d'identité ni de cabinet (`CockpitReception.tsx`, `lireSnapshot`/`ecrireSnapshot`). Les chemins de déconnexion examinés (`useSessionEcran.ts`, `auth.ts`, `conversation.ts` `purgerContexteSession`) ne suppriment pas explicitement cette clé. Si un même onglet survit à une déconnexion puis qu'une autre assistante ouvre l'accueil, parvient à charger sa session et son profil, et que la lecture du tableau échoue ensuite en mode hors ligne, le code peut essayer de réutiliser le cliché de la session précédente pour le même jour. Un affichage entre deux périmètres distincts serait une atteinte à la confidentialité. **Non reproduit de bout en bout** : vérifier l'effet réel de la navigation/déconnexion, l'existence de plusieurs périmètres et les conditions de coupure avant d'affirmer une fuite observée. Test requis avec deux acteurs/cabinets synthétiques, un stockage d'onglet conservé et un réseau simulé ; correction envisagée : purger ou lier le cache à l'identité et au périmètre autorisés, sans en faire une source de droits.

## Paramètres et postes

`src/app/parametres/page.tsx` propose deux liens : documents et cabinet/postes. `src/app/parametres/documents/page.tsx` lit profil et cabinet, puis expose un formulaire de numéro d'ordre via `updateDocumentOrderNumber`; ses champs affichés comprennent identité professionnelle, spécialités, téléphone et coordonnées cabinet. Le lien d'index évoque aussi modèles, en-tête et impression : la présence de ces mots ne prouve pas que cette page les rende modifiables. Inventorier leurs vrais points d'édition avant d'annoncer une capacité Alexa.

`src/app/parametres/cabinet/page.tsx` compose pour `owner` un formulaire de compte accueil, une invitation d'appairage et la révocation de postes via `cabinet-collaboration.ts` et `cabinet-postes.ts`. Le rôle dans React n'est qu'une composition ; la route, les fonctions SQL, le proxy et les permissions effectives exigent une vérification indépendante. Aucun identifiant ni mot de passe n'a été ouvert ou testé.

## Observabilité

`src/app/observabilite/page.tsx` n'installe pas le panneau pour le rôle `assistant`. `src/components/observabilite/PanneauObservabilite.tsx` présente statistiques, listes et détails de runs ; `src/services/observabilite-lecture.ts` expose des schémas de durée, état, comptage, empreintes et preuves documentaires. Les composants et les commentaires ne prouvent pas qu'aucun chemin de télémétrie ne journalise une donnée sensible : lire les portes SQL et tester la frontière de journalisation. Une liste vide n'est pas une preuve qu'aucun problème ne s'est produit.
