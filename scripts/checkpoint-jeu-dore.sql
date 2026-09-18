-- checkpoint-jeu-dore — le jeu doré du §35, semé, vérifié, puis ANNULÉ.
--
-- ═══ POURQUOI UNE TRANSACTION QUI SE TERMINE PAR ROLLBACK ══════════════════
--
-- La règle 8 de CLAUDE.md est catégorique : « Une fixture de test vit DANS LA
-- TRANSACTION DU CHECKPOINT, jamais dans un seed livré. » Un jeu de données de
-- démonstration laissé en base finit par ressembler à de vraies données : on
-- oublie qui est fictif, et un jour un certificat sort au nom d'un patient qui
-- n'existe pas.
--
-- Tout ce fichier tourne donc dans UNE transaction, et se termine par
-- `ROLLBACK`. Les comptages sont faits À L'INTÉRIEUR, où les données existent ;
-- après, la base est exactement dans l'état où on l'a trouvée.
--
-- ═══ POURQUOI PASSER PAR LES PORTES, ET NON PAR DES INSERT ════════════════
--
-- On aurait pu remplir les tables directement — c'est plus court et ça marche.
-- Ce serait passer à côté de ce qu'on veut prouver : que la CHAÎNE fonctionne
-- après la migration. Les portes appliquent la RLS, les transitions d'état, la
-- numérotation sans trou, les déclencheurs d'audit et les contraintes
-- d'immutabilité. Un `INSERT` direct les contourne tous, et rendrait un
-- checkpoint vert sur une base dont aucune règle n'a été éprouvée.
--
-- Ce que ce fichier vérifie est donc double : les données sont là (§19), ET
-- elles y sont arrivées par le chemin que l'application emprunte réellement.

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · L'identité — impersonation, exactement comme les autres checkpoints
-- ---------------------------------------------------------------------------
-- On emprunte la praticienne …a1 du semis 015. `SET LOCAL` : l'identité meurt
-- avec la transaction, comme dans `withCaller()`.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

-- ---------------------------------------------------------------------------
-- 1 · 20 patientes, par la porte `app.create_patient`
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE dore_patients (i integer, id uuid) ON COMMIT DROP;

DO $seed$
DECLARE
  n integer;
  v_id uuid;
BEGIN
  FOR n IN 1..20 LOOP
    -- `create_patient` rend `SETOF app.patients` : on prend la ligne, donc `.id`.
    SELECT (app.create_patient(json_build_object(
      -- ⚠️ « BELLOUMI » EST ABSENT DU VIVIER DE `population-synthetique.json`,
      -- ET CE N'EST PAS UN HASARD. Ce patronyme sert aussi de JETON DE
      -- RECHERCHE plus bas (`search_patients('Belloumi', …)` doit rendre
      -- exactement 20). Un nom présent dans la population persistante y
      -- ajouterait ses propres dossiers et ferait rougir un compte qui n'a rien
      -- à voir avec ce que le checkpoint mesure. Si ce nom rejoint un jour le
      -- vivier, c'est ce fichier qu'il faut changer, pas le compte attendu.
      'first_name', 'Amine',
      'last_name',  'Belloumi' || n,
      -- Numéro valide au format attendu par `patients_phone_format`.
      'phone',      '05' || lpad(n::text, 8, '0'),
      'sex',        CASE WHEN n % 2 = 0 THEN 'F' ELSE 'M' END,
      'birth_date', (date '1980-01-01' + (n * 200))::text
    )::text)).id INTO v_id;
    INSERT INTO dore_patients VALUES (n, v_id);
  END LOOP;
END $seed$;

-- ---------------------------------------------------------------------------
-- 2 · 50 consultations + 100 notes, par les portes
-- ---------------------------------------------------------------------------
-- 50 consultations réparties sur les 20 dossiers ; DEUX enregistrements de note
-- par consultation (une ébauche, une reprise), soit 100 écritures de note.
-- `save_note` est idempotente sur la même consultation : c'est bien 50 notes
-- distinctes pour 100 écritures, et c'est ce que le §35 décrit.
CREATE TEMP TABLE dore_consultations (i integer, id uuid, patient_id uuid, appt_id uuid) ON COMMIT DROP;

-- ⚠️ LA CHAÎNE CLINIQUE COMPLÈTE, ET C'EST TOUT L'INTÉRÊT.
--
-- Trois invariants du schéma ont été découverts EN ÉCRIVANT ce checkpoint, et
-- chacun a fait échouer une version plus naïve :
--   1. une séance se rattache TOUJOURS à un rendez-vous (026) — pas de
--      consultation flottante ;
--   2. une seule séance OUVERTE par praticienne à la fois (026) — il faut donc
--      clore avant d'ouvrir la suivante ;
--   3. une séance sans TARIF ne peut pas être close (037) — le geste clinique
--      et le geste comptable sont noués en base.
--
-- Un `INSERT` direct dans `app.consultations` aurait contourné les trois, et
-- le checkpoint serait passé au vert en ne prouvant rien. C'est exactement la
-- raison pour laquelle on sème par les portes.
DO $seed$
DECLARE
  n integer;
  v_patient uuid;
  v_appt    uuid;
  v_consult uuid;
BEGIN
  FOR n IN 1..50 LOOP
    SELECT id INTO v_patient FROM dore_patients WHERE dore_patients.i = ((n - 1) % 20) + 1;

    -- 1 · le rendez-vous
    SELECT app.create_appointment(
      v_patient, auth.uid(),
      now() + (n || ' days')::interval, 30
    ) INTO v_appt;

    -- 2 · la séance
    SELECT app.start_consultation(v_patient, v_appt) INTO v_consult;
    INSERT INTO dore_consultations VALUES (n, v_consult, v_patient, v_appt);

    -- 3 · l'ébauche pendant l'entretien
    PERFORM app.save_note(v_consult, json_build_object(
      'subjective', 'Motif rapporte, seance ' || n,
      'objective',  'Examen clinique consigne.'
    )::text);

    -- 4 · la reprise après l'entretien. C'est le cas qui compte : une note se
    --     complète tant qu'elle n'est pas verrouillée (ADR-004).
    PERFORM app.save_note(v_consult, json_build_object(
      'assessment', 'Evaluation consignee, seance ' || n,
      'plan',       'Conduite a tenir consignee.'
    )::text);

    -- 5 · le tarif, sans lequel la séance ne peut pas être close (037)
    PERFORM app.set_consultation_price(v_consult, 2000);

    -- 6 · la clôture — obligatoire, sinon la séance suivante refuse de s'ouvrir
    PERFORM app.close_consultation(v_consult);
  END LOOP;
END $seed$;

-- ---------------------------------------------------------------------------
-- 4 · Les comptages du §19 — source == cible
-- ---------------------------------------------------------------------------
\echo ''
\echo '── COMPTAGES DU JEU DORE ────────────────────────────────────────────'

SELECT 'patients semes' AS mesure,
       (SELECT count(*) FROM dore_patients)::text AS obtenu,
       '20' AS attendu,
       CASE WHEN (SELECT count(*) FROM dore_patients) = 20 THEN 'VERT' ELSE 'ROUGE' END AS verdict
UNION ALL
SELECT 'consultations semees',
       (SELECT count(*) FROM dore_consultations)::text, '50',
       CASE WHEN (SELECT count(*) FROM dore_consultations) = 50 THEN 'VERT' ELSE 'ROUGE' END
UNION ALL
SELECT 'notes cliniques rattachees',
       (SELECT count(*)::text FROM app.clinical_notes n
         WHERE n.consultation_id IN (SELECT id FROM dore_consultations)), '50',
       CASE WHEN (SELECT count(*) FROM app.clinical_notes n
                   WHERE n.consultation_id IN (SELECT id FROM dore_consultations)) = 50
            THEN 'VERT' ELSE 'ROUGE' END
UNION ALL
-- INTÉGRITÉ RÉFÉRENTIELLE : aucune consultation orpheline. La question n'est
-- pas rhétorique — c'est exactement ce qu'une migration casse en silence.
SELECT 'consultations sans patient (orphelines)',
       (SELECT count(*)::text FROM dore_consultations c
         WHERE NOT EXISTS (SELECT 1 FROM dore_patients p WHERE p.id = c.patient_id)), '0',
       CASE WHEN (SELECT count(*) FROM dore_consultations c
                   WHERE NOT EXISTS (SELECT 1 FROM dore_patients p WHERE p.id = c.patient_id)) = 0
            THEN 'VERT' ELSE 'ROUGE' END
UNION ALL
SELECT 'notes sans consultation (orphelines)',
       (SELECT count(*)::text FROM app.clinical_notes n
         WHERE n.consultation_id IN (SELECT id FROM dore_consultations)
           AND NOT EXISTS (SELECT 1 FROM app.consultations c WHERE c.id = n.consultation_id)), '0',
       CASE WHEN (SELECT count(*) FROM app.clinical_notes n
                   WHERE n.consultation_id IN (SELECT id FROM dore_consultations)
                     AND NOT EXISTS (SELECT 1 FROM app.consultations c WHERE c.id = n.consultation_id)) = 0
            THEN 'VERT' ELSE 'ROUGE' END
UNION ALL
-- L'AUDIT A-T-IL SUIVI ? Chaque écriture passe par trg_audit (013). Un jeu doré
-- qui ne produirait aucune trace signalerait un déclencheur perdu à la migration.
SELECT 'traces d''audit produites',
       (SELECT count(*)::text FROM audit.log WHERE occurred_at > now() - interval '5 minutes'),
       '> 100',
       CASE WHEN (SELECT count(*) FROM audit.log WHERE occurred_at > now() - interval '5 minutes') > 100
            THEN 'VERT' ELSE 'ROUGE' END
UNION ALL
-- NUMÉROTATION SANS TROU (§6) : autant de numéros distincts que de patientes.
--
-- ⚠️ COMPTÉ PAR LA PORTE, PAS PAR LA TABLE. Une première rédaction lisait
-- `FROM app.patients` et a été refusée : « permission denied for table
-- patients ». C'est ADR-019 qui fonctionne — le SELECT direct est révoqué,
-- même pour un checkpoint. On passe donc par `app.search_patients`, ce qui a
-- l'avantage de mesurer ce que l'application voit réellement.
SELECT 'numeros de dossier distincts (par la porte)',
       (SELECT count(DISTINCT s.record_number)::text
          FROM app.search_patients('Belloumi', 100, 0) s), '20',
       CASE WHEN (SELECT count(DISTINCT s.record_number)
                    FROM app.search_patients('Belloumi', 100, 0) s) = 20
            THEN 'VERT' ELSE 'ROUGE' END
UNION ALL
-- Et la preuve qu'ADR-019 tient toujours : la table elle-même reste fermée.
SELECT 'SELECT direct sur app.patients',
       CASE WHEN has_table_privilege('authenticated', 'app.patients', 'SELECT')
            THEN 'AUTORISE' ELSE 'revoque' END, 'revoque',
       CASE WHEN has_table_privilege('authenticated', 'app.patients', 'SELECT')
            THEN 'ROUGE' ELSE 'VERT' END;

-- ---------------------------------------------------------------------------
-- 5 · L'IMMUTABILITÉ CLINIQUE (ADR-004) — le contrôle qui doit REFUSER
-- ---------------------------------------------------------------------------
-- ⚠️ PREMIÈRE RÉDACTION FAUSSE, ET ELLE ACCUSAIT LE SCHÉMA À TORT.
--
-- Elle clôturait la séance, puis tentait de réécrire la note, et concluait
-- « ADR-004 est tombée » quand l'écriture passait. Le verdict était ROUGE et le
-- schéma parfaitement sain : le test confondait deux choses distinctes.
--
-- Ce que dit réellement la migration 008 :
--   · `close_consultation` ferme la SÉANCE. Elle ne verrouille pas la note ;
--   · `sign_note` pose `status = 'signed'`, et le déclencheur `trg_note_sign`
--     pose alors `lock_after = now() + 15 minutes` ;
--   · `trg_note_immutable` ne refuse l'écriture que si
--     `OLD.status = 'signed' AND now() > OLD.lock_after`.
--
-- Il y a donc une FENÊTRE DE GRÂCE de quinze minutes après signature, pendant
-- laquelle une correction reste possible — c'est un choix clinique délibéré, pas
-- un trou. Un test qui l'ignore accuse le schéma d'un défaut qu'il n'a pas.
--
-- On éprouve donc les DEUX moitiés de la règle.
\echo ''
\echo '── IMMUTABILITE (ADR-004) ───────────────────────────────────────────'

DO $garde$
DECLARE
  v_consult uuid;
  v_note    uuid;
  v_statut  text;
  v_lock    timestamptz;
  v_refuse  boolean := false;
BEGIN
  -- On rouvre une séance pour disposer d'une note signable.
  SELECT id INTO v_consult FROM dore_consultations WHERE i = 7;
  SELECT id, status, lock_after INTO v_note, v_statut, v_lock
    FROM app.clinical_notes WHERE consultation_id = v_consult;

  IF v_note IS NULL THEN
    RAISE EXCEPTION 'ROUGE · aucune note pour la seance 7 : le semis est incomplet';
  END IF;

  -- ── Moitié 1 : la signature pose bien le verrou différé ──
  PERFORM app.sign_note(v_note);
  SELECT status, lock_after INTO v_statut, v_lock
    FROM app.clinical_notes WHERE id = v_note;

  IF v_statut <> 'signed' THEN
    RAISE EXCEPTION 'ROUGE · sign_note n''a pas pose status=signed (%)', v_statut;
  END IF;
  IF v_lock IS NULL OR v_lock <= now() THEN
    RAISE EXCEPTION 'ROUGE · lock_after absent ou deja echu apres signature (%)', v_lock;
  END IF;
  RAISE NOTICE 'VERT  · signature : status=signed, verrou differe a %', v_lock;

  -- ── Moitié 2 : une fois la fenêtre passée, l'écriture est REFUSÉE ──
  -- On simule l'écoulement des quinze minutes en reculant `lock_after`. Ce
  -- geste n'est PAS un contournement du garde-fou : il déplace l'horloge, pas
  -- la règle. Il faut le rôle propriétaire, parce que `save_note` exclut
  -- délibérément `lock_after` de son allowlist (I15) — la base seule pose ce
  -- champ, et c'est bien ce qu'on veut.
  RESET ROLE;
  UPDATE app.clinical_notes SET lock_after = now() - interval '1 minute'
   WHERE id = v_note;
  SET LOCAL ROLE authenticated;

  BEGIN
    UPDATE app.clinical_notes SET subjective = 'REECRITURE INTERDITE' WHERE id = v_note;
  EXCEPTION WHEN OTHERS THEN
    v_refuse := true;
  END;

  IF v_refuse THEN
    RAISE NOTICE 'VERT  · apres la fenetre, la note signee REFUSE la reecriture';
  ELSE
    RAISE EXCEPTION 'ROUGE · une note signee et verrouillee a ete REECRITE — ADR-004 est tombee';
  END IF;
END $garde$;

-- ---------------------------------------------------------------------------
-- 6 · La cloison, sous une AUTRE praticienne
-- ---------------------------------------------------------------------------
\echo ''
\echo '── CLOISON ADR-003 ──────────────────────────────────────────────────'

SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

SELECT 'patientes du jeu dore visibles par la Dr #2' AS mesure,
       (SELECT count(*)::text FROM app.search_patients('Belloumi', 100, 0)) AS obtenu,
       '0' AS attendu,
       CASE WHEN (SELECT count(*) FROM app.search_patients('Belloumi', 100, 0)) = 0
            THEN 'VERT' ELSE 'ROUGE' END AS verdict;

-- ---------------------------------------------------------------------------
-- 7 · Rien ne reste
-- ---------------------------------------------------------------------------
-- `ROLLBACK`, pas `COMMIT`. Règle 8. La base retrouve exactement l'état d'avant.
ROLLBACK;

\echo ''
\echo '── ANNULE : la base est revenue a son etat initial (regle 8) ─────────'
