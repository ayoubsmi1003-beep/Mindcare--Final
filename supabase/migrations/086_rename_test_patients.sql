-- 086_rename_test_patients — humanise les noms de test tout en gardant le marqueur (test)
--
-- Contexte : 015_seed_data semait volontairement des noms manifestement fictifs
-- (« Patient DE TEST UN/DEUX », commentaire ligne 89) pour qu'aucune confusion
-- avec un patient réel ne soit possible à l'écran. La praticienne souhaite
-- désormais que les fixtures affichent des noms algériens réalistes.
--
-- Décision (plan approuvé 2026-09-05) : remplacer les deux noms par des identités
-- algériennes plausibles tout en conservant un suffixe visible « (test) » —
-- garde humaine lisible, doublée par la garde base `is_synthetic = true` posée
-- par 016. Respecte la règle 8 (données synthétiques marquées) et la règle 9
-- (015 déjà appliquée n'est pas éditée — cette migration porte la modification).
--
-- Idempotente : rejouable sans effet si les noms sont déjà posés.

BEGIN;

-- 00000000-0000-0000-0000-0000000000b1 — owner (TEST-0001) → Smail KARIM (test)
UPDATE app.patients
   SET first_name = 'Smail',
       last_name  = 'KARIM (test)',
       updated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000000b1'
   AND is_synthetic IS TRUE
   AND (first_name IS DISTINCT FROM 'Smail' OR last_name IS DISTINCT FROM 'KARIM (test)');

-- 00000000-0000-0000-0000-0000000000b2 — praticienne …a2 (TEST-0002) → Ayoub SALMI (test)
UPDATE app.patients
   SET first_name = 'Ayoub',
       last_name  = 'SALMI (test)',
       updated_at = now()
 WHERE id = '00000000-0000-0000-0000-0000000000b2'
   AND is_synthetic IS TRUE
   AND (first_name IS DISTINCT FROM 'Ayoub' OR last_name IS DISTINCT FROM 'SALMI (test)');

INSERT INTO app.schema_migrations (version) VALUES ('086_rename_test_patients')
  ON CONFLICT DO NOTHING;

COMMIT;
