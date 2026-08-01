# 01 — SCHEMA
**MindCare OS — Base de données PostgreSQL (Supabase auto-hébergé)**
Version 1.0 — 2026-07-28
Prérequis : `00-DECISIONS.md` lu et accepté.

> **Règle absolue.** La sécurité vit dans la base, pas dans le front-end.
> Toute table contenant une donnée patient a RLS **activée** et **forcée**.
> Un front-end compromis ne doit rien pouvoir lire de plus qu'un utilisateur légitime.

---

## 0. PRINCIPES DE CONCEPTION

| # | Principe | Application |
|---|---|---|
| P1 | Tout `timestamptz`, jamais `timestamp` | Alger = UTC+1, pas de DST, mais on ne parie pas dessus |
| P2 | Clés primaires `uuid` (`gen_random_uuid()`) | Pas de séquences devinables sur données médicales |
| P3 | `cabinet_id` + `practitioner_id` sur tout ce qui est clinique | ADR-003 |
| P4 | Soft delete interdit sur le clinique | Append-only, ADR-004 |
| P5 | Aucune donnée métier dans une clé primaire | Le téléphone change, l'UUID non |
| P6 | Migrations numérotées et tracées | Table `schema_migrations` |
| P7 | Numérotation sans trou via table compteur | Jamais `SEQUENCE` (les séquences trouent au rollback) |
| P8 | Nommage `snake_case`, tables au pluriel, FK `<table_singulier>_id` | Cohérence |

---

## 1. EXTENSIONS & FONDATIONS

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pg_trgm;      -- recherche floue sur noms
CREATE EXTENSION IF NOT EXISTS unaccent;     -- recherche insensible aux accents
-- pgvector : PAS maintenant. Ajouté au Mois 2 avec le GPU (mémoire Jarvis).

CREATE SCHEMA IF NOT EXISTS app;
CREATE SCHEMA IF NOT EXISTS audit;
```

### 1.1 Suivi des migrations
```sql
CREATE TABLE app.schema_migrations (
    version         text PRIMARY KEY,           -- '001_initial'
    applied_at      timestamptz NOT NULL DEFAULT now(),
    applied_by      text        NOT NULL DEFAULT current_user,
    checksum        text,
    execution_ms    integer
);
```
> Chaque fichier de migration insère sa ligne à la fin, dans la même transaction.

### 1.2 Types énumérés
```sql
CREATE TYPE app.user_role         AS ENUM ('owner','practitioner','assistant','patient');
CREATE TYPE app.sex               AS ENUM ('M','F');
CREATE TYPE app.appt_status       AS ENUM ('requested','confirmed','arrived','in_session','completed','no_show','cancelled');
CREATE TYPE app.appt_source       AS ENUM ('phone','walk_in','web','assistant','doctor');
CREATE TYPE app.note_status       AS ENUM ('draft','signed');
CREATE TYPE app.consult_status    AS ENUM ('open','closed');
CREATE TYPE app.payment_method    AS ENUM ('cash');
CREATE TYPE app.doc_type          AS ENUM ('bonne_sante_mentale','suivi_medical','certificat_medical','justification');
CREATE TYPE app.intake_lang       AS ENUM ('fr','ar','darija');
CREATE TYPE app.pending_status    AS ENUM ('awaiting','validated','rejected','merged');
CREATE TYPE app.jarvis_state      AS ENUM ('proposed','confirmed','executed','rejected','failed');
CREATE TYPE app.audit_op          AS ENUM ('select','insert','update','delete');
```

---

## 2. IDENTITÉ & PERSONNEL

### 2.1 Cabinet
```sql
CREATE TABLE app.cabinets (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name            text NOT NULL,
    address         text,
    phone           text,
    created_at      timestamptz NOT NULL DEFAULT now()
);
```
> Une seule ligne aujourd'hui. Présente pour ADR-003.

### 2.2 Profils (extension de `auth.users` Supabase)
```sql
CREATE TABLE app.profiles (
    id                  uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE RESTRICT,
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    role                app.user_role NOT NULL,
    full_name           text NOT NULL,
    -- champs praticien
    title               text,           -- 'Dr.'
    speciality_fr       text,           -- 'Médecin Spécialiste en Psychiatrie et Psychothérapie'
    speciality_ar       text,
    order_number        text,           -- '16/16780'
    phone               text,
    signature_block     jsonb,          -- en-tête documents, cf. ADR-011
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.profiles (cabinet_id, role) WHERE is_active;
```

### 2.3 Fonctions d'aide (le cœur des RLS)
```sql
-- Rôle de l'utilisateur courant. STABLE = mis en cache par requête.
CREATE OR REPLACE FUNCTION app.current_role()
RETURNS app.user_role LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT role FROM app.profiles WHERE id = auth.uid();
$$;

CREATE OR REPLACE FUNCTION app.current_cabinet()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT cabinet_id FROM app.profiles WHERE id = auth.uid();
$$;

-- Voit-il les données cliniques de ce praticien ?
-- owner : oui, tous. practitioner : uniquement les siennes. assistant : jamais.
CREATE OR REPLACE FUNCTION app.can_see_clinical(target_practitioner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT CASE app.current_role()
        WHEN 'owner'        THEN true
        WHEN 'practitioner' THEN target_practitioner = auth.uid()
        ELSE false
    END;
$$;

-- Accès administratif : identité, RDV, paiement. Pas de clinique.
CREATE OR REPLACE FUNCTION app.can_see_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
    SELECT app.current_role() IN ('owner','practitioner','assistant');
$$;
```

> **P-4 tranché : cloison stricte.** `practitioner` ne voit *que* `practitioner_id = auth.uid()`.
> Aucun patient partagé. Aucune exception dans le code.

---

## 3. PATIENTS

### 3.1 Patient
```sql
CREATE TABLE app.patients (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),   -- ADR-003, cloison
    record_number       text NOT NULL,                              -- sans trou, cf. §9
    first_name          text NOT NULL,
    last_name           text NOT NULL,
    birth_date          date,
    sex                 app.sex,
    phone               text NOT NULL,
    phone_alt           text,
    address             text,
    id_document_number  text,
    id_document_issuer  text,        -- 'mairie de ...' (certificats)
    emergency_contact   jsonb,       -- {name, relation, phone}
    notes_admin         text,        -- non clinique : "préfère le matin"
    is_active           boolean NOT NULL DEFAULT true,
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),
    created_by          uuid REFERENCES app.profiles(id),

    CONSTRAINT patients_record_unique UNIQUE (cabinet_id, record_number),
    CONSTRAINT patients_phone_format  CHECK (phone ~ '^[0-9+ ]{8,20}$')
);

CREATE INDEX ON app.patients (practitioner_id) WHERE is_active;
CREATE INDEX ON app.patients (phone);
CREATE INDEX patients_name_trgm ON app.patients
    USING gin ((unaccent(lower(first_name || ' ' || last_name))) gin_trgm_ops);
```

> ⚠️ **Attention.** `phone` n'est **pas** unique : deux enfants d'une même mère partagent son numéro.
> L'unicité se fait sur `(practitioner_id, phone, birth_date)` — appliquée en logique métier, pas en contrainte.

### 3.2 RLS patients
```sql
ALTER TABLE app.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.patients FORCE ROW LEVEL SECURITY;

-- owner + praticien propriétaire : accès complet
CREATE POLICY patients_clinical ON app.patients
    FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

-- assistante : lecture + écriture identité, tous praticiens
CREATE POLICY patients_assistant_read ON app.patients
    FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');

CREATE POLICY patients_assistant_write ON app.patients
    FOR INSERT TO authenticated
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');

CREATE POLICY patients_assistant_update ON app.patients
    FOR UPDATE TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant')
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');
```

> **L'assistante voit la ligne patient entière.** C'est voulu : elle a besoin de l'identité.
> Ce qu'elle ne voit **jamais** : consultations, notes, transcriptions, diagnostics, échelles.
> Ces tables n'ont **aucune** policy `assistant`. Elles sont invisibles pour elle, même en SQL brut.

---

## 4. ACCUEIL QR & FILE DE VALIDATION

### 4.1 Soumissions QR (zone tampon, hors dossier patient)
```sql
CREATE TABLE app.pending_patients (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    submitted_phone     text NOT NULL,
    first_name          text,
    last_name           text,
    birth_date          date,
    sex                 app.sex,
    language            app.intake_lang NOT NULL DEFAULT 'fr',
    answers             jsonb NOT NULL DEFAULT '{}'::jsonb,
    ai_summary          text,                -- pré-analyse Jarvis (pseudonymisée à l'aller)
    ai_flags            jsonb,               -- {urgence:false, themes:[...]}
    matched_patient_id  uuid REFERENCES app.patients(id),  -- si téléphone reconnu
    status              app.pending_status NOT NULL DEFAULT 'awaiting',
    reviewed_by         uuid REFERENCES app.profiles(id),
    reviewed_at         timestamptz,
    reject_reason       text,
    client_fingerprint  text,                -- anti-abus
    created_at          timestamptz NOT NULL DEFAULT now(),
    expires_at          timestamptz NOT NULL DEFAULT now() + interval '7 days'
);
CREATE INDEX ON app.pending_patients (cabinet_id, status, created_at DESC);
CREATE INDEX ON app.pending_patients (submitted_phone);
```

> **Anti-abus (ADR-006).** 3 soumissions / 24 h / numéro, appliqué en fonction serveur.
> `expires_at` : purge automatique à 7 jours des soumissions non validées → protège le disque.

### 4.2 Questionnaire d'accueil
```sql
CREATE TABLE app.intake_forms (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    code            text NOT NULL,
    version         integer NOT NULL DEFAULT 1,
    is_active       boolean NOT NULL DEFAULT true,
    created_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, code, version)
);

CREATE TABLE app.intake_questions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    form_id         uuid NOT NULL REFERENCES app.intake_forms(id) ON DELETE CASCADE,
    position        integer NOT NULL,
    code            text NOT NULL,
    response_type   text NOT NULL,       -- text|number|single|multi|scale|boolean|date
    options         jsonb,               -- [{value, label_fr, label_ar, label_dz}]
    is_required     boolean NOT NULL DEFAULT false,
    label_fr        text NOT NULL,
    label_ar        text,
    label_dz        text,
    show_if         jsonb,               -- logique conditionnelle
    UNIQUE (form_id, position)
);
```

> 🔴 **Règle clinique (imposée par la praticienne).** Aucune question ni option ne doit
> **suggérer un effet secondaire**. Cela biaise l'auto-déclaration. Interdit en accueil comme en aftercare.
> À faire respecter par revue humaine de chaque question ajoutée.

---

## 5. AGENDA

```sql
CREATE TABLE app.appointments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid REFERENCES app.patients(id),   -- NULL si demande web non validée
    pending_patient_id  uuid REFERENCES app.pending_patients(id),
    starts_at           timestamptz NOT NULL,
    ends_at             timestamptz NOT NULL,
    status              app.appt_status NOT NULL DEFAULT 'requested',
    source              app.appt_source NOT NULL DEFAULT 'assistant',
    reason              text,               -- ⚠️ INVISIBLE à l'assistante (P-3)
    notes_admin         text,               -- visible assistante
    arrived_at          timestamptz,
    created_by          uuid REFERENCES app.profiles(id),
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT appt_time_valid CHECK (ends_at > starts_at),
    CONSTRAINT appt_has_subject CHECK (patient_id IS NOT NULL OR pending_patient_id IS NOT NULL)
);
CREATE INDEX ON app.appointments (practitioner_id, starts_at);
CREATE INDEX ON app.appointments (cabinet_id, starts_at) WHERE status <> 'cancelled';

-- Anti double-réservation
CREATE UNIQUE INDEX appt_no_overlap ON app.appointments (practitioner_id, starts_at)
    WHERE status IN ('confirmed','arrived','in_session');
```

### 5.1 Le problème de `reason` — et sa solution
P-3 tranché : **l'assistante ne voit pas le motif.** Or PostgreSQL RLS filtre les *lignes*, pas les *colonnes*.

**Solution : une vue.**
```sql
CREATE VIEW app.appointments_admin
WITH (security_invoker = true) AS
SELECT id, cabinet_id, practitioner_id, patient_id, pending_patient_id,
       starts_at, ends_at, status, source, notes_admin, arrived_at, created_at
FROM app.appointments;   -- `reason` volontairement absent
```
```sql
ALTER TABLE app.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.appointments FORCE ROW LEVEL SECURITY;

CREATE POLICY appt_clinical ON app.appointments
    FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));

CREATE POLICY appt_assistant ON app.appointments
    FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant')
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.current_role() = 'assistant');
```
> 🔒 **Règle de code, non négociable.** Le front-end assistante requête **exclusivement**
> `appointments_admin`. Jamais `appointments`. À vérifier en revue de code.

---

## 6. CONSULTATION

### 6.1 Séance
```sql
CREATE TABLE app.consultations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid NOT NULL REFERENCES app.patients(id),
    appointment_id      uuid REFERENCES app.appointments(id),
    started_at          timestamptz NOT NULL DEFAULT now(),
    ended_at            timestamptz,
    duration_seconds    integer GENERATED ALWAYS AS
                        (EXTRACT(EPOCH FROM (ended_at - started_at))::integer) STORED,
    status              app.consult_status NOT NULL DEFAULT 'open',
    session_token       uuid NOT NULL DEFAULT gen_random_uuid(),  -- envoyé au STT, jamais l'ID patient
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.consultations (patient_id, started_at DESC);
CREATE UNIQUE INDEX one_open_consult ON app.consultations (practitioner_id)
    WHERE status = 'open';
```
> `session_token` = ADR-002. Seul jeton transmis à Groq. Aucune corrélation possible côté fournisseur.

### 6.2 Transcription
```sql
CREATE TABLE app.transcript_segments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id     uuid NOT NULL REFERENCES app.consultations(id) ON DELETE CASCADE,
    seq                 integer NOT NULL,
    speaker             text,                -- 'patient' | 'praticien' | NULL
    offset_ms           integer NOT NULL,
    text_ar             text NOT NULL,       -- ADR-008 : sortie en arabe
    text_fr             text,                -- traduction à la demande
    confidence          real,
    is_edited           boolean NOT NULL DEFAULT false,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (consultation_id, seq)
);
CREATE INDEX ON app.transcript_segments (consultation_id, seq);
```
> **Aucune colonne audio. Aucun chemin de fichier. ADR-009.** L'audio n'existe jamais sur disque.

### 6.3 Analyse en direct
```sql
CREATE TABLE app.live_insights (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    consultation_id     uuid NOT NULL REFERENCES app.consultations(id) ON DELETE CASCADE,
    emitted_at          timestamptz NOT NULL DEFAULT now(),
    kind                text NOT NULL,   -- suggested_question|risk_flag|theme|dsm_hint|summary_delta
    payload             jsonb NOT NULL,
    model               text,
    was_useful          boolean          -- feedback praticien → amélioration des prompts
);
CREATE INDEX ON app.live_insights (consultation_id, emitted_at DESC);
```
> ⚕️ **Statut clinique.** Ce sont des **suggestions**, jamais des conclusions. Elles n'entrent
> dans le dossier que si la praticienne les reprend explicitement dans sa note. Affichage
> permanent : *« Aide à la décision — le jugement clinique appartient au praticien. »*

---

## 7. NOTES CLINIQUES — APPEND-ONLY (ADR-004)

```sql
CREATE TABLE app.clinical_notes (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid NOT NULL REFERENCES app.patients(id),
    consultation_id     uuid REFERENCES app.consultations(id),
    status              app.note_status NOT NULL DEFAULT 'draft',
    subjective          text,       -- S
    objective           text,       -- O
    assessment          text,       -- A
    plan                text,       -- P
    structured          jsonb,      -- {humeur, sommeil, appetit, ideation, observance...}
    ai_draft            boolean NOT NULL DEFAULT false,
    signed_at           timestamptz,
    signed_by           uuid REFERENCES app.profiles(id),
    lock_after          timestamptz,   -- signed_at + 15 min (fenêtre de brouillon)
    created_at          timestamptz NOT NULL DEFAULT now(),
    updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.clinical_notes (patient_id, created_at DESC);

CREATE TABLE app.clinical_note_amendments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id             uuid NOT NULL REFERENCES app.clinical_notes(id),
    author_id           uuid NOT NULL REFERENCES app.profiles(id),
    reason              text NOT NULL,
    body                text NOT NULL,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.clinical_note_amendments (note_id, created_at);
```

### 7.1 Le verrou — appliqué par la base
```sql
CREATE OR REPLACE FUNCTION app.enforce_note_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status = 'signed' AND now() > OLD.lock_after THEN
        RAISE EXCEPTION
            'Note % verrouillée depuis %. Utilisez un amendement.',
            OLD.id, OLD.lock_after
            USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status = 'draft' AND OLD.status = 'signed' THEN
        RAISE EXCEPTION 'Une note signée ne peut pas repasser en brouillon.';
    END IF;
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_note_immutable
    BEFORE UPDATE ON app.clinical_notes
    FOR EACH ROW EXECUTE FUNCTION app.enforce_note_immutability();

CREATE OR REPLACE FUNCTION app.set_lock_window()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'signed' AND OLD.status = 'draft' THEN
        NEW.signed_at  := now();
        NEW.signed_by  := auth.uid();
        NEW.lock_after := now() + interval '15 minutes';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_note_sign
    BEFORE UPDATE ON app.clinical_notes
    FOR EACH ROW EXECUTE FUNCTION app.set_lock_window();

-- Aucune suppression. Jamais.
CREATE RULE no_delete_notes AS ON DELETE TO app.clinical_notes DO INSTEAD NOTHING;
```

> ⚖️ **C'est ici que se joue la valeur juridique du dossier.** Le verrou est en base :
> même un bug applicatif, même un accès SQL direct ne peut pas réécrire une note signée.

### 7.2 RLS — cloison totale
```sql
ALTER TABLE app.clinical_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.clinical_notes FORCE ROW LEVEL SECURITY;

CREATE POLICY notes_clinical ON app.clinical_notes
    FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id))
    WITH CHECK (cabinet_id = app.current_cabinet() AND app.can_see_clinical(practitioner_id));
-- Aucune policy assistant. Table inexistante pour elle.
```
> Même modèle RLS appliqué à : `consultations`, `transcript_segments`, `live_insights`,
> `diagnoses`, `scale_administrations`, `prescriptions`.

---

## 8. DIAGNOSTICS, ÉCHELLES, MÉDICAMENTS

### 8.1 Diagnostics
```sql
CREATE TABLE app.diagnoses (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid NOT NULL REFERENCES app.patients(id),
    code_system         text NOT NULL DEFAULT 'ICD-10',
    code                text,
    label               text NOT NULL,
    is_primary          boolean NOT NULL DEFAULT false,
    onset_date          date,
    resolved_at         date,
    created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.diagnoses (patient_id) WHERE resolved_at IS NULL;
```
> ICD-10 et non DSM-5 : c'est la référence administrative en Algérie. Champ `label` libre
> pour ne pas la bloquer si le code n'existe pas.

### 8.2 Échelles psychométriques
```sql
CREATE TABLE app.scales (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code            text NOT NULL UNIQUE,     -- 'PHQ9','GAD7','HDRS','YMRS','MMSE'
    name_fr         text NOT NULL,
    name_ar         text,
    items           jsonb NOT NULL,           -- questions + barème
    scoring         jsonb NOT NULL,           -- seuils d'interprétation
    is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE app.scale_administrations (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid NOT NULL REFERENCES app.patients(id),
    consultation_id     uuid REFERENCES app.consultations(id),
    scale_id            uuid NOT NULL REFERENCES app.scales(id),
    responses           jsonb NOT NULL,
    total_score         numeric,
    interpretation      text,
    administered_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.scale_administrations (patient_id, scale_id, administered_at DESC);
```
> Cet index sert la comparaison **séance après séance** : c'est le graphique d'évolution
> le plus parlant pour la praticienne, et il est quasi gratuit.

### 8.3 Médicaments
```sql
CREATE TABLE app.medications (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid REFERENCES app.cabinets(id),   -- NULL = base commune
    inn                 text NOT NULL,          -- dénomination commune (molécule)
    brand_name          text,
    atc_class           text,
    form                text,                   -- comprimé, gouttes, injectable
    strength            text,                   -- '50 mg'
    default_posology    text,
    notes               text,
    source              text NOT NULL DEFAULT 'manual',  -- manual | vidal
    is_active           boolean NOT NULL DEFAULT true
);
CREATE INDEX meds_search ON app.medications
    USING gin ((unaccent(lower(coalesce(brand_name,'') || ' ' || inn))) gin_trgm_ops);
```
> ADR-012 : ~60 molécules saisies à la main à J1. Import Vidal (scanné → OCR) en Semaine 2–3,
> via `source = 'vidal'`. La colonne `cabinet_id` NULL permet un référentiel partagé et
> une extension propre au cabinet.

### 8.4 Prescriptions
> ⚠️ **Ordonnance manuscrite en Mois 1** (décision d'Ayoub). Les tables sont créées
> maintenant pour que l'historique médicamenteux existe dès J1 — sinon on perd un mois
> de données de traitement qu'on ne pourra jamais reconstituer.

```sql
CREATE TABLE app.prescriptions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid NOT NULL REFERENCES app.patients(id),
    consultation_id     uuid REFERENCES app.consultations(id),
    prescribed_at       timestamptz NOT NULL DEFAULT now(),
    is_handwritten      boolean NOT NULL DEFAULT true,   -- Mois 1
    notes               text
);

CREATE TABLE app.prescription_lines (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    prescription_id     uuid NOT NULL REFERENCES app.prescriptions(id) ON DELETE CASCADE,
    medication_id       uuid REFERENCES app.medications(id),
    free_text           text,               -- si absente du référentiel
    dose                text,
    frequency_per_day   integer,
    timing              jsonb,              -- ['matin','soir']
    duration_days       integer,
    instructions        text,
    position            integer NOT NULL DEFAULT 1
);
```

---

## 9. DOCUMENTS & NUMÉROTATION SANS TROU

### 9.1 Compteur (P7 — jamais `SEQUENCE`)
```sql
CREATE TABLE app.counters (
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    scope           text NOT NULL,          -- 'patient_record','document','payment'
    period          text NOT NULL,          -- '2026' ou 'ALL'
    current_value   bigint NOT NULL DEFAULT 0,
    PRIMARY KEY (cabinet_id, scope, period)
);

CREATE OR REPLACE FUNCTION app.next_number(p_cabinet uuid, p_scope text, p_period text)
RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE v bigint;
BEGIN
    INSERT INTO app.counters (cabinet_id, scope, period, current_value)
    VALUES (p_cabinet, p_scope, p_period, 1)
    ON CONFLICT (cabinet_id, scope, period)
    DO UPDATE SET current_value = app.counters.current_value + 1
    RETURNING current_value INTO v;
    RETURN v;
END $$;
```
> `ON CONFLICT DO UPDATE` verrouille la ligne → aucun trou même en concurrence.
> Une `SEQUENCE` consomme son numéro même en cas de rollback → trous → suspicion en audit.

### 9.2 Documents générés
```sql
CREATE TABLE app.documents (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid NOT NULL REFERENCES app.patients(id),
    consultation_id     uuid REFERENCES app.consultations(id),
    doc_type            app.doc_type NOT NULL,
    doc_number          text NOT NULL,
    variables           jsonb NOT NULL,     -- {jours:30, mairie:'Alger-Centre', ...}
    rendered_html       text NOT NULL,      -- figé au moment de l'impression
    issued_at           timestamptz NOT NULL DEFAULT now(),
    printed_count       integer NOT NULL DEFAULT 0,
    UNIQUE (cabinet_id, doc_number)
);
```
> `rendered_html` est stocké **figé**. Si le modèle change en 2027, le document de 2026
> reste rigoureusement ce qui a été remis au patient. C'est une exigence médico-légale.

### 9.3 Modèles
```sql
CREATE TABLE app.document_templates (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    doc_type        app.doc_type NOT NULL,
    version         integer NOT NULL DEFAULT 1,
    title_fr        text NOT NULL,
    header_html     text NOT NULL,
    body_html       text NOT NULL,      -- {{patient.first_name}}, {{vars.jours}}
    footer_html     text,
    is_active       boolean NOT NULL DEFAULT true,
    UNIQUE (cabinet_id, doc_type, version)
);
```

---

## 10. FINANCE

```sql
CREATE TABLE app.payments (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    practitioner_id     uuid NOT NULL REFERENCES app.profiles(id),
    patient_id          uuid NOT NULL REFERENCES app.patients(id),
    consultation_id     uuid REFERENCES app.consultations(id),
    receipt_number      text NOT NULL,
    amount_dzd          numeric(10,2) NOT NULL CHECK (amount_dzd >= 0),
    method              app.payment_method NOT NULL DEFAULT 'cash',
    set_by              uuid NOT NULL REFERENCES app.profiles(id),
    collected_by        uuid REFERENCES app.profiles(id),
    collected_at        timestamptz,
    created_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (cabinet_id, receipt_number)
);
CREATE INDEX ON app.payments (practitioner_id, created_at DESC);
```

### 10.1 RLS finance — cloison des revenus (ADR-005)
```sql
ALTER TABLE app.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.payments FORCE ROW LEVEL SECURITY;

CREATE POLICY pay_owner ON app.payments FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet() AND app.current_role() = 'owner');

CREATE POLICY pay_practitioner ON app.payments FOR ALL TO authenticated
    USING (cabinet_id = app.current_cabinet()
           AND app.current_role() = 'practitioner'
           AND practitioner_id = auth.uid());

-- Assistante : encaisse, ne consulte pas l'historique global
CREATE POLICY pay_assistant ON app.payments FOR SELECT TO authenticated
    USING (cabinet_id = app.current_cabinet()
           AND app.current_role() = 'assistant'
           AND created_at > now() - interval '24 hours');
```
> La fenêtre 24 h donne à l'assistante ce dont elle a besoin (encaissements du jour)
> sans lui ouvrir le chiffre d'affaires du cabinet.

### 10.2 Notifications
```sql
CREATE TABLE app.notifications (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id      uuid NOT NULL REFERENCES app.cabinets(id),
    recipient_role  app.user_role,
    recipient_id    uuid REFERENCES app.profiles(id),
    kind            text NOT NULL,      -- 'payment_due','patient_arrived','pending_intake'
    payload         jsonb NOT NULL,
    read_at         timestamptz,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON app.notifications (recipient_role, read_at, created_at DESC);
```
> Diffusion via **Supabase Realtime**. Le médecin saisit le prix → notification instantanée
> sur le poste assistante. `payload` ne contient **jamais** de donnée clinique.

---

## 11. JARVIS — TRAÇABILITÉ DES ACTIONS (R4)

```sql
CREATE TABLE app.jarvis_actions (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cabinet_id          uuid NOT NULL REFERENCES app.cabinets(id),
    actor_id            uuid NOT NULL REFERENCES app.profiles(id),
    conversation_id     uuid NOT NULL,
    user_utterance      text NOT NULL,
    tool_name           text NOT NULL,
    tool_args           jsonb NOT NULL,
    state               app.jarvis_state NOT NULL DEFAULT 'proposed',
    proposed_at         timestamptz NOT NULL DEFAULT now(),
    confirmed_at        timestamptz,
    executed_at         timestamptz,
    result              jsonb,
    error               text,
    affected_table      text,
    affected_id         uuid
);
CREATE INDEX ON app.jarvis_actions (actor_id, proposed_at DESC);
```

> **Contrat imposé par la base.** Aucune écriture ne peut passer à `executed` sans
> `confirmed_at` renseigné :
```sql
ALTER TABLE app.jarvis_actions ADD CONSTRAINT jarvis_must_confirm
    CHECK (state <> 'executed' OR confirmed_at IS NOT NULL);
```
> Ce n'est plus une convention applicative. C'est une contrainte. Elle ne peut pas être oubliée.

---

## 12. JOURNAL D'AUDIT (R6)

```sql
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
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE changed text[];
BEGIN
    IF TG_OP = 'UPDATE' THEN
        SELECT array_agg(key) INTO changed
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
```

**Tables auditées :** `patients`, `clinical_notes`, `clinical_note_amendments`,
`consultations`, `prescriptions`, `documents`, `payments`, `appointments`, `diagnoses`.

```sql
-- Le journal est en écriture seule pour tous.
REVOKE UPDATE, DELETE ON audit.log FROM PUBLIC, authenticated;
```

---

## 13. GESTION DU DISQUE (256 GB — RSK-1)

Vous restez sur 256 GB. Le schéma doit donc défendre le disque lui-même.

```sql
CREATE OR REPLACE VIEW app.storage_health AS
SELECT
    pg_size_pretty(pg_database_size(current_database()))              AS db_size,
    (SELECT count(*) FROM app.transcript_segments)                    AS segments,
    (SELECT count(*) FROM audit.log)                                  AS audit_rows,
    pg_size_pretty(pg_total_relation_size('audit.log'))               AS audit_size;
```

**Purges programmées (`pg_cron` ou tâche Windows) :**
| Cible | Règle |
|---|---|
| `pending_patients` non validés | supprimés après `expires_at` (7 j) |
| `live_insights` | supprimés à 90 j — ce sont des suggestions, pas le dossier |
| `audit.log` | archivés hors ligne au-delà de 24 mois |
| `transcript_segments` | **jamais purgés** — ils font partie du dossier |

🔴 **Alarme obligatoire.** Tâche planifiée : si l'espace libre < 20 GB → notification
`kind='disk_critical'` en tête de tableau de bord. **Postgres sur disque plein ne ralentit pas :
il s'arrête, en pleine consultation.**

---

## 14. DONNÉES INITIALES (J1)

```sql
INSERT INTO app.cabinets (id, name, address, phone)
VALUES ('00000000-0000-0000-0000-000000000001', 'Cabinet Dr. Larbi N.', 'Alger', '0554813911');
```
Puis :
1. Profil `owner` — Dr. Larbi N., N° d'Ordre 16/16780, `signature_block` complet (ADR-011)
2. Profil `assistant`
3. 4 `document_templates` (en-tête FR + AR + logo, Times New Roman 14)
4. ~60 lignes `medications` (psychotropes réellement prescrits)
5. `scales` : PHQ-9, GAD-7, HDRS, YMRS
6. 1 `intake_form` v1, FR/AR/Darija — **relu question par question** contre la règle
   « aucune suggestion d'effet secondaire »
7. `counters` initialisés à 0

---

## 15. TESTS D'ACCEPTATION — VERT / ROUGE

À exécuter avant de déclarer le schéma prêt. **Aucun passage à l'étape suivante sur un rouge.**

```sql
-- T1 : l'assistante ne voit AUCUNE note clinique
SET LOCAL role = 'authenticated';
SET LOCAL request.jwt.claim.sub = '<uuid-assistante>';
SELECT count(*) FROM app.clinical_notes;          -- ATTENDU : 0

-- T2 : la Dr. #2 ne voit pas les patients de la Dr. Larbi
SET LOCAL request.jwt.claim.sub = '<uuid-dr2>';
SELECT count(*) FROM app.patients WHERE practitioner_id <> '<uuid-dr2>';  -- ATTENDU : 0

-- T3 : une note signée et verrouillée est immuable
UPDATE app.clinical_notes SET subjective = 'modifié' WHERE id = '<note-verrouillée>';
-- ATTENDU : EXCEPTION

-- T4 : impossible de supprimer une note
DELETE FROM app.clinical_notes WHERE id = '<toute-note>';
SELECT count(*) FROM app.clinical_notes WHERE id = '<toute-note>';  -- ATTENDU : 1

-- T5 : numérotation sans trou sous concurrence
SELECT app.next_number('<cabinet>','payment','2026');  -- x100 en parallèle
-- ATTENDU : 1..100, aucun doublon, aucun trou

-- T6 : Jarvis ne peut pas exécuter sans confirmation
INSERT INTO app.jarvis_actions (..., state, confirmed_at) VALUES (..., 'executed', NULL);
-- ATTENDU : violation de contrainte

-- T7 : l'assistante ne voit pas le motif
SELECT reason FROM app.appointments_admin LIMIT 1;   -- ATTENDU : erreur, colonne inexistante

-- T8 : l'audit capture les modifications
UPDATE app.patients SET phone = '0555000000' WHERE id = '<patient>';
SELECT changed_fields FROM audit.log ORDER BY occurred_at DESC LIMIT 1;  -- ATTENDU : {phone}
```

---

## 16. ORDRE DES MIGRATIONS

```
001_extensions_and_migrations_table
002_enums
003_cabinets_profiles_helpers
004_patients_and_rls
005_pending_patients_and_intake
006_appointments_and_admin_view
007_consultations_transcripts_insights
008_clinical_notes_immutability
009_diagnoses_scales_medications_prescriptions
010_counters_documents_templates
011_payments_notifications
012_jarvis_actions
013_audit_schema_and_triggers
014_storage_health_and_purges
015_seed_data
```
Une migration = un fichier = une transaction = une ligne dans `schema_migrations`.

---

## 17. CE QUI EST DÉLIBÉRÉMENT ABSENT

| Absent | Raison | Quand |
|---|---|---|
| `pgvector` / mémoire Jarvis | Aucune inférence locale sans GPU | Mois 2 |
| Fils de discussion aftercare | ADR-015, hors périmètre M1 | Mois 2 |
| Consentements structurés | Papier en M1 (formulaire STT signé) | Mois 2 |
| `tenant_id` multi-cabinet | `cabinet_id` suffit et prépare le terrain | Si 2ᵉ cabinet |
| Event sourcing | `audit.log` couvre le besoin réel à ce stade | Si un jour |

> Ce que nous n'écrivons pas aujourd'hui est un choix, pas un oubli.
> Chaque ligne ci-dessus a une porte d'entrée déjà prévue dans le schéma.

---

*Fin du document. Prochain livrable : `02-SECURITY-BOUNDARY.md` — passerelle de pseudonymisation, gestion des secrets, contrat exact des appels STT/LLM.*
