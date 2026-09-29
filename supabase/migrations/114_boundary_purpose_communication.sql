-- 114_boundary_purpose_communication — élargit le registre des
-- franchissements au domaine Communication (112/113).
--
-- Même geste que 054 : la colonne `purpose` porte une CHECK à liste fermée.
-- Sans cette migration, `audit.log_boundary_crossing('communication', …)`
-- (appelé par `appelComposio` dans `external-call.ts`) serait rejeté et la
-- journalisation des envois WhatsApp/Facebook deviendrait silencieuse —
-- exactement l'angle mort que cette table existe pour empêcher.
--
-- Aucun secret, aucune PII : seuls purpose/provider/modèle/métadonnées.
-- Retour arrière (documentation) : recréer la CHECK à quatre valeurs après
-- avoir vérifié qu'aucune ligne 'communication' ne subsiste. Humain seulement.

BEGIN;

ALTER TABLE audit.boundary_crossings
    DROP CONSTRAINT boundary_crossings_purpose_check;

ALTER TABLE audit.boundary_crossings
    ADD CONSTRAINT boundary_crossings_purpose_check
    CHECK (purpose IN ('jarvis', 'voix-entree', 'voix-sortie', 'resume-cas', 'communication'));

INSERT INTO app.schema_migrations (version) VALUES ('114_boundary_purpose_communication')
  ON CONFLICT DO NOTHING;

COMMIT;
