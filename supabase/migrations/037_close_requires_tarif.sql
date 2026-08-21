-- 037_close_requires_tarif — LE CHEMIN D'ÉCRITURE DES FINANCES.
--
-- ADDITIF PUR. Ne crée aucune table, aucune colonne, aucun type. Remplace DEUX
-- portes existantes par `CREATE OR REPLACE`, à l'identique sauf les points
-- décrits ci-dessous.
--
-- ═══ LE DÉFAUT CORRIGÉ ════════════════════════════════════════════════════
-- `app.consultations` NE PORTE AUCUNE COLONNE DE PRIX. Une ligne de
-- `app.payments` naît par UN SEUL chemin : `app.set_consultation_price` (029),
-- appelée depuis le bloc tarif de l'écran de séance.
--
-- Or `app.close_consultation` (026) ne regarde JAMAIS `app.payments`. Rien
-- n'apparie la clôture au tarif. Une séance close avant la saisie du tarif
-- n'a donc pas de paiement — et comme TOUT l'écran Finances lit `app.payments`
-- (029 §7, 036), cette séance est invisible aux Finances DÉFINITIVEMENT, sans
-- qu'aucun écran ne signale l'omission.
--
-- C'est la cause du « certaines séances remontent, d'autres non » : ce n'est
-- pas aléatoire, c'est selon que le tarif a été saisi AVANT la clôture.
--
-- ⚠️ CE QUI N'EST PAS EN CAUSE, VÉRIFIÉ AVANT D'ÉCRIRE CETTE MIGRATION :
--   · `set_consultation_price` rend `NULL` hors périmètre — c'est VOULU
--     (ADR-003, règle 5 : « introuvable » et « hors périmètre » rendent la même
--     chose). Et `BlocTarif` traite déjà ce `null` comme un échec lisible
--     (`fr.finances.tarifSeanceIntrouvable`). Rien à corriger de ce côté ;
--     y poser une exception FABRIQUERAIT un oracle d'existence.
--   · `app.close_stale_consultations` (032) clôt des séances en lot sans
--     regarder les paiements. Elle n'a AUCUN appelant dans le dépôt et n'était
--     pas appliquée en base au moment de ce correctif. Laissée telle quelle,
--     signalée dans STATE.md — la retoucher ici casserait le garde-fou
--     `one_open_consult` qu'elle existe pour desserrer.
--
-- ═══ 🔴 AUCUN `DROP` ══════════════════════════════════════════════════════
-- Un `DROP FUNCTION` emporte le PROPRIÉTAIRE (faute de 018, rejouée en 024 et
-- 025). Ici : `CREATE OR REPLACE` uniquement. Ces deux portes sont SECURITY
-- INVOKER et n'ont jamais eu de propriétaire dédié — pas d'`ALTER FUNCTION
-- ... OWNER TO` ici, contrairement aux portes DEFINER de 029 §7 et de 036.
-- Les GRANT posés par 026 §9 et 029 survivent à un REPLACE ; ils sont malgré
-- tout reposés en fin de fichier, car un GRANT reposé est sans effet de bord
-- alors qu'un GRANT manquant est une porte morte.
--
-- ═══ POURQUOI REFUSER, ET NON INVENTER UN TARIF ═══════════════════════════
-- Règle 8 : aucune donnée fictive. Clore en écrivant d'office un tarif « par
-- défaut » fabriquerait un chiffre comptable plausible et faux. La porte
-- refuse donc, et renvoie la praticienne au bloc tarif. Une séance offerte se
-- saisit explicitement à 0 (ADR-018, `amount_dzd >= 0` de 011) : le cas
-- gratuit reste atteignable, mais il devient un GESTE, pas un oubli.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · Clore exige un tarif
-- ---------------------------------------------------------------------------
-- Identique à 026 sauf le §(2) ci-dessous. `ended_at` renseigné fait calculer
-- `duration_seconds`, colonne GÉNÉRÉE (007) : on ne l'écrit pas.
CREATE OR REPLACE FUNCTION app.close_consultation(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_statut  app.consult_status;
  v_appt    uuid;
  v_id      uuid;
  v_paiement uuid;
BEGIN
  -- (1) Périmètre. Une séance hors périmètre rend NULL, comme avant : le
  -- comportement « introuvable » et « pas à vous » reste indistinguable
  -- (ADR-003, pas d'oracle d'existence).
  SELECT c.status, c.appointment_id INTO v_statut, v_appt
    FROM app.consultations c WHERE c.id = p_id;

  IF v_statut IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_statut = 'closed' THEN
    RAISE EXCEPTION 'Cette séance est déjà close.';
  END IF;

  -- (2) LE CORRECTIF. Le tarif est une condition de clôture, pas une étape
  -- facultative qui suit. Sans ligne de paiement, la séance ne serait jamais
  -- comptée : on refuse ici plutôt que de perdre la recette en silence.
  -- La lecture est SECURITY INVOKER, donc soumise aux policies `pay_*` de 011 —
  -- la praticienne voit ses paiements, l'owner ceux du cabinet.
  SELECT p.id INTO v_paiement
    FROM app.payments p
   WHERE p.consultation_id = p_id;

  IF v_paiement IS NULL THEN
    RAISE EXCEPTION 'Cette séance n''a pas de tarif : elle ne peut pas être close.'
      USING HINT = 'Indiquez le tarif de la séance. Une séance offerte se saisit à 0.';
  END IF;

  UPDATE app.consultations c
     SET status = 'closed', ended_at = now()
   WHERE c.id = p_id
  RETURNING c.id INTO v_id;

  -- Le rendez-vous suit la séance. La condition sur le statut évite de heurter
  -- `trg_appt_transition` sur un RDV annulé entre-temps : clore une séance ne
  -- doit pas échouer pour une raison qui appartient à l'agenda.
  IF v_appt IS NOT NULL THEN
    UPDATE app.appointments a SET status = 'completed', updated_at = now()
     WHERE a.id = v_appt AND a.status NOT IN ('completed', 'cancelled');
  END IF;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.close_consultation(uuid) IS
  '037. Clôt la séance et fait suivre le rendez-vous en `completed`. EXIGE un '
  'tarif : sans ligne dans `app.payments`, la séance serait invisible aux '
  'Finances définitivement, donc la clôture est refusée (règle 8 — on ne '
  'fabrique pas un tarif par défaut ; une séance offerte se saisit à 0). '
  'Ne touche jamais à la note : forcer la signature à la clôture serait signer '
  'sous contrainte d''horaire.';

REVOKE ALL ON FUNCTION app.close_consultation(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.close_consultation(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('037_close_requires_tarif')
  ON CONFLICT DO NOTHING;

COMMIT;
