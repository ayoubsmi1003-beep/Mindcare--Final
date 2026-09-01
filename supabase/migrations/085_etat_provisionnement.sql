-- 085_etat_provisionnement — « faut-il montrer l'écran de premier lancement ? »
--
-- ═══ POURQUOI CETTE QUESTION A BESOIN D'UNE PORTE SQL ═══════════════════════
--
-- Elle doit répondre AVANT toute session (personne n'est encore connecté au
-- premier lancement), donc elle ne peut pas passer par `/api/db/rpc`
-- (`preparer()` y exige un cookie de session — voir `src/app/api/db/_commun.ts`).
-- Elle est donc appelée, comme 070/071/084, sous `mindcare_app` directement
-- (`withAuthGate()`), jamais sous `anon` ni `authenticated`.
--
-- Elle doit aussi voir SI un profil réel existe — et `app.profiles` porte sa
-- propre RLS, invisible à qui n'est pas encore authentifié. D'où
-- SECURITY DEFINER, comme `app.is_cloud_dev()` (016) qu'elle réutilise.
--
-- Ne rend RIEN d'identifiant : un booléen et le nom de l'environnement. Un
-- visiteur non authentifié ne peut apprendre ni le nom du cabinet, ni celui
-- de la praticienne, ni son adresse — seulement « faut-il configurer ? ».

BEGIN;

CREATE OR REPLACE FUNCTION app.etat_provisionnement()
RETURNS TABLE(environment text, compte_reel_existe boolean)
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = app, pg_catalog
AS $$
  SELECT
    (SELECT d.environment FROM app.deployment d WHERE d.singleton),
    EXISTS (
      SELECT 1 FROM app.profiles p
      WHERE p.id NOT IN ('00000000-0000-0000-0000-0000000000a1',
                          '00000000-0000-0000-0000-0000000000a2',
                          '00000000-0000-0000-0000-0000000000a3')
    );
$$;

COMMENT ON FUNCTION app.etat_provisionnement() IS
  'Pré-authentification : dit si l''écran de premier lancement doit '
  's''afficher. Ne révèle ni cabinet ni profil, seulement environnement + '
  'un booléen. Appelée sous mindcare_app (withAuthGate), jamais authenticated.';

REVOKE ALL ON FUNCTION app.etat_provisionnement() FROM PUBLIC, anon, authenticated, service_role;

-- ⚠️ LE GRANT VERS `mindcare_app` N'EST PAS ICI. Cette migration s'applique
-- AVANT `supabase/bootstrap/010_app_role.sql` (qui crée ce rôle) — un GRANT
-- posé ici tomberait sur un rôle inexistant. C'est exactement le piège que
-- 010 documente longuement pour 070/071/084 : le contre-geste vit dans 010,
-- dans un CINQUIÈME bloc conditionnel du même DO $$.

INSERT INTO app.schema_migrations (version) VALUES ('085_etat_provisionnement')
  ON CONFLICT DO NOTHING;

COMMIT;
