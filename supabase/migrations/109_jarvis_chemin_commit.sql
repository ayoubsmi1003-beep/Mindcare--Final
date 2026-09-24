-- ═══════════════════════════════════════════════════════════════════════════
-- 109_jarvis_chemin_commit — le troisième chemin change de nom, pas de nature.
-- Amendement d'ADR-023 du 2026-09-24 (docs/00-DECISIONS.md ; constitution
-- `docs/domains/alexa-constitution.md`).
--
-- POURQUOI : la porte déterministe de routage ne refuse plus une QUESTION —
-- « Karim est-il dépressif ? » est désormais une demande de raisonnement,
-- servie par le chemin `patient`. Ce qu'elle refuse, c'est un ACTE D'AUTORITÉ
-- NON CONFIRMÉ (« émets l'ordonnance », « signe le certificat », « note au
-- dossier que… », « fais-le sans me demander »). Le troisième chemin s'appelait
-- `refus` ; il s'appelle `commit`.
--
-- ⚠️ POURQUOI UNE MIGRATION, ET PAS SEULEMENT UNE CONSTANTE TS.
-- Le jeu de valeurs est FERMÉ EN BASE : CHECK `jarvis_messages.chemin` (058:77)
-- et contrôle de la porte `complete_jarvis_turn` (058:234). Écrire `commit`
-- sans cette migration ferait lever « Chemin de routage inconnu. » — l'INSERT
-- du tour échouerait, la praticienne verrait un tour non persité, et l'écran
-- mentirait par omission. C'est exactement la classe de défaut que 058 existe
-- pour empêcher.
--
-- ⚠️ `refus` RESTE ACCEPTÉ, ET CE N'EST PAS DE LA COMPLAISANCE : c'est
-- l'HISTOIRE. Les tours enregistrés avant l'amendement portent `refus` ; les
-- réécrire serait une réécriture d'historique (règle 3, ADR-004). Le jeu de
-- valeurs devient donc {connaissance, patient, commit, refus} : `refus` n'est
-- plus PRODUIT par le serveur, il reste LISIBLE — et le client comme les
-- schémas de lecture (observabilite-lecture.ts) l'acceptent pour cette raison.
--
-- ⚠️ AUCUNE LIGNE DÉPLACÉE. Deux objets touchés : la contrainte, la porte.
-- Aucun UPDATE, aucun DELETE sur app.jarvis_messages.
--
-- RÈGLE 9 : 058 est appliquée et n'est PAS retouchée. Corps de la porte recopié
-- de 058:217, une seule valeur ajoutée au contrôle.
-- Retour arrière : réappliquer la contrainte et la porte de 058 (corps dans
-- 058:77 et 058:217) ; aucune donnée à restaurer, aucune colonne supprimée.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 · Le jeu fermé des chemins, en base ────────────────────────────────
-- Le nom vient de la contrainte inline de 058 (`<table>_<colonne>_check`) ;
-- `IF EXISTS` rend la migration rejouable sans dépendre de ce nom.
ALTER TABLE app.jarvis_messages DROP CONSTRAINT IF EXISTS jarvis_messages_chemin_check;
ALTER TABLE app.jarvis_messages ADD CONSTRAINT jarvis_messages_chemin_check
  CHECK (chemin IS NULL OR chemin IN ('connaissance','patient','commit','refus'));

COMMENT ON COLUMN app.jarvis_messages.chemin IS
  'Chemin de routage (ADR-023, amendée le 2026-09-24) : connaissance | patient | '
  'commit. `refus` est historique (tours écrits avant l''amendement) — il n''est '
  'plus produit, il reste lisible.';

-- ── 2 · La porte — une seule valeur ajoutée au contrôle ──────────────────
CREATE OR REPLACE FUNCTION app.complete_jarvis_turn(
    p_conversation_id uuid,
    p_client_turn_id  uuid,
    p_chemin          text,
    p_contenu         text,
    p_registre        text DEFAULT NULL,
    p_statut          text DEFAULT 'complet',
    p_outil           jsonb DEFAULT NULL)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_conv uuid;
  v_row  uuid;
BEGIN
  -- ⚠️ `commit` AJOUTÉ, `refus` CONSERVÉ POUR LA LECTURE DE L'HISTORIQUE.
  -- Retirer `refus` d'ici ferait échouer le rejeu d'un tour ancien ; l'accepter
  -- en écriture ne rouvre rien : le serveur ne l'émet plus (routing.ts).
  IF p_chemin NOT IN ('connaissance','patient','commit','refus') THEN
    RAISE EXCEPTION 'Chemin de routage inconnu.';
  END IF;
  IF p_statut NOT IN ('complet','interrompu') THEN
    RAISE EXCEPTION 'Statut de tour inconnu.';
  END IF;
  IF p_contenu IS NULL OR btrim(p_contenu) = '' THEN
    RAISE EXCEPTION 'Réponse vide.';
  END IF;
  IF p_outil IS NOT NULL AND jsonb_typeof(p_outil) <> 'object' THEN
    RAISE EXCEPTION 'Proposition d''outil invalide.';
  END IF;

  SELECT c.id INTO v_conv
    FROM app.jarvis_conversations c
   WHERE c.id = p_conversation_id
     AND c.utilisateur_id = auth.uid();
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO app.jarvis_messages
      (conversation_id, client_turn_id, role, chemin, registre,
       contenu, outil, statut)
  VALUES
      (p_conversation_id, p_client_turn_id, 'jarvis', p_chemin,
       nullif(btrim(coalesce(p_registre, '')), ''),
       left(btrim(p_contenu), 12000), p_outil, p_statut)
  ON CONFLICT (client_turn_id, role) DO NOTHING
  RETURNING id INTO v_row;

  IF v_row IS NULL THEN
    RETURN false;
  END IF;

  UPDATE app.jarvis_conversations SET last_message_at = now()
   WHERE id = p_conversation_id;
  RETURN true;
END;
$$;

-- CREATE OR REPLACE préserve propriétaire et privilèges ; les deux lignes
-- suivantes sont réémises pour qu'une réapplication reste auto-suffisante.
ALTER FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) OWNER TO app_gatekeeper;
REVOKE ALL ON FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) TO authenticated;

COMMENT ON FUNCTION app.complete_jarvis_turn(uuid,uuid,text,text,text,text,jsonb) IS
  'V-JARVIS-CORE. Réponse canonique Jarvis, écrite par la passerelle avant '
  'l''événement fin. Idempotent sur (client_turn_id,''jarvis''). '
  '109 : chemins = connaissance | patient | commit (+ refus, historique en lecture).';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('109_jarvis_chemin_commit')
  ON CONFLICT DO NOTHING;

COMMIT;
