# Compréhension sémantique et lectures globales Alexa

TASK : remplacer le fallback de menu comme seule compréhension des questions nouvelles, conserver les outils et portes existants, répondre aux demandes globales depuis le dashboard.
SCOPE : classifieur/ontologie Jarvis existants, sélection public/connaissance approuvée/lecture métier, adaptateurs DbPort, références locales de résultats, contrat de sortie structurée pour les livres. Ni identité/historique/notes libres transmis, ni mutation clinique, ni nouvelle table/colonne/enum.
ENTRYPOINT : orchestrator → semantic-planner → classifieur-intentions → gateway ; outils locaux sous l'acteur appelant.
STOP : questions variées réellement inspectées dans le navigateur ; le but maître reste complet et ouvert, aucune tranche seule ne le termine.

## Constats navigateur qui motivent la tranche

- La question composée sur les phases de la Lune est envoyée aux livres médicaux puis au menu de clarification.
- La question « Quels patients n’ont pas de numéro de carte et combien sont-ils ? » reçoit le menu.
- La réponse complète DSM est parfois un tableau de chaînes non conformes, malgré le prompt. L'objet JSON valide n'est pas le contrat structuré attendu.

## Réalisation

- [x] Réutiliser l'ontologie/classifieur existants, ajouter uniquement des paramètres fermés de source et filtre administratif.
- [x] Classifier uniquement la question C4 actuelle, sans contexte, dossier, historique ou mention patient ; la passerelle continue de scanner les octets.
- [x] Faire précéder le découpage lexical par la décision sémantique cohérente ; la lease protège le tour contre une réponse devenue obsolète.
- [x] Lire la liste par search_patients puis revalider chaque ligne par get_patient ; identités et numéros restent locaux. Limite explicitement visible, aucun total filtré incomplet annoncé.
- [x] Contrat JSON unique Zod partagé entre validation locale et contraintes Groq/Gemini ; aucune entrée de schéma libre depuis le client.
- [ ] Revue indépendante et corrections nécessaires.
- [ ] TypeScript/lint/build.
- [ ] Réponses navigateur : public composé inédit, liste et filtre administratif, DSM et Taylor variés, alternance dossier/global.
- [ ] Références ordonnées → deuxième patient → dernière consultation, sous revalidation locale.
- [ ] Couvrir les autres lectures existantes (attente, finances, documents, consultations), périodes, puis synthèses et voix conformément au but maître.

Les réponses doivent distinguer un dossier vide, une capacité indisponible, une ambiguïté d'identité et une preuve insuffisante. Aucun test injecté ni appel modèle en terminal. Une confiance de modèle n'autorise aucune porte ni écriture.
