# Écrans patient, consultation et documents — trace ciblée

**Statut : partiel.** Le rendu isolé ci-dessous utilise uniquement un objet synthétique en mémoire. Il ne démontre pas la fréquence du cas ni l'état de la base installée.

## Observation vérifiée : traitement indisponible présenté comme absent

**Entrée précise.** Le service `src/services/patients.ts`, schéma `ESPACE_TRAVAIL`, accepte `traitements_v2` nul ou absent et le convertit en `traitementsV2: null` ; ses commentaires distinguent les domaines inaccessibles des listes vides. `src/components/patients/PatientProfilClinique.tsx`, `PatientProfilClinique`, prend `espace.traitementsV2?.actifs ?? []` et affiche « Aucun traitement actif. » pour une liste vide. Il est monté dans l'onglet de vue d'ensemble par `src/app/patients/[id]/page.tsx` lorsque le résumé est affiché ; le composant exige seulement que `espace.clinique` ne soit pas nul.

**Reproduction contrôlée : PASS pour l'observation du défaut**, non pour le comportement attendu. Un test Vitest temporaire a rendu `PatientProfilClinique` avec `clinique: { diagnostics: [], echelles: [] }` et `traitementsV2: null` ; le HTML contenait « Aucun traitement actif. ». Le test a été supprimé après exécution, sans changement de production. Un premier lancement a échoué avant collecte (`React is not defined`) ; une relance avec React défini dans l'environnement du test a passé 1/1. Le chemin d'une réponse SQL actuelle produisant simultanément ces valeurs, et la fréquence en production, sont **NON VÉRIFIÉS**.

`src/components/consultation/cockpit/RailContexte.tsx`, `AppercuTraitement`, présente une branche similaire : `traitementsV2?.actifs[0] ?? null` mène à `cockpit.traitementVide`, dont le libellé ciblé dans `src/i18n/fr.ts` est « Aucun traitement actif ». Cette seconde observation est statique ; le rendu et sa présence effective pour chaque rôle restent à tester.

**Conséquence.** Dans le cas décrit, un état inconnu ou inaccessible peut devenir une affirmation clinique négative. Une praticienne pourrait croire à tort qu'aucun traitement n'est enregistré. Ne pas inférer qu'un tel cas est arrivé à un patient réel.

**Correction proposée, non implémentée.** Dans les deux vues, traiter séparément `null`/absence et une liste effectivement vide, avec un libellé approprié du catalogue i18n autorisé par la décision de maintenance. Ajouter une vérification de rendu pour état indisponible, vide et au moins un traitement, puis tester les droits et versions de porte SQL. Ne pas lire ou fabriquer de données réelles pour cette reproduction.

## Traitements : ce que l'écran présente

`src/components/traitements/ChargeTraitements.tsx` appelle `getMedicationWorkload(query, 30, offset, filtre)` ; il affiche un résumé (`patients`, traitements actifs, revue, changements), une recherche, les filtres `tout`, `revue`, `fin`, une page de résultats et un état restreint. L'alerte de fin proche est calculée à partir de la date locale `Africa/Algiers` et d'une fenêtre de 14 jours ; elle porte aussi sur fin dépassée et posologie manquante. `src/services/medication-workspace.ts` valide les lignes et résumés renvoyés. Les définitions SQL et la complétude sur plusieurs pages doivent être vérifiées avant de promettre une réponse Alexa équivalente.

## Documents : points d'entrée et opérations

`src/components/documents/DocumentWorkspace.tsx` associe un patient et un type à un espace avec brouillons et pièces émises. Le code relie création, modification, aperçu, émission, duplication/révision, archivage, consultation, annulation et impression aux services `document-drafts.ts` et `documents.ts`. Le contexte du document sélectionné est transmis localement à Alexa via `setAlexaDocumentContext`. Le code de la fonction de confirmation d'impression appelle `markDocumentPrinted` après le dialogue et affiche une erreur distincte si la trace d'impression échoue. Le dialogue d'impression ne prouve pas qu'une imprimante physique a effectivement imprimé.

Les transitions SQL, la confirmation humaine exacte, l'autorisation par rôle et le contenu des cinq types de document doivent encore être tracés. Les services et boutons identifiés ne prouvent pas qu'ils sont accessibles dans tous les états ou sur le poste installé.
