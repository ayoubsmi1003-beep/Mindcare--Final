-- Keep expired proposals out of the dashboard confirmation cards.
-- The confirmation gate still checks status and expiry before any write.
BEGIN;

CREATE OR REPLACE FUNCTION app.dashboard_today(p_day date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $fn$
DECLARE
  v_role       app.user_role;
  v_debut      timestamptz;
  v_fin        timestamptz;
  v_mois_debut timestamptz;
  v_mois_fin   timestamptz;
  v_encaisse   jsonb;
  v_resultat   jsonb;
BEGIN
  IF p_day IS NULL THEN
    RETURN NULL;
  END IF;

  v_role := app.current_role();

  v_debut      := p_day::timestamp AT TIME ZONE 'Africa/Algiers';
  v_fin        := (p_day + 1)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_mois_debut := date_trunc('month', p_day)::timestamp AT TIME ZONE 'Africa/Algiers';
  v_mois_fin   := (date_trunc('month', p_day)::date + interval '1 month')::timestamp
                    AT TIME ZONE 'Africa/Algiers';

  PERFORM audit.log_read(NULL, 'liste');

  IF v_role = 'owner' THEN
    SELECT jsonb_build_object(
             'montant_dzd', COALESCE(SUM(p.amount_dzd)
                              FILTER (WHERE p.collected_at IS NOT NULL), 0)::bigint,
             'seances',     COUNT(*) FILTER (WHERE p.collected_at IS NOT NULL)::bigint,
             'perimetre',   'cabinet')
      INTO v_encaisse
      FROM app.payments p
     WHERE p.cabinet_id = app.current_cabinet()
       AND p.created_at >= v_debut
       AND p.created_at <  v_fin;

  ELSIF v_role = 'practitioner' THEN
    SELECT jsonb_build_object(
             'montant_dzd', COALESCE(SUM(p.amount_dzd)
                              FILTER (WHERE p.collected_at IS NOT NULL), 0)::bigint,
             'seances',     COUNT(*) FILTER (WHERE p.collected_at IS NOT NULL)::bigint,
             'perimetre',   'praticienne')
      INTO v_encaisse
      FROM app.payments p
     WHERE p.cabinet_id      = app.current_cabinet()
       AND p.practitioner_id = auth.uid()
       AND p.created_at >= v_debut
       AND p.created_at <  v_fin;

  ELSE
    v_encaisse := NULL;
  END IF;

  SELECT jsonb_build_object(

    'consultation_ouverte',
      (SELECT jsonb_build_object(
                'id',            c.id,
                'started_at',    c.started_at,
                'patient_id',    c.patient_id,
                'record_number', pt.record_number,
                'first_name',    pt.first_name,
                'last_name',     pt.last_name)
         FROM app.consultations c
         JOIN app.patients pt ON pt.id = c.patient_id
        WHERE c.practitioner_id = auth.uid()
          AND c.status = 'open'
        LIMIT 1),

    'journee', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'starts_at')
         FROM (
           SELECT jsonb_build_object(
                    'id',            a.id,
                    'starts_at',     a.starts_at,
                    'ends_at',       a.ends_at,
                    'status',        a.status,
                    'kind',          a.kind,
                    'arrived_at',    a.arrived_at,
                    'patient_id',    a.patient_id,
                    'record_number', pt.record_number,
                    'first_name',    pt.first_name,
                    'last_name',     pt.last_name
                  ) AS ligne
             FROM app.appointments a
             LEFT JOIN app.patients pt ON pt.id = a.patient_id
            WHERE a.practitioner_id = auth.uid()
              AND a.starts_at >= v_debut
              AND a.starts_at <  v_fin
              AND a.status IN ('confirmed','arrived','in_session','completed','no_show')
         ) g),
      '[]'::jsonb),

    -- ⚠️ LE CORRECTIF DE CE FICHIER — voir l'en-tête.
    -- `status <> 'arrived'` rend `false` (donc 0) pour les arrivés : en tri
    -- ASC, ils sortent devant. Le `ends_at > now()` ne s'applique QU'AUX
    -- attendus — un patient déjà dans la salle reste le suivant même si son
    -- créneau a débordé, parce qu'il est là.
    'suivant',
      (SELECT jsonb_build_object(
                'id',            a.id,
                'starts_at',     a.starts_at,
                'ends_at',       a.ends_at,
                'status',        a.status,
                'kind',          a.kind,
                'arrived_at',    a.arrived_at,
                'patient_id',    a.patient_id,
                'record_number', pt.record_number,
                'first_name',    pt.first_name,
                'last_name',     pt.last_name)
         FROM app.appointments a
         LEFT JOIN app.patients pt ON pt.id = a.patient_id
        WHERE a.practitioner_id = auth.uid()
          AND a.starts_at >= v_debut
          AND a.starts_at <  v_fin
          AND (a.status = 'arrived'
               OR (a.status = 'confirmed' AND a.ends_at > now()))
        ORDER BY (a.status <> 'arrived'), a.starts_at
        LIMIT 1),

    'attente_nombre',
      (SELECT COUNT(*)::bigint
         FROM app.appointments a
        WHERE a.practitioner_id = auth.uid()
          AND a.starts_at >= v_debut
          AND a.starts_at <  v_fin
          AND a.status = 'arrived'),

    'encaisse', v_encaisse,

    'nouveaux_patients_mois',
      (SELECT COUNT(*)::bigint
         FROM app.patients pt
        WHERE pt.practitioner_id = auth.uid()
          AND pt.created_at >= v_mois_debut
          AND pt.created_at <  v_mois_fin),

    'propositions', COALESCE(
      (SELECT jsonb_agg(ligne ORDER BY ligne->>'proposed_at' DESC)
         FROM (
           SELECT jsonb_build_object(
                    'id',             j.id,
                    'tool_name',      j.tool_name,
                    'tool_args',      j.tool_args,
                    'user_utterance', j.user_utterance,
                    'proposed_at',    j.proposed_at
                  ) AS ligne
             FROM app.jarvis_actions j
            WHERE j.cabinet_id = app.current_cabinet()
              AND j.actor_id   = auth.uid()
              AND j.state      = 'proposed'
              AND (j.expires_at IS NULL OR j.expires_at >= now())
            ORDER BY j.proposed_at DESC
            LIMIT 3
         ) g),
      '[]'::jsonb),

    'genere_a', now()
  )
  INTO v_resultat;

  RETURN v_resultat;
END;
$fn$;

ALTER FUNCTION app.dashboard_today(date) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.dashboard_today(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dashboard_today(date) TO authenticated;
INSERT INTO app.schema_migrations(version)
VALUES ('188_alexa_expired_actions_dashboard')
ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
