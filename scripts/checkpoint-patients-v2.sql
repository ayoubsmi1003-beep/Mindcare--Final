-- checkpoint-patients-v2.sql — lot PATIENTS V2. La vérité des portes 047.
--
--   docker run --rm -i -e PGURL="$DATABASE_URL" postgres:15 \
--     sh -c 'psql "$PGURL" -f -' < scripts/checkpoint-patients-v2.sql
--
-- ⚠️ TOUT SE PASSE DANS UNE TRANSACTION ANNULÉE — fixtures posées sous le rôle
-- de connexion, impersonation par `SET LOCAL ROLE authenticated` +
-- `SET LOCAL request.jwt.claim.sub`, ROLLBACK final. Rien n'entre dans les
-- données livrées (règle 8).
--
-- CE QUE LE FICHIER PROUVE, SECTION PAR SECTION :
--   §A  plateforme    : app_gatekeeper ne peut PAS contourner la RLS —
--                       non-propriétaire, sans BYPASSRLS, FORCE RLS partout,
--                       et `authenticated` toujours privé de SELECT direct
--   §B  cloison       : praticienne / consœur / assistante / dossier absent
--   §C  « pas le droit » ≠ « rien à montrer » — le contrôle qui justifie
--                       l'usage de can_see_clinical dans la porte
--   §D  chronologie   : ordre, keyset stable, bornage, AUCUNE fuite de texte
--                       clinique dans `detail`
--   §E  audit         : une trace par appel, y compris hors périmètre
--   §F  écriture      : update_patient — allowlist, coalesce, format
--
-- Les contrôles refusent le NULL : une condition qui ne compare rien n'est pas
-- verte (leçon v6, conservée telle quelle).

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

BEGIN;

CREATE FUNCTION pg_temp.controle(p_label text, p_cond boolean, p_detail text DEFAULT '')
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_cond IS NULL THEN
    RAISE INFO 'BLOQUÉ | % | % (condition NULL — rien n''a été comparé)', rpad(p_label, 58), p_detail;
  ELSIF p_cond THEN
    RAISE INFO 'vert   | % | %', rpad(p_label, 58), p_detail;
  ELSE
    RAISE INFO 'ROUGE  | % | %', rpad(p_label, 58), p_detail;
  END IF;
END $$;

CREATE FUNCTION pg_temp.appel_refuse(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;
EXCEPTION WHEN OTHERS THEN
  RETURN true;
END $$;

-- Instruments. SECURITY DEFINER : `audit.log` n'est lisible que par le
-- propriétaire, un compte mesuré sous une praticienne rendrait 0 sans que rien
-- n'ait échoué (même motif que `traces_total` du checkpoint accueil).
-- ⚠️ UNE BORNE, PAS UN COMPTE. Une première version rendait `count(*)` et le
-- comparait ensuite à `id > …` : deux grandeurs sans rapport, et les quatre
-- contrôles d'audit sortaient ROUGE alors que les portes traçaient
-- correctement. Le repère d'un `id > ` est le DERNIER id, jamais le nombre de
-- lignes.
CREATE FUNCTION pg_temp.traces_borne() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT coalesce(max(id), 0) FROM audit.log;
$$;

CREATE FUNCTION pg_temp.traces_depuis(p_depuis bigint, p_contexte text) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT count(*) FROM audit.log
   WHERE id > p_depuis
     AND operation = 'select'
     AND changed_fields && ARRAY[p_contexte]::text[];
$$;

-- Accesseurs SECURITY INVOKER : ils voient ce que voit le rôle impersoné au
-- moment de l'appel — c'est tout l'objet du test.
CREATE FUNCTION pg_temp.ws(p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER AS $$
  SELECT app.get_patient_workspace(p_id);
$$;

-- ---------------------------------------------------------------------------
-- FIXTURES — cabinet 001, patients b1 (à a1/owner) et b2 (à a2/praticienne)
-- ---------------------------------------------------------------------------
-- ⚠️ `is_synthetic = true` PARTOUT : le garde ADR-016 (016) refuse toute
-- insertion non synthétique tant que le déploiement est en `cloud-dev`, sur
-- app.patients et sur TOUTE table portant `patient_id`. Ce n'est pas une
-- formalité de fixture — c'est ce qui empêche une donnée réelle d'atteindre le
-- cloud, et le checkpoint doit s'y plier comme le reste.
--
-- b3 est NEUF et volontairement VIDE de tout clinique : c'est lui qui prouve
-- que « accessible mais sans donnée » se distingue de « inaccessible » (§C).
INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number,
                          first_name, last_name, phone, sex, birth_date,
                          address, emergency_contact, created_by, is_synthetic)
VALUES ('00000000-0000-0000-0000-f04700000b03',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        'TEST-0047',
        'Patient', 'DE TEST TROIS', '0555000047', 'F', DATE '1990-01-15',
        E'12, Rue de Test\nAlger Centre\nAlger',
        '{"name":"Contact DE TEST","relation":"Sœur","phone":"0555000048"}'::jsonb,
        '00000000-0000-0000-0000-0000000000a2', true);

-- Le marqueur de fuite : cette chaîne ne doit JAMAIS ressortir de la
-- chronologie. Elle est placée dans TOUS les champs de texte clinique libre
-- que les sept branches de `list_patient_timeline` effleurent.
INSERT INTO app.diagnoses (id, cabinet_id, practitioner_id, patient_id,
                           code, label, is_primary, onset_date, is_synthetic)
VALUES ('00000000-0000-0000-0000-f04700000d01',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        'F32.1', 'Épisode dépressif moyen', true, DATE '2026-01-10', true);

INSERT INTO app.prescriptions (id, cabinet_id, practitioner_id, patient_id,
                               prescribed_at, is_handwritten, notes, is_synthetic)
VALUES ('00000000-0000-0000-0000-f04700000e01',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        now() - interval '10 days', true,
        'MARQUEUR-CLINIQUE-NE-DOIT-PAS-FUIR', true);

INSERT INTO app.prescription_lines (prescription_id, free_text, dose,
                                    frequency_per_day, duration_days, position)
VALUES ('00000000-0000-0000-0000-f04700000e01',
        'MARQUEUR-CLINIQUE-NE-DOIT-PAS-FUIR', '50 mg', 1, 30, 1);

INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT '00000000-0000-0000-0000-f04700000f01',
       '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-0000000000a2',
       '00000000-0000-0000-0000-0000000000b2',
       s.id, '{}'::jsonb, 14, now() - interval '40 days', true
  FROM app.scales s ORDER BY s.code LIMIT 1;

-- Deux mesures de la MÊME échelle : sans la seconde, `delta` reste nul et le
-- contrôle « écart calculé » ne prouverait rien.
INSERT INTO app.scale_administrations (id, cabinet_id, practitioner_id, patient_id,
                                       scale_id, responses, total_score,
                                       administered_at, is_synthetic)
SELECT '00000000-0000-0000-0000-f04700000f02',
       '00000000-0000-0000-0000-000000000001',
       '00000000-0000-0000-0000-0000000000a2',
       '00000000-0000-0000-0000-0000000000b2',
       s.id, '{}'::jsonb, 9, now() - interval '5 days', true
  FROM app.scales s ORDER BY s.code LIMIT 1;

-- ===========================================================================
-- §A · PLATEFORME — le porteur ne peut pas contourner la RLS
-- ===========================================================================
-- ⚠️ CES SEPT CONTRÔLES SONT LA JUSTIFICATION DES SIX `GRANT SELECT` DE 047.
-- Sans eux, accorder au porteur la lecture des tables cliniques serait un acte
-- de foi. Avec eux, c'est une conséquence vérifiée.

SELECT pg_temp.controle('A1 gatekeeper sans BYPASSRLS ni superuser ni login',
  (SELECT NOT rolbypassrls AND NOT rolsuper AND NOT rolcanlogin AND rolinherit
     FROM pg_roles WHERE rolname = 'app_gatekeeper'),
  'la RLS s''applique à lui comme à tout le monde');

SELECT pg_temp.controle('A2 gatekeeper hérite effectivement de authenticated',
  pg_has_role('app_gatekeeper', 'authenticated', 'USAGE'),
  'sinon les policies TO authenticated ne matchent pas');

SELECT pg_temp.controle('A3 gatekeeper ne possède AUCUNE table',
  (SELECT count(*) = 0 FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r' AND n.nspname IN ('app','audit')
      AND c.relowner = 'app_gatekeeper'::regrole),
  'un propriétaire contournerait la RLS — c''est CE contrôle qui tient');

SELECT pg_temp.controle('A4 FORCE RLS sur les 6 tables nouvellement accordées',
  (SELECT count(*) = 6 FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'app'
      AND c.relname IN ('diagnoses','prescriptions','prescription_lines',
                        'scale_administrations','scales','medications')
      AND c.relrowsecurity AND c.relforcerowsecurity),
  '6/6 attendues');

SELECT pg_temp.controle('A5 authenticated n''a TOUJOURS PAS SELECT sur patients',
  NOT has_table_privilege('authenticated', 'app.patients', 'SELECT'),
  'ADR-019 ; 021 lève si ce contrôle tombe');

SELECT pg_temp.controle('A6 les 2 portes sont DEFINER, à gatekeeper, search_path figé',
  (SELECT count(*) = 2 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app'
      AND p.proname IN ('get_patient_workspace','list_patient_timeline')
      AND p.prosecdef
      AND p.proowner = 'app_gatekeeper'::regrole
      AND p.proconfig IS NOT NULL),
  '2/2 attendues');

SELECT pg_temp.controle('A7 les 2 portes ne sont pas STABLE (elles écrivent l''audit)',
  (SELECT count(*) = 2 FROM pg_proc p
     JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app'
      AND p.proname IN ('get_patient_workspace','list_patient_timeline')
      AND p.provolatile = 'v'),
  'STABLE autoriserait le planificateur à élider des traces');

SELECT pg_temp.controle('A8 service_role ne peut exécuter aucune des 2 portes',
  NOT has_function_privilege('service_role', 'app.get_patient_workspace(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('service_role',
        'app.list_patient_timeline(uuid,timestamptz,uuid,integer)', 'EXECUTE'),
  'motif 017/020');

SELECT pg_temp.controle('A9 index prescriptions_patient posé',
  (SELECT count(*) = 1 FROM pg_indexes
    WHERE schemaname = 'app' AND indexname = 'prescriptions_patient'),
  'la chronologie et la porte agrégée le lisent');

-- ===========================================================================
-- §B · LA CLOISON — quatre appels, quatre réponses attendues
-- ===========================================================================

-- B1 · La praticienne sur SON dossier : espace complet.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

SELECT pg_temp.controle('B1 praticienne / son dossier : espace complet',
  (SELECT w IS NOT NULL
      AND w->'identite'->>'record_number' = 'TEST-0002'
      AND w->'clinique'    <> 'null'::jsonb
      AND w->'traitements' <> 'null'::jsonb
     FROM pg_temp.ws('00000000-0000-0000-0000-0000000000b2') w),
  'identité + clinique + traitements');

SELECT pg_temp.controle('B1b l''âge est calculé EN BASE, pas nul',
  (SELECT (w->'identite'->>'age') IS NOT NULL
     FROM pg_temp.ws('00000000-0000-0000-0000-f04700000b03') w),
  'birth_date renseignée sur b3');

SELECT pg_temp.controle('B1c l''écart d''échelle est calculé sur 2 mesures',
  (SELECT (w->'clinique'->'echelles'->0->>'delta') IS NOT NULL
      AND (w->'clinique'->'echelles'->0->'precedent') <> 'null'::jsonb
     FROM pg_temp.ws('00000000-0000-0000-0000-0000000000b2') w),
  '9 - 14 = -5 attendu');

-- B2 · La MÊME praticienne sur le dossier de sa consœur : NULL.
SELECT pg_temp.controle('B2 praticienne / dossier d''une consœur : NULL',
  (SELECT pg_temp.ws('00000000-0000-0000-0000-0000000000b1') IS NULL),
  'cloison ADR-003 — b1 appartient à a1');

-- B3 · Un identifiant qui n'existe pas : NULL, INDISCERNABLE de B2.
SELECT pg_temp.controle('B3 dossier inexistant : NULL, comme B2',
  (SELECT pg_temp.ws('00000000-0000-0000-0000-ffffffffffff') IS NULL),
  'pas d''oracle d''existence');

RESET request.jwt.claim.sub;
RESET ROLE;

-- B4 · L'assistante : identité oui, clinique NON. LE CONTRÔLE CENTRAL DU LOT.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

SELECT pg_temp.controle('B4 assistante : identité et contact présents',
  (SELECT w IS NOT NULL
      AND w->'identite'->>'record_number' = 'TEST-0002'
      AND (w->'contact'->>'phone') IS NOT NULL
     FROM pg_temp.ws('00000000-0000-0000-0000-0000000000b2') w),
  'l''accueil a besoin de joindre');

SELECT pg_temp.controle('B4b assistante : clinique NULL et traitements NULL',
  (SELECT w->'clinique' = 'null'::jsonb AND w->'traitements' = 'null'::jsonb
     FROM pg_temp.ws('00000000-0000-0000-0000-0000000000b2') w),
  'AUCUN diagnostic, aucune ordonnance, aucune échelle');

SELECT pg_temp.controle('B4c assistante : chronologie sans AUCUN événement clinique',
  (SELECT count(*) = 0 FROM app.list_patient_timeline(
            '00000000-0000-0000-0000-0000000000b2', NULL, NULL, 50)
    WHERE event_type IN ('note','diagnostic','prescription','echelle','consultation')),
  'les RDV et documents restent légitimes');

RESET request.jwt.claim.sub;
RESET ROLE;

-- B5 · La propriétaire voit tout : non-régression.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.controle('B5 owner voit le dossier de la praticienne',
  (SELECT w IS NOT NULL AND w->'clinique' <> 'null'::jsonb
     FROM pg_temp.ws('00000000-0000-0000-0000-0000000000b2') w),
  'can_see_clinical rend true pour owner');

RESET request.jwt.claim.sub;
RESET ROLE;

-- ===========================================================================
-- §C · « PAS LE DROIT » ≠ « RIEN À MONTRER »
-- ===========================================================================
-- ⚠️ LE CONTRÔLE QUI JUSTIFIE L'USAGE DE `can_see_clinical` DANS LA PORTE.
-- b3 appartient à a2 et n'a AUCUNE donnée clinique. Si la porte se contentait
-- de la RLS, b3 et le cas assistante rendraient tous deux des listes vides et
-- l'écran ne pourrait pas choisir entre « onglet absent » et « Aucun
-- diagnostic enregistré ». Ici, b3 doit rendre un OBJET, pas `null`.

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

SELECT pg_temp.controle('C1 praticienne / dossier vide : clinique OBJET, pas null',
  (SELECT w->'clinique' <> 'null'::jsonb
      AND w->'clinique'->'diagnostics' = '[]'::jsonb
      AND w->'clinique'->'echelles'    = '[]'::jsonb
     FROM pg_temp.ws('00000000-0000-0000-0000-f04700000b03') w),
  'accessible ET vide — distinct de B4b');

SELECT pg_temp.controle('C2 praticienne / dossier vide : traitements OBJET, pas null',
  (SELECT w->'traitements' <> 'null'::jsonb
      AND w->'traitements'->'derniere_prescription' = 'null'::jsonb
     FROM pg_temp.ws('00000000-0000-0000-0000-f04700000b03') w),
  'l''écran dira « Aucune prescription enregistrée »');

SELECT pg_temp.controle('C3 le contrat de sortie n''expose AUCUN champ interne',
  (SELECT NOT (w ? 'cabinet_id') AND NOT (w ? 'practitioner_id')
      AND NOT (w->'identite' ? 'cabinet_id')
      AND NOT (w->'identite' ? 'practitioner_id')
      AND NOT (w->'identite' ? 'created_by')
      AND NOT (w->'identite' ? 'created_at')
     FROM pg_temp.ws('00000000-0000-0000-0000-f04700000b03') w),
  'allowlist explicite, jamais to_jsonb(p.*)');

SELECT pg_temp.controle('C4 la version de contrat est portée',
  (SELECT (w->>'contrat') = '1' AND (w->>'genere_a') IS NOT NULL
     FROM pg_temp.ws('00000000-0000-0000-0000-f04700000b03') w),
  'précurseur du Digital Twin, versionné');

-- ===========================================================================
-- §D · CHRONOLOGIE — ordre, keyset, bornage, ET ZÉRO FUITE
-- ===========================================================================

SELECT pg_temp.controle('D1 ordre strictement décroissant (occurred_at, event_id)',
  (SELECT bool_and(ordonne) FROM (
     SELECT (occurred_at, event_id)
            <= lag((occurred_at, event_id)) OVER (ORDER BY occurred_at DESC, event_id DESC)
            IS NOT FALSE AS ordonne
       FROM app.list_patient_timeline('00000000-0000-0000-0000-0000000000b2', NULL, NULL, 50)
   ) t),
  'le keyset en dépend');

SELECT pg_temp.controle('D2 p_limit est borné EN BASE à 50',
  (SELECT count(*) <= 50 FROM app.list_patient_timeline(
            '00000000-0000-0000-0000-0000000000b2', NULL, NULL, 999)),
  'une pagination sans borne est un export');

SELECT pg_temp.controle('D3 keyset : page 2 ne répète aucune ligne de la page 1',
  (SELECT NOT EXISTS (
     SELECT 1
       FROM app.list_patient_timeline('00000000-0000-0000-0000-0000000000b2', NULL, NULL, 2) p1
       JOIN LATERAL (
         SELECT * FROM app.list_patient_timeline(
           '00000000-0000-0000-0000-0000000000b2',
           (SELECT occurred_at FROM app.list_patient_timeline(
              '00000000-0000-0000-0000-0000000000b2', NULL, NULL, 2)
             ORDER BY occurred_at DESC, event_id DESC LIMIT 1 OFFSET 1),
           (SELECT event_id FROM app.list_patient_timeline(
              '00000000-0000-0000-0000-0000000000b2', NULL, NULL, 2)
             ORDER BY occurred_at DESC, event_id DESC LIMIT 1 OFFSET 1),
           50)
       ) p2 ON p2.event_id = p1.event_id AND p2.occurred_at = p1.occurred_at)),
  'aucun doublon entre les deux pages');

-- ⚠️ LE CONTRÔLE ANTI-FUITE. Le marqueur a été écrit dans
-- `prescriptions.notes` et `prescription_lines.free_text`. Aucun `detail` de la
-- chronologie ne doit le contenir, sous AUCUN rôle.
SELECT pg_temp.controle('D4 AUCUN texte clinique libre dans `detail`',
  (SELECT count(*) = 0 FROM app.list_patient_timeline(
            '00000000-0000-0000-0000-0000000000b2', NULL, NULL, 50)
    WHERE detail::text LIKE '%MARQUEUR-CLINIQUE-NE-DOIT-PAS-FUIR%'),
  'ni notes d''ordonnance, ni free_text');

SELECT pg_temp.controle('D5 `label_key` reste dans l''ensemble fermé attendu',
  (SELECT bool_and(label_key IN ('consultation_ouverte','consultation_close',
                                 'note_signee','diagnostic_pose','diagnostic_resolu',
                                 'prescription','echelle','rdv','document'))
     FROM app.list_patient_timeline('00000000-0000-0000-0000-0000000000b2', NULL, NULL, 50)),
  'la base nomme un type, elle ne rédige pas de phrase');

-- ===========================================================================
-- §E · AUDIT — une trace par appel, y compris hors périmètre
-- ===========================================================================

DO $$
DECLARE
  v_borne bigint;
BEGIN
  v_borne := pg_temp.traces_borne();
  PERFORM app.get_patient_workspace('00000000-0000-0000-0000-0000000000b2');
  PERFORM pg_temp.controle('E1 un appel de l''espace = exactement 1 trace `fiche`',
    pg_temp.traces_depuis(v_borne, 'fiche') = 1, '');

  v_borne := pg_temp.traces_borne();
  PERFORM app.get_patient_workspace('00000000-0000-0000-0000-0000000000b1');
  PERFORM pg_temp.controle('E2 hors périmètre : la TENTATIVE est tracée quand même',
    pg_temp.traces_depuis(v_borne, 'fiche') = 1, 'b1 rend NULL mais laisse la trace');

  v_borne := pg_temp.traces_borne();
  PERFORM app.get_patient_workspace('00000000-0000-0000-0000-ffffffffffff');
  PERFORM pg_temp.controle('E3 dossier inexistant : tracé aussi',
    pg_temp.traces_depuis(v_borne, 'fiche') = 1, '');

  v_borne := pg_temp.traces_borne();
  PERFORM count(*) FROM app.list_patient_timeline(
    '00000000-0000-0000-0000-0000000000b2', NULL, NULL, 20);
  PERFORM pg_temp.controle('E4 un appel de chronologie = exactement 1 trace `liste`',
    pg_temp.traces_depuis(v_borne, 'liste') = 1, '');
END $$;

SELECT pg_temp.controle('E5 SELECT direct sur app.patients toujours refusé',
  pg_temp.appel_refuse('SELECT 1 FROM app.patients LIMIT 1'),
  '42501 attendu — le chemin non audité reste fermé');

-- ===========================================================================
-- §F · ÉCRITURE — update_patient, la porte unique
-- ===========================================================================

SELECT pg_temp.controle('F1 une clé hors allowlist LÈVE (jamais ignorée en silence)',
  pg_temp.appel_refuse($q$
    SELECT app.update_patient('00000000-0000-0000-0000-f04700000b03',
                              '{"record_number":"PIRATE-1"}'::jsonb)$q$),
  'échec clos');

SELECT pg_temp.controle('F2 un téléphone hors format est refusé par le CHECK',
  pg_temp.appel_refuse($q$
    SELECT app.update_patient('00000000-0000-0000-0000-f04700000b03',
                              '{"phone":"nope"}'::jsonb)$q$),
  'patients_phone_format (004)');

SELECT pg_temp.controle('F3 first_name à null NE VIDE PAS (coalesce de la porte)',
  (SELECT first_name = 'Patient' FROM app.update_patient(
     '00000000-0000-0000-0000-f04700000b03', '{"first_name":null}'::jsonb)),
  'colonne NOT NULL protégée');

SELECT pg_temp.controle('F4 une modification légitime passe et se relit',
  (SELECT address = 'Nouvelle adresse de test' FROM app.update_patient(
     '00000000-0000-0000-0000-f04700000b03',
     '{"address":"Nouvelle adresse de test"}'::jsonb)),
  '');

SELECT pg_temp.controle('F5 address à null EFFACE (distinct de « absent »)',
  (SELECT address IS NULL FROM app.update_patient(
     '00000000-0000-0000-0000-f04700000b03', '{"address":null}'::jsonb)),
  'clé absente = inchangé, clé null = effacé');

-- ⚠️ F6 ET F7 SONT LE CHEMIN CLIENT RÉEL, ET LEUR ABSENCE A COÛTÉ UN BOGUE.
--
-- F1–F5 passent une charge écrite en `'…'::jsonb` — un OBJET. Ce n'est PAS ce
-- que l'application envoie : `RpcArgs` (ADR-020) ne transporte que des
-- scalaires, donc le port sérialise, et PostgREST livre une CHAÎNE jsonb au
-- paramètre. La porte refusait alors toute modification (« un objet JSON est
-- attendu », P0001) — pendant que ce checkpoint était vert.
--
-- Un contrôle qui n'emprunte pas le chemin de l'appelant ne prouve pas que
-- l'appelant fonctionne. `to_jsonb(texte)` reproduit exactement ce que reçoit
-- la porte depuis le client.
SELECT pg_temp.controle('F6 la charge SÉRIALISÉE du port est acceptée (049)',
  (SELECT address = 'Adresse via charge sérialisée' FROM app.update_patient(
     '00000000-0000-0000-0000-f04700000b03',
     to_jsonb('{"address":"Adresse via charge sérialisée"}'::text))),
  'le chemin réel de FormulaireModification');

SELECT pg_temp.controle('F7 une chaîne qui ne contient pas un objet reste refusée',
  pg_temp.appel_refuse($q$
    SELECT app.update_patient('00000000-0000-0000-0000-f04700000b03',
                              to_jsonb('ceci n''est pas un objet'::text))$q$),
  '049 déballe UNE fois, il n''ouvre pas la porte');

SELECT pg_temp.controle('F8 clé inconnue refusée AUSSI en charge sérialisée',
  pg_temp.appel_refuse($q$
    SELECT app.update_patient('00000000-0000-0000-0000-f04700000b03',
                              to_jsonb('{"record_number":"PIRATE-2"}'::text))$q$),
  'l''allowlist s''applique après le déballage');

RESET request.jwt.claim.sub;
RESET ROLE;

-- ---------------------------------------------------------------------------
-- Rien n'est conservé.
-- ---------------------------------------------------------------------------
ROLLBACK;
