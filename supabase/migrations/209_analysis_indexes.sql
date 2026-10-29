-- 209_analysis_indexes — les deux index qui manquaient aux agrégats d'analyse.
--
-- ⚠️ AUCUNE TABLE, COLONNE, TYPE NI VALEUR D'ENUM. Uniquement des index.
--
-- MESURÉ : la RLS évalue `app.can_see_clinical()` PAR LIGNE, et cette fonction
-- appelle `app.current_role()` — une lecture de `app.profiles`. Le coût d'un
-- balayage est donc proportionnel au nombre de lignes LUES, pas au nombre de
-- lignes rendues. Chaque index qui ramène le balayage à la fenêtre demandée
-- divise le temps du panneau correspondant.
--
-- `payments` n'avait que `(practitioner_id, created_at)` : la caisse de la
-- période filtre sur `collected_at`, donc elle balayait tout l'historique.
-- `diagnoses` n'avait que `(cabinet_id, label)` — le stock mensuel filtre sur
-- `created_at` / `resolved_at`.

BEGIN;

CREATE INDEX IF NOT EXISTS payments_cabinet_collected
  ON app.payments (cabinet_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS payments_practitioner_collected
  ON app.payments (practitioner_id, collected_at DESC);
CREATE INDEX IF NOT EXISTS diagnoses_cabinet_created
  ON app.diagnoses (cabinet_id, created_at DESC);
CREATE INDEX IF NOT EXISTS diagnoses_cabinet_resolved
  ON app.diagnoses (cabinet_id, resolved_at)
  WHERE resolved_at IS NOT NULL;

INSERT INTO app.schema_migrations (version) VALUES ('209_analysis_indexes')
    ON CONFLICT DO NOTHING;

COMMIT;
