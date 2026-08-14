-- 033_jarvis_gates — la boucle proposer → confirmer → exécuter → journaliser.
--
-- 012 a créé `app.jarvis_actions` et la contrainte `jarvis_must_confirm` (I16).
-- Depuis, AUCUNE fonction n'écrit dans cette table : de 001 à 032, la boucle
-- n'existe qu'en intention. Ce fichier l'écrit, en base, parce que la règle 5
-- de CLAUDE.md n'accepte pas qu'une écriture métier et sa trace vivent dans
-- deux requêtes que PostgREST ne peut pas réunir dans une transaction.
--
-- NUMÉROTATION — pourquoi `033` alors que STATE.md dit « aucune migration 033 ».
-- Cette phrase a été écrite le 2026-08-11 pour la porte G4, c'est-à-dire une
-- porte SQL COMPOSITE sur l'agenda, refusée faute de mesure. Arbitrage
-- utilisateur du 2026-08-12 : l'interdiction portait sur cet OBJET, pas sur le
-- NUMÉRO. La porte composite agenda n'est toujours pas écrite et reste
-- reportée à V5. `031` reste absent de ce dossier : il vit dans `docs/` et
-- reviendra en V6 (seed des modèles de documents).
--
-- ⚠️ CES QUATRE FONCTIONS SONT `SECURITY INVOKER`, ET CE N'EST PAS UN DÉFAUT
-- D'ÉCRITURE. `app.execute_jarvis_action` appelle les portes métier existantes
-- (`app.create_appointment` dans sa forme VIVANTE, celle de 024 — 022 l'a créée
-- mais 024 l'a remplacée, signature comprise ; `app.set_consultation_price` de
-- 029), elles
-- aussi `SECURITY INVOKER`. Sous `SECURITY DEFINER` appartenant à
-- `app_gatekeeper`, l'appel imbriqué s'exécuterait sous ce rôle : les policies
-- `TO authenticated` — `jarvis_own` de 012 comprise — cesseraient de
-- s'appliquer, et sous `FORCE ROW LEVEL SECURITY` (007) une table sans policy
-- applicable ne rend AUCUNE ligne. L'écriture ne serait pas élargie, elle
-- disparaîtrait. C'est le raisonnement déjà payé en 018 puis annulé en 019 ;
-- il n'est pas rejoué ici. Aucun `ALTER FUNCTION … OWNER TO` dans ce fichier.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · L'ALLOWLIST EST UNE CONTRAINTE, PAS UNE CONSTANTE TYPESCRIPT (L1)
-- ---------------------------------------------------------------------------
-- `03-JARVIS-TOOLS.md` L1 : « un outil absent d'ici n'existe pas ». Écrite en
-- TypeScript, cette loi tient tant que personne ne se trompe d'import. Écrite
-- ici, elle tient même contre un bug — c'est la même intention que I16.
--
-- SEULS LES DEUX OUTILS `write: true` DE V2 FIGURENT ICI, et c'est délibéré.
-- Les trois autres outils gelés (`analyze_session`, `search_patients`,
-- `get_agenda`) sont `write: false` : ils s'exécutent immédiatement, sans
-- confirmation, et ne posent aucune ligne dans cette table — `jarvis.ts` le
-- documente déjà pour `analyze_session`. Y inscrire leur nom laisserait croire
-- qu'une lecture peut être « confirmée puis exécutée », et ouvrirait un chemin
-- d'écriture pour un outil qui n'écrit rien. La table journalise les actes qui
-- exigent une main humaine ; les lectures laissent leur trace ailleurs, dans
-- `audit.log`, par les portes d'ADR-019.
--
-- La table est vide à cet instant — aucun écrivain n'a existé depuis 012 — donc
-- la contrainte se valide sans exception sur les lignes existantes.
--
-- LE `DROP … IF EXISTS` N'EST PAS UNE PRÉCAUTION DÉCORATIVE. Postgres n'offre
-- pas `ADD CONSTRAINT IF NOT EXISTS` pour un CHECK : un second passage de ce
-- fichier échouerait en `42710`. Or l'`INSERT … ON CONFLICT DO NOTHING` de la
-- fin annonce une migration REJOUABLE, et `db-migrate.sh` la rejouerait sur
-- toute base où `app.schema_migrations` a été perdue. Une migration à moitié
-- rejouable est un piège qui ne se voit qu'au deuxième rejeu. Même motif que
-- 034:34, écrit pour la même raison.
ALTER TABLE app.jarvis_actions DROP CONSTRAINT IF EXISTS jarvis_tool_allowlist;

ALTER TABLE app.jarvis_actions ADD CONSTRAINT jarvis_tool_allowlist
    CHECK (tool_name IN ('create_appointment', 'set_consultation_price'));

-- ---------------------------------------------------------------------------
-- 2 · PROPOSER — Jarvis écrit son intention, il n'exécute rien
-- ---------------------------------------------------------------------------
-- `p_tool_args` est du `text`, PAS du `jsonb`, et c'est le port qui l'impose :
-- `RpcArgs` (ADR-020) ne transporte que des scalaires. Même forme que
-- `app.update_appointment` (022), pour que cela s'apprenne une seule fois.
--
-- Ni `cabinet_id` ni `actor_id` ne sont des paramètres : les accepter de
-- l'appelant déplacerait une décision d'autorisation dans le client. Ils
-- viennent de `app.current_cabinet()` et `auth.uid()`, et la policy `jarvis_own`
-- de 012 les revérifie au `WITH CHECK`.
CREATE OR REPLACE FUNCTION app.propose_jarvis_action(
  p_conversation_id uuid,
  p_user_utterance  text,
  p_tool_name       text,
  p_tool_args       text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_id   uuid;
  v_args jsonb;
BEGIN
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION 'Conversation absente : une proposition appartient à un échange.';
  END IF;

  IF nullif(btrim(coalesce(p_user_utterance, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Demande vide : une proposition cite toujours ce qui l''a déclenchée.';
  END IF;

  -- Le cast échoue bruyamment sur un JSON malformé, avant tout INSERT. Zod
  -- valide déjà côté serveur ; ceci est la seconde barrière, celle qui tient
  -- même si l'appelant n'est pas notre code.
  BEGIN
    v_args := p_tool_args::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Arguments illisibles : le contenu attendu est un objet JSON.';
  END;

  IF jsonb_typeof(v_args) <> 'object' THEN
    RAISE EXCEPTION 'Arguments illisibles : le contenu attendu est un objet JSON.';
  END IF;

  -- L'allowlist est déjà une contrainte (§1). Ce test ne la remplace pas : il
  -- rend le refus lisible à l'écran plutôt que de laisser remonter une
  -- violation de contrainte brute. Même partage des rôles que le test de
  -- montant de `set_consultation_price` (029) face au CHECK de 011.
  IF p_tool_name IS NULL OR p_tool_name NOT IN ('create_appointment', 'set_consultation_price') THEN
    RAISE EXCEPTION 'Outil inconnu : Jarvis ne dispose d''aucune action de ce nom.';
  END IF;

  INSERT INTO app.jarvis_actions (cabinet_id, actor_id, conversation_id,
                                  user_utterance, tool_name, tool_args, state)
  VALUES (app.current_cabinet(), auth.uid(), p_conversation_id,
          p_user_utterance, p_tool_name, v_args, 'proposed')
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.propose_jarvis_action(uuid, text, text, text) IS
  'V2. SECURITY INVOKER : aucune élévation, la policy jarvis_own de 012 décide. '
  'Écrit une intention en état `proposed`. N''exécute rien, ne touche aucune '
  'table métier. cabinet_id et actor_id viennent de la session, jamais du client.';

-- ---------------------------------------------------------------------------
-- 3 · CONFIRMER — `confirmed_at` est écrit ICI, donc AVANT toute exécution
-- ---------------------------------------------------------------------------
-- Confirmer et exécuter sont DEUX portes, et deux appels distincts. C'est ce
-- qui donne à `SPRINT-V1.md` §V2.5 (« confirmed_at écrit AVANT l'exécution,
-- jamais l'inverse ») une garantie et non une intention : quand
-- `execute_jarvis_action` commence, la ligne confirmée est déjà commitée. Les
-- réunir dans une seule fonction rendrait l'ordre indémontrable après coup.
CREATE OR REPLACE FUNCTION app.confirm_jarvis_action(p_id uuid)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_state app.jarvis_state;
  v_at    timestamptz;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Le verrou AVANT toute décision : deux clics sur la même carte se
  -- sérialisent, et le second lit un état déjà changé.
  SELECT state INTO v_state
    FROM app.jarvis_actions
   WHERE id = p_id
     FOR UPDATE;

  -- Ligne inexistante OU masquée par la RLS : même retour. Une erreur qui
  -- distinguerait les deux serait un oracle d'existence (ADR-003).
  IF v_state IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_state <> 'proposed' THEN
    RAISE EXCEPTION 'Cette proposition n''est plus en attente.';
  END IF;

  v_at := now();

  UPDATE app.jarvis_actions
     SET state = 'confirmed', confirmed_at = v_at
   WHERE id = p_id;

  RETURN v_at;
END;
$$;

COMMENT ON FUNCTION app.confirm_jarvis_action(uuid) IS
  'V2. Pose confirmed_at et l''état `confirmed`, dans une transaction distincte '
  'de l''exécution : c''est ce qui rend l''ordre « confirmé puis exécuté » '
  'vérifiable après coup, et pas seulement promis.';

-- ---------------------------------------------------------------------------
-- 4 · REFUSER — le chemin de sortie de la carte de confirmation
-- ---------------------------------------------------------------------------
-- Sans lui, une proposition déclinée resterait `proposed` indéfiniment et la
-- carte n'aurait qu'un seul bouton. L'état `rejected` existe dans l'enum
-- `app.jarvis_state` depuis 002 : rien n'est ajouté au schéma (règle 9).
CREATE OR REPLACE FUNCTION app.reject_jarvis_action(p_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_state app.jarvis_state;
BEGIN
  IF p_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT state INTO v_state
    FROM app.jarvis_actions
   WHERE id = p_id
     FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN false;
  END IF;

  IF v_state <> 'proposed' THEN
    RAISE EXCEPTION 'Cette proposition n''est plus en attente.';
  END IF;

  UPDATE app.jarvis_actions SET state = 'rejected' WHERE id = p_id;
  RETURN true;
END;
$$;

COMMENT ON FUNCTION app.reject_jarvis_action(uuid) IS
  'V2. Décline une proposition. Aucune donnée métier touchée, aucune raison '
  'demandée : refuser est le défaut, il n''a pas à se justifier.';

-- ---------------------------------------------------------------------------
-- 5 · EXÉCUTER — l'écriture métier et sa trace, dans LA MÊME TRANSACTION
-- ---------------------------------------------------------------------------
-- C'est la fonction que la règle 5 exige. Elle n'a aucun droit propre : elle
-- appelle la porte métier existante, qui garde son verrou, ses bornes, ses
-- transitions et son `trg_audit` (013). Aucune règle métier n'est réécrite ici.
--
-- ⚠️ `error` NE REÇOIT JAMAIS `SQLERRM`, SEULEMENT `SQLSTATE`. Un message
-- d'erreur Postgres porte volontiers la valeur qui l'a causée — `Key
-- (phone)=(0554…)` — et cette colonne est lisible par l'application. Y écrire
-- le message ferait sortir une donnée identifiante d'un chemin que la règle 1
-- ferme partout ailleurs. Le SQLSTATE dit la nature de la panne sans dire sur
-- qui elle est tombée : `23505` (doublon), `42501` (la cloison a refusé),
-- `P0001` (une porte métier a levé son propre message). Le message lisible par
-- l'humain vit dans `fr.ts`, pas en base.
--
-- POURQUOI ON CAPTURE AU LIEU DE LAISSER REMONTER. Sans bloc EXCEPTION, un
-- échec annulerait toute la transaction, y compris la trace de la tentative :
-- la ligne resterait `confirmed` et personne ne saurait qu'une exécution a été
-- tentée. Le bloc en fait un état `failed` daté — la trace survit à l'échec,
-- ce qui est exactement l'objet de cette table.
CREATE OR REPLACE FUNCTION app.execute_jarvis_action(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_state    app.jarvis_state;
  v_conf     timestamptz;
  v_tool     text;
  v_args     jsonb;
  v_affected uuid;
  v_table    text;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT state, confirmed_at, tool_name, tool_args
    INTO v_state, v_conf, v_tool, v_args
    FROM app.jarvis_actions
   WHERE id = p_id
     FOR UPDATE;

  IF v_state IS NULL THEN
    RETURN NULL;
  END IF;

  -- I16 est une contrainte de table, donc `state='executed'` sans
  -- `confirmed_at` est déjà impossible. Ce test-ci vérifie l'autre sens, celui
  -- qu'aucune contrainte ne couvre : qu'on n'exécute pas une ligne qui n'est
  -- pas passée par la confirmation, ou qui l'a déjà été.
  IF v_state <> 'confirmed' OR v_conf IS NULL THEN
    RAISE EXCEPTION 'Action non confirmée : rien ne s''exécute sans confirmation.';
  END IF;

  BEGIN
    CASE v_tool

      -- ⚠️ SIX ARGUMENTS, PAS CINQ, ET LE SIXIÈME EST OBLIGATOIRE À L'APPEL.
      -- 024 a DROPPÉ la signature à cinq arguments de 022 au lieu de la
      -- surcharger — précisément pour qu'un appel ne puisse pas se résoudre en
      -- silence vers la version qui ignore le type de consultation. Écrire ici
      -- l'appel à cinq arguments aurait levé `42883`, que le bloc EXCEPTION
      -- ci-dessous aurait rangé en `failed` sans que rien ne le distingue d'un
      -- refus de la RLS. Le défaut ne se serait vu qu'à l'exécution.
      WHEN 'create_appointment' THEN
        v_table := 'appointments';
        v_affected := app.create_appointment(
          (v_args ->> 'patient_id')::uuid,
          (v_args ->> 'practitioner_id')::uuid,
          (v_args ->> 'starts_at')::timestamptz,
          (v_args ->> 'duration_minutes')::integer,
          v_args ->> 'notes_admin',
          (v_args ->> 'kind')::app.consult_kind);

      WHEN 'set_consultation_price' THEN
        v_table := 'payments';
        v_affected := app.set_consultation_price(
          (v_args ->> 'consultation_id')::uuid,
          (v_args ->> 'amount_dzd')::integer);

      -- Inatteignable tant que la contrainte `jarvis_tool_allowlist` tient.
      -- Écrit quand même : le jour où un sixième outil est ajouté à la
      -- contrainte sans être ajouté ici, on veut un refus, pas un silence.
      ELSE
        RAISE EXCEPTION 'Outil inconnu : Jarvis ne dispose d''aucune action de ce nom.';
    END CASE;

    -- ⚠️ UN RETOUR NULL N'EST PAS UN SUCCÈS SILENCIEUX, et sans ce test il le
    -- deviendrait. `app.set_consultation_price` (029) rend délibérément NULL —
    -- pas une exception — quand la séance est introuvable OU masquée par la
    -- RLS : c'est sa façon de ne pas fabriquer d'oracle d'existence. Sans ce
    -- test, la ligne passerait à `executed` avec `affected_id` à NULL, et la
    -- carte de confirmation annoncerait à la praticienne un tarif posé sur une
    -- séance que la base a refusé de lui montrer. L'échec doit se voir.
    IF v_affected IS NULL THEN
      RAISE EXCEPTION 'Action sans effet : la cible est introuvable ou hors de votre périmètre.';
    END IF;

    UPDATE app.jarvis_actions
       SET state          = 'executed',
           executed_at    = now(),
           affected_table = v_table,
           affected_id    = v_affected,
           result         = jsonb_build_object('id', v_affected)
     WHERE id = p_id;

    RETURN v_affected;

  EXCEPTION WHEN others THEN
    UPDATE app.jarvis_actions
       SET state       = 'failed',
           executed_at = now(),
           error       = SQLSTATE
     WHERE id = p_id;

    RETURN NULL;
  END;
END;
$$;

COMMENT ON FUNCTION app.execute_jarvis_action(uuid) IS
  'V2, règle 5. Exécute une action CONFIRMÉE en appelant la porte métier '
  'existante, et journalise le résultat dans la même transaction. SECURITY '
  'INVOKER : l''appel imbriqué s''exécute sous `authenticated`, sinon les '
  'policies TO authenticated cesseraient de s''appliquer (voir en-tête). '
  '`error` ne porte que le SQLSTATE, jamais SQLERRM — règle 1.';

-- ---------------------------------------------------------------------------
-- 6 · DROITS — révoquer le défaut avant d'accorder
-- ---------------------------------------------------------------------------
-- Postgres accorde `EXECUTE` à `PUBLIC` sur toute fonction créée. On le retire
-- d'abord, on accorde ensuite à `authenticated` seul : `anon` n'a rien à faire
-- sur une boucle d'écriture. Ces quatre fonctions sont neuves — aucun GRANT
-- antérieur ne survit à ce REVOKE, contrairement au cas rencontré sur 032.
REVOKE ALL ON FUNCTION app.propose_jarvis_action(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION app.confirm_jarvis_action(uuid)                   FROM PUBLIC;
REVOKE ALL ON FUNCTION app.reject_jarvis_action(uuid)                    FROM PUBLIC;
REVOKE ALL ON FUNCTION app.execute_jarvis_action(uuid)                   FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.propose_jarvis_action(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION app.confirm_jarvis_action(uuid)                   TO authenticated;
GRANT EXECUTE ON FUNCTION app.reject_jarvis_action(uuid)                    TO authenticated;
GRANT EXECUTE ON FUNCTION app.execute_jarvis_action(uuid)                   TO authenticated;

INSERT INTO app.schema_migrations (version) VALUES ('033_jarvis_gates')
    ON CONFLICT DO NOTHING;

COMMIT;
