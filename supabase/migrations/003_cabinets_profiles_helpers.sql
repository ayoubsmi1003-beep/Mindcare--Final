-- 003_cabinets_profiles_helpers — §2 de 01-SCHEMA.md.
-- Les fonctions d'aide sont le CŒUR des RLS : toute policy plus bas en dépend.
-- P-4 : cloison stricte. `practitioner` ne voit que `practitioner_id = auth.uid()`.

BEGIN;

CREATE TABLE app.cabinets (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name        text NOT NULL,
    address     text,
    phone       text,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- Une seule ligne aujourd'hui. Présente dès maintenant pour ADR-003.
CREATE TABLE app.profiles (
    id               uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
    cabinet_id       uuid NOT NULL REFERENCES app.cabinets(id),
    role             app.user_role NOT NULL,
    full_name        text NOT NULL,
    title            text,
    speciality_fr    text,
    speciality_ar    text,
    order_number     text,
    phone            text,
    signature_block  jsonb,
    is_active        boolean NOT NULL DEFAULT true,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.profiles (cabinet_id, role) WHERE is_active;

-- ---------------------------------------------------------------------------
-- Fonctions d'aide
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER : elles lisent app.profiles, qui porte sa propre RLS. Sans
-- ça, chaque policy déclencherait une récursion sur profiles.
-- search_path figé : une fonction SECURITY DEFINER sans search_path explicite
-- est une escalade de privilèges classique.

CREATE OR REPLACE FUNCTION app.current_role()
RETURNS app.user_role LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog AS $$
    SELECT role FROM app.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION app.current_cabinet()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog AS $$
    SELECT cabinet_id FROM app.profiles WHERE id = auth.uid();
$$;

-- Voit-il le clinique de ce praticien ?
-- owner : tous · practitioner : les siens seulement · assistant : jamais.
CREATE OR REPLACE FUNCTION app.can_see_clinical(target_practitioner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog AS $$
    SELECT CASE app.current_role()
        WHEN 'owner'        THEN true
        WHEN 'practitioner' THEN target_practitioner = auth.uid()
        ELSE false
    END;
$$;

-- Accès administratif : identité, RDV, paiement. Jamais de clinique.
CREATE OR REPLACE FUNCTION app.can_see_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = app, pg_catalog AS $$
    SELECT app.current_role() IN ('owner','practitioner','assistant');
$$;

-- ---------------------------------------------------------------------------
-- RLS sur les tables d'identité
-- ---------------------------------------------------------------------------

ALTER TABLE app.cabinets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.cabinets FORCE  ROW LEVEL SECURITY;
CREATE POLICY cabinets_read ON app.cabinets FOR SELECT TO authenticated
    USING (id = app.current_cabinet());

ALTER TABLE app.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.profiles FORCE  ROW LEVEL SECURITY;

-- Lecture de l'annuaire du cabinet : nécessaire pour afficher un nom de
-- praticien. Ne donne accès à aucune donnée patient.
CREATE POLICY profiles_read ON app.profiles FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet());

-- Chacun modifie sa propre fiche, et rien d'autre. Aucune policy ne permet de
-- changer `role` d'un tiers : l'escalade de privilèges n'a pas de chemin
-- (`modify_permissions` est dans la liste des interdits).
CREATE POLICY profiles_self_update ON app.profiles FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());

INSERT INTO app.schema_migrations (version) VALUES ('003_cabinets_profiles_helpers')
    ON CONFLICT DO NOTHING;

COMMIT;
