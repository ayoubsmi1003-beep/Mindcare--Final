# Patient : résolution, contexte et résumé Alexa

**Statut : analyse statique ciblée ; données réelles et validation clinique non examinées.**

## Résolution de l'identité

`src/server/alexa/patient-resolver.ts`, `resolvePatient`, retourne `resolved`, `ambiguous`, `absent`, `unavailable` ou `cancelled`. Un nom explicite remplace l'identifiant antérieur. La recherche passe par `search_patients`, autorise des rotations bornées des mots si la première recherche est vide, et ne décide d'une identité sur un nom complet exact que si les résultats sont complets, cohérents et uniques. Un grand ensemble reste ambigu. Le chemin archive est paginé et borné ; une identité résolue est relue par `get_patient` et son nom revérifié. Les jetons d'identité produits sont destinés à l'usage local. Ces protections ne prouvent pas la qualité de reconnaissance vocale des noms ni tous les cas d'homonymie dans l'installation réelle.

## Contenu du contexte

`src/shared/alexa/clinical.ts`, `clinicalContextSchema`, décrit les consultations avec dates, notes libres et structurées, statut, amendements, détails de séance et analyse optionnelle ; les traitements courants et leur historique avec indicateur de complétude ; les diagnostics, échelles, révision source et couverture paginée. C'est le contrat du DTO, non la preuve que tous les champs du dossier ou toutes les données stockées y figurent. Allergies, effets indésirables, adhérence et autres structures du domaine médicament ne sont pas visibles dans ce schéma ; leur éventuel accès par d'autres outils doit être vérifié séparément.

`src/server/alexa/clinical-context.ts`, `buildClinicalContext`, revalide l'accès patient par `get_patient`, puis appelle `get_alexa_clinical_context` en pages allant jusqu'à 20. Il vérifie identité, forme, ordre, absence de doublons et révision source constante. Une plage temporelle lit au maximum 100 consultations et porte un indicateur `hasMore`/`complete`. L'indication de complétude signifie la couverture de ce contrat et de ce périmètre, pas une certification que toute l'histoire pertinente du patient a été enregistrée.

## Résumé et limites

`src/server/alexa/case-summary.ts`, `buildStructuredSummaryNarrative`, assemble des diagnostics non résolus, traitements courants, un extrait d'une consultation terminée récente et une indication de couverture ; il ne déduit pas de tendance clinique dans ce constructeur. `buildConsultationNoteDetails` considère la consultation courante et la dernière terminée, et marque la provenance et les omissions. `buildCaseSummary` organise des diagnostics, traitements et consultations en chronologie ; son tableau `anterieur` est initialisé vide dans ce constructeur. Cela n'établit pas que tous les autres parcours de résumé fonctionnent ainsi : leurs appelants et leur rendu restent à tracer.

`src/server/alexa/clinical-coverage.ts`, `clinicalSectionComplete` et `clinicalSummaryComplete`, tient compte notamment de la couverture, des extraits omis, de la limite cumulée de 8 000 caractères et de l'historique médicamenteux. Il faut tester les cas où une information est absente, conflictuelle, ancienne, tronquée ou non autorisée et vérifier que la sortie finale explique réellement sa limite.

## Tests de qualification à prévoir

Jeu synthétique isolé : homonymes et noms inversés ; recherche partielle supérieure aux bornes ; changement de patient en cours de tour ; plus de 100 consultations sur période ; révision source modifiée entre pages ; notes signées, brouillons et amendements contradictoires ; dose et unité manquantes ; traitement arrêté versus actif ; événements médicamenteux présents hors DTO. Comparer chaque affirmation aux sources et vérifier la séparation fait enregistré/interprétation. Aucun résultat d'acceptation clinique n'est disponible ici.
