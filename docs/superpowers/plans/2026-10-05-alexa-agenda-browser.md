# Alexa — agenda daté et question composée

TASK : corriger l’échec réel « Qui ai-je demain et quels rendez-vous sont à confirmer ? ».
SCOPE : sélection locale d’un jour, propagation de cette référence entre lectures d’agenda, porte nominative list_agenda existante, distinction requested/confirmed et rendu français/arabe. Aucune écriture ni migration.
ENTRYPOINT : shared/alexa/agenda-plan → request-plan → orchestrator → agenda-adapter → list_agenda.
STOP de cette tranche : réponses datées et demandes à confirmer inspectées dans le navigateur, limites consignées. Le but global reste actif.

- [x] Reproduire l’échec navigateur : première partie non comprise, seconde sans portée demain.
- [x] Vérifier les contrats SQL et la sérialisation text[] déjà utilisée dans appointments.ts.
- [x] Réutiliser le résolveur temporel existant pour les jours ; refuser périodes/qualificatifs non couverts et plusieurs références contradictoires.
- [x] Conserver le dashboard pour le prochain patient du jour, sans resélection locale.
- [x] Utiliser list_agenda sous l’appelant pour les lectures datées ; afficher le jour, les noms autorisés et le statut, sans modèle externe.
- [x] Revue indépendante, TypeScript/lint/build du changement de lecture. Constats corrigés : modificateurs de date, propagation d’une période rejetée, retour natif Date de pg, prochain patient après demain.
- [x] Vérification réelle navigateur : question composée du 6 octobre, deux rendez-vous existants du 3 octobre, prochain patient après demain, période semaine rejetée et « مواعيد بعد غدوة » sans substitution silencieuse.
- [ ] Dernier rendu : heure sur 24 heures et clarification spécifique à la date, puis vérification navigateur.

Les tests d’acceptation restent uniquement réels et visibles dans le navigateur. Aucun rendez-vous de test n’est injecté, confirmé ou modifié pour obtenir un PASS. Une réponse vide ne démontre pas à elle seule la couverture des lignes non vides. La compréhension sémantique générale reste un travail distinct du but maître.
