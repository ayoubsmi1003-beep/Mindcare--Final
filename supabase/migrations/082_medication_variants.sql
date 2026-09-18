-- 082_medication_variants — porte de lecture pour la liste déroulante de dosage.
--
-- ADR-028. La praticienne veut choisir un autre dosage EXISTANT du même
-- médicament (ex. Sertraline 50mg → 100mg) au lieu de taper la dose en texte
-- libre. `medication_id` du traitement reste IMMUTABLE (update_treatment
-- l'interdit déjà, 075) : cette porte ne sert qu'à peupler la liste, jamais à
-- réattribuer le traitement à une autre ligne catalogue.
--
-- Rapproché par DCI (`inn`), insensible à la casse, et par `form` quand la
-- ligne d'origine en porte un — un comprimé ne doit pas proposer un sirop.

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.get_medication_variants(p_medication_id uuid)
RETURNS TABLE(
  id uuid,
  raw_name text,
  inn text,
  brand_name text,
  form text,
  strength text
)
LANGUAGE sql STABLE
SET search_path = app, pg_catalog
AS $$
  WITH origine AS (
    SELECT m.inn, m.form
    FROM app.medications m
    WHERE m.id = p_medication_id
  )
  SELECT m.id,
         coalesce(m.source_raw_value, coalesce(m.brand_name,'') || ' ' || m.inn) AS raw_name,
         m.inn,
         m.brand_name,
         m.form,
         m.strength
  FROM app.medications m, origine o
  WHERE m.is_active IS NOT FALSE
    AND (m.cabinet_id IS NULL OR m.cabinet_id = app.current_cabinet())
    AND lower(m.inn) = lower(o.inn)
    AND (o.form IS NULL OR m.form IS NULL OR lower(m.form) = lower(o.form))
  ORDER BY m.strength NULLS LAST, m.brand_name NULLS LAST
  LIMIT 30;
$$;

REVOKE ALL ON FUNCTION app.get_medication_variants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app.get_medication_variants(uuid) TO authenticated;

COMMENT ON FUNCTION app.get_medication_variants(uuid) IS
  'Autres dosages catalogue du même DCI (et de la même forme si connue) — peuple la liste déroulante de changement de dose. Ne réattribue jamais medication_id.';

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('082_medication_variants')
  ON CONFLICT DO NOTHING;

COMMIT;
