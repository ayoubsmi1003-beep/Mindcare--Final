-- 049 · `app.update_patient` accepte la charge SÉRIALISÉE d'ADR-020
--
-- ═══ CE QUI SE PASSAIT À L'ÉCRAN ═══════════════════════════════════════════
-- Modifier une fiche patient échouait TOUJOURS, quel que soit le champ, sur
-- « Charge de modification invalide : un objet JSON est attendu. » (P0001).
-- Le formulaire de modification est le premier appelant réel de cette porte :
-- écrite en 018 puis reprise en 020, elle n'avait jamais été exercée depuis le
-- client — le défaut a donc vécu deux migrations sans se voir.
--
-- ═══ LA CAUSE, ET ELLE EST DE CONVENTION, PAS DE SÉCURITÉ ══════════════════
-- `RpcArgs` (ADR-020) n'accepte que des SCALAIRES : un objet JavaScript ne
-- traverse pas le port, il part sérialisé. Toutes les portes écrites APRÈS
-- cette décision reçoivent donc du `text` et font le cast elles-mêmes —
-- `update_appointment` (022), `save_note` (026), `issue_document` (030/043),
-- `log_jarvis_call` (033). `update_patient` est la SEULE restée en `jsonb` :
-- elle précède la convention.
--
-- PostgREST ne devine pas : une chaîne JSON envoyée vers un paramètre `jsonb`
-- arrive comme une VALEUR JSON de type chaîne, pas comme un objet. D'où
-- `jsonb_typeof(p_changes) = 'string'`, et le refus — qui était JUSTE.
--
-- ═══ POURQUOI `CREATE OR REPLACE`, ET SURTOUT PAS UN CHANGEMENT DE TYPE ════
-- Passer `p_changes` en `text` alignerait la porte sur ses cinq consœurs. Ce
-- serait une NOUVELLE signature, donc un `DROP` de l'ancienne — et un `DROP`
-- suivi d'un `CREATE` réattribue le propriétaire à l'exécutant du script, ce
-- qui rouvrirait la cloison ADR-019 sur une migration parfaitement verte
-- (défaut de 018, déjà payé une fois). La signature ne bouge donc PAS :
-- `CREATE OR REPLACE` conserve le propriétaire `app_gatekeeper`, les GRANT et
-- le `SECURITY DEFINER`.
--
-- La porte accepte désormais les DEUX formes — un objet jsonb, ou l'objet
-- sérialisé que le port sait envoyer. Rien d'autre ne change : l'allowlist,
-- le refus des clés inconnues, l'héritage de `trg_audit` (013) et l'absence de
-- toute décision de rôle sont repris à l'identique de 020.

BEGIN;

CREATE OR REPLACE FUNCTION app.update_patient(p_id uuid, p_changes jsonb)
RETURNS SETOF app.patients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  k text;
  v_changes jsonb := p_changes;
  allowed constant text[] := ARRAY[
    'first_name','last_name','birth_date','sex','phone','phone_alt',
    'address','id_document_number','id_document_issuer',
    'emergency_contact','notes_admin','is_active'];
BEGIN
  -- LE CORRECTIF, ET IL TIENT EN CINQ LIGNES. Une charge arrivée sous forme de
  -- chaîne JSON est DÉSÉRIALISÉE UNE FOIS, puis retombe dans le contrôle
  -- d'origine ci-dessous — une chaîne qui ne contient pas un objet reste
  -- refusée exactement comme avant. On ne déballe pas en boucle : une chaîne
  -- doublement encodée est une erreur d'appelant, pas un cas à rattraper.
  IF jsonb_typeof(v_changes) = 'string' THEN
    BEGIN
      v_changes := (v_changes #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'Charge de modification invalide : un objet JSON est attendu.'
        USING HINT = 'p_changes accepte un objet jsonb ou ce même objet sérialisé (ADR-020).';
    END;
  END IF;

  IF v_changes IS NULL OR jsonb_typeof(v_changes) <> 'object' THEN
    RAISE EXCEPTION 'Charge de modification invalide : un objet JSON est attendu.'
      USING HINT = 'p_changes accepte un objet jsonb ou ce même objet sérialisé (ADR-020).';
  END IF;

  -- On refuse la clé inconnue au lieu de l'ignorer. Ignorer silencieusement
  -- ferait croire à l'appelant que sa modification a été prise en compte.
  FOREACH k IN ARRAY ARRAY(SELECT jsonb_object_keys(v_changes)) LOOP
    IF NOT (k = ANY (allowed)) THEN
      RAISE EXCEPTION 'Champ non modifiable par cette porte : %.', k
        USING HINT = 'cabinet_id, practitioner_id et record_number sont exclus par conception.';
    END IF;
  END LOOP;

  -- Le déclencheur `trg_audit` de 013 journalise la modification : l'audit des
  -- écritures n'est pas réimplémenté ici, il est hérité.
  RETURN QUERY
  UPDATE app.patients p SET
    first_name         = coalesce(v_changes->>'first_name', p.first_name),
    last_name          = coalesce(v_changes->>'last_name',  p.last_name),
    birth_date         = CASE WHEN v_changes ? 'birth_date'
                         THEN (v_changes->>'birth_date')::date ELSE p.birth_date END,
    sex                = CASE WHEN v_changes ? 'sex'
                         THEN (v_changes->>'sex')::app.sex ELSE p.sex END,
    phone              = coalesce(v_changes->>'phone', p.phone),
    phone_alt          = CASE WHEN v_changes ? 'phone_alt'
                         THEN v_changes->>'phone_alt' ELSE p.phone_alt END,
    address            = CASE WHEN v_changes ? 'address'
                         THEN v_changes->>'address' ELSE p.address END,
    id_document_number = CASE WHEN v_changes ? 'id_document_number'
                         THEN v_changes->>'id_document_number' ELSE p.id_document_number END,
    id_document_issuer = CASE WHEN v_changes ? 'id_document_issuer'
                         THEN v_changes->>'id_document_issuer' ELSE p.id_document_issuer END,
    emergency_contact  = CASE WHEN v_changes ? 'emergency_contact'
                         THEN v_changes->'emergency_contact' ELSE p.emergency_contact END,
    notes_admin        = CASE WHEN v_changes ? 'notes_admin'
                         THEN v_changes->>'notes_admin' ELSE p.notes_admin END,
    is_active          = coalesce((v_changes->>'is_active')::boolean, p.is_active),
    updated_at         = now()
  WHERE p.id = p_id
  RETURNING p.*;
END;
$$;

COMMENT ON FUNCTION app.update_patient(uuid, jsonb) IS
  'ADR-019. Seule porte d''écriture sur une fiche patient. Allowlist stricte : '
  'cabinet_id, practitioner_id et record_number sont exclus, pour qu''une mise à '
  'jour de routine ne puisse pas déplacer un dossier à travers la cloison. '
  '049 : accepte aussi la charge SÉRIALISÉE — `RpcArgs` (ADR-020) n''envoie que '
  'des scalaires, comme pour update_appointment, save_note et issue_document.';

COMMIT;
