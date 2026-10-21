-- Username login uses existing private account metadata; email and identity
-- remain intact. Authorization and password checks stay in the original gate.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS auth_users_username_lower_idx
 ON auth.users (lower(raw_user_meta_data->>'username'))
 WHERE raw_user_meta_data->>'username' IS NOT NULL;

CREATE OR REPLACE FUNCTION auth.verify_login(p_login text,p_password text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
SET search_path = auth, pg_catalog AS $$
DECLARE v_login text:=lower(btrim(coalesce(p_login,''))); v_count integer; v_email text; v_id uuid; v_verified uuid;
BEGIN
 IF length(v_login) NOT BETWEEN 1 AND 320 THEN
  PERFORM pg_sleep(0.25); RETURN NULL;
 END IF;
 SELECT count(*) INTO v_count FROM auth.users u
  WHERE lower(u.email)=v_login OR lower(u.raw_user_meta_data->>'username')=v_login;
 IF v_count<>1 THEN PERFORM pg_sleep(0.25); RETURN NULL; END IF;
 SELECT u.id,u.email INTO v_id,v_email FROM auth.users u
  WHERE lower(u.email)=v_login OR lower(u.raw_user_meta_data->>'username')=v_login;
 SELECT count(*) INTO v_count FROM auth.users u WHERE lower(u.email)=lower(v_email);
 IF v_count<>1 THEN PERFORM pg_sleep(0.25); RETURN NULL; END IF;
 v_verified:=auth.verify_password(v_email,p_password);
 IF v_verified IS DISTINCT FROM v_id THEN RETURN NULL; END IF;
 RETURN v_verified;
END $$;
ALTER FUNCTION auth.verify_login(text,text) OWNER TO auth_gatekeeper;
REVOKE ALL ON FUNCTION auth.verify_login(text,text) FROM PUBLIC,anon,authenticated,service_role;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='mindcare_app') THEN
  GRANT EXECUTE ON FUNCTION auth.verify_login(text,text) TO mindcare_app;
 END IF;
END $$;
INSERT INTO app.schema_migrations(version) VALUES('158_username_login') ON CONFLICT DO NOTHING;
COMMIT;
