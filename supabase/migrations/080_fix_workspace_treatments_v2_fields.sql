-- 080_fix_workspace_treatments_v2_fields — patients.espaceTravail rendait
-- « regle-metier » (zod) pour tout patient portant un traitement en pause ou
-- arrêté récemment.
--
-- ADDITIF PUR. 076 est APPLIQUÉE : on ne la retouche pas (règle 9).
--
-- ═══ LE DÉFAUT ═══════════════════════════════════════════════════════════
-- Dans `get_patient_workspace`, `traitements_v2.actifs` rend l'ensemble complet
-- des colonnes (dose_unit, end_date, stopped_at, stopped_reason, created_at,
-- medication_id, form, strength, inn). `en_pause` et `arretes_recents`
-- n'en rendaient qu'un SOUS-ENSEMBLE — la jointure sur `app.medications`
-- existait déjà pour les deux, mais l'objet JSON omettait la moitié de ses
-- colonnes. Le contrat TypeScript (`TRAITEMENT_V2` dans `patients.ts`) exige
-- le même jeu de champs pour les trois listes : dès qu'un patient portait un
-- traitement en pause ou arrêté, le parse Zod échouait pour la FICHE ENTIÈRE
-- du patient (documents, agenda, tout redevenait invisible avec elle),
-- l'écran affichant « la réponse du serveur ne correspond pas au format
-- attendu ».
--
-- `medication_id` en particulier n'est pas cosmétique : c'est l'identifiant
-- dont la fonctionnalité de changement de dosage (liste déroulante des
-- présentations existantes du même médicament) a besoin, et son absence
-- l'aurait rendue impossible à construire pour un traitement en pause.
--
-- Reproduit : `get_patient_workspace` sur un patient dont un traitement V2
-- est en pause rendait bien un `en_pause` incomplet ; corrigé et vérifié en
-- base après application de cette migration.
--
-- 🔴 AUCUN `DROP` — un DROP emporterait le propriétaire `app_gatekeeper` et la
-- porte reviendrait à `postgres` (rolbypassrls).

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

CREATE OR REPLACE FUNCTION app.get_patient_workspace(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat      app.patients%ROWTYPE;
  v_clinique boolean;
  v_resultat jsonb;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;
  PERFORM audit.log_read(p_id, 'fiche');
  SELECT * INTO v_pat FROM app.patients WHERE id = p_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  v_clinique := app.can_see_clinical(v_pat.practitioner_id);

  SELECT jsonb_build_object(
    'contrat',  1,
    'genere_a', now(),
    'identite', jsonb_build_object(
      'id', v_pat.id, 'record_number', v_pat.record_number,
      'first_name', v_pat.first_name, 'last_name', v_pat.last_name,
      'birth_date', v_pat.birth_date,
      'age', CASE WHEN v_pat.birth_date IS NULL THEN NULL ELSE extract(year FROM age(v_pat.birth_date))::int END,
      'sex', v_pat.sex, 'is_active', v_pat.is_active
    ),
    'contact', jsonb_build_object('phone', v_pat.phone, 'phone_alt', v_pat.phone_alt, 'address', v_pat.address, 'emergency_contact', v_pat.emergency_contact),
    'identification', jsonb_build_object('id_document_number', v_pat.id_document_number, 'id_document_issuer', v_pat.id_document_issuer),
    'admin', jsonb_build_object('notes_admin', v_pat.notes_admin),
    'clinique', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(
      'diagnostics', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', d.id, 'code_system', d.code_system, 'code', d.code, 'label', d.label, 'is_primary', d.is_primary, 'onset_date', d.onset_date, 'resolved_at', d.resolved_at) ORDER BY d.is_primary DESC, d.onset_date DESC NULLS LAST, d.created_at DESC) FROM app.diagnoses d WHERE d.patient_id = p_id), '[]'::jsonb),
      'echelles', COALESCE((SELECT jsonb_agg(jsonb_build_object('scale_code', e.code, 'scale_name', e.name_fr, 'dernier', jsonb_build_object('score', e.d_score, 'date', e.d_date, 'interpretation', e.d_interp), 'precedent', CASE WHEN e.p_date IS NULL THEN 'null'::jsonb ELSE jsonb_build_object('score', e.p_score, 'date', e.p_date) END, 'delta', CASE WHEN e.p_score IS NULL OR e.d_score IS NULL THEN NULL ELSE e.d_score - e.p_score END) ORDER BY e.d_date DESC) FROM (SELECT r.code, r.name_fr, max(r.total_score) FILTER (WHERE r.rang=1) AS d_score, max(r.administered_at) FILTER (WHERE r.rang=1) AS d_date, max(r.interpretation) FILTER (WHERE r.rang=1) AS d_interp, max(r.total_score) FILTER (WHERE r.rang=2) AS p_score, max(r.administered_at) FILTER (WHERE r.rang=2) AS p_date FROM (SELECT s.code, s.name_fr, sa.total_score, sa.interpretation, sa.administered_at, row_number() OVER (PARTITION BY sa.scale_id ORDER BY sa.administered_at DESC) AS rang FROM app.scale_administrations sa JOIN app.scales s ON s.id=sa.scale_id WHERE sa.patient_id=p_id) r WHERE r.rang<=2 GROUP BY r.code, r.name_fr) e), '[]'::jsonb),
      'derniere_consultation', (SELECT jsonb_build_object('id', c.id, 'started_at', c.started_at, 'ended_at', c.ended_at, 'status', c.status, 'kind', c.kind, 'practitioner_name', pr.full_name) FROM app.consultations c LEFT JOIN app.profiles pr ON pr.id=c.practitioner_id WHERE c.patient_id=p_id ORDER BY c.started_at DESC LIMIT 1),
      'nombre_consultations', (SELECT count(*) FROM app.consultations c WHERE c.patient_id=p_id)
    ) END,
    'traitements', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE jsonb_build_object(
      'derniere_prescription', (SELECT jsonb_build_object('id', px.id, 'prescribed_at', px.prescribed_at, 'is_handwritten', px.is_handwritten, 'practitioner_name', pr.full_name, 'lignes', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pl.id, 'designation', COALESCE(m.inn, pl.free_text), 'brand_name', m.brand_name, 'dose', pl.dose, 'frequency_per_day', pl.frequency_per_day, 'duration_days', pl.duration_days, 'instructions', pl.instructions) ORDER BY pl.position) FROM app.prescription_lines pl LEFT JOIN app.medications m ON m.id=pl.medication_id WHERE pl.prescription_id=px.id), '[]'::jsonb)) FROM app.prescriptions px LEFT JOIN app.profiles pr ON pr.id=px.practitioner_id WHERE px.patient_id=p_id ORDER BY px.prescribed_at DESC LIMIT 1),
      'nombre_prescriptions', (SELECT count(*) FROM app.prescriptions px WHERE px.patient_id=p_id)
    ) END,
    -- ADDITIF — ne casse aucun consommateur existant (contrat reste 1)
    'traitements_v2', CASE WHEN NOT v_clinique THEN 'null'::jsonb ELSE
      (SELECT jsonb_build_object(
        'actifs', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', pt.id, 'status', pt.status, 'dose', pt.dose, 'dose_unit', pt.dose_unit, 'frequency', pt.frequency, 'timing', pt.timing, 'instructions', pt.instructions,
                  'start_date', pt.start_date, 'end_date', pt.end_date, 'stopped_at', pt.stopped_at, 'stopped_reason', pt.stopped_reason,
                  'current_version', pt.current_version, 'created_at', pt.created_at, 'updated_at', pt.updated_at,
                  'medication_id', pt.medication_id, 'medication_raw', m.source_raw_value, 'brand_name', m.brand_name, 'form', m.form, 'strength', m.strength, 'inn', m.inn
                ) ORDER BY pt.start_date DESC, pt.created_at DESC)
          FROM app.patient_treatments pt JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=p_id AND pt.status='active'), '[]'::jsonb),
        -- CORRECTIF 080 — même jeu de colonnes que `actifs`, ci-dessus. La
        -- jointure sur `app.medications` existait déjà ; seul l'objet JSON
        -- en omettait la moitié.
        'en_pause', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', pt.id, 'status', pt.status, 'dose', pt.dose, 'dose_unit', pt.dose_unit, 'frequency', pt.frequency, 'timing', pt.timing, 'instructions', pt.instructions,
                  'start_date', pt.start_date, 'end_date', pt.end_date, 'stopped_at', pt.stopped_at, 'stopped_reason', pt.stopped_reason,
                  'current_version', pt.current_version, 'created_at', pt.created_at, 'updated_at', pt.updated_at,
                  'medication_id', pt.medication_id, 'medication_raw', m.source_raw_value, 'brand_name', m.brand_name, 'form', m.form, 'strength', m.strength, 'inn', m.inn
                ) ORDER BY pt.updated_at DESC)
          FROM app.patient_treatments pt JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=p_id AND pt.status='paused'), '[]'::jsonb),
        'arretes_recents', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                  'id', pt.id, 'status', pt.status, 'dose', pt.dose, 'dose_unit', pt.dose_unit, 'frequency', pt.frequency, 'timing', pt.timing, 'instructions', pt.instructions,
                  'start_date', pt.start_date, 'end_date', pt.end_date, 'stopped_at', pt.stopped_at, 'stopped_reason', pt.stopped_reason,
                  'current_version', pt.current_version, 'created_at', pt.created_at, 'updated_at', pt.updated_at,
                  'medication_id', pt.medication_id, 'medication_raw', m.source_raw_value, 'brand_name', m.brand_name, 'form', m.form, 'strength', m.strength, 'inn', m.inn
                ) ORDER BY pt.stopped_at DESC)
          FROM app.patient_treatments pt JOIN app.medications m ON m.id=pt.medication_id WHERE pt.patient_id=p_id AND pt.status='stopped' AND pt.stopped_at > now() - interval '90 days' LIMIT 20), '[]'::jsonb),
        'total_actifs', (SELECT count(*) FROM app.patient_treatments WHERE patient_id=p_id AND status='active'),
        'total', (SELECT count(*) FROM app.patient_treatments WHERE patient_id=p_id)
      ))
    END,
    'agenda', jsonb_build_object(
      'prochain_rendez_vous', (SELECT jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'kind', a.kind, 'practitioner_name', pr.full_name) FROM app.appointments a LEFT JOIN app.profiles pr ON pr.id=a.practitioner_id WHERE a.patient_id=p_id AND a.starts_at >= now() AND a.status NOT IN ('cancelled','no_show') ORDER BY a.starts_at ASC LIMIT 1),
      'dernier_rendez_vous', (SELECT jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'status', a.status, 'kind', a.kind, 'practitioner_name', pr.full_name) FROM app.appointments a LEFT JOIN app.profiles pr ON pr.id=a.practitioner_id WHERE a.patient_id=p_id AND a.starts_at < now() ORDER BY a.starts_at DESC LIMIT 1),
      'nombre_rendez_vous', (SELECT count(*) FROM app.appointments a WHERE a.patient_id=p_id)
    ),
    'documents', jsonb_build_object('nombre', (SELECT count(*) FROM app.documents dc WHERE dc.patient_id=p_id), 'dernier_emis_le', (SELECT max(dc.issued_at) FROM app.documents dc WHERE dc.patient_id=p_id))
  ) INTO v_resultat;
  RETURN v_resultat;
END;
$$;
ALTER FUNCTION app.get_patient_workspace(uuid) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.get_patient_workspace(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_patient_workspace(uuid) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('080_fix_workspace_treatments_v2_fields')
  ON CONFLICT DO NOTHING;

COMMIT;
