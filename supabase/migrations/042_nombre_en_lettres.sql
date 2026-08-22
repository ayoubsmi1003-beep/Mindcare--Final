-- 042_nombre_en_lettres — V7 Documents, préalable au rendu.
--
-- POURQUOI CETTE FONCTION EXISTE, ET POURQUOI EN BASE.
--
-- Le certificat d'arrêt de travail (`suivi_medical`) porte le nombre de jours
-- DEUX FOIS : en chiffres et en lettres — « 30 Jours (trente jours) », relevé
-- sur l'original de la praticienne (docs/DOCUMENT-TEMPLATES.md §3.2). C'est la
-- convention médico-légale d'ADR-011 : les lettres empêchent qu'un chiffre soit
-- retouché après remise.
--
-- Or `030 §2` valide `jours_lettres` comme une clé d'ENTRÉE : il vérifie
-- qu'elle est présente, scalaire et non vide — RIEN DE PLUS. Une appelante
-- pourrait donc soumettre {"jours":"30","jours_lettres":"trois"} et la base
-- n'y verrait rien : un certificat dont les chiffres et les lettres se
-- contredisent, c'est-à-dire un faux exploitable devant un employeur.
--
-- Écrire la conversion en TypeScript ne ferme pas ce trou — elle resterait du
-- côté de qui appelle. Elle doit vivre là où `issue_document` peut l'IMPOSER,
-- en écrasant la valeur reçue au moment du rendu (043 §3).
-- docs/DOCUMENT-TEMPLATES.md:68 dit déjà « calculée, pas saisie » ; cette
-- migration et la suivante rendent cette phrase vraie.
--
-- DOMAINE : 1 à 999. Un arrêt de zéro jour n'est pas un arrêt, et au-delà de
-- 999 jours ce n'est plus un arrêt mais une invalidité, qui relève d'un autre
-- document. Hors bornes → EXCEPTION, jamais une chaîne approximative.
--
-- SECURITY INVOKER, délibérément : aucune donnée patient ne la traverse, elle
-- ne lit aucune table. Lui donner DEFINER serait un privilège sans objet.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · La conversion
-- ---------------------------------------------------------------------------
-- LES QUATRE PIÈGES DU FRANÇAIS, tous présents entre 1 et 999 :
--   · « et » : 21, 31, 41, 51, 61, 71 SEULEMENT. Jamais 81, jamais 91, jamais
--     101 (« quatre-vingt-un », « quatre-vingt-onze », « cent un »).
--   · 70 et 90 n'ont pas de dizaine propre : ce sont 60+10 et 80+10, donc
--     « soixante-dix » et « quatre-vingt-dix ».
--   · « vingts » et « cents » ne prennent l'`s` QU'EN FIN DE NOMBRE :
--     « quatre-vingts » mais « quatre-vingt-un » ; « deux cents » mais
--     « deux cent un ». Et « cent quatre-vingts » porte l'`s` parce que
--     quatre-vingt termine, pas cent.
--   · « cent » n'est JAMAIS précédé de « un » : 100 se dit « cent ».
--
-- Ces règles sont vérifiées à l'application par le §2, sur des cas choisis
-- parce que chacun tombe dans un piège différent. La migration ÉCHOUE si l'un
-- d'eux est faux — une conversion fausse ne doit pas atteindre un certificat.
CREATE OR REPLACE FUNCTION app.nombre_en_lettres(p_n integer)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $fn$
DECLARE
  -- Index 1 du tableau = valeur 0, inutilisée : « zéro » n'a pas de place ici.
  v_unites text[] := ARRAY[
    '', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf',
    'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize',
    'dix-sept', 'dix-huit', 'dix-neuf'];
  v_dizaines text[] := ARRAY[
    '', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
  v_c   integer;
  v_r   integer;
  v_d   integer;
  v_u   integer;
  v_out text;
BEGIN
  IF p_n < 1 OR p_n > 999 THEN
    RAISE EXCEPTION 'Nombre hors domaine (%) : la conversion en lettres couvre 1 a 999.', p_n
      USING HINT = 'Un arret de travail se compte en jours, entre 1 et 999.';
  END IF;

  v_c := p_n / 100;
  v_r := p_n % 100;

  -- --- Les centaines --------------------------------------------------------
  IF v_c = 0 THEN
    v_out := '';
  ELSIF v_c = 1 THEN
    v_out := 'cent';                       -- jamais « un cent »
  ELSE
    v_out := v_unites[v_c + 1] || ' cent';
  END IF;

  -- « cents » prend l's seulement si RIEN ne suit, et seulement au pluriel.
  IF v_c >= 2 AND v_r = 0 THEN
    RETURN v_out || 's';
  END IF;
  IF v_r = 0 THEN
    RETURN v_out;                          -- 100 → « cent »
  END IF;
  IF v_c > 0 THEN
    v_out := v_out || ' ';
  END IF;

  -- --- Le reste, 1 à 99 -----------------------------------------------------
  IF v_r < 20 THEN
    RETURN v_out || v_unites[v_r + 1];
  END IF;

  v_d := v_r / 10;
  v_u := v_r % 10;

  IF v_d <= 6 THEN
    -- 20 à 69 : dizaine propre, « et » au 1.
    IF v_u = 0 THEN
      RETURN v_out || v_dizaines[v_d + 1];
    ELSIF v_u = 1 THEN
      RETURN v_out || v_dizaines[v_d + 1] || ' et un';
    ELSE
      RETURN v_out || v_dizaines[v_d + 1] || '-' || v_unites[v_u + 1];
    END IF;

  ELSIF v_d = 7 THEN
    -- 70 à 79 : soixante + (10 à 19). 71 garde le « et » de 61+10.
    IF v_u = 1 THEN
      RETURN v_out || 'soixante et onze';
    END IF;
    RETURN v_out || 'soixante-' || v_unites[10 + v_u + 1];

  ELSIF v_d = 8 THEN
    -- 80 à 89 : quatre-vingt(s), et AUCUN « et » au 1.
    IF v_u = 0 THEN
      RETURN v_out || 'quatre-vingts';
    END IF;
    RETURN v_out || 'quatre-vingt-' || v_unites[v_u + 1];

  ELSE
    -- 90 à 99 : quatre-vingt + (10 à 19). Pas de « et » non plus.
    RETURN v_out || 'quatre-vingt-' || v_unites[10 + v_u + 1];
  END IF;
END;
$fn$;

COMMENT ON FUNCTION app.nombre_en_lettres(integer) IS
  'V7. Convertit 1 a 999 en toutes lettres francaises. Existe parce que 030 '
  'valide jours_lettres comme simple cle d entree (presente, scalaire, non '
  'vide) : sans recalcul en base, un certificat pourrait porter « 30 jours '
  '(trois jours) ». 043 ecrase la valeur recue par celle-ci au moment du '
  'rendu. Hors domaine : EXCEPTION, jamais une approximation.';

REVOKE ALL ON FUNCTION app.nombre_en_lettres(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.nombre_en_lettres(integer) TO authenticated;
GRANT EXECUTE ON FUNCTION app.nombre_en_lettres(integer) TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 2 · Contrôle — la migration échoue plutôt que de livrer une conversion fausse
-- ---------------------------------------------------------------------------
-- Ce ne sont pas des exemples décoratifs : chaque cas est un endroit où une
-- implémentation naïve se trompe.
DO $ctl$
DECLARE
  v_cas  text[][] := ARRAY[
    ARRAY['1',   'un'],
    ARRAY['15',  'quinze'],
    ARRAY['21',  'vingt et un'],
    ARRAY['30',  'trente'],
    ARRAY['70',  'soixante-dix'],
    ARRAY['71',  'soixante et onze'],
    ARRAY['80',  'quatre-vingts'],
    ARRAY['81',  'quatre-vingt-un'],
    ARRAY['90',  'quatre-vingt-dix'],
    ARRAY['91',  'quatre-vingt-onze'],
    ARRAY['100', 'cent'],
    ARRAY['101', 'cent un'],
    ARRAY['180', 'cent quatre-vingts'],
    ARRAY['200', 'deux cents'],
    ARRAY['201', 'deux cent un'],
    ARRAY['999', 'neuf cent quatre-vingt-dix-neuf']];
  v_i    integer;
  v_obt  text;
  v_leve boolean;
BEGIN
  FOR v_i IN 1 .. array_length(v_cas, 1) LOOP
    v_obt := app.nombre_en_lettres(v_cas[v_i][1]::int);
    IF v_obt IS DISTINCT FROM v_cas[v_i][2] THEN
      RAISE EXCEPTION '042 : % rend « % », attendu « % ».',
        v_cas[v_i][1], v_obt, v_cas[v_i][2];
    END IF;
  END LOOP;

  -- Et les bornes : le refus doit être un refus, pas une chaîne vide.
  v_leve := false;
  BEGIN
    PERFORM app.nombre_en_lettres(0);
  EXCEPTION WHEN others THEN
    v_leve := true;
  END;
  IF NOT v_leve THEN
    RAISE EXCEPTION '042 : 0 aurait du etre refuse.';
  END IF;

  v_leve := false;
  BEGIN
    PERFORM app.nombre_en_lettres(1000);
  EXCEPTION WHEN others THEN
    v_leve := true;
  END;
  IF NOT v_leve THEN
    RAISE EXCEPTION '042 : 1000 aurait du etre refuse.';
  END IF;
END $ctl$;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('042_nombre_en_lettres')
  ON CONFLICT DO NOTHING;

COMMIT;
