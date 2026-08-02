-- 013_audit_schema_and_triggers — §12 de 01-SCHEMA.md (R6, I4).
-- Non rétro-installable : un audit posé plus tard ne sait rien du passé. C'est
-- pour ça qu'il est là dès J1.
--
-- ⚠️ CE QUE CET AUDIT NE FAIT PAS : les LECTURES. I4 les exige, mais aucun
-- trigger Postgres ne voit un SELECT. C'est Q-B, requalifiée en dette datée :
-- traitée en S2 dans `src/services/*` (I3), après évaluation de `pgaudit`.
-- Ne pas laisser croire que `audit.log` couvre déjà la lecture.

BEGIN;

CREATE TABLE audit.log (
    id              bigserial PRIMARY KEY,
    occurred_at     timestamptz NOT NULL DEFAULT now(),
    actor_id        uuid,
    actor_role      app.user_role,
    operation       app.audit_op NOT NULL,
    table_name      text NOT NULL,
    row_id          uuid,
    patient_id      uuid,
    changed_fields  text[],
    old_values      jsonb,
    new_values      jsonb,
    client_ip       inet
);
CREATE INDEX ON audit.log (patient_id, occurred_at DESC);
CREATE INDEX ON audit.log (actor_id, occurred_at DESC);
CREATE INDEX ON audit.log (occurred_at DESC);

CREATE OR REPLACE FUNCTION audit.track()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = app, audit, pg_catalog AS $$
DECLARE changed text[];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(o.key) INTO changed
        FROM jsonb_each(to_jsonb(OLD)) o
        WHERE o.value IS DISTINCT FROM (to_jsonb(NEW) -> o.key);
    END IF;

    INSERT INTO audit.log (actor_id, actor_role, operation, table_name, row_id,
                           patient_id, changed_fields, old_values, new_values)
    VALUES (
        auth.uid(), app.current_role(), lower(TG_OP)::app.audit_op,
        TG_TABLE_NAME,
        COALESCE((to_jsonb(NEW)->>'id')::uuid, (to_jsonb(OLD)->>'id')::uuid),
        COALESCE((to_jsonb(NEW)->>'patient_id')::uuid, (to_jsonb(OLD)->>'patient_id')::uuid),
        changed,
        CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) END,
        CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) END
    );
    RETURN COALESCE(NEW, OLD);
END $$;

-- Attachement par liste EXPLICITE : ce sont les tables nommées au §12. Une
-- table clinique ajoutée plus tard devra être ajoutée ici — c'est justement ce
-- que le test T9 du checkpoint vérifie, pour que l'oubli soit visible.
DO $$
DECLARE t text;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'patients','clinical_notes','clinical_note_amendments','consultations',
        'prescriptions','documents','payments','appointments','diagnoses'
    ] LOOP
        EXECUTE format(
            'CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.%I '
            'FOR EACH ROW EXECUTE FUNCTION audit.track()', t);
    END LOOP;
END $$;

-- Le journal est en AJOUT SEUL pour tout le monde.
ALTER TABLE audit.log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit.log FORCE  ROW LEVEL SECURITY;

-- Seul l'owner relit l'audit. Personne ne le réécrit : aucune policy UPDATE ni
-- DELETE n'existe, et les privilèges sont révoqués en plus de la RLS.
CREATE POLICY audit_read_owner ON audit.log FOR SELECT TO authenticated
    USING (app.current_role() = 'owner');

-- ⚠️ FILET, et ce n'est pas un relâchement. `FORCE ROW LEVEL SECURITY`
-- s'applique AUSSI au propriétaire de la table. Si le rôle qui exécute
-- `audit.track()` (SECURITY DEFINER → le propriétaire de la fonction) n'a pas
-- BYPASSRLS, l'insertion dans le journal échoue — et avec elle TOUTE écriture
-- sur les tables auditées. Le rôle `postgres` de Supabase a BYPASSRLS
-- aujourd'hui, donc cette policy n'est pas strictement nécessaire ; elle rend
-- le mécanisme indépendant de cette hypothèse, que rien ici ne contrôle.
-- Le journal reste inviolable : aucune policy UPDATE ni DELETE n'existe, et les
-- privilèges correspondants sont révoqués.
CREATE POLICY audit_append ON audit.log FOR INSERT TO PUBLIC WITH CHECK (true);

REVOKE UPDATE, DELETE ON audit.log FROM PUBLIC, anon, authenticated, service_role;

INSERT INTO app.schema_migrations (version) VALUES ('013_audit_schema_and_triggers')
    ON CONFLICT DO NOTHING;

COMMIT;
