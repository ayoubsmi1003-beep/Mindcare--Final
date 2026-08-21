-- 038_charges — LES CHARGES DU CABINET. Ce qui manquait pour un résultat net.
--
-- ADDITIF PUR. Nouvelle table, trois nouveaux types, trois portes d'écriture.
-- Ne touche à aucune table, aucune policy et aucune porte existante.
--
-- ═══ POURQUOI CETTE TABLE ═════════════════════════════════════════════════
-- `app.payments` était la SEULE table financière du dépôt. Sans charges,
-- « résultat net » — le chiffre que la médecin regarde en premier — n'est pas
-- calculable. Il n'était donc pas affiché ; l'afficher aurait été le mentir.
--
-- ═══ MONTANTS : `integer montant_dzd`, PAS `numeric(12,2)` ════════════════
-- CLAUDE.md §4 et ADR-018 : dinars ENTIERS, aucun centime, aucun flottant —
-- la même règle que `payments.amount_dzd`. Deux représentations d'argent dans
-- une même base finissent par se soustraire l'une à l'autre.
-- Contrainte `> 0` : une charge nulle n'est pas une charge. (Un tarif de séance
-- accepte 0 — une séance offerte existe ; une charge de 0 DZD n'existe pas.)
--
-- ═══ `cabinet_id` ET `is_synthetic` EN PLUS DU STRICT NÉCESSAIRE ══════════
-- `cabinet_id` : toutes les policies du dépôt s'ancrent sur
-- `app.current_cabinet()`. Une table qui ne cloisonnerait que par praticienne
-- serait la seule à ne pas cloisonner par cabinet — la faille du jour où un
-- second cabinet existe.
-- `is_synthetic` : le garde de 016 exige la colonne en cloud-dev. Écrite ici
-- explicitement, DÉRIVÉE de `app.is_cloud_dev()` et jamais choisie par
-- l'appelant (leçon de 023).

BEGIN;

GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Les types
-- ---------------------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE app.charge_categorie AS ENUM ('local','personnel','outils','assurance','autre');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.charge_type AS ENUM ('recurrente','ponctuelle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE app.charge_frequence AS ENUM ('mensuelle','trimestrielle','annuelle');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------------
-- 2 · La table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app.charges (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cabinet_id               uuid NOT NULL REFERENCES app.cabinets(id),
  practitioner_id          uuid NOT NULL REFERENCES app.profiles(id),
  intitule                 text NOT NULL CHECK (length(btrim(intitule)) > 0),
  montant_dzd              integer NOT NULL CHECK (montant_dzd > 0),
  categorie                app.charge_categorie NOT NULL,
  type                     app.charge_type NOT NULL,
  frequence                app.charge_frequence NULL,
  -- Engagée (ponctuelle) / début (récurrente).
  date_charge              date NOT NULL,
  -- Prochaine échéance ; NULL pour une ponctuelle, qui n'en a pas.
  date_prochaine_echeance  date NULL,
  actif                    boolean NOT NULL DEFAULT true,
  is_synthetic             boolean NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  -- La cohérence type ⇄ fréquence est une CONTRAINTE, pas un test applicatif
  -- (règle 4). Une récurrente sans échéance ne serait jamais rappelée ; une
  -- ponctuelle avec fréquence serait comptée chaque mois.
  CONSTRAINT charge_type_coherent CHECK (
    (type = 'recurrente' AND frequence IS NOT NULL AND date_prochaine_echeance IS NOT NULL)
    OR
    (type = 'ponctuelle' AND frequence IS NULL AND date_prochaine_echeance IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS charges_prat_actif_echeance
  ON app.charges (practitioner_id, actif, date_prochaine_echeance);

-- Le tableau de bord lit toujours par cabinet et par période.
CREATE INDEX IF NOT EXISTS charges_cabinet_date
  ON app.charges (cabinet_id, date_charge);

-- ---------------------------------------------------------------------------
-- 3 · RLS — décalquée de `app.payments` (011 §2)
-- ---------------------------------------------------------------------------
-- ⚠️ `WITH CHECK` EXPLICITE. 011 s'appuie sur la réutilisation implicite du
-- `USING` par Postgres ; ça marche, mais sur une table neuve on l'écrit, sinon
-- la prochaine relecture doit redémontrer que l'écriture est bien cloisonnée.
-- Pas de policy assistante : les charges ne sont pas de son ressort.
ALTER TABLE app.charges ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.charges FORCE  ROW LEVEL SECURITY;

DROP POLICY IF EXISTS charge_owner ON app.charges;
CREATE POLICY charge_owner ON app.charges FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet() AND app.current_role() = 'owner')
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.current_role() = 'owner');

DROP POLICY IF EXISTS charge_practitioner ON app.charges;
CREATE POLICY charge_practitioner ON app.charges FOR ALL TO authenticated
    USING      (cabinet_id = app.current_cabinet()
                AND app.current_role() = 'practitioner'
                AND practitioner_id = auth.uid())
    WITH CHECK (cabinet_id = app.current_cabinet()
                AND app.current_role() = 'practitioner'
                AND practitioner_id = auth.uid());

-- Le garde de 016 : en cloud-dev, `is_synthetic` doit valoir true.
--
-- ⚠️ AUCUN `DROP TRIGGER IF EXISTS` EN TÊTE, ET LE PRÉFLIGHT A RAISON DE LE
-- REFUSER. Il refuse tout désarmement d'un garde-fou ou d'une RLS hors de la
-- migration 016 — et il ne peut pas distinguer « je désarme une protection »
-- de « j'écris un CREATE idempotent ». Sur une table créée douze lignes plus
-- haut, le DROP ne pouvait de toute façon rien trouver : il était décoratif.
-- Un garde-fou qui doit deviner l'intention n'est plus un garde-fou.
CREATE TRIGGER assert_synthetic BEFORE INSERT OR UPDATE ON app.charges
  FOR EACH ROW EXECUTE FUNCTION app.assert_synthetic_when_cloud();

-- La trace immuable (013). `app.charges` ne porte pas de `patient_id` —
-- `audit.track()` y lit NULL, ce qui est le comportement attendu.
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON app.charges
  FOR EACH ROW EXECUTE FUNCTION audit.track();

GRANT SELECT, INSERT, UPDATE ON app.charges TO authenticated;
GRANT SELECT, INSERT, UPDATE ON app.charges TO app_gatekeeper;

COMMENT ON TABLE app.charges IS
  '038. Les charges du cabinet — ce qui manquait pour un résultat net. '
  'Montants en dinars ENTIERS (ADR-018). Jamais de DELETE : `actif=false` '
  '(règle 3). Une récurrente porte fréquence + prochaine échéance, une '
  'ponctuelle ni l''une ni l''autre — contrainte `charge_type_coherent`.';

-- ---------------------------------------------------------------------------
-- 4 · Les portes d'écriture
-- ---------------------------------------------------------------------------
-- Patron du §5 de CLAUDE.md : périmètre · verrou · transition · écriture ·
-- trace. La trace est `trg_audit`, jamais un mécanisme parallèle.
-- `cabinet_id` et `practitioner_id` ne sont JAMAIS acceptés de l'appelant.
-- SECURITY INVOKER : la RLS décide (règle 4), la porte ne teste aucun rôle.

CREATE OR REPLACE FUNCTION app.create_charge(
  p_intitule    text,
  p_montant_dzd integer,
  p_categorie   app.charge_categorie,
  p_type        app.charge_type,
  p_frequence   app.charge_frequence,
  p_date_charge date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_id       uuid;
  v_echeance date;
BEGIN
  IF p_intitule IS NULL OR length(btrim(p_intitule)) = 0 THEN
    RAISE EXCEPTION 'Intitulé absent : nommez la charge.';
  END IF;
  IF p_montant_dzd IS NULL OR p_montant_dzd <= 0 THEN
    RAISE EXCEPTION 'Le montant d''une charge doit être supérieur à zéro.'
      USING HINT = 'ADR-018 : dinars entiers.';
  END IF;
  IF p_date_charge IS NULL THEN
    RAISE EXCEPTION 'Date absente : indiquez la date de la charge.';
  END IF;

  -- La transition type ⇄ fréquence, redite ici pour un message lisible ; la
  -- barrière reste `charge_type_coherent`.
  IF p_type = 'recurrente' THEN
    IF p_frequence IS NULL THEN
      RAISE EXCEPTION 'Une charge récurrente demande une fréquence.';
    END IF;
    -- La première échéance suit la date de début, au pas de la fréquence.
    v_echeance := (p_date_charge + CASE p_frequence
                                     WHEN 'mensuelle'     THEN interval '1 month'
                                     WHEN 'trimestrielle' THEN interval '3 months'
                                     WHEN 'annuelle'      THEN interval '1 year'
                                   END)::date;
  ELSE
    IF p_frequence IS NOT NULL THEN
      RAISE EXCEPTION 'Une charge ponctuelle n''a pas de fréquence.';
    END IF;
    v_echeance := NULL;
  END IF;

  INSERT INTO app.charges (cabinet_id, practitioner_id, intitule, montant_dzd,
                           categorie, type, frequence, date_charge,
                           date_prochaine_echeance, is_synthetic)
  VALUES (app.current_cabinet(), auth.uid(), btrim(p_intitule), p_montant_dzd,
          p_categorie, p_type, p_frequence, p_date_charge,
          v_echeance, app.is_cloud_dev())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.create_charge(text, integer, app.charge_categorie, app.charge_type, app.charge_frequence, date) IS
  '038. Crée une charge. `cabinet_id` et `practitioner_id` viennent de '
  '`app.current_cabinet()` et `auth.uid()`, jamais de l''appelant.';

REVOKE ALL ON FUNCTION app.create_charge(text, integer, app.charge_categorie, app.charge_type, app.charge_frequence, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.create_charge(text, integer, app.charge_categorie, app.charge_type, app.charge_frequence, date) TO authenticated;

CREATE OR REPLACE FUNCTION app.update_charge(
  p_id          uuid,
  p_intitule    text,
  p_montant_dzd integer,
  p_categorie   app.charge_categorie,
  p_type        app.charge_type,
  p_frequence   app.charge_frequence,
  p_date_charge date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_existe   uuid;
  v_echeance date;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;

  -- Verrou : sérialise deux corrections concurrentes.
  SELECT c.id INTO v_existe FROM app.charges c WHERE c.id = p_id FOR UPDATE;

  -- Introuvable ou hors périmètre : MÊME RETOUR (ADR-003, règle 5).
  IF v_existe IS NULL THEN RETURN NULL; END IF;

  IF p_montant_dzd IS NULL OR p_montant_dzd <= 0 THEN
    RAISE EXCEPTION 'Le montant d''une charge doit être supérieur à zéro.';
  END IF;
  IF p_date_charge IS NULL THEN
    RAISE EXCEPTION 'Date absente : indiquez la date de la charge.';
  END IF;

  IF p_type = 'recurrente' THEN
    IF p_frequence IS NULL THEN
      RAISE EXCEPTION 'Une charge récurrente demande une fréquence.';
    END IF;
    v_echeance := (p_date_charge + CASE p_frequence
                                     WHEN 'mensuelle'     THEN interval '1 month'
                                     WHEN 'trimestrielle' THEN interval '3 months'
                                     WHEN 'annuelle'      THEN interval '1 year'
                                   END)::date;
  ELSE
    v_echeance := NULL;
  END IF;

  UPDATE app.charges
     SET intitule                = btrim(p_intitule),
         montant_dzd             = p_montant_dzd,
         categorie               = p_categorie,
         type                    = p_type,
         frequence               = CASE WHEN p_type = 'recurrente' THEN p_frequence ELSE NULL END,
         date_charge             = p_date_charge,
         date_prochaine_echeance = v_echeance,
         updated_at              = now()
   WHERE id = p_id;

  RETURN p_id;
END;
$$;

REVOKE ALL ON FUNCTION app.update_charge(uuid, text, integer, app.charge_categorie, app.charge_type, app.charge_frequence, date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.update_charge(uuid, text, integer, app.charge_categorie, app.charge_type, app.charge_frequence, date) TO authenticated;

-- Suppression DOUCE. Règle 3 : aucun DELETE sur une donnée financière. Une
-- charge désactivée sort des totaux à venir sans effacer l'historique qu'elle
-- a déjà produit.
CREATE OR REPLACE FUNCTION app.delete_charge(p_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE v_existe uuid;
BEGIN
  IF p_id IS NULL THEN RETURN NULL; END IF;

  SELECT c.id INTO v_existe FROM app.charges c WHERE c.id = p_id FOR UPDATE;
  IF v_existe IS NULL THEN RETURN NULL; END IF;

  UPDATE app.charges SET actif = false, updated_at = now() WHERE id = p_id;
  RETURN p_id;
END;
$$;

COMMENT ON FUNCTION app.delete_charge(uuid) IS
  '038. Désactive une charge (`actif = false`). Règle 3 : aucun DELETE sur une '
  'donnée financière — l''historique déjà produit reste lisible.';

REVOKE ALL ON FUNCTION app.delete_charge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.delete_charge(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 5 · Amorce — UNIQUEMENT en cloud-dev
-- ---------------------------------------------------------------------------
-- ⚠️ RÈGLE 8. Un seed de charges livré sur la base d'un vrai cabinet y
-- inscrirait sept écritures comptables inventées. La condition
-- `app.is_cloud_dev()` fait que cette instance de développement — celle qui
-- porte déjà le bandeau DONNÉES FICTIVES (ADR-016) — reçoit les lignes, et
-- qu'une base de production n'en reçoit AUCUNE.
--
-- L'identité de la praticienne est RÉSOLUE PAR REQUÊTE, jamais écrite en dur :
-- la première praticienne du cabinet, à défaut l'owner.
DO $$
DECLARE
  v_cab   uuid;
  v_prat  uuid;
  v_debut date;
BEGIN
  IF NOT app.is_cloud_dev() THEN
    RAISE NOTICE '038 : instance non cloud-dev — aucune charge amorcée (règle 8).';
    RETURN;
  END IF;

  SELECT p.cabinet_id, p.id INTO v_cab, v_prat
    FROM app.profiles p
   WHERE p.role = 'practitioner'
   ORDER BY p.created_at
   LIMIT 1;

  IF v_prat IS NULL THEN
    SELECT p.cabinet_id, p.id INTO v_cab, v_prat
      FROM app.profiles p WHERE p.role = 'owner' ORDER BY p.created_at LIMIT 1;
  END IF;

  IF v_prat IS NULL THEN
    RAISE NOTICE '038 : aucun profil — aucune charge amorcée.';
    RETURN;
  END IF;

  -- Idempotent : rejouer la migration ne double pas les charges.
  IF EXISTS (SELECT 1 FROM app.charges WHERE cabinet_id = v_cab) THEN
    RAISE NOTICE '038 : charges déjà présentes — amorce ignorée.';
    RETURN;
  END IF;

  -- Le mois courant se calcule en Africa/Algiers (CLAUDE.md §4).
  v_debut := date_trunc('month', now() AT TIME ZONE 'Africa/Algiers')::date;

  INSERT INTO app.charges (cabinet_id, practitioner_id, intitule, montant_dzd,
                           categorie, type, frequence, date_charge,
                           date_prochaine_echeance, is_synthetic)
  VALUES
    (v_cab, v_prat, 'Loyer du cabinet',               45000, 'local',     'recurrente', 'mensuelle',
     v_debut, (v_debut + interval '1 month')::date, true),
    (v_cab, v_prat, 'Secrétariat (mi-temps)',         28000, 'personnel', 'recurrente', 'mensuelle',
     v_debut, (v_debut + interval '1 month')::date, true),
    (v_cab, v_prat, 'Électricité & internet',          9500, 'local',     'recurrente', 'mensuelle',
     v_debut, (v_debut + interval '1 month' + interval '4 days')::date, true),
    (v_cab, v_prat, 'Abonnements logiciels & IA',      8000, 'outils',    'recurrente', 'mensuelle',
     v_debut, (v_debut + interval '1 month')::date, true),
    (v_cab, v_prat, 'Assurance responsabilité civile', 6000, 'assurance', 'recurrente', 'mensuelle',
     v_debut, (v_debut + interval '1 month' + interval '14 days')::date, true),
    -- Deux PONCTUELLES, pour que ce chemin soit visiblement exercé à l'écran.
    (v_cab, v_prat, 'Réparation climatiseur',         18000, 'local',     'ponctuelle', NULL,
     ((now() AT TIME ZONE 'Africa/Algiers')::date - 12), NULL, true),
    (v_cab, v_prat, 'Formation EMDR',                 35000, 'autre',     'ponctuelle', NULL,
     ((now() AT TIME ZONE 'Africa/Algiers')::date - 5),  NULL, true);

  RAISE NOTICE '038 : 7 charges amorcées (cloud-dev).';
END $$;

REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('038_charges')
  ON CONFLICT DO NOTHING;

COMMIT;
