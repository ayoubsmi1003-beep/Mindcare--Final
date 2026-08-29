-- checkpoint-jarvis-conversations.sql — V-JARVIS-CORE · la vérité des portes
-- de la migration 058, l'idempotence des tours, et la cloison propriétaire.
--
--   docker run --rm -i -e PGURL="$DATABASE_URL" postgres:15 \
--     sh -c 'psql "$PGURL" -f -' < checkpoints/checkpoint-jarvis-conversations.sql
--
-- ⚠️ TOUT SE PASSE DANS UNE TRANSACTION ANNULÉE — impersonation par
-- `SET LOCAL ROLE authenticated` + `SET request.jwt.claim.sub`
-- (voie checkpoint-v2-rls / reception), ROLLBACK final. Rien n'entre dans les
-- données livrées (règle 8).
--
-- CE QUE LE FICHIER PROUVE :
--   §A  plateforme    : RLS FORCE, triggers trg_audit, révocations aux rôles API
--   §B  propriété     : a2 ouvre son fil, parle, relit par la porte ;
--                       fenêtre bornée ; audit émis par l'usage normal
--   §C  idempotence   : réponse notée DEUX fois (serveur + repli client)
--                       → UNE ligne, premier contenu gagnant ; interruption
--                       portée par son statut ; tour humain persist-first
--   §D  validation    : chemin/statut/contenu/outil absurdes refusés EN BASE
--   §E  ajout-seul    : INSERT/SELECT/UPDATE/DELETE directs refusés à
--                       authenticated ; gatekeeper borné à last_message_at
--   §F  cloison       : a1 et a3 n'écrivent pas et ne lisent pas le fil d'a2 ;
--                       hors périmètre ≡ introuvable (false, sans oracle)
--
-- Les contrôles refusent le NULL : une condition qui ne compare rien n'est
-- pas verte (leçon v6, conservée telle quelle).
--
-- NOTE DE MÉTHODE : plusieurs conversations créées DANS LA MÊME TRANSACTION
-- partageraient now() — le « plus récent » de get_jarvis_history serait alors
-- indécidable. Le checkpoint n'exerce donc qu'UNE conversation par rôle :
-- en production, chaque conversation naît d'un appel HTTP distinct, donc
-- d'une horloge distincte.

\set ON_ERROR_STOP on
\pset pager off
\set QUIET on

BEGIN;

-- ── Harnais ────────────────────────────────────────────────────────────────
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

CREATE FUNCTION pg_temp.traces_depuis(p_depuis bigint) RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = audit, pg_catalog AS $$
  SELECT count(*) FROM audit.log WHERE id > p_depuis
    AND table_name IN ('jarvis_conversations','jarvis_messages');
$$;

CREATE FUNCTION pg_temp.msgs(p_conv uuid, p_role text DEFAULT NULL)
RETURNS bigint
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT count(*) FROM app.jarvis_messages
   WHERE conversation_id = p_conv
     AND (p_role IS NULL OR role = p_role);
$$;

CREATE FUNCTION pg_temp.reponse_de(p_conv uuid, p_turn uuid)
RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path = app, pg_catalog AS $$
  SELECT contenu || '|' || statut FROM app.jarvis_messages
   WHERE conversation_id = p_conv AND client_turn_id = p_turn AND role = 'jarvis';
$$;

-- Exécute du SQL SOUS LE RÔLE COURANT et rend SQLSTATE, ou 'OK'.
-- INVOKER : il voit exactement ce que voit l'impersoné.
CREATE FUNCTION pg_temp.etat(p_sql text) RETURNS text
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE p_sql;
  RETURN 'OK';
EXCEPTION WHEN OTHERS THEN
  RETURN SQLSTATE;
END $$;

-- État partagé entre sections (temporaire : meurt avec le ROLLBACK).
-- Le GRANT est obligatoire : sous `SET LOCAL ROLE authenticated`, les tables
-- temporaires du rôle de connexion sont inaccessibles sans privilège.
CREATE TEMP TABLE etat_courant (conv uuid, tour1 uuid, tour2 uuid);
GRANT SELECT, INSERT, UPDATE, DELETE ON etat_courant TO authenticated;

-- ══════════════════════════════════════════════════════════════════════════
-- §A · PLATEFORME (sous le rôle de connexion)
-- ══════════════════════════════════════════════════════════════════════════
DO $$
DECLARE v bigint;
BEGIN
  SELECT count(*) INTO v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='app' AND c.relname='jarvis_conversations'
     AND c.relrowsecurity AND c.relforcerowsecurity;
  PERFORM pg_temp.controle('A1 RLS ENABLE+FORCE conversations', v = 1);

  SELECT count(*) INTO v FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='app' AND c.relname='jarvis_messages'
     AND c.relrowsecurity AND c.relforcerowsecurity;
  PERFORM pg_temp.controle('A2 RLS ENABLE+FORCE messages', v = 1);

  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgrelid = 'app.jarvis_conversations'::regclass AND tgname='trg_audit' AND NOT tgisinternal;
  PERFORM pg_temp.controle('A3 trg_audit posé sur conversations', v >= 1);

  SELECT count(*) INTO v FROM pg_trigger
   WHERE tgrelid = 'app.jarvis_messages'::regclass AND tgname='trg_audit' AND NOT tgisinternal;
  PERFORM pg_temp.controle('A4 trg_audit posé sur messages', v >= 1);
END $$;

-- Les révocations ne se prouvent PAS sous le rôle de connexion : un
-- superuser passe outre. Elles se prouvent sous un rôle API impersoné.
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

DO $$
BEGIN
  PERFORM pg_temp.controle('A5 SELECT direct conversations révoqué',
    pg_temp.etat('SELECT count(*) FROM app.jarvis_conversations') = '42501');
  PERFORM pg_temp.controle('A6 SELECT direct messages révoqué',
    pg_temp.etat('SELECT count(*) FROM app.jarvis_messages') = '42501');
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- ══════════════════════════════════════════════════════════════════════════
-- §B · PROPRIÉTÉ — a2 ouvre son fil, parle, relit par la porte
-- ══════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

DO $$
DECLARE
  v_conv uuid;
  v_hist jsonb;
  v_avant bigint;
BEGIN
  v_conv := app.start_jarvis_conversation();
  PERFORM pg_temp.controle('B1 a2 ouvre une conversation', v_conv IS NOT NULL);
  INSERT INTO pg_temp.etat_courant VALUES (
    v_conv,
    '11111111-1111-4111-8111-111111111101',
    '11111111-1111-4111-8111-111111111102');

  v_avant := pg_temp.traces_depuis(0);

  PERFORM pg_temp.controle('B2 tour humain enregistré (persist-first)',
    app.append_jarvis_turn(v_conv,
      '11111111-1111-4111-8111-111111111101', 'Question de contrôle A2'));

  PERFORM pg_temp.controle('B3 rejeu humain → false sans doublon',
    NOT app.append_jarvis_turn(v_conv,
      '11111111-1111-4111-8111-111111111101', 'Question de contrôle A2')
    AND pg_temp.msgs(v_conv, 'humain') = 1);

  PERFORM pg_temp.controle('B4 réponse canonique enregistrée',
    app.complete_jarvis_turn(v_conv,
      '11111111-1111-4111-8111-111111111101',
      'connaissance', 'Réponse de contrôle.', 'connaissance-generale'));

  PERFORM pg_temp.controle('B5 rejeu réponse → false sans doublon',
    NOT app.complete_jarvis_turn(v_conv,
      '11111111-1111-4111-8111-111111111101',
      'connaissance', 'Réponse de contrôle.')
    AND pg_temp.msgs(v_conv, 'jarvis') = 1);

  -- Historique PAR LA PORTE : contrat explicite, ordre ascendant.
  SELECT app.get_jarvis_history(50) INTO v_hist;
  PERFORM pg_temp.controle('B6 historique contrat + fil correct',
    v_hist->>'contrat' = '1'
    AND v_hist->>'conversationId' = v_conv::text
    AND jsonb_array_length(v_hist->'messages') = 2
    AND v_hist->'messages'->0->>'role' = 'humain'
    AND v_hist->'messages'->1->>'chemin' = 'connaissance'
    AND (v_hist->'messages'->0->>'rang')::bigint
      < (v_hist->'messages'->1->>'rang')::bigint);

  PERFORM pg_temp.controle('B7 audit émis par l''usage des portes',
    pg_temp.traces_depuis(v_avant) >= 4,
    'insert conv · msg humain · update conv · msg jarvis');

  -- Fenêtre bornée : un deuxième tour complet, p_limit=2 → les deux derniers.
  PERFORM app.append_jarvis_turn(v_conv,
    '11111111-1111-4111-8111-111111111102', 'Deuxième question de contrôle.');
  PERFORM app.complete_jarvis_turn(v_conv,
    '11111111-1111-4111-8111-111111111102',
    'connaissance', 'Deuxième réponse de contrôle.');
  SELECT app.get_jarvis_history(2) INTO v_hist;
  PERFORM pg_temp.controle('B8 fenêtre get_jarvis_history honorée',
    jsonb_array_length(v_hist->'messages') = 2
    AND v_hist->'messages'->0->>'contenu' = 'Deuxième question de contrôle.'
    AND v_hist->'messages'->1->>'role' = 'jarvis'
    AND v_hist->'messages'->1->>'statut' = 'complet');
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- ══════════════════════════════════════════════════════════════════════════
-- §C · IDEMPOTENCE DOUBLE ÉCRITURE + INTERRUPTION (toujours sous a2)
-- ══════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

DO $$
DECLARE
  v_conv uuid;
  v_tour uuid := '11111111-1111-4111-8111-111111111103';
BEGIN
  SELECT conv INTO v_conv FROM pg_temp.etat_courant;

  PERFORM app.append_jarvis_turn(v_conv, v_tour, 'Question interrompue.');

  -- La génération est coupée : la passerelle note le partiel (statut
  -- « interrompu »), PUIS le repli client rejoue le même appel — scénario
  -- nominal de l'interruption. UNE seule ligne doit exister, et c'est la
  -- PREMIÈRE qui gagne (le contenu du serveur fait foi).
  PERFORM pg_temp.controle('C1 interruption notée avec son statut',
    app.complete_jarvis_turn(v_conv, v_tour, 'connaissance',
                             'Réponse partielle coupée.', NULL, 'interrompu'));
  PERFORM pg_temp.controle('C2 repli client → false, contenu intact',
    NOT app.complete_jarvis_turn(v_conv, v_tour, 'connaissance',
                                 'AUTRE CONTENU CONCURRENT.', NULL, 'complet')
    AND pg_temp.reponse_de(v_conv, v_tour) = 'Réponse partielle coupée.|interrompu');

  PERFORM pg_temp.controle('C3 trois tours, six lignes au total, aucun doublon',
    pg_temp.msgs(v_conv, NULL) = 6,
    't1 hum+rep · t2 hum+rep · t3 hum+partiel');
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- ══════════════════════════════════════════════════════════════════════════
-- §D · VALIDATION EN BASE — l'absurde est refusé à la porte (a2)
-- ══════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

DO $$
DECLARE v_conv uuid;
BEGIN
  SELECT conv INTO v_conv FROM pg_temp.etat_courant;

  PERFORM pg_temp.controle('D1 chemin inconnu refusé',
    pg_temp.etat(format(
      'SELECT app.complete_jarvis_turn(%L, %L, ''saboteur'', ''x'')',
      v_conv, '11111111-1111-4111-8111-111111111199')) <> 'OK');
  PERFORM pg_temp.controle('D2 statut inconnu refusé',
    pg_temp.etat(format(
      'SELECT app.complete_jarvis_turn(%L, %L, ''connaissance'', ''x'', NULL, ''annule'')',
      v_conv, '11111111-1111-4111-8111-111111111199')) <> 'OK');
  PERFORM pg_temp.controle('D3 contenu vide refusé',
    pg_temp.etat(format(
      'SELECT app.complete_jarvis_turn(%L, %L, ''connaissance'', ''  '')',
      v_conv, '11111111-1111-4111-8111-111111111199')) <> 'OK');
  PERFORM pg_temp.controle('D4 demande vide refusée',
    pg_temp.etat(format(
      'SELECT app.append_jarvis_turn(%L, %L, '''')',
      v_conv, '11111111-1111-4111-8111-111111111198')) <> 'OK');
  PERFORM pg_temp.controle('D5 outil non-objet refusé',
    pg_temp.etat(format(
      'SELECT app.complete_jarvis_turn(%L, %L, ''patient'', ''x'', NULL, ''complet'', ''[1,2]''::jsonb)',
      v_conv, '11111111-1111-4111-8111-111111111197')) <> 'OK');
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- ══════════════════════════════════════════════════════════════════════════
-- §E · AJOUT-SEUL — personne ne mute ni n'efface un message (sous a2)
-- ══════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a2';

DO $$
DECLARE v_conv uuid;
BEGIN
  SELECT conv INTO v_conv FROM pg_temp.etat_courant;

  PERFORM pg_temp.controle('E1 INSERT direct message refusé',
    pg_temp.etat(format(
      'INSERT INTO app.jarvis_messages(conversation_id,client_turn_id,role,contenu)'
      ||' VALUES (%L,''99999999-9999-4999-8999-999999999991'',''humain'',''x'')', v_conv)) = '42501');
  PERFORM pg_temp.controle('E2 UPDATE direct message refusé',
    pg_temp.etat('UPDATE app.jarvis_messages SET contenu=''x''') = '42501');
  PERFORM pg_temp.controle('E3 DELETE direct message refusé',
    pg_temp.etat('DELETE FROM app.jarvis_messages') = '42501');
  PERFORM pg_temp.controle('E4 UPDATE direct conversation refusé',
    pg_temp.etat(format(
      'UPDATE app.jarvis_conversations SET closed_at=now() WHERE id=%L', v_conv)) = '42501');
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

-- Le porteur (gatekeeper, rôle des portes DEFINER) est borné LUI AUSSI :
-- il ne peut poser que last_message_at, jamais closed_at ni une autre colonne.
SET LOCAL ROLE app_gatekeeper;
DO $$
BEGIN
  PERFORM pg_temp.controle('E5 gatekeeper sans UPDATE hors last_message_at',
    pg_temp.etat($g$UPDATE app.jarvis_conversations SET closed_at = now()$g$) = '42501');
END $$;
RESET ROLE;

-- ══════════════════════════════════════════════════════════════════════════
-- §F · CLOISON CROISÉE — a1 et a3 restent dehors du fil d'a2
-- ══════════════════════════════════════════════════════════════════════════
SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

DO $$
DECLARE
  v_conv_a2 uuid;
  v_mien uuid;
BEGIN
  SELECT conv INTO v_conv_a2 FROM pg_temp.etat_courant;

  -- Hors périmètre ≡ introuvable : false, jamais une erreur distincte (ADR-003).
  PERFORM pg_temp.controle('F1 a1 ne peut pas écrire dans le fil d''a2',
    NOT app.append_jarvis_turn(v_conv_a2,
      '33333333-3333-4333-8333-333333333301', 'tentative croisée')
    AND NOT app.complete_jarvis_turn(v_conv_a2,
      '33333333-3333-4333-8333-333333333301', 'connaissance', 'tentative croisée'));

  -- Son propre monde fonctionne, et son historique NE MONTRE PAS celui d'a2.
  v_mien := app.start_jarvis_conversation();
  PERFORM app.append_jarvis_turn(v_mien,
    '33333333-3333-4333-8333-333333333302', 'Question privée du owner.');
  PERFORM pg_temp.controle('F2 a1 vit SON fil, jamais celui d''a2',
    v_mien IS NOT NULL AND v_mien <> v_conv_a2
    AND (SELECT app.get_jarvis_history(50))->>'conversationId' = v_mien::text
    AND jsonb_array_length((SELECT app.get_jarvis_history(50))->'messages') = 1);
END $$;

RESET ROLE;
RESET request.jwt.claim.sub;

SET LOCAL ROLE authenticated;
SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a3';

DO $$
DECLARE v_hist jsonb;
BEGIN
  -- a3 n'a rien ouvert : contrat vide honnête (jamais le fil d'autrui).
  SELECT app.get_jarvis_history(50) INTO v_hist;
  PERFORM pg_temp.controle('F3 a3 sans conversation → vide honnête',
    v_hist->>'contrat' = '1'
    AND (v_hist->>'conversationId') IS NULL
    AND jsonb_array_length(v_hist->'messages') = 0);
END $$;

ROLLBACK;
