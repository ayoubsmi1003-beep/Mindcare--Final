-- 079_fix_treatment_history_ambiguous_id — app.get_treatment_history rendait
-- « inattendu » à chaque appel.
--
-- ADDITIF PUR. 076 est APPLIQUÉE : on ne la retouche pas (règle 9).
--
-- ═══ LE DÉFAUT ═══════════════════════════════════════════════════════════
-- `RETURNS TABLE(id uuid, …)` déclare implicitement `id` comme variable
-- PL/pgSQL dans le corps de la fonction. La ligne
--   SELECT patient_id INTO v_patient FROM app.patient_treatments WHERE id = p_treatment_id
-- laissait `id` sans qualification : Postgres ne pouvait plus décider s'il
-- désignait la colonne de la table ou la variable de sortie, et levait
-- `42702 column reference "id" is ambiguous`. Ce SQLSTATE n'étant classé nulle
-- part dans `errors.ts`, il retombait sur le code générique `inattendu` —
-- l'écran affichait « une erreur inattendue » à chaque ouverture de
-- l'historique d'un traitement, quel qu'il soit.
--
-- Reproduit hors application : appel direct de la porte en base, même erreur,
-- même ligne. Le reste du corps qualifie déjà ses références (`t.id`, `h.id`) ;
-- seule cette ligne d'amorçage y échappait.
--
-- 🔴 AUCUN `DROP` — un DROP emporterait le propriétaire `app_gatekeeper` et la
-- porte reviendrait à `postgres` (rolbypassrls).

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.get_treatment_history(
  p_treatment_id uuid,
  p_before_at timestamptz DEFAULT NULL,
  p_before_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 20
) RETURNS TABLE(
  id uuid,
  treatment_id uuid,
  version integer,
  action app.treatment_action,
  previous_values jsonb,
  new_values jsonb,
  actor_id uuid,
  actor_name text,
  occurred_at timestamptz,
  consultation_id uuid,
  reason text,
  notes text
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE v_limit integer;
DECLARE v_patient uuid;
BEGIN
  IF p_treatment_id IS NULL THEN RETURN; END IF;
  -- CORRECTIF : qualifié sur l'alias `pt`, pour ne plus collisionner avec la
  -- variable de sortie `id` du RETURNS TABLE ci-dessus.
  SELECT pt.patient_id INTO v_patient FROM app.patient_treatments pt WHERE pt.id = p_treatment_id;
  IF v_patient IS NULL THEN RETURN; END IF;
  PERFORM audit.log_read(v_patient, 'liste');
  -- RLS via EXISTS already, but explicit check for gate visibility
  IF NOT EXISTS (SELECT 1 FROM app.patient_treatments t WHERE t.id = p_treatment_id AND t.cabinet_id = app.current_cabinet() AND app.can_see_clinical(t.practitioner_id)) THEN
    RETURN;
  END IF;
  v_limit := least(greatest(coalesce(p_limit,20),1),50);
  RETURN QUERY
  SELECT h.id, h.treatment_id, h.version, h.action, h.previous_values, h.new_values, h.actor_id, pr.full_name, h.occurred_at, h.consultation_id, h.reason, h.notes
  FROM app.patient_treatment_history h
  LEFT JOIN app.profiles pr ON pr.id = h.actor_id
  WHERE h.treatment_id = p_treatment_id
    AND (p_before_at IS NULL OR (h.occurred_at, h.id) < (p_before_at, p_before_id))
  ORDER BY h.occurred_at DESC, h.id DESC
  LIMIT v_limit;
END; $$;

ALTER FUNCTION app.get_treatment_history(uuid, timestamptz, uuid, integer) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_treatment_history(uuid, timestamptz, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_treatment_history(uuid, timestamptz, uuid, integer) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('079_fix_treatment_history_ambiguous_id')
  ON CONFLICT DO NOTHING;

COMMIT;
