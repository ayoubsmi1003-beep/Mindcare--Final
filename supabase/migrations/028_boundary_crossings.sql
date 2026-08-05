-- 028_boundary_crossings — S6. Journal des franchissements de la passerelle LLM.
--
-- CE QUE CE FICHIER TRACE. Chaque appel sortant vers OpenRouter depuis
-- `supabase/functions/_shared/external-call.ts` — succès ou échec — pour que
-- Loi 18-07 (registre des traitements et des transferts) trouve une trace,
-- documentée en 02-SECURITY-BOUNDARY.md §3.6.
--
-- ZÉRO COLONNE PATIENT, PAR CONSTRUCTION. `session_token` est un uuid
-- ALÉATOIRE généré par l'appelant à chaque appel, jamais `patient_id`. Un
-- journal qui contiendrait l'identifiant qu'il est censé protéger serait
-- lui-même une fuite — exactement l'avertissement de §3.6 de la passerelle.
-- Aucun contenu (entrée ni sortie du modèle) n'est stocké ici non plus :
-- uniquement des compteurs et un horodatage.
--
-- SCHÉMA `audit`, NON EXPOSÉ POSTGREST. Cohérent avec `audit.log` (013) : ce
-- schéma n'apparaît jamais dans les schémas exposés du projet, donc PostgREST
-- ne peut pas le servir même si quelqu'un l'y autorisait par erreur — la
-- fermeture d'ADR-019 vaut pour ce journal aussi.
--
-- ÉCRITURE, PAS LECTURE. Cette migration ne pose AUCUNE porte de lecture :
-- rien dans ce lot ne lit `audit.boundary_crossings` depuis l'application.
-- Seul `external-call.ts`, via un client `service_role` qui lui est propre,
-- y insère — jamais côté Next.js, jamais un autre fichier de la passerelle.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · La table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit.boundary_crossings (
  id                 bigserial PRIMARY KEY,
  occurred_at        timestamptz NOT NULL DEFAULT now(),
  purpose            text NOT NULL,
  provider           text NOT NULL,
  model              text,
  prompt_version     text NOT NULL,
  prompt_hash        text NOT NULL,
  session_token      uuid NOT NULL,
  chars_out          integer,
  tokens_in          integer,
  tokens_out         integer,
  estimated_cost_usd numeric(10, 6),
  outcome            text NOT NULL,
  latency_ms         integer,

  -- ALLOWLIST FERMÉE, PAS UN `text` LIBRE. Un `purpose`/`outcome` en texte libre
  -- finirait, un jour de débogage pressé, par porter une phrase qui identifie
  -- — exactement l'erreur qu'audit.log_read (017) a refusée pour `p_context`.
  CONSTRAINT boundary_crossings_purpose_check
    CHECK (purpose IN ('jarvis')),
  CONSTRAINT boundary_crossings_outcome_check
    CHECK (outcome IN ('ok', 'blocked', 'error', 'timeout'))
);

COMMENT ON TABLE audit.boundary_crossings IS
  'S6, 02-SECURITY-BOUNDARY.md §3.6. Un franchissement de la passerelle LLM = '
  'une ligne. ZÉRO colonne patient : session_token est un uuid aléatoire par '
  'appel, jamais patient_id. Aucun contenu stocké, seulement des compteurs.';

COMMENT ON COLUMN audit.boundary_crossings.session_token IS
  'uuid aléatoire généré par external-call.ts à CHAQUE appel. Ne corrèle pas '
  'deux appels entre eux et ne désigne jamais un patient ou une consultation.';

COMMENT ON COLUMN audit.boundary_crossings.estimated_cost_usd IS
  'Calculé depuis une table de tarifs constante indexée par modèle, dans '
  'external-call.ts. NULL si le modèle n''y figure pas — jamais une '
  'estimation inventée.';

CREATE INDEX ON audit.boundary_crossings (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 2 · Verrouillage — même logique que audit.log (013)
-- ---------------------------------------------------------------------------
-- RLS activée ET forcée : même sans policy permissive, un rôle qui contourne
-- la RLS par défaut (le propriétaire de la table) resterait sinon en dehors du
-- périmètre qu'on vient de fermer.
ALTER TABLE audit.boundary_crossings ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.boundary_crossings FORCE ROW LEVEL SECURITY;

-- Aucune policy n'est posée : `authenticated` n'a besoin d'AUCUN accès à ce
-- journal, ni en lecture ni en écriture. Seul `service_role`, qui contourne la
-- RLS par conception et qui vit exclusivement dans `external-call.ts`, y
-- insère. Une table sans policy et sans GRANT à `authenticated` est
-- INACCESSIBLE à l'application — c'est l'état voulu, pas un oubli.
REVOKE ALL ON audit.boundary_crossings FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE audit.boundary_crossings_id_seq FROM PUBLIC, anon, authenticated;

INSERT INTO app.schema_migrations (version) VALUES ('028_boundary_crossings')
  ON CONFLICT DO NOTHING;

COMMIT;
