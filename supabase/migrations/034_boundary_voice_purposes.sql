-- 034_boundary_voice_purposes — ouvre `audit.boundary_crossings` à la voix.
--
-- LE PROBLÈME, TROUVÉ EN ÉCRIVANT V2.4 ET PAS EN LE PLANIFIANT. 028 ferme
-- `purpose` par une allowlist : `CHECK (purpose IN ('jarvis'))`. C'est une
-- bonne contrainte, et elle a fait exactement son travail — elle a arrêté un
-- franchissement non prévu au lieu de l'accepter en silence.
--
-- Mais ADR-024 exige que les DEUX appels de voix (Groq à l'entrée, ElevenLabs
-- à la sortie) passent par `_shared/external-call.ts`, et la règle 1 de
-- CLAUDE.md veut que tout franchissement laisse une trace. Avec l'allowlist
-- telle quelle, il ne reste que trois issues : ne pas journaliser la voix
-- (règle 1 tombe), la journaliser sous `'jarvis'` (l'allowlist devient un
-- mensonge et la colonne perd son sens analytique — on ne pourrait plus
-- distinguer un appel de texte d'un envoi d'AUDIO, qui n'a pas du tout le même
-- profil de risque), ou étendre l'allowlist. C'est la troisième.
--
-- ⚠️ CE FICHIER MODIFIE UNE CONTRAINTE POSÉE PAR UNE MIGRATION APPLIQUÉE, il
-- ne modifie PAS cette migration (règle 9). 028 reste intacte, octet pour
-- octet ; l'histoire du schéma se lit dans l'ordre des fichiers.
--
-- DEUX VALEURS, PAS UNE. `voix-entree` et `voix-sortie` sont séparées parce que
-- les deux sens ne portent pas le même risque et ne se relisent pas ensemble :
-- à l'entrée sort de l'AUDIO non pseudonymisable — la passerelle d'ADR-002
-- traite le texte PRODUIT par la transcription, elle arrive une étape trop
-- tard ; à la sortie sort du TEXTE déjà composé, qui peut nommer une patiente.
-- Une seule valeur `voix` rendrait impossible de compter combien de fois de
-- l'audio a quitté la machine, qui est précisément le chiffre qu'on voudra le
-- jour de la bascule `VOICE_PROVIDER=local` (D-21, dette datée de
-- DOC-AUTHORITY §4).

BEGIN;

ALTER TABLE audit.boundary_crossings
  DROP CONSTRAINT IF EXISTS boundary_crossings_purpose_check;

ALTER TABLE audit.boundary_crossings
  ADD CONSTRAINT boundary_crossings_purpose_check
  CHECK (purpose IN ('jarvis', 'voix-entree', 'voix-sortie'));

COMMENT ON CONSTRAINT boundary_crossings_purpose_check ON audit.boundary_crossings IS
  'ADR-024. Allowlist FERMÉE, jamais un text libre : un purpose non prévu doit '
  'faire échouer l''écriture, pas s''y glisser. `voix-entree` = audio sortant '
  'vers la transcription, non pseudonymisable. `voix-sortie` = texte sortant '
  'vers la synthèse. Les deux disparaissent le jour de VOICE_PROVIDER=local.';

INSERT INTO app.schema_migrations (version) VALUES ('034_boundary_voice_purposes')
    ON CONFLICT DO NOTHING;

COMMIT;
