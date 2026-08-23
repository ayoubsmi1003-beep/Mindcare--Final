-- 054_boundary_purpose_resume_cas — élargit le registre des franchissements
-- de frontière au NOUVEL usage IA du lot Patients V3.
--
-- Chaque appel modèle passe par `_shared/external-call.ts`, qui journalise une
-- ligne dans `audit.boundary_crossings` : purpose, provider, modèle, version
-- et empreinte de prompt, jeton de session ALÉATOIRE (jamais patient_id),
-- coûts estimés, issue, latence. La colonne `purpose` porte une contrainte
-- CHECK à liste fermée — 028 l'a créée ('jarvis'), 034 l'a élargie
-- ('voix-entree','voix-sortie'). Cette migration suit le même geste pour le
-- Résumé du cas : 'resume-cas'.
--
-- Pourquoi un purpose PROPRE plutôt que réutiliser 'jarvis' : le résumé a son
-- propre prompt versionné et son propre contrat de sortie ; confondre les
-- usages rendrait impossible toute analyse de coût/latence/régression PAR
-- capacité — c'est-à-dire exactement ce que cette table existe pour permettre.
--
-- Aucun secret, aucune PII ajoutée : le contenu des requêtes ne transite
-- jamais dans cette table (I5), seulement leurs métadonnées.
--
-- Retour arrière (documentation) : recréer la CHECK à trois valeurs après
-- avoir vérifié qu'aucune ligne 'resume-cas' ne subsiste. Humain seulement.

BEGIN;

ALTER TABLE audit.boundary_crossings
    DROP CONSTRAINT boundary_crossings_purpose_check;

ALTER TABLE audit.boundary_crossings
    ADD CONSTRAINT boundary_crossings_purpose_check
    CHECK (purpose IN ('jarvis', 'voix-entree', 'voix-sortie', 'resume-cas'));

INSERT INTO app.schema_migrations (version) VALUES ('054_boundary_purpose_resume_cas')
  ON CONFLICT DO NOTHING;

COMMIT;
