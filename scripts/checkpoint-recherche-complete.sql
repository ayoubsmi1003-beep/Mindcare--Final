-- ═══════════════════════════════════════════════════════════════════════════
-- checkpoint-recherche-complete.sql — preuve de complétude des deux portes.
--
-- À exécuter sur mc-p3 (ou toute base de cabinet) :
--   docker exec -i mc-p3 psql -U postgres -d mindcare -X -v ON_ERROR_STOP=1 \
--     -f /tmp/checkpoint-recherche-complete.sql
--
-- Tout est exécuté sous `authenticated` avec l'identité d'un propriétaire
-- actif, puis ROLLBACK : aucune ligne d'audit de test n'est conservée.
-- Aucun nom de patient n'est affiché — seuls des comptages et des booléens.
-- ═══════════════════════════════════════════════════════════════════════════

\set ON_ERROR_STOP on

SELECT id AS owner_id
FROM app.profiles
WHERE role = 'owner' AND is_active
ORDER BY id
LIMIT 1
\gset

BEGIN;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'owner_id', true);

DO $$
DECLARE
  v_total    bigint;
  v_seen     bigint;
  v_off      integer;
  v_ms       numeric;
  v_start    timestamptz;
  v_missing  integer := 0;
  r          record;
BEGIN
  -- ── Médicaments : le cas signalé « troxene » ───────────────────────────
  SELECT max(total_count) INTO v_total
  FROM app.search_medications_page('troxene', 50, 0);
  IF coalesce(v_total, 0) < 1 THEN
    RAISE EXCEPTION 'troxene : aucun résultat';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM app.search_medications_page('troxene', 50, 0)
    WHERE raw_name LIKE 'TRANXENE%'
  ) THEN
    RAISE EXCEPTION 'troxene : TRANXENE absent du repli approximatif';
  END IF;
  RAISE NOTICE 'PASS troxene -> TRANXENE (% résultats approximatifs)', v_total;

  -- ── Médicaments : « doli » doit rendre les 33 lignes, pas 8 ────────────
  SELECT max(total_count) INTO v_total
  FROM app.search_medications_page('doli', 100, 0);
  SELECT count(*) INTO v_seen
  FROM app.search_medications_page('doli', 100, 0);
  IF v_total < 30 OR v_seen <> v_total THEN
    RAISE EXCEPTION 'doli : % visibles sur %', v_seen, v_total;
  END IF;
  RAISE NOTICE 'PASS doli : % lignes visibles', v_seen;

  -- ── Médicaments : multi-mots et séparateurs ────────────────────────────
  SELECT max(total_count) INTO v_total
  FROM app.search_medications_page('amox clav', 50, 0);
  IF coalesce(v_total, 0) < 1 THEN
    RAISE EXCEPTION 'amox clav : aucun résultat';
  END IF;
  SELECT max(total_count) INTO v_seen
  FROM app.search_medications_page('amoxicilline acide clavulanique', 50, 0);
  IF coalesce(v_seen, 0) < 1 THEN
    RAISE EXCEPTION 'amoxicilline acide clavulanique : aucun résultat';
  END IF;
  RAISE NOTICE 'PASS multi-mots : amox clav=%, amoxicilline/acide=%', v_total, v_seen;

  -- ── Médicaments : pagination exhaustive de « para » ────────────────────
  SELECT max(total_count) INTO v_total
  FROM app.search_medications_page('para', 100, 0);
  IF coalesce(v_total, 0) < 2 THEN
    RAISE EXCEPTION 'para : total % insuffisant pour éprouver la pagination', v_total;
  END IF;
  v_seen := 0;
  FOR v_off IN 0..(v_total - 1) BY 100 LOOP
    SELECT v_seen + count(*) INTO v_seen
    FROM app.search_medications_page('para', 100, v_off);
  END LOOP;
  IF v_seen <> v_total THEN
    RAISE EXCEPTION 'para : pagination % / %', v_seen, v_total;
  END IF;
  RAISE NOTICE 'PASS para : pagination %/%', v_seen, v_total;

  -- ── Patients : toutes les pages couvrent le total ──────────────────────
  SELECT max(total_count) INTO v_total FROM app.search_patients(NULL, 100, 0);
  IF coalesce(v_total, 0) < 1 THEN
    RAISE EXCEPTION 'patients : aucun dossier visible';
  END IF;
  v_seen := 0;
  FOR v_off IN 0..(v_total - 1) BY 100 LOOP
    SELECT v_seen + count(*) INTO v_seen
    FROM app.search_patients(NULL, 100, v_off);
  END LOOP;
  IF v_seen <> v_total THEN
    RAISE EXCEPTION 'patients : pagination % / %', v_seen, v_total;
  END IF;
  RAISE NOTICE 'PASS patients : pagination %/%', v_seen, v_total;

  -- ── Patients : « nom prénom » retrouve le dossier ──────────────────────
  FOR r IN
    SELECT id, first_name, last_name
    FROM app.search_patients(NULL, 5, 0)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM app.search_patients(r.last_name || ' ' || r.first_name, 100, 0)
      WHERE id = r.id
    ) THEN
      v_missing := v_missing + 1;
    END IF;
  END LOOP;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'patients : % dossier(s) absent(s) en ordre nom-prénom', v_missing;
  END IF;
  RAISE NOTICE 'PASS patients : ordre nom-prénom retrouve les 5 premiers dossiers';

  -- ── Repli arabe : la fonction 108 est toujours là ──────────────────────
  IF app.pli_arabe('أحمد') <> 'احمد' THEN
    RAISE EXCEPTION 'pli_arabe : repli arabe cassé';
  END IF;
  RAISE NOTICE 'PASS repli arabe';

  -- ── Performance chaude (rapport, pas une borne de production) ──────────
  v_start := clock_timestamp();
  PERFORM count(*) FROM app.search_medications_page('doli', 50, 0);
  v_ms := round(extract(epoch FROM clock_timestamp() - v_start) * 1000, 1);
  RAISE NOTICE 'INFO médicaments doli : % ms (chaud, poste de dev)', v_ms;

  v_start := clock_timestamp();
  PERFORM count(*) FROM app.search_patients('benali', 50, 0);
  v_ms := round(extract(epoch FROM clock_timestamp() - v_start) * 1000, 1);
  RAISE NOTICE 'INFO patients benali : % ms (chaud, poste de dev)', v_ms;
END;
$$;

ROLLBACK;
