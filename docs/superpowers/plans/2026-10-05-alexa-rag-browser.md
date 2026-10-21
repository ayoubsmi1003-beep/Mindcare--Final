# Alexa RAG — continuation et réception réelle

TASK : corriger les échecs observés dans les réponses Alexa du navigateur, puis poursuivre le but global.
SCOPE : performance de la porte lexicale, passages complets dans le budget existant, sélection explicite de section, synthèse publique sourcée et validation de sortie. Ni corpus/OCR, ni hybride, ni notes patient, ni écriture clinique.
ENTRYPOINT : orchestrator → knowledge-adapter → search_knowledge_lexical → knowledge-synthesis → passerelle externe unique.
STOP de cette tranche : réponses DSM et abstention inspectées dans le navigateur visible, preuves et limites conservées. Cela ne termine pas le prompt maître.

La continuation est demandée explicitement. Tous les nouveaux appels modèles proviennent du compositeur visible. Aucun mock, réponse injectée ou appel fournisseur CLI ne sert de réception.

- [x] Reproduire dans le navigateur : RAG indisponible, questions publiques mal classées, question composée perdue.
- [x] Corriger et observer les réponses publiques/photosynthèse/saisons et agenda+recettes du jour.
- [x] Diagnostiquer le vrai SQL protégé : Hamilton 104556 ms, GIN inutilisé.
- [x] Revoir et répéter la nouvelle porte en transaction annulée : 229/138 ms, 19 champs inchangés, null/vide, limites, restauration du contexte, RLS forcée.
- [x] Appliquer uniquement 123 à la base locale synthétique ; garde normale : 113 migrations à jour.
- [x] Observer Hamilton/DSM dans le navigateur après 123 : retrieval rétabli, qualité de réponse encore PARTIAL/FAIL.
- [x] Garder les passages entiers jusqu’au budget total existant de 8000 caractères. Aucun préfixe clinique tronqué.
- [x] Pour un trouble DSM nommé explicitement, restreindre à sa section exacte, sans substituer son diagnostic différentiel.
- [x] Projeter seulement des sources C4 approuvées et figées, tâches/focus/langue fermés, sans question brute, UUID, dossier, contexte ou historique vers le modèle.
- [x] Revue des sorties : citations normalisées non vides ; chiffres arabes/persans, signes/fractions et unités ; refus des actions prétendument effectuées ; polarité littérale ; synthèse IA explicitement à vérifier et citations affichées.
- [x] TypeScript et lint ciblé. Build Windows initial EPERM, répétition indépendante autorisée.
- [x] Inspection réelle : DSM-5-TR abstient ; Hamilton abstient si l’interprétation n’est pas documentée ; DSM nommé utilise la bonne section et une synthèse réelle avec citations visibles. Couverture des symptômes encore PARTIAL.
- [ ] Répéter après instruction de complétude et sélection du volet critères pour la demande explicite de symptômes.
- [ ] Continuer l’agenda futur/composé, la compréhension sémantique et les autres lectures du but global.

La validation des citations ne démontre pas l’entaillement de toute prose. Les paragraphes générés restent des inférences à vérifier ; leurs supports littéraux restent visibles. Les passages/corpus/goldens gelés ne sont pas réécrits pour obtenir un PASS. Voix acoustique, synthèses individuelles/longitudinales et compréhension globale restent non qualifiées.
