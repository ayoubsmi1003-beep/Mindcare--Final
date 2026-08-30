-- ═══════════════════════════════════════════════════════════════════════════
-- checkpoint-longitudinal.sql — UN DOSSIER DE 50 SÉANCES SUR 5 ANS.
--
-- ═══ CE QUE CE CHECKPOINT PROUVE, ET POURQUOI IL FAUT LE PROUVER ═══
--
-- L'argument de conception du résumé longitudinal est que son coût NE CROÎT
-- PAS avec l'âge du dossier : `app.build_case_context` (068) détaille les
-- dernières séances et AGRÈGE tout le reste par année. Tant que la base ne
-- contient que des dossiers de deux séances, cet argument n'est qu'une
-- intention — et une intention non mesurée finit toujours par être fausse.
--
-- On fabrique donc ici ce que la base n'a pas : 50 consultations réparties sur
-- cinq années, plus des mesures d'échelle, et on VÉRIFIE que la sortie reste
-- bornée. Le contrôle décisif est E4 : la charge d'un dossier de 50 séances
-- doit rester du même ordre que celle d'un dossier de 6.
--
-- ⚠️ TOUT EST ANNULÉ EN FIN DE TRANSACTION. Aucune ligne ne subsiste, aucun
-- numéro de dossier n'est consommé (I17). Les fixtures sont synthétiques
-- (ADR-016, `is_synthetic = true`) — règle 8 : une fixture vit DANS la
-- transaction du checkpoint, jamais dans un seed livré.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/checkpoint-longitudinal.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TEMP TABLE _lg_resultats (nom text PRIMARY KEY, ok boolean, detail text);

-- ⚠️ L'IDENTIFIANT TRANSITE PAR UNE TABLE TEMPORAIRE, PAS PAR UNE VARIABLE psql.
-- Deux raisons, toutes deux constatées à l'exécution :
--   · psql n'interpole PAS `:'var'` à l'intérieur d'un bloc `DO $$ … $$` —
--     le littéral `:` arrive tel quel et lève une erreur de syntaxe ;
--   · sous le rôle `authenticated`, `SELECT` sur `app.patients` est RÉVOQUÉ
--     (ADR-019) : rechercher le patient par son numéro échouerait en 42501.
-- Une table temporaire traverse les deux obstacles sans en contourner aucun.
CREATE TEMP TABLE _lg_ctx (pat uuid);
GRANT SELECT ON _lg_ctx TO authenticated;
GRANT SELECT, INSERT ON _lg_resultats TO authenticated;

-- ── §A · Les portes existent, avec le bon propriétaire ────────────────────
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM app.schema_migrations
   WHERE version IN ('067_consultation_analyses', '068_build_case_context');
  INSERT INTO _lg_resultats VALUES ('A1 · migrations 067 et 068 tracées', n = 2, n::text);

  SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'app'
     AND p.proname IN ('build_case_context','save_session_analysis',
                       'get_consultation_analysis','get_recent_session_analyses')
     AND p.prosecdef AND pg_get_userbyid(p.proowner) = 'app_gatekeeper';
  INSERT INTO _lg_resultats VALUES ('A2 · 4 portes DEFINER app_gatekeeper', n = 4, n::text);
END $$;

-- ── §B · Le dossier long, fabriqué ─────────────────────────────────────────
DO $$
DECLARE
  v_cab     uuid;
  v_prat    uuid;
  v_pat     uuid;
  v_scale   uuid;
  v_i       int;
  v_date    timestamptz;
BEGIN
  SELECT id, cabinet_id INTO v_prat, v_cab
    FROM app.profiles WHERE role = 'practitioner' LIMIT 1;

  INSERT INTO app.patients (cabinet_id, practitioner_id, record_number,
                            first_name, last_name, birth_date, phone,
                            address, is_synthetic)
  VALUES (v_cab, v_prat, 'LONG-TEST-0001', 'Fixture', 'Longitudinale',
          DATE '1985-03-11', '+213000000000', 'Alger', true)
  RETURNING id INTO v_pat;

  -- 50 séances, une toutes les 5 semaines ⇒ un peu moins de 5 ans.
  FOR v_i IN 1..50 LOOP
    v_date := now() - ((50 - v_i) * INTERVAL '5 weeks');
    INSERT INTO app.consultations (cabinet_id, practitioner_id, patient_id,
                                   started_at, ended_at, status, raw_notes,
                                   is_synthetic)
    VALUES (v_cab, v_prat, v_pat, v_date, v_date + INTERVAL '45 minutes',
            'closed',
            -- Des notes VOLUMINEUSES : si la porte ne tronquait pas, la charge
            -- exploserait, et le contrôle E4 le verrait immédiatement.
            repeat('Séance de suivi. Observations cliniques détaillées. ', 40),
            true);
  END LOOP;

  SELECT id INTO v_scale FROM app.scales LIMIT 1;
  IF v_scale IS NOT NULL THEN
    FOR v_i IN 1..20 LOOP
      INSERT INTO app.scale_administrations (cabinet_id, practitioner_id, patient_id,
                                             scale_id, responses, total_score,
                                             administered_at, is_synthetic)
      VALUES (v_cab, v_prat, v_pat, v_scale, '{}'::jsonb, 10 + (v_i % 8),
              now() - ((20 - v_i) * INTERVAL '13 weeks'), true);
    END LOOP;
  END IF;

  INSERT INTO _lg_ctx VALUES (v_pat);
  INSERT INTO _lg_resultats VALUES ('B1 · 50 séances posées', true, '50');
END $$;

-- ── §C · Le contexte, sous la praticienne ─────────────────────────────────
SELECT id::text AS ipr FROM app.profiles WHERE role = 'practitioner' LIMIT 1 \gset

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = :'ipr';

DO $$
DECLARE
  v_ctx      jsonb;
  v_recentes int;
  v_annees   int;
  v_octets   int;
  v_extrait  text;
  v_pat      uuid;
BEGIN
  SELECT pat INTO v_pat FROM _lg_ctx;
  v_ctx := app.build_case_context(v_pat);

  v_recentes := jsonb_array_length(v_ctx -> 'recentes');
  v_annees   := jsonb_array_length(v_ctx -> 'anterieures');
  v_octets   := length(v_ctx::text);

  -- E1 · Les séances récentes sont PLAFONNÉES. Sans ce plafond, 50 notes
  -- entières partiraient au modèle.
  INSERT INTO _lg_resultats
  VALUES ('E1 · récentes plafonnées à 6', v_recentes = 6, v_recentes::text);

  -- E2 · Le reste n'est pas PERDU, il est AGRÉGÉ. 44 séances antérieures
  -- réparties sur environ cinq années civiles.
  INSERT INTO _lg_resultats
  VALUES ('E2 · antérieures groupées par année', v_annees BETWEEN 3 AND 7,
          v_annees::text || ' année(s)');

  -- E3 · Aucune séance ne disparaît : récentes + somme des années = 50.
  INSERT INTO _lg_resultats
  VALUES ('E3 · les 50 séances sont couvertes',
          v_recentes + COALESCE((SELECT sum((a ->> 'seances')::int)
                                   FROM jsonb_array_elements(v_ctx -> 'anterieures') a), 0) = 50,
          (v_recentes + COALESCE((SELECT sum((a ->> 'seances')::int)
                                    FROM jsonb_array_elements(v_ctx -> 'anterieures') a), 0))::text);

  -- E4 · LE CONTRÔLE DÉCISIF. 50 séances de notes volumineuses tiennent sous
  -- 40 Ko. Sans stratification ni troncature, la seule matière brute
  -- dépasserait 100 Ko — et le coût croîtrait à chaque séance ajoutée.
  INSERT INTO _lg_resultats
  VALUES ('E4 · charge bornée (< 40 Ko)', v_octets < 40000, v_octets::text || ' octets');

  -- E5 · Les extraits sont tronqués EN BASE, et la coupure se voit.
  SELECT (r ->> 'notes_extrait') INTO v_extrait
    FROM jsonb_array_elements(v_ctx -> 'recentes') r LIMIT 1;
  INSERT INTO _lg_resultats
  VALUES ('E5 · extrait tronqué et signalé', v_extrait LIKE '%…', length(v_extrait)::text);

  -- E6 · Le socle est déterministe et complet : c'est l'aperçu du §1.
  INSERT INTO _lg_resultats
  VALUES ('E6 · socle : âge et résidence présents',
          (v_ctx -> 'socle' -> 'identite' ->> 'age') IS NOT NULL
          AND (v_ctx -> 'socle' ->> 'residence') IS NOT NULL,
          COALESCE(v_ctx -> 'socle' -> 'identite' ->> 'age', 'NULL'));

  -- E7 · Toutes les séances restent CITABLES, donc navigables depuis le résumé.
  INSERT INTO _lg_resultats
  VALUES ('E7 · les 50 consultations sont citables',
          (SELECT count(*) FROM jsonb_array_elements_text(v_ctx -> 'ids_autorises')) >= 50,
          (SELECT count(*)::text FROM jsonb_array_elements_text(v_ctx -> 'ids_autorises')));
END $$;

-- ── §D · L'assistante ne voit RIEN du clinique ────────────────────────────
SELECT id::text AS iass FROM app.profiles WHERE role = 'assistant' LIMIT 1 \gset
SET LOCAL request.jwt.claim.sub = :'iass';

DO $$
DECLARE
  v_ctx jsonb;
  v_pat uuid;
BEGIN
  SELECT pat INTO v_pat FROM _lg_ctx;
  v_ctx := app.build_case_context(v_pat);
  INSERT INTO _lg_resultats
  VALUES ('D1 · assistante : socle/recentes/anterieures NULL',
          (v_ctx -> 'socle') = 'null'::jsonb
          AND (v_ctx -> 'recentes') = 'null'::jsonb
          AND (v_ctx -> 'anterieures') = 'null'::jsonb,
          'cloisonnement');
END $$;

RESET ROLE;

SELECT 'VERDICT',
       count(*) FILTER (WHERE NOT ok) AS echecs,
       count(*) AS total
FROM _lg_resultats;
SELECT nom, ok, detail FROM _lg_resultats ORDER BY nom;

ROLLBACK;
