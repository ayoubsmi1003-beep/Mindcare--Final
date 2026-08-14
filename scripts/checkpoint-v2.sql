-- assert-l1.sql — ce que le rejeu doit PROUVER de 033 et 034.
--
-- DEUX DÉFAUTS DE CE FICHIER, TROUVÉS À L'EXÉCUTION ET CORRIGÉS ICI :
--   1. `session_token` est un `uuid` (028:38), pas du texte.
--   2. `SET LOCAL` hors bloc transactionnel n'a AUCUN effet — psql est en
--      autocommit. `auth.uid()` restait NULL, `app.current_cabinet()` aussi, et
--      le contrôle de cloisonnement rendait « 0 ligne visible » parce qu'il n'y
--      avait AUCUNE ligne, pas parce que la RLS cloisonnait. Un faux vert exact.
--      D'où `SET` simple, au niveau session, dont l'effet est vérifié par C0.
--
-- Chaque contrôle compare une valeur mesurée à une valeur attendue. Aucun ne se
-- déclare vert par simple absence d'erreur.

\pset pager off
\pset format aligned
\pset tuples_only on

CREATE OR REPLACE FUNCTION pg_temp.verdict(nom text, ok boolean, detail text)
RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT rpad(nom, 46) || ' | ' || CASE WHEN ok THEN 'VERT ' ELSE 'ROUGE' END || ' | ' || detail $$;

-- ═══ 1 · Les quatre portes existent et sont SECURITY INVOKER ═══
SELECT pg_temp.verdict('C1 · 4 portes 033 présentes', count(*) = 4,
  count(*) || '/4 : ' || string_agg(proname, ', ' ORDER BY proname))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND p.proname IN ('propose_jarvis_action','confirm_jarvis_action',
                                          'reject_jarvis_action','execute_jarvis_action');

SELECT pg_temp.verdict('C2 · prosecdef = false sur les 4',
  count(*) FILTER (WHERE p.prosecdef) = 0,
  'DEFINER trouvés : ' || coalesce(string_agg(p.proname, ', ') FILTER (WHERE p.prosecdef), 'aucun'))
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND p.proname IN ('propose_jarvis_action','confirm_jarvis_action',
                                          'reject_jarvis_action','execute_jarvis_action');

-- `proacl` NULL = défaut Postgres = EXECUTE à PUBLIC. C'est ce que le REVOKE de
-- 033 §6 doit avoir supprimé : NULL est donc ROUGE, pas « rien à signaler ».
SELECT pg_temp.verdict('C3 · ACL sans PUBLIC ni anon',
  bool_and(p.proacl IS NOT NULL
           AND array_to_string(p.proacl, ',') LIKE '%authenticated=X%'
           AND array_to_string(p.proacl, ',') NOT LIKE '%anon=X%'
           AND array_to_string(p.proacl, ',') NOT LIKE '=X%'
           AND array_to_string(p.proacl, ',') NOT LIKE '%,=X%'),
  'aucune entrée PUBLIC (=X) ni anon sur les 4')
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'app' AND p.proname IN ('propose_jarvis_action','confirm_jarvis_action',
                                          'reject_jarvis_action','execute_jarvis_action');

-- ═══ 2 · Allowlists ═══
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN
    INSERT INTO app.jarvis_actions (cabinet_id, actor_id, conversation_id,
                                    user_utterance, tool_name, tool_args)
    VALUES ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-0000000000a1',
            gen_random_uuid(), 'test', 'delete_patient', '{}'::jsonb);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  CREATE TEMP TABLE r_c4 AS SELECT v_ok AS ok;
END $$;
SELECT pg_temp.verdict('C4 · allowlist 033 refuse un 6e outil', ok,
  CASE WHEN ok THEN 'check_violation levée' ELSE 'INSERT ACCEPTÉ — allowlist absente' END) FROM r_c4;

DO $$
DECLARE v_ok boolean := false; v_n integer;
BEGIN
  INSERT INTO audit.boundary_crossings (purpose, provider, model, prompt_version,
                                        prompt_hash, session_token, outcome, latency_ms)
  VALUES ('jarvis','t','m','v','h',gen_random_uuid(),'ok',1),
         ('voix-entree','t','m','v','h',gen_random_uuid(),'ok',1),
         ('voix-sortie','t','m','v','h',gen_random_uuid(),'ok',1);
  SELECT count(*) INTO v_n FROM audit.boundary_crossings WHERE purpose IN ('voix-entree','voix-sortie');
  BEGIN
    INSERT INTO audit.boundary_crossings (purpose, provider, model, prompt_version,
                                          prompt_hash, session_token, outcome, latency_ms)
    VALUES ('exfiltration','t','m','v','h',gen_random_uuid(),'ok',1);
  EXCEPTION WHEN check_violation THEN v_ok := true;
  END;
  CREATE TEMP TABLE r_c5 AS SELECT v_ok AS ok, v_n AS n;
END $$;
SELECT pg_temp.verdict('C5 · 034 : voix acceptée, purpose inconnu refusé', ok AND n = 2,
  n || ' ligne(s) voix écrite(s) ; purpose inconnu ' ||
  CASE WHEN ok THEN 'refusé' ELSE 'ACCEPTÉ — allowlist ouverte' END) FROM r_c5;

-- ═══ 3 · Sous l'identité réelle d'une praticienne ═══
-- `SET`, pas `SET LOCAL` : psql est en autocommit, un SET LOCAL serait perdu.
SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- C0 — l'identité est-elle RÉELLEMENT prise ? Sans ce contrôle, tout ce qui
-- suit peut passer au vert par vacuité. C'est le défaut qui a été trouvé ici.
SELECT pg_temp.verdict('C0 · identité effective (auth.uid + cabinet)',
  auth.uid() = '00000000-0000-0000-0000-0000000000a1'::uuid
  AND app.current_cabinet() = '00000000-0000-0000-0000-000000000001'::uuid,
  'uid=' || coalesce(auth.uid()::text,'NULL') || ' role=' || current_user);

-- C6 — propose écrit `proposed`, sans confirmed_at
DO $$
DECLARE v_id uuid; v_state app.jarvis_state; v_conf timestamptz;
BEGIN
  v_id := app.propose_jarvis_action(gen_random_uuid(), 'fixe le tarif',
            'set_consultation_price',
            '{"consultation_id":"00000000-0000-0000-0000-0000000000ff","amount_dzd":3000}');
  SELECT state, confirmed_at INTO v_state, v_conf FROM app.jarvis_actions WHERE id = v_id;
  CREATE TEMP TABLE r_c6 AS SELECT v_id AS id, v_state::text AS st, v_conf AS conf;
END $$;
SELECT pg_temp.verdict('C6 · propose → proposed, confirmed_at NULL',
  st = 'proposed' AND conf IS NULL,
  'state=' || st || ' confirmed_at=' || coalesce(conf::text,'NULL')) FROM r_c6;

-- C7 — exécuter SANS confirmer est refusé
DO $$
DECLARE v_ok boolean := false; v_id uuid;
BEGIN
  SELECT id INTO v_id FROM r_c6;
  BEGIN PERFORM app.execute_jarvis_action(v_id);
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  CREATE TEMP TABLE r_c7 AS SELECT v_ok AS ok;
END $$;
SELECT pg_temp.verdict('C7 · exécution sans confirmation refusée', ok,
  CASE WHEN ok THEN 'exception levée' ELSE 'EXÉCUTÉE — la porte est contournable' END) FROM r_c7;

-- C8/C9/C10 — cible hors périmètre : ordre, état, message
--
-- ⚠️ CONFIRMER ET EXÉCUTER SONT ÉMIS EN DEUX INSTRUCTIONS SÉPARÉES, donc en
-- DEUX TRANSACTIONS (psql est en autocommit). Ce n'est pas un détail de
-- rédaction : `now()` rend l'horodatage de TRANSACTION. Réunis dans un même
-- bloc `DO`, les deux appels donnent `confirmed_at = executed_at` à la
-- microseconde près et l'ordre cesse d'être démontrable — mesuré ici même, le
-- contrôle est passé au ROUGE. C'est précisément ce que l'en-tête de 033
-- revendique : deux portes, deux appels. CONTRAINTE SUR L3 : le service TS doit
-- émettre deux `rpc` distincts, jamais une transaction qui les réunit.
SELECT app.confirm_jarvis_action((SELECT id FROM r_c6)) AS _c8_confirm \gset
SELECT pg_sleep(0.02) AS _c8_pause \gset
SELECT app.execute_jarvis_action((SELECT id FROM r_c6)) AS _c8_execute \gset

CREATE TEMP TABLE r_c8 AS
SELECT confirmed_at AS conf, executed_at AS exec, state::text AS st, error AS err, affected_id AS aff
  FROM app.jarvis_actions WHERE id = (SELECT id FROM r_c6);
SELECT pg_temp.verdict('C8 · confirmed_at < executed_at',
  conf IS NOT NULL AND exec IS NOT NULL AND conf < exec,
  'confirmed=' || coalesce(conf::text,'NULL') || ' executed=' || coalesce(exec::text,'NULL')) FROM r_c8;
SELECT pg_temp.verdict('C9 · cible hors périmètre → failed, pas executed',
  st = 'failed' AND aff IS NULL, 'state=' || st || ' affected_id=' || coalesce(aff::text,'NULL')) FROM r_c8;
SELECT pg_temp.verdict('C10 · error = SQLSTATE seul, jamais SQLERRM',
  err ~ '^[0-9A-Z]{5}$', 'error=' || coalesce(err,'NULL')) FROM r_c8;

-- C11 — reject
DO $$
DECLARE v_id uuid; v_st text;
BEGIN
  v_id := app.propose_jarvis_action(gen_random_uuid(), 'annule', 'create_appointment',
            '{"patient_id":"00000000-0000-0000-0000-0000000000b1"}');
  PERFORM app.reject_jarvis_action(v_id);
  SELECT state::text INTO v_st FROM app.jarvis_actions WHERE id = v_id;
  CREATE TEMP TABLE r_c11 AS SELECT v_st AS st;
END $$;
SELECT pg_temp.verdict('C11 · reject → rejected', st = 'rejected', 'state=' || st) FROM r_c11;

-- C12 — outil hors allowlist refusé par la porte, message lisible
DO $$
DECLARE v_ok boolean := false;
BEGIN
  BEGIN PERFORM app.propose_jarvis_action(gen_random_uuid(), 'x', 'get_patient', '{}');
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  CREATE TEMP TABLE r_c12 AS SELECT v_ok AS ok;
END $$;
SELECT pg_temp.verdict('C12 · propose refuse un outil hors allowlist', ok,
  CASE WHEN ok THEN 'refusée' ELSE 'ACCEPTÉE' END) FROM r_c12;

-- C13 — arguments illisibles refusés AVANT tout INSERT
DO $$
DECLARE v_ok boolean := false; v_avant integer; v_apres integer;
BEGIN
  SELECT count(*) INTO v_avant FROM app.jarvis_actions;
  BEGIN PERFORM app.propose_jarvis_action(gen_random_uuid(), 'x', 'create_appointment', 'pas du json');
  EXCEPTION WHEN others THEN v_ok := true;
  END;
  SELECT count(*) INTO v_apres FROM app.jarvis_actions;
  CREATE TEMP TABLE r_c13 AS SELECT v_ok AS ok, v_avant AS avant, v_apres AS apres;
END $$;
SELECT pg_temp.verdict('C13 · args non-JSON refusés, aucune ligne écrite',
  ok AND avant = apres, 'lignes ' || avant || '→' || apres) FROM r_c13;

-- ═══ 4 · LE CHEMIN NOMINAL — confirmé PUIS exécuté, avec effet réel ═══
-- Sans ce contrôle, tout le reste prouverait seulement que la porte sait
-- refuser. Une porte qui refuse tout est verte et inutile.
DO $$
DECLARE v_id uuid; v_aff uuid; v_st text; v_appt integer;
BEGIN
  v_id := app.propose_jarvis_action(gen_random_uuid(), 'crée un RDV', 'create_appointment',
    json_build_object('patient_id','00000000-0000-0000-0000-0000000000b1',
                      'practitioner_id','00000000-0000-0000-0000-0000000000a1',
                      'starts_at', (now() + interval '2 days')::text,
                      'duration_minutes', 30,
                      'notes_admin', null,
                      'kind', 'suivi')::text);
  PERFORM app.confirm_jarvis_action(v_id);
  PERFORM app.execute_jarvis_action(v_id);
  SELECT state::text, affected_id INTO v_st, v_aff FROM app.jarvis_actions WHERE id = v_id;
  SELECT count(*) INTO v_appt FROM app.appointments WHERE id = v_aff;
  CREATE TEMP TABLE r_c15 AS SELECT v_st AS st, v_aff AS aff, v_appt AS n,
    (SELECT error FROM app.jarvis_actions WHERE id = v_id) AS err;
END $$;
SELECT pg_temp.verdict('C15 · chemin nominal : executed + RDV réel',
  st = 'executed' AND aff IS NOT NULL AND n = 1,
  'state=' || st || ' rdv=' || n || coalesce(' err=' || err, '')) FROM r_c15;

-- ═══ 5 · Cloisonnement — mesuré depuis une AUTRE praticienne ═══
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.verdict('C14 · RLS jarvis_own cloisonne par acteur',
  auth.uid() = '00000000-0000-0000-0000-0000000000a2'::uuid AND count(*) = 0,
  count(*) || ' ligne(s) visible(s) depuis a2 ; uid=' || coalesce(auth.uid()::text,'NULL'))
FROM app.jarvis_actions;

-- C16 — et elle ne peut pas non plus EXÉCUTER l'action d'une autre
DO $$
DECLARE v_ok boolean := false; v_r uuid;
BEGIN
  SELECT id INTO v_r FROM app.jarvis_actions LIMIT 1;   -- invisible : NULL attendu
  v_ok := v_r IS NULL;
  CREATE TEMP TABLE r_c16 AS SELECT v_ok AS ok;
END $$;
SELECT pg_temp.verdict('C16 · aucune action d''autrui n''est atteignable', ok,
  CASE WHEN ok THEN 'aucune ligne atteignable' ELSE 'LIGNE VISIBLE — cloison percée' END) FROM r_c16;

RESET ROLE;
