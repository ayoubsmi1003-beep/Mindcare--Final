-- 084_provision_owner_account — la porte du premier lancement, §D et §M
-- (étape 8) du plan `mindcare-os-robust-wigderson.md`.
--
-- ═══ CE QU'ELLE FAIT, EN UNE TRANSACTION ═══════════════════════════════════
--
--   1. renomme le cabinet SINGLETON en place (même id — voir 083, qui explique
--      pourquoi il n'est jamais recréé : `app.document_templates` y est
--      rattaché par une clé étrangère NOT NULL, et porte le VRAI contenu des
--      modèles de la praticienne) ;
--   2. crée le compte réel — `auth.users` + `app.profiles` (role 'owner') —
--      avec un mot de passe haché en bcrypt, exactement comme
--      `auth.verify_password()` (070) l'exige pour authentifier.
--
-- Elle NE PURGE PAS les fixtures de 015/038 : c'est `app.purge_fixtures_015()`
-- (083) qui le fait, appelée séparément juste après par l'appelant. Deux
-- fonctions, une responsabilité chacune — même esprit que 016 vis-à-vis de
-- ce qui la précède.
--
-- ═══ POURQUOI ELLE EST APPELABLE AVANT TOUTE CONNEXION ═════════════════════
--
-- Au premier lancement, AUCUN compte réel n'existe encore : cette porte ne
-- peut donc pas être protégée par `authenticated`. Elle suit le même patron
-- que les portes de 070 — appelée sous `mindcare_app` directement (aucun rôle
-- endossé, `withAuthGate()` côté application), jamais sous `anon` ni
-- `authenticated`. Le bootstrap `010_app_role.sql` lui accorde `EXECUTE`,
-- exactement comme il le fait déjà pour `auth.verify_password`.
--
-- ═══ POURQUOI ELLE NE PEUT S'EXÉCUTER QU'UNE FOIS ══════════════════════════
--
-- Elle refuse si un profil RÉEL (c'est-à-dire hors des trois identifiants
-- fixes de 015) existe déjà — la seule façon de la rejouer serait de
-- réinstaller sur une base neuve. Sans cette garde, un second appel créerait
-- un second compte « owner » sans qu'aucune interface ne l'empêche.

BEGIN;

CREATE OR REPLACE FUNCTION app.provision_owner_account(
  p_cabinet_name    text,
  p_cabinet_address text,
  p_cabinet_phone   text,
  p_full_name       text,
  p_title           text,
  p_order_number    text,
  p_phone           text,
  p_email           text,
  p_password        text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, auth, pg_catalog
AS $$
DECLARE
  env        text;
  v_cabinet  uuid;
  v_user     uuid;
  n_cabinets integer;
  n_profils_reels integer;
BEGIN
  SELECT environment INTO env FROM app.deployment WHERE singleton;
  IF env IS DISTINCT FROM 'self-hosted' THEN
    RAISE EXCEPTION
      'app.provision_owner_account() refuse hors installation cabinet (self-hosted). '
      'Environnement actuel : %.', COALESCE(env, 'NULL (jamais basculé)');
  END IF;

  SELECT count(*) INTO n_profils_reels FROM app.profiles
    WHERE id NOT IN ('00000000-0000-0000-0000-0000000000a1',
                      '00000000-0000-0000-0000-0000000000a2',
                      '00000000-0000-0000-0000-0000000000a3');
  IF n_profils_reels > 0 THEN
    RAISE EXCEPTION
      'Un compte réel existe déjà — le premier lancement ne peut avoir lieu qu''une fois.';
  END IF;

  IF p_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    RAISE EXCEPTION 'Adresse courriel invalide.';
  END IF;
  -- Même borne que auth.verify_password (070) : bcrypt ignore silencieusement
  -- tout au-delà de 72 octets, un mot de passe plus long serait tronqué sans
  -- avertissement à la vérification suivante.
  IF octet_length(p_password) < 10 OR octet_length(p_password) > 72 THEN
    RAISE EXCEPTION 'Le mot de passe doit compter entre 10 et 72 caractères.';
  END IF;
  IF btrim(coalesce(p_full_name, '')) = '' THEN
    RAISE EXCEPTION 'Le nom de la praticienne est obligatoire.';
  END IF;
  IF btrim(coalesce(p_cabinet_name, '')) = '' THEN
    RAISE EXCEPTION 'Le nom du cabinet est obligatoire.';
  END IF;

  SELECT count(*) INTO n_cabinets FROM app.cabinets;
  IF n_cabinets <> 1 THEN
    RAISE EXCEPTION
      'État inattendu : % cabinet(s) au lieu de 1. Provisionnement refusé.', n_cabinets;
  END IF;
  SELECT id INTO v_cabinet FROM app.cabinets;

  UPDATE app.cabinets
     SET name = btrim(p_cabinet_name), address = p_cabinet_address, phone = p_cabinet_phone
   WHERE id = v_cabinet;

  -- `public.crypt`/`public.gen_salt`, qualifiés — même choix que
  -- `auth.verify_password` (070) : pgcrypto atterrit dans `public` sur une
  -- base nue (000 §5), hors du search_path de cette fonction.
  INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
                          created_at, updated_at)
  VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated', lower(btrim(p_email)),
          public.crypt(p_password, public.gen_salt('bf')), now(), now())
  RETURNING id INTO v_user;

  INSERT INTO app.profiles (id, cabinet_id, role, full_name, title, order_number, phone)
  VALUES (v_user, v_cabinet, 'owner', btrim(p_full_name), p_title, p_order_number, p_phone);

  RETURN v_user;
END;
$$;

COMMENT ON FUNCTION app.provision_owner_account(text, text, text, text, text, text, text, text, text) IS
  'Premier lancement (§D du plan Bureau Windows) : renomme le cabinet unique '
  'en place et crée le compte owner réel. Refuse hors self-hosted, et refuse '
  'un second appel une fois un compte réel créé. Appelée sous mindcare_app '
  '(withAuthGate), avant toute session — jamais par un rôle authentifié.';

REVOKE ALL ON FUNCTION app.provision_owner_account(text, text, text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO app.schema_migrations (version) VALUES ('084_provision_owner_account')
  ON CONFLICT DO NOTHING;

COMMIT;
