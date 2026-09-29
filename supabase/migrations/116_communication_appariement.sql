-- 116_communication_appariement — matching patient, liaison, suivi de remise.
--
-- Le téléphone n'est PAS unique en base (004 : deux enfants partagent le
-- numéro de leur mère) : `comm_matcher_patient` rend donc une LISTE (10 au
-- plus), jamais un correspondant unique — c'est l'humaine qui lie via
-- `comm_lier_patient`. Le matching se fait sur les 9 derniers chiffres
-- (formes `05…`, `+213 5…`, `00213…` équivalentes), sans jamais logger le
-- numéro Cherché en clair ailleurs que dans cette transaction.
-- `comm_suivi_statut` fait progresser la remise (sent→delivered→read) sur le
-- message ET sa dernière livraison, même transaction (règle 5).

BEGIN;

-- Candidats dossiers pour un numéro entrant (périmètre cabinet, 10 au plus).
CREATE OR REPLACE FUNCTION app.comm_matcher_patient(p_telephone text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
  WITH cle AS (
    SELECT right(regexp_replace(COALESCE(p_telephone, ''), '[^0-9]', '', 'g'), 9) AS k
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'patientId', p.id,
              'libelle', p.first_name || ' ' || p.last_name)
            ORDER BY p.last_name, p.first_name), '[]'::jsonb)
    FROM app.patients p, cle
   WHERE p.cabinet_id = app.current_cabinet()
     AND length(cle.k) = 9
     AND (right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 9) = cle.k
          OR (p.phone_alt IS NOT NULL
              AND right(regexp_replace(p.phone_alt, '[^0-9]', '', 'g'), 9) = cle.k))
   LIMIT 10;
$$;

-- Lie une conversation (prospect ou correction) à un dossier du cabinet.
CREATE OR REPLACE FUNCTION app.comm_lier_patient(
    p_conversation_id uuid,
    p_patient_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM app.patients p
                  WHERE p.id = p_patient_id
                    AND p.cabinet_id = app.current_cabinet()) THEN
    RETURN false;
  END IF;
  UPDATE app.communication_conversations c
     SET patient_id = p_patient_id
   WHERE c.id = p_conversation_id
     AND c.cabinet_id = app.current_cabinet();
  RETURN FOUND;
END;
$$;

-- Progression de remise : sent→delivered→read. Tout autre saut = exception.
CREATE OR REPLACE FUNCTION app.comm_suivi_statut(
    p_message_id uuid,
    p_statut text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_etat text;
  v_livraison uuid;
BEGIN
  IF p_statut NOT IN ('delivered', 'read') THEN
    RAISE EXCEPTION 'Statut de remise inconnu.';
  END IF;
  SELECT m.etat INTO v_etat
    FROM app.communication_messages m
    JOIN app.communication_conversations c ON c.id = m.conversation_id
   WHERE m.id = p_message_id
     AND c.cabinet_id = app.current_cabinet()
     FOR UPDATE OF m;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF (v_etat = 'sent' AND p_statut <> 'delivered')
     OR (v_etat = 'delivered' AND p_statut <> 'read')
     OR (v_etat NOT IN ('sent', 'delivered')) THEN
    RAISE EXCEPTION 'Progression de remise interdite.';
  END IF;
  UPDATE app.communication_messages SET etat = p_statut WHERE id = p_message_id;
  -- Miroir sur la dernière livraison (traçabilité retry, même transaction).
  SELECT d.id INTO v_livraison
    FROM app.message_deliveries d
   WHERE d.message_id = p_message_id
   ORDER BY d.created_at DESC
   LIMIT 1;
  IF FOUND THEN
    UPDATE app.message_deliveries SET statut = p_statut WHERE id = v_livraison;
  END IF;
  RETURN true;
END;
$$;

ALTER FUNCTION app.comm_matcher_patient(text) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_lier_patient(uuid, uuid) OWNER TO app_gatekeeper;
ALTER FUNCTION app.comm_suivi_statut(uuid, text) OWNER TO app_gatekeeper;

REVOKE ALL ON FUNCTION app.comm_matcher_patient(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_lier_patient(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.comm_suivi_statut(uuid, text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.comm_matcher_patient(text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_lier_patient(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION app.comm_suivi_statut(uuid, text) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('116_communication_appariement')
    ON CONFLICT DO NOTHING;

COMMIT;
