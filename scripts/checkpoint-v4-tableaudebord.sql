-- checkpoint-v4-tableaudebord.sql — la porte 059/060, ses cloisons, et le piège du
-- mot « encaissé ».
--
--   docker run --rm -i -e PGURL="$DATABASE_URL" postgres:15 \
--     sh -c 'psql "$PGURL" -f -' < scripts/checkpoint-v4-tableaudebord.sql
--
-- ⚠️ TOUT SE PASSE DANS UNE TRANSACTION ANNULÉE — fixtures posées sous le rôle
-- de connexion, impersonation par `SET LOCAL ROLE authenticated` +
-- `SET LOCAL request.jwt.claim.sub`, ROLLBACK final. Rien n'entre dans les
-- données livrées (règle 8).
--
-- CE QUE LE FICHIER PROUVE, SECTION PAR SECTION :
--   §A  forme       : UN objet, les huit clés du contrat, et pas d'autres
--   §B  la journée  : SA journée, sa séance ouverte, son suivant, son attente
--   §C  cloison     : une praticienne ne voit pas la journée de sa consœur
--   §D  caisse      : owner → cabinet · practitioner → la sienne ·
--                     assistant → clé NULL, ET PAS UNE ERREUR (ADR-005)
--   §E  ENCAISSÉ ≠ FACTURÉ — le contrôle central de ce lot
--   §F  Jarvis      : ses propositions, `proposed` seulement, plafond 3
--   §G  audit       : UNE trace `liste` par appel, patient_id NULL
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

-- Accesseur : la fonction rend UN jsonb dont la colonne de sortie s'appelle
-- `dashboard_today`. Ce helper reste SECURITY INVOKER — il voit le tableau DU
-- RÔLE impersoné au moment de l'appel. Même motif que `pg_temp.board()` du
-- checkpoint cockpit.
CREATE FUNCTION pg_temp.tb() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER AS $$
  SELECT app.dashboard_today(CURRENT_DATE);
$$;

-- Repère d'audit lisible quel que soit le rôle testé (SECURITY DEFINER,
-- réservé à l'instrument — motif v6 / cockpit).
--
-- ⚠️ `max(id)`, PAS `count(*)`. Les deux sondes ci-dessous comparent `id > repère` :
-- un COMPTE de lignes n'est un repère d'identifiant que sur une table dont on
-- n'a jamais rien retiré. Or `app.run_purges` (014) supprime, et `audit.log`
-- porte des identifiants bien supérieurs à son nombre de lignes. Le repère
-- était donc dépassé par des lignes ANCIENNES, et §G rendait ROUGE deux
-- contrôles pourtant justes (constaté le 2026-08-25).
CREATE FUNCTION pg_temp.traces_repere() RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT COALESCE(max(id), 0) FROM audit.log;
$$;

CREATE FUNCTION pg_temp.traces_liste_depuis(p_depuis bigint) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT count(*) FROM audit.log
   WHERE id > p_depuis AND changed_fields && ARRAY['liste']::text[];
$$;

CREATE FUNCTION pg_temp.traces_nommees_depuis(p_depuis bigint) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT count(*) FROM audit.log
   WHERE id > p_depuis AND patient_id IS NOT NULL;
$$;

-- Séquençage explicite : Postgres ne garantit pas l'ordre d'évaluation des
-- arguments d'une fonction. Un appel suivi de sa mesure vit donc dans un
-- helper, où l'ordre est celui du pl/pgsql (leçon du checkpoint cockpit).
CREATE FUNCTION pg_temp.un_appel_une_trace() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_avant bigint;
  v_liste bigint;
BEGIN
  v_avant := pg_temp.traces_repere();
  PERFORM pg_temp.tb();
  v_liste := pg_temp.traces_liste_depuis(v_avant);
  RETURN v_liste = 1;
END $$;

CREATE FUNCTION pg_temp.aucun_patient_nomme() RETURNS boolean
LANGUAGE plpgsql SECURITY INVOKER AS $$
DECLARE
  v_avant bigint;
BEGIN
  v_avant := pg_temp.traces_repere();
  PERFORM pg_temp.tb();
  RETURN pg_temp.traces_nommees_depuis(v_avant) = 0;
END $$;

-- ⚠️ COMPTER LES PATIENTS SANS `SELECT app.patients`. ADR-019 a RÉVOQUÉ le
-- SELECT direct sur la table : sous le rôle `authenticated`, la requête rend
-- « permission denied for table patients ». C'est la cloison qui fonctionne,
-- pas une panne — mais un instrument de mesure ne doit pas tomber dessus. Ce
-- compteur est donc SECURITY DEFINER et réservé au checkpoint, comme les
-- compteurs d'audit ci-dessus.
CREATE FUNCTION pg_temp.patients_du_mois(p_praticienne uuid) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT count(*) FROM app.patients p
   WHERE p.practitioner_id = p_praticienne
     AND p.created_at >= date_trunc('month', CURRENT_DATE)::timestamp
                           AT TIME ZONE 'Africa/Algiers'
     AND p.created_at <  (date_trunc('month', CURRENT_DATE)::date + interval '1 month')::timestamp
                           AT TIME ZONE 'Africa/Algiers';
$$;

-- Refus attendu : vrai SI l'appel a levé.
CREATE FUNCTION pg_temp.appel_refuse(p_sql text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN false;                       -- passé => ROUGE
EXCEPTION WHEN OTHERS THEN
  RETURN true;                        -- levé  => vert
END $$;

-- ---------------------------------------------------------------------------
-- FIXTURES — cabinet 001 · a1 owner · a2 praticienne · a3 assistante
--            b1 patient d'a1 · b2 patient d'a2
-- ---------------------------------------------------------------------------
-- Un patient NEUF pour a2, créé maintenant : c'est lui que
-- `nouveaux_patients_mois` doit compter, et que le tableau d'a1 ne doit PAS
-- compter. Nom volontairement non vraisemblable (règle 8).
INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number,
                          first_name, last_name, phone, created_at, is_synthetic)
VALUES ('00000000-0000-0000-0000-f05800000009',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        'F058-NEUF', 'Fixture', 'Zzz058', '0550000058', now(), true);

INSERT INTO app.appointments (id, cabinet_id, practitioner_id, patient_id,
                              starts_at, ends_at, status, source, created_by,
                              is_synthetic)
VALUES
       -- Déjà arrivé, et il attend : c'est LUI le patient suivant, pas celui
       -- de 10 h — quelqu'un dans la salle passe avant quelqu'un attendu.
       ('00000000-0000-0000-0000-f05800000001',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        date_trunc('day', now()) + interval '9 hours',
        date_trunc('day', now()) + interval '9 hours 30 minutes',
        'arrived', 'doctor', '00000000-0000-0000-0000-0000000000a2', true),
       ('00000000-0000-0000-0000-f05800000002',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        date_trunc('day', now()) + interval '10 hours',
        date_trunc('day', now()) + interval '10 hours 30 minutes',
        'confirmed', 'doctor', '00000000-0000-0000-0000-0000000000a2', true),
       ('00000000-0000-0000-0000-f05800000003',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        date_trunc('day', now()) + interval '8 hours',
        date_trunc('day', now()) + interval '8 hours 30 minutes',
        'completed', 'doctor', '00000000-0000-0000-0000-0000000000a2', true),
       -- La séance en cours d'a2.
       ('00000000-0000-0000-0000-f05800000004',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        date_trunc('day', now()) + interval '11 hours',
        date_trunc('day', now()) + interval '11 hours 30 minutes',
        'in_session', 'doctor', '00000000-0000-0000-0000-0000000000a2', true),
       -- La journée d'a1 : elle ne doit JAMAIS apparaître chez a2.
       ('00000000-0000-0000-0000-f05800000005',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1',
        date_trunc('day', now()) + interval '14 hours',
        date_trunc('day', now()) + interval '14 hours 30 minutes',
        'confirmed', 'doctor', '00000000-0000-0000-0000-0000000000a1', true),
       -- Annulé : hors du fil, il n'aura pas lieu.
       ('00000000-0000-0000-0000-f0580000000a',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        date_trunc('day', now()) + interval '16 hours',
        date_trunc('day', now()) + interval '16 hours 30 minutes',
        'cancelled', 'doctor', '00000000-0000-0000-0000-0000000000a2', true);

INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id,
                               appointment_id, started_at, status, is_synthetic)
VALUES ('00000000-0000-0000-0000-f05800000006',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        '00000000-0000-0000-0000-f05800000004',
        now() - interval '20 minutes', 'open', true);

-- ⚠️ LE CŒUR DU LOT. Trois paiements du jour :
--   · 3 000 ENCAISSÉ par a2      → doit compter
--   · 5 000 FACTURÉ, non encaissé → NE DOIT PAS compter (le piège)
--   · 1 000 ENCAISSÉ par a1      → cabinet seulement
-- Si la porte confondait facturé et encaissé, a2 lirait 8 000.
INSERT INTO app.payments (id, cabinet_id, practitioner_id, patient_id,
                          receipt_number, amount_dzd, method, set_by,
                          collected_by, collected_at, created_at, is_synthetic)
VALUES ('00000000-0000-0000-0000-f05800000007',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        'REC-2026-F0581', 3000, 'cash',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000a2', now(), now(), true),
       ('00000000-0000-0000-0000-f05800000008',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-0000000000b2',
        'REC-2026-F0582', 5000, 'cash',
        '00000000-0000-0000-0000-0000000000a2',
        NULL, NULL, now(), true),
       ('00000000-0000-0000-0000-f0580000000b',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000b1',
        'REC-2026-F0583', 1000, 'cash',
        '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-0000000000a1', now(), now(), true);

-- Jarvis : une proposition en attente pour a2, une déjà tranchée, une d'a1.
INSERT INTO app.jarvis_actions (id, cabinet_id, actor_id, conversation_id,
                                user_utterance, tool_name, tool_args, state,
                                confirmed_at)
VALUES ('00000000-0000-0000-0000-f0580000000c',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-f05800000fff',
        'Fixture — proposition en attente.', 'create_appointment',
        '{}'::jsonb, 'proposed', NULL),
       ('00000000-0000-0000-0000-f0580000000d',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a2',
        '00000000-0000-0000-0000-f05800000fff',
        'Fixture — déjà confirmée.', 'set_consultation_price',
        '{}'::jsonb, 'confirmed', now()),
       ('00000000-0000-0000-0000-f0580000000e',
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-0000000000a1',
        '00000000-0000-0000-0000-f05800000ffe',
        'Fixture — proposition d''une consœur.', 'create_appointment',
        '{}'::jsonb, 'proposed', NULL);

\echo ''
\echo '═══ §A · FORME DU CONTRAT — rôle PRATICIENNE (a2) ═══'

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

SELECT pg_temp.controle('A1 · un objet jsonb, pas une liste',
  jsonb_typeof(pg_temp.tb()) = 'object',
  jsonb_typeof(pg_temp.tb()));

SELECT pg_temp.controle('A2 · les huit clés du contrat, exactement',
  (SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.tb()) k)
    = ARRAY['attente_nombre','consultation_ouverte','encaisse','genere_a',
            'journee','nouveaux_patients_mois','propositions','suivant'],
  (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_object_keys(pg_temp.tb()) k));

-- Le contrat est ÉTROIT : aucun champ clinique n'a le droit d'y entrer. Le
-- motif de consultation (ADR-017) n'est même pas dans la table `appointments`,
-- mais un `notes_admin` ou un `raw_notes` glissé un jour ici passerait inaperçu
-- sans ce contrôle.
SELECT pg_temp.controle('A3 · aucun champ clinique dans le fil',
  NOT (pg_temp.tb()->'journee')::text ~* '(raw_notes|reason|motif|note|diagnos|transcript)',
  'le fil ne porte que des champs opérationnels');

\echo ''
\echo '═══ §B · LA JOURNÉE D''UNE PRATICIENNE (a2) ═══'

-- ⚠️ ON N'AFFIRME PAS UN COMPTE ABSOLU. Ce checkpoint tourne sur la base
-- RÉELLE, qui porte déjà les rendez-vous du jour : exiger « exactement 4 »
-- rendait ROUGE un fil parfaitement correct (constaté le 2026-08-25 — un RDV
-- réel de 08:00 s'ajoutait aux fixtures). On vérifie donc la PRÉSENCE de ce
-- qu'on a posé, ce qui reste vrai quel que soit le reste de la journée.
SELECT pg_temp.controle('B1 · les 4 créneaux fixtures sont dans le fil',
  (SELECT count(*) FROM jsonb_array_elements(pg_temp.tb()->'journee') e
    WHERE e.value->>'id' IN ('00000000-0000-0000-0000-f05800000001',
                             '00000000-0000-0000-0000-f05800000002',
                             '00000000-0000-0000-0000-f05800000003',
                             '00000000-0000-0000-0000-f05800000004')) = 4,
  'arrivé, confirmé, terminé, en séance');

SELECT pg_temp.controle('B2 · l''annulé n''est PAS dans le fil',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.tb()->'journee') e
               WHERE e.value->>'id' = '00000000-0000-0000-0000-f0580000000a'),
  'un rendez-vous annulé n''aura pas lieu');

SELECT pg_temp.controle('B3 · la séance en cours est la sienne',
  pg_temp.tb()->'consultation_ouverte'->>'id'
    = '00000000-0000-0000-0000-f05800000006',
  coalesce(pg_temp.tb()->'consultation_ouverte'->>'id', 'NULL'));

-- Règle de 060 : qui est PHYSIQUEMENT LÀ passe devant, puis le prochain
-- attendu dont le créneau n'est pas terminé. Sous 059, ce contrôle était ROUGE
-- — un RDV de 08:00 jamais clôturé sortait devant le patient de la salle
-- d'attente, et restait « suivant » jusqu'au soir. C'est ce défaut qui a été
-- trouvé ici, puis corrigé en base.
SELECT pg_temp.controle('B4 · le suivant est celui QUI ATTEND DÉJÀ',
  pg_temp.tb()->'suivant'->>'id' = '00000000-0000-0000-0000-f05800000001',
  'lu : ' || coalesce(pg_temp.tb()->'suivant'->>'id', 'NULL'));

SELECT pg_temp.controle('B4bis · un créneau passé non clôturé n''est pas « suivant »',
  NOT EXISTS (SELECT 1 WHERE pg_temp.tb()->'suivant'->>'status' = 'confirmed'
                         AND (pg_temp.tb()->'suivant'->>'ends_at')::timestamptz <= now()),
  'le matin ne se fait plus passer pour l''avenir');

SELECT pg_temp.controle('B5 · salle d''attente = 1',
  (pg_temp.tb()->>'attente_nombre')::bigint = 1,
  coalesce(pg_temp.tb()->>'attente_nombre', 'NULL'));

SELECT pg_temp.controle('B6 · nouveaux patients du mois ≥ 1 (le sien)',
  (pg_temp.tb()->>'nouveaux_patients_mois')::bigint >= 1,
  coalesce(pg_temp.tb()->>'nouveaux_patients_mois', 'NULL'));

\echo ''
\echo '═══ §C · CLOISON ENTRE PRATICIENNES (ADR-003) ═══'

SELECT pg_temp.controle('C1 · a2 ne voit AUCUN créneau d''a1',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.tb()->'journee') e
               WHERE e.value->>'id' = '00000000-0000-0000-0000-f05800000005'),
  'le tableau de bord répond « ma journée »');

RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

SELECT pg_temp.controle('C2 · a1 ne voit AUCUN créneau d''a2',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.tb()->'journee') e
               WHERE e.value->>'practitioner_id' IS NOT NULL
                 AND e.value->>'id' IN ('00000000-0000-0000-0000-f05800000001',
                                        '00000000-0000-0000-0000-f05800000002')),
  'la cloison tient dans les deux sens');

SELECT pg_temp.controle('C3 · a1 n''hérite pas de la séance ouverte d''a2',
  pg_temp.tb()->'consultation_ouverte' = 'null'::jsonb
   OR pg_temp.tb()->'consultation_ouverte'->>'id'
        <> '00000000-0000-0000-0000-f05800000006',
  'one_open_consult est par praticienne');

SELECT pg_temp.controle('C4 · a1 ne compte pas le patient neuf d''a2',
  (pg_temp.tb()->>'nouveaux_patients_mois')::bigint
    = pg_temp.patients_du_mois('00000000-0000-0000-0000-0000000000a1'),
  'le compte suit auth.uid(), pas le cabinet');

\echo ''
\echo '═══ §D · LA CLOISON FINANCIÈRE (ADR-005, D-14) ═══'

SELECT pg_temp.controle('D1 · owner → périmètre « cabinet »',
  pg_temp.tb()->'encaisse'->>'perimetre' = 'cabinet',
  coalesce(pg_temp.tb()->'encaisse'->>'perimetre', 'NULL'));

SELECT pg_temp.controle('D2 · owner → 4 000 DZD encaissés (3 000 + 1 000)',
  (pg_temp.tb()->'encaisse'->>'montant_dzd')::bigint = 4000,
  coalesce(pg_temp.tb()->'encaisse'->>'montant_dzd', 'NULL'));

RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

SELECT pg_temp.controle('D3 · practitioner → périmètre « praticienne »',
  pg_temp.tb()->'encaisse'->>'perimetre' = 'praticienne',
  coalesce(pg_temp.tb()->'encaisse'->>'perimetre', 'NULL'));

RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

-- ⚠️ ZÉRO LIGNE, PAS UNE ERREUR. Une exception apprendrait à l'assistante qu'il
-- y a quelque chose à ne pas voir.
SELECT pg_temp.controle('D4 · assistante → clé `encaisse` NULL',
  pg_temp.tb()->'encaisse' = 'null'::jsonb,
  coalesce((pg_temp.tb()->'encaisse')::text, 'absente'));

SELECT pg_temp.controle('D5 · assistante → l''appel N''ÉCHOUE PAS',
  NOT pg_temp.appel_refuse('SELECT app.dashboard_today(CURRENT_DATE)'),
  'un refus se lit comme un aveu');

\echo ''
\echo '═══ §E · ENCAISSÉ ≠ FACTURÉ — le contrôle central du lot ═══'

RESET request.jwt.claim.sub;
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

-- Si la porte comptait `SUM(amount_dzd)` sans filtre — comme le fait
-- `day_revenue.total_dzd`, qui est un total FACTURÉ — a2 lirait 8 000 sous le
-- mot « encaissé ». C'est faux un jour sur deux, et invisible à l'écran.
SELECT pg_temp.controle('E1 · 3 000 encaissés, PAS 8 000 facturés',
  (pg_temp.tb()->'encaisse'->>'montant_dzd')::bigint = 3000,
  'lu : ' || coalesce(pg_temp.tb()->'encaisse'->>'montant_dzd', 'NULL'));

SELECT pg_temp.controle('E2 · 1 séance encaissée, PAS 2 tarifées',
  (pg_temp.tb()->'encaisse'->>'seances')::bigint = 1,
  'lu : ' || coalesce(pg_temp.tb()->'encaisse'->>'seances', 'NULL'));

\echo ''
\echo '═══ §F · LES PROPOSITIONS JARVIS (012, 033) ═══'

SELECT pg_temp.controle('F1 · une seule proposition en attente',
  jsonb_array_length(pg_temp.tb()->'propositions') = 1,
  'lu : ' || jsonb_array_length(pg_temp.tb()->'propositions')::text);

SELECT pg_temp.controle('F2 · c''est bien la sienne, en état `proposed`',
  pg_temp.tb()->'propositions'->0->>'id'
    = '00000000-0000-0000-0000-f0580000000c',
  coalesce(pg_temp.tb()->'propositions'->0->>'id', 'NULL'));

SELECT pg_temp.controle('F3 · une action DÉJÀ confirmée n''y est plus',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.tb()->'propositions') e
               WHERE e.value->>'id' = '00000000-0000-0000-0000-f0580000000d'),
  'la carte ne redemande pas ce qui est tranché');

SELECT pg_temp.controle('F4 · la proposition d''une consœur reste invisible',
  NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pg_temp.tb()->'propositions') e
               WHERE e.value->>'id' = '00000000-0000-0000-0000-f0580000000e'),
  'policy jarvis_own (012)');

\echo ''
\echo '═══ §G · L''AUDIT NE SE NOIE PAS (patron list_agenda) ═══'

SELECT pg_temp.controle('G1 · UNE trace `liste` par appel',
  pg_temp.un_appel_une_trace(),
  'le rafraîchissement de 120 s coûte 1 ligne, pas 12');

SELECT pg_temp.controle('G2 · aucune trace nominative (patient_id NULL)',
  pg_temp.aucun_patient_nomme(),
  'un coup d''œil au matin n''est pas 12 ouvertures de dossier');

\echo ''
\echo '═══ FIN — la transaction est ANNULÉE, rien n''a été écrit ═══'

RESET request.jwt.claim.sub;
RESET ROLE;
ROLLBACK;
