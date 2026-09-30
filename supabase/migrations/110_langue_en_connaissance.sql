-- ═══════════════════════════════════════════════════════════════════════════
-- 110_langue_en_connaissance — D2 : admission de l'anglais au contrat canonique.
--
-- DÉCISION (D2, mission M08-Taylor, sur preuves dépôt — pas d'édition silencieuse) :
-- Architecture A — étendre le contrat canonique. Rejetée : l'option B (voie EN
-- séparée) n'a AUCUN support dépôt : aucune table EN, aucun chargeur EN, aucune
-- porte EN n'existe ; ADR-038 + migration 100 (supprimée, jamais appliquée : les
-- contraintes live sont `*_check` fr/ar/darija, vérifié) avaient déjà choisi
-- l'élargissement additif des CHECKs. Les chargeurs passent `langue` sans la
-- valider, `validerQuarantaine` est agnostique à la langue, la récupération est
-- déjà paramétrée par langue (`p_langue`, `'toutes'` par défaut).
--
-- POURQUOI UNE MIGRATION, ET PAS SEULEMENT DES CONSTANTES TS :
-- Le jeu de valeurs est FERMÉ EN BASE : CHECK `langue` sur
-- `knowledge_sources` (092:47) et `knowledge_chunks` (092:75). Insérer Taylor
-- (`langue='en'`) sans cette migration lève une violation de CHECK — l'INSERT
-- échoue, le chargeur s'arrête, et rien n'est écrit à moitié. C'est exactement
-- la classe de défaut que les CHECKs existent pour empêcher.
--
-- PORTÉE — DEUX CONTRAINTES, RIEN D'AUTRE :
-- Aucune ligne déplacée. Aucune RLS touchée. Aucune porte touchée. Aucune donnée
-- FR/AR/Darija relue ni réécrite (le prédicat élargi accepte un sur-ensemble
-- strict : toute ligne acceptée avant l'est après). `en` n'est ni traduit ni
-- normalisé ici : la langue reste verbatim (`en`), jamais convertie.
--
-- RÈGLE 9 : 092 est appliquée et n'est PAS retouchée. Noms 092 conservés
-- (`*_langue_check`) ; les noms `*_langue_vocab` de la 100 supprimée sont
-- également retirés SI présents (base ayant connu un essai), sans effet sinon.
-- Rejouable : DROP IF EXISTS + ADD (aucun état supposé).
-- Retour arrière : réappliquer les CHECK fr/ar/darija (corps 092:47, 092:75) —
-- REFUSÉ en présence de lignes `en` (le CHECK échouerait : preuve, pas silently).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1 · Le jeu fermé des langues, en base ──────────────────────────────────
ALTER TABLE app.knowledge_sources DROP CONSTRAINT IF EXISTS knowledge_sources_langue_check;
ALTER TABLE app.knowledge_sources DROP CONSTRAINT IF EXISTS knowledge_sources_langue_vocab;
ALTER TABLE app.knowledge_sources ADD CONSTRAINT knowledge_sources_langue_check
  CHECK (langue IN ('fr', 'ar', 'darija', 'en'));

ALTER TABLE app.knowledge_chunks DROP CONSTRAINT IF EXISTS knowledge_chunks_langue_check;
ALTER TABLE app.knowledge_chunks DROP CONSTRAINT IF EXISTS knowledge_chunks_langue_vocab;
ALTER TABLE app.knowledge_chunks ADD CONSTRAINT knowledge_chunks_langue_check
  CHECK (langue IN ('fr', 'ar', 'darija', 'en'));

COMMENT ON COLUMN app.knowledge_sources.langue IS
  'M08-D2 : fr | ar | darija | en. `en` = admission Taylor 2021 (canonique, verbatim, jamais traduit).';
COMMENT ON COLUMN app.knowledge_chunks.langue IS
  'M08-D2 : fr | ar | darija | en. `en` = chunks Taylor 2021 (canonique, verbatim, jamais traduit).';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('110_langue_en_connaissance')
  ON CONFLICT DO NOTHING;

COMMIT;
