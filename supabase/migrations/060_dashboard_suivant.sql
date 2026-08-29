-- 060_dashboard_suivant — « patient suivant » disait une contre-vérité l'après-midi.
--
-- ═══ LE DÉFAUT, TROUVÉ AU CHECKPOINT V4 ═══════════════════════════════════
--
-- 059 choisissait le suivant par `ORDER BY starts_at` seul, parmi `confirmed`
-- et `arrived`. Deux conséquences, mesurées sur la base réelle le 2026-08-25 :
--
--   1. UN CRÉNEAU DU MATIN JAMAIS CLÔTURÉ RESTE « SUIVANT » TOUTE LA JOURNÉE.
--      Un rendez-vous de 08:00 encore `confirmed` à 15:30 — personne ne l'a
--      marqué arrivé ni absent, ce qui est le cas ordinaire d'une matinée
--      chargée — sortait devant tout le reste. L'écran du matin annonçait donc
--      comme « suivant » quelqu'un qui ne viendrait plus.
--
--   2. QUELQU'UN QUI ATTEND DANS LA SALLE PASSAIT APRÈS QUELQU'UN D'ABSENT.
--      Un patient `arrived` de 09:00 était classé derrière le `confirmed` de
--      08:00. Or `arrived` est un fait PHYSIQUE : la personne est là.
--
-- ═══ LA RÈGLE, MAINTENANT ═════════════════════════════════════════════════
--
--   · quelqu'un est dans la salle (`arrived`) → c'est lui, le plus ancien
--     arrivé d'abord ;
--   · sinon, le prochain `confirmed` DONT LE CRÉNEAU N'EST PAS TERMINÉ
--     (`ends_at > now()`) ;
--   · sinon `null` — et l'écran dit « Plus personne après cette séance. »
--
-- Un créneau passé jamais clôturé ne disparaît PAS pour autant : il reste dans
-- `journee` avec son statut « Attendu », qui est l'endroit juste pour le voir
-- et le régler. Il cesse seulement de se faire passer pour l'avenir.
--
-- ═══ CE QUE CE FICHIER NE FAIT PAS ════════════════════════════════════════
--
-- `CREATE OR REPLACE` sur la MÊME signature `(date) RETURNS jsonb` : aucun
-- DROP, donc le propriétaire et les privilèges survivent. Ils sont malgré tout
-- RÉAFFIRMÉS plus bas — un DROP/CREATE fait un jour par distraction rendrait
-- la fonction à son créateur, et une porte `SECURITY DEFINER` qui change de
-- propriétaire change de pouvoirs sans que rien ne le signale.
--
-- Aucune autre clé du contrat ne bouge. Ni table, ni colonne, ni type, ni
-- valeur d'enum (règle 9).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges du porteur — inchangés, redits (motif 022 §1)
-- ---------------------------------------------------------------------------
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

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

-- Réaffirmés délibérément — voir l'en-tête. `CREATE OR REPLACE` les préserve
-- déjà ; les redire coûte trois lignes et ferme la porte au jour où quelqu'un
-- passera par un DROP.
ALTER FUNCTION app.dashboard_today(date) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.dashboard_today(date) IS
  'V4, PERF §3 : TOUT le tableau de bord de la praticienne en UN appel. 060 — '
  'le « patient suivant » privilégie qui est PHYSIQUEMENT LÀ (arrived), puis le '
  'prochain attendu dont le créneau n''est pas terminé : un rendez-vous du '
  'matin jamais clôturé ne se fait plus passer pour l''avenir tout l''après-midi. '
  'La caisse reste cloisonnée comme app.day_revenue (ADR-005) et compte les '
  'paiements ENCAISSÉS, jamais les montants facturés. Aucune écriture. Une '
  'trace `liste` par appel, patient_id NULL (patron list_agenda).';

REVOKE ALL ON FUNCTION app.dashboard_today(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.dashboard_today(date) TO authenticated;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('060_dashboard_suivant')
  ON CONFLICT DO NOTHING;

COMMIT;
