-- checkpoint-v2-rls.sql — « RLS vérifiée pour les 3 rôles » (§7.2 de CLAUDE.md),
-- mesurée par la SEULE voie qu'ADR-016 autorise.
--
-- ═══ POURQUOI PAS TROIS CONNEXIONS AU NAVIGATEUR ═══
-- ADR-016 condition 1 interdit l'accès praticien sur l'instance cloud, et `015`
-- rend les trois comptes NON CONNECTABLES en posant un `encrypted_password`
-- volontairement non hashable. Ce n'est pas un obstacle à contourner : c'est le
-- garde-fou. `015:28-29` dit ce qu'il faut faire à la place, noir sur blanc —
-- « ils ne servent qu'à porter les profiles que les tests RLS empruntent via
-- request.jwt.claim.sub ». C'est cette voie-là, et elle ne demande aucun mot de
-- passe.
--
-- ═══ LE PIÈGE DÉJÀ PAYÉ, ET POURQUOI CE FICHIER N'EN MEURT PAS ═══
-- `SET LOCAL` hors bloc transactionnel n'a AUCUN effet : psql est en autocommit.
-- `auth.uid()` reste NULL, `app.current_cabinet()` aussi, et un contrôle de
-- cloisonnement rend « 0 ligne visible » PARCE QU'IL N'Y A AUCUNE LIGNE, pas
-- parce que la RLS cloisonne. Un faux vert exact. D'où `SET` simple, au niveau
-- session — et surtout : CHAQUE identité est vérifiée par un contrôle d'identité
-- effective AVANT qu'on ne conclue quoi que ce soit de ce qu'elle voit.
--
-- ⛔ NE TOURNE QUE SUR LA BASE JETABLE du rejeu. Aucune URL distante ici.

\pset pager off
\pset format aligned
\pset tuples_only on

CREATE OR REPLACE FUNCTION pg_temp.verdict(nom text, ok boolean, detail text)
RETURNS text LANGUAGE sql IMMUTABLE AS
$$ SELECT rpad(nom, 46) || ' | ' || CASE WHEN ok THEN 'VERT ' ELSE 'ROUGE' END || ' | ' || detail $$;

-- Les trois identités de 015. a1 = owner · a2 = practitioner · a3 = assistant.
\set A1 '00000000-0000-0000-0000-0000000000a1'
\set A2 '00000000-0000-0000-0000-0000000000a2'
\set A3 '00000000-0000-0000-0000-0000000000a3'

-- ═══════════════════════════════════════════════════════════════════════════
-- R0 · L'IDENTITÉ EST RÉELLEMENT PRISE — sans quoi tout le reste ment
-- ═══════════════════════════════════════════════════════════════════════════

SET ROLE authenticated;
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.verdict('R0a · identité owner effective',
  auth.uid() = :'A1'::uuid AND current_user = 'authenticated',
  'uid=' || coalesce(auth.uid()::text, 'NULL') || ' role=' || current_user);

SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';
SELECT pg_temp.verdict('R0b · identité praticien2 effective',
  auth.uid() = :'A2'::uuid, 'uid=' || coalesce(auth.uid()::text, 'NULL'));

SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';
SELECT pg_temp.verdict('R0c · identité assistante effective',
  auth.uid() = :'A3'::uuid, 'uid=' || coalesce(auth.uid()::text, 'NULL'));

-- Le rôle applicatif vient de `app.profiles`, pas d'une supposition du test.
SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
SELECT pg_temp.verdict('R0d · les 3 rôles applicatifs sont distincts',
  (SELECT count(DISTINCT role) FROM app.profiles
    WHERE id IN (:'A1'::uuid, :'A2'::uuid, :'A3'::uuid)) = 3,
  (SELECT string_agg(role::text, ', ' ORDER BY role::text) FROM app.profiles
    WHERE id IN (:'A1'::uuid, :'A2'::uuid, :'A3'::uuid)));

-- ═══════════════════════════════════════════════════════════════════════════
-- R1 · LA PORTE QUI JOURNALISE — règle 6 / ADR-019, pour LES TROIS RÔLES
--
-- Le `SELECT` direct sur `app.patients` est RÉVOQUÉ. Lire un dossier sans
-- laisser de trace doit rendre `permission denied`, et pas « 0 ligne » : zéro
-- ligne serait indiscernable d'un périmètre vide.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_sub  text;
  v_ok   boolean;
  v_res  text := '';
BEGIN
  FOREACH v_sub IN ARRAY ARRAY[
    '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-0000000000a3'] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_sub, false);
    v_ok := false;
    BEGIN
      PERFORM 1 FROM app.patients LIMIT 1;
    EXCEPTION
      WHEN insufficient_privilege THEN v_ok := true;
    END;
    v_res := v_res || right(v_sub, 2) || ':' || CASE WHEN v_ok THEN 'refuse' ELSE 'LU' END || ' ';
  END LOOP;
  CREATE TEMP TABLE r_r1 AS SELECT v_res AS detail, (v_res NOT LIKE '%LU%') AS ok;
END $$;
SELECT pg_temp.verdict('R1 · SELECT direct app.patients refusé aux 3', ok, detail) FROM r_r1;

-- ═══════════════════════════════════════════════════════════════════════════
-- R2 · LES PORTES DE 033 CLOISONNENT PAR ACTEUR
--
-- Une action proposée par a1 ne doit être NI VISIBLE, NI CONFIRMABLE, NI
-- EXÉCUTABLE par a2. « Non confirmable » se mesure au RETOUR de la porte, pas
-- à l'absence d'erreur : `confirm_jarvis_action` rend NULL quand la ligne est
-- masquée par la RLS — délibérément le même retour que pour une ligne
-- inexistante, pour ne pas fabriquer d'oracle d'existence (ADR-003).
-- ═══════════════════════════════════════════════════════════════════════════

SET request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $$
DECLARE
  v_id             uuid;
  v_conf_autre     timestamptz;
  v_exec_autre     boolean := false;
  v_etat_apres     app.jarvis_state;
  v_conf_propre    timestamptz;
  v_rejeu          boolean := false;
BEGIN
  -- a1 propose. `propose_jarvis_action` prend l'acteur de auth.uid(), jamais
  -- de l'appelant.
  -- ⚠️ `p_tool_args` est du TEXTE, pas du `jsonb` (033:79) — la porte valide
  -- elle-même que le texte est du JSON (contrôle C13). Passer un `jsonb` ne
  -- résout aucune signature : l'appel échoue, le bloc entier est abandonné, et
  -- les assertions qui suivent DISPARAISSENT du rapport sans laisser de ROUGE.
  -- C'est exactement ce qui s'est produit au premier passage de ce fichier.
  v_id := app.propose_jarvis_action(
    gen_random_uuid(), 'rdv de test RLS', 'create_appointment',
    jsonb_build_object(
      'patient_id',      '00000000-0000-0000-0000-0000000000b1',
      'practitioner_id', '00000000-0000-0000-0000-0000000000a1',
      'starts_at',       (now() + interval '30 days')::text,
      'duration_minutes', 30)::text);

  -- ── a2 tente de confirmer l'action d'a1 ──
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-0000000000a2', false);
  v_conf_autre := app.confirm_jarvis_action(v_id);

  BEGIN
    PERFORM app.execute_jarvis_action(v_id);
  EXCEPTION WHEN OTHERS THEN
    v_exec_autre := true;   -- refusée par exception : correct aussi
  END;

  -- ── retour chez a1 : la ligne doit être INTACTE ──
  PERFORM set_config('request.jwt.claim.sub',
                     '00000000-0000-0000-0000-0000000000a1', false);
  SELECT state INTO v_etat_apres FROM app.jarvis_actions WHERE id = v_id;

  -- ── a1 confirme, puis tente de CONFIRMER UNE SECONDE FOIS ──
  v_conf_propre := app.confirm_jarvis_action(v_id);
  BEGIN
    PERFORM app.confirm_jarvis_action(v_id);
  EXCEPTION WHEN OTHERS THEN
    v_rejeu := true;        -- le second appel est refusé : c'est l'attendu
  END;

  CREATE TEMP TABLE r_r2 AS
    SELECT v_conf_autre    AS conf_autre,
           v_exec_autre    AS exec_autre,
           v_etat_apres    AS etat_apres,
           v_conf_propre   AS conf_propre,
           v_rejeu         AS rejeu_refuse;
END $$;

SELECT pg_temp.verdict('R2a · a2 ne peut pas confirmer l''action d''a1',
  conf_autre IS NULL,
  'retour de confirm = ' || coalesce(conf_autre::text, 'NULL (ligne masquée)')) FROM r_r2;

SELECT pg_temp.verdict('R2b · l''action d''a1 reste `proposed` après a2',
  etat_apres = 'proposed', 'état = ' || etat_apres::text) FROM r_r2;

SELECT pg_temp.verdict('R2c · a1 confirme la sienne',
  conf_propre IS NOT NULL, 'confirmed_at posé') FROM r_r2;

SELECT pg_temp.verdict('R2d · une confirmation ne se rejoue pas',
  rejeu_refuse, CASE WHEN rejeu_refuse THEN 'second appel refusé'
                     ELSE 'SECOND APPEL ACCEPTÉ' END) FROM r_r2;

-- ═══════════════════════════════════════════════════════════════════════════
-- R3 · L'ALLOWLIST TIENT POUR LES TROIS RÔLES
--
-- L'assistante n'a pas de front-end aujourd'hui. C'est exactement pour ça
-- qu'on la teste : §7.2 dit « même ceux dont le front n'existe pas encore ».
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_sub text;
  v_res text := '';
  v_ok  boolean;
BEGIN
  FOREACH v_sub IN ARRAY ARRAY[
    '00000000-0000-0000-0000-0000000000a1',
    '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-0000000000a3'] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_sub, false);
    v_ok := false;
    BEGIN
      PERFORM app.propose_jarvis_action(
        gen_random_uuid(), 'tentative', 'delete_patient', '{}');
    EXCEPTION WHEN OTHERS THEN
      v_ok := true;
    END;
    v_res := v_res || right(v_sub, 2) || ':' || CASE WHEN v_ok THEN 'refuse' ELSE 'ACCEPTE' END || ' ';
  END LOOP;
  CREATE TEMP TABLE r_r3 AS SELECT v_res AS detail, (v_res NOT LIKE '%ACCEPTE%') AS ok;
END $$;
SELECT pg_temp.verdict('R3 · outil hors allowlist refusé aux 3 rôles', ok, detail) FROM r_r3;

-- ═══════════════════════════════════════════════════════════════════════════
-- R4 · AUCUN DES TROIS NE VOIT LES ACTIONS D'UN AUTRE
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_sub text;
  v_n   integer;
  v_res text := '';
  v_ok  boolean := true;
BEGIN
  FOREACH v_sub IN ARRAY ARRAY[
    '00000000-0000-0000-0000-0000000000a2',
    '00000000-0000-0000-0000-0000000000a3'] LOOP
    PERFORM set_config('request.jwt.claim.sub', v_sub, false);
    SELECT count(*) INTO v_n FROM app.jarvis_actions
     WHERE actor_id = '00000000-0000-0000-0000-0000000000a1'::uuid;
    v_res := v_res || right(v_sub, 2) || ':' || v_n || ' ';
    IF v_n <> 0 THEN v_ok := false; END IF;
  END LOOP;
  CREATE TEMP TABLE r_r4 AS SELECT v_res AS detail, v_ok AS ok;
END $$;
SELECT pg_temp.verdict('R4 · actions d''a1 invisibles à a2 et a3', ok,
  'lignes d''a1 vues : ' || detail) FROM r_r4;

RESET ROLE;
