-- 030_document_gates — S7b phase 1. Les quatre portes des documents.
--
-- ADDITIF PUR. Ne modifie ni 010, ni la policy `documents_clinical`, ni
-- `templates_read`. `app.documents` et `app.document_templates` restent
-- exactement ce que 010 en a fait — aucune colonne ajoutée, aucun statut.
--
-- ⚠️ CE QUE CE FICHIER NE FAIT PAS, ET POURQUOI. S7b est BLOQUÉ sur cinq actifs
-- (D-12, §B1 de docs/S7B-DOCUMENTS.md) : scan de l'en-tête, arbitrage
-- « Pychiaterie », logo SVG, 7 fontes .woff2, contenu des 4 modèles. Ce fichier
-- livre la MÉCANIQUE, prouvée contre une fixture de checkpoint. Il ne sème
-- AUCUN modèle : le texte d'un certificat médical engage la responsabilité de
-- la praticienne, et l'inventer produirait un faux, pas un brouillon. Le jalon
-- S7b reste OUVERT après cette migration — seul le contrôle papier le clôt.
--
-- UN DOCUMENT ÉMIS NE SE RÉÉMET PAS ET NE SE CORRIGE PAS. Il n'y a ici AUCUNE
-- porte `update_document` ni `delete_document`, aujourd'hui ni plus tard : un
-- certificat remis au patient existe hors du système, et le rattraper en base ne
-- le rattrape pas dans sa poche. Une erreur se corrige en émettant un NOUVEAU
-- document, numéroté à sa date. Même principe qu'ADR-004 sur les notes signées
-- — et TENU DE LA MÊME FAÇON : ADR-004 s'appuie sur `trg_note_immutable` (008),
-- pas sur la seule absence de porte, et §1bis-2 pose l'équivalent ici
-- (`assert_document_immutable`, `forbid_document_delete`). L'absence de porte
-- RPC n'aurait rien empêché : `app.documents` reste une table PostgREST, et
-- sans ce verrou de table un INSERT/UPDATE/DELETE direct aurait suffi à
-- réaliser exactement ce que §B3 décrit comme le risque à fermer.
--
-- ⚠️ À NE PAS CONFONDRE : « pas de DELETE, jamais » est définitif. « Pas
-- d'annulation » ne l'est pas. Une éventuelle porte `void_document` — qui
-- MARQUERAIT un document annulé sans jamais l'effacer — est une transition
-- d'état contrôlée, à trancher par un ADR et par une migration qui ajouterait
-- la colonne correspondante. Elle n'existe pas dans le schéma actif, et ce
-- fichier ne la préempte ni ne l'interdit.
--
-- LA CLOISON. Un document EST une pièce clinique (policy `documents_clinical`,
-- 010) : c'est le piège de la colonne `reason`, transposé aux documents.
--   owner        → lit tout le cabinet
--   practitioner → lit ses seuls documents
--   assistant    → ZÉRO LIGNE sur les portes de lecture, et aucune trace
--                  d'audit : elle n'a rien lu, journaliser une lecture qui n'a
--                  pas eu lieu serait une trace FAUSSE.
-- Mais ÉMETTRE est plus étroit que LIRE (voir §2).
--
-- LE TEMPS EST CELUI DU SERVEUR. Aucune porte de ce fichier ne prend de
-- timestamp en paramètre. `issued_at` vient du défaut de la table (010). Un
-- certificat antidaté par l'horloge d'un poste est un faux dans un dossier
-- médical. Contrôle 14.
--
-- ⚠️ MAIS L'ANNÉE DU NUMÉRO EST CELLE DU CABINET, PAS CELLE DU SERVEUR.
-- Postgres tourne en UTC ici ; Alger est à UTC+1 — même piège identifié et
-- corrigé pour la caisse par `029_payment_gates.sql §2quater`. La période du
-- compteur et l'année affichée dans `doc_number` (§2) passent par
-- `AT TIME ZONE 'Africa/Algiers'` ; `issued_at` reste un `timestamptz`, un
-- instant absolu que la conversion ne change pas.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Privilège nécessaire au transfert de propriété, retiré au §6
-- ---------------------------------------------------------------------------
-- Symétrie obligatoire, DANS CE FICHIER, pas ailleurs. C'est le défaut n°1
-- trouvé en vérification locale S6 : `ALTER FUNCTION ... OWNER TO
-- app_gatekeeper` exige que LE NOUVEAU PROPRIÉTAIRE possède CREATE sur le
-- schéma. 026 §3 et 029 §0 accordent puis retirent ce privilège dans LEUR
-- propre transaction ; une migration séparée qui l'oublie hérite d'un rôle déjà
-- refermé et échoue en 42501, après une longue série de migrations vertes.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Privilèges NOMMÉS, jamais hérités
-- ---------------------------------------------------------------------------
GRANT SELECT ON app.documents          TO app_gatekeeper;
GRANT SELECT ON app.document_templates TO app_gatekeeper;
GRANT SELECT ON app.patients           TO app_gatekeeper;   -- déjà en 020 §2, idempotent
GRANT SELECT ON app.profiles           TO app_gatekeeper;   -- déjà en 029 §1, idempotent

-- `app_gatekeeper` est membre de `authenticated` avec `INHERIT TRUE` (020 §2,
-- 021) : par défaut il hérite donc de tout ce que 001 accorde à `authenticated`
-- sur `app.documents`, SAUF de ce que §1bis révoque explicitement à
-- `authenticated` plus bas — l'héritage ne restitue jamais un privilège que le
-- rôle hérité n'a plus (même mur que `app.patients`, 017:174). C'est pour ça
-- que `GRANT INSERT ON app.documents TO app_gatekeeper` ci-dessous N'EST PAS
-- redondant, contrairement au `SELECT` : `issue_document` (§2), désormais
-- DEFINER, s'exécute SOUS app_gatekeeper et doit pouvoir écrire alors que
-- `authenticated` ne le peut plus.
GRANT INSERT ON app.documents TO app_gatekeeper;

-- CE QUI PROTÈGE SOUS LES PORTES DEFINER (§2, §3), C'EST LA RLS, PAS SEULEMENT
-- LE PRIVILÈGE : `app_gatekeeper` n'a PAS `BYPASSRLS`, donc `documents_clinical`
-- (010) s'applique sous lui, et `auth.uid()` reste celui de l'appelante.

-- ---------------------------------------------------------------------------
-- 1bis · Index — contrat de performance
-- ---------------------------------------------------------------------------
-- 010 ne pose AUCUN index sur `app.documents` hors la contrainte
-- `UNIQUE (cabinet_id, doc_number)`. Lister les documents d'un patient
-- balaierait donc la table. Contrôle 13, vérifié par EXPLAIN — pas par
-- intuition.
CREATE INDEX IF NOT EXISTS documents_patient_issued
  ON app.documents (patient_id, issued_at DESC);

-- Sert la recherche du modèle actif le plus récent, au §2.
CREATE INDEX IF NOT EXISTS templates_active_lookup
  ON app.document_templates (cabinet_id, doc_type, version DESC) WHERE is_active;

-- ---------------------------------------------------------------------------
-- 1bis-2 · Verrouiller LA TABLE, pas seulement les portes
-- ---------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ EN REVUE ADVERSARIALE, le plus coûteux des trois trouvés
-- CE jour. Toute la promesse de ce fichier — « un document émis ne se réémet
-- pas, `rendered_html` figé, aucune porte update/delete, jamais » — ne tenait
-- QUE dans l'absence de RPC. `app.documents` restait, elle, une table du
-- schéma `app` que PostgREST expose, avec `authenticated` détenant INSERT,
-- UPDATE, DELETE par défaut (001) et `documents_clinical` (010) FOR ALL
-- l'autorisant pour toute ligne visible. Mesuré à l'exécution AVANT correction,
-- rôle `authenticated`, AUCUNE porte utilisée :
--   INSERT INTO app.documents (…) VALUES (…) → réussit, doc_number arbitraire
--   UPDATE app.documents SET rendered_html = '…', issued_at = … → réussit
--   DELETE FROM app.documents WHERE … → réussit
-- Autrement dit : §B3 (« un appelant pourrait poster n'importe quel HTML comme
-- le certificat émis ») décrivait exactement ce que ce fichier, sans cette
-- section, laissait faire. « Même principe qu'ADR-004 sur les notes signées »
-- (ligne 16) était FAUX tant que ceci n'existait pas : ADR-004 est tenu par un
-- TRIGGER (008 `trg_note_immutable`), pas par la seule absence de porte — motif
-- que cette section reproduit enfin pour `app.documents`.
--
-- (a) INSERT et DELETE révoqués à `authenticated` ET `service_role` (même
-- portée que 017:174, défense en profondeur puisque `service_role` contourne
-- la RLS mais PAS les GRANT). `issue_document` (§2), désormais DEFINER, reste
-- seule à pouvoir insérer, via le GRANT explicite du §1.
REVOKE INSERT, DELETE ON app.documents FROM authenticated, service_role;

-- (b) UPDATE reste accordé (`mark_document_printed`, §4, est SECURITY INVOKER
-- par contrat gelé — §B2 §4 — donc DOIT s'exécuter sous l'appelante). Ce que le
-- privilège de table ne borne pas, ce trigger le borne : SEUL `printed_count`
-- peut changer sur un document déjà émis. Motif de `trg_note_immutable` (008),
-- transposé.
CREATE OR REPLACE FUNCTION app.assert_document_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF NEW.rendered_html    IS DISTINCT FROM OLD.rendered_html
     OR NEW.doc_number    IS DISTINCT FROM OLD.doc_number
     OR NEW.doc_type      IS DISTINCT FROM OLD.doc_type
     OR NEW.variables     IS DISTINCT FROM OLD.variables
     OR NEW.issued_at     IS DISTINCT FROM OLD.issued_at
     OR NEW.patient_id    IS DISTINCT FROM OLD.patient_id
     OR NEW.practitioner_id IS DISTINCT FROM OLD.practitioner_id
     OR NEW.cabinet_id    IS DISTINCT FROM OLD.cabinet_id
     OR NEW.consultation_id IS DISTINCT FROM OLD.consultation_id
     -- ⚠️ DÉFAUT TROUVÉ EN REVUE, 3e passe : `is_synthetic` était absent de
     -- cette liste alors que la ligne juste au-dessus affirmait « SEUL
     -- printed_count peut changer ». Mesuré : `UPDATE … SET is_synthetic = true`
     -- réussissait sans lever, une pièce déjà émise pouvait être re-étiquetée
     -- « donnée de test » après coup — la garantie était fausse à l'exécution.
     OR NEW.is_synthetic  IS DISTINCT FROM OLD.is_synthetic
  THEN
    RAISE EXCEPTION 'Document % verrouillé après émission : seul le compteur d''impression peut changer.', OLD.doc_number
      USING HINT = 'Un document émis ne se corrige pas — émettez-en un nouveau (ADR-004).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS document_immutable_after_issue ON app.documents;
CREATE TRIGGER document_immutable_after_issue
  BEFORE UPDATE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app.assert_document_immutable();

-- (c) DELETE : le REVOKE (a) ferme `authenticated`/`service_role`, mais un
-- TRIGGER est la seule barrière qui vaille pour un rôle qui garderait le
-- privilège par erreur future — motif déjà écrit dans ce dépôt, mot pour mot :
-- « POURQUOI UN TRIGGER ET PAS LA RLS : service_role contourne la RLS » (016,
-- garde de déploiement). Aucune exception, aucun rôle : ni owner, ni
-- app_gatekeeper, ni un futur `service_role` élargi ne supprime un document.
CREATE OR REPLACE FUNCTION app.forbid_document_delete()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Un document émis ne se supprime jamais (ADR-004, même principe que les notes signées).';
END;
$$;

DROP TRIGGER IF EXISTS document_no_delete ON app.documents;
CREATE TRIGGER document_no_delete
  BEFORE DELETE ON app.documents
  FOR EACH ROW EXECUTE FUNCTION app.forbid_document_delete();

-- ---------------------------------------------------------------------------
-- 1ter · L'ÉCHAPPEMENT — le point critique de tout ce jalon
-- ---------------------------------------------------------------------------
-- Un nom de patient contenant `<`, `>`, `&` ou une apostrophe est NORMAL, pas
-- une attaque. Sans échappement, `rendered_html` devient un XSS STOCKÉ DANS UNE
-- PIÈCE MÉDICO-LÉGALE, réaffiché à chaque relecture du dossier — et figé pour
-- dix ans par la garantie même qu'on cherche à donner. Contrôle 9.
--
-- ⚠️ ET AUSSI LES ACCOLADES, et ce point-là ne se voit pas tout seul. Une valeur
-- substituée qui contient littéralement `{{vars.x}}` serait RE-SUBSTITUÉE au
-- tour de boucle suivant : une INJECTION DE GABARIT PAR LA DONNÉE, où le nom
-- d'un patient irait lire un champ que le modèle n'a jamais demandé.
-- L'échappement HTML seul ne l'attrape pas — une accolade n'a rien d'HTML. En
-- les neutralisant ici, aucune valeur substituée ne peut plus FORMER un
-- marqueur, et la boucle du rendu devient sûre par construction plutôt que par
-- ordonnancement.
--
-- `&` D'ABORD, impérativement : l'inverse ré-échapperait les `&` des entités
-- qu'on vient d'écrire (`&lt;` deviendrait `&amp;lt;`).
CREATE OR REPLACE FUNCTION app.html_escape(p_value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = pg_catalog
AS $$
  SELECT replace(replace(replace(replace(replace(replace(replace(
           p_value, '&', '&amp;'),
                    '<', '&lt;'),
                    '>', '&gt;'),
                    '"', '&quot;'),
                    '''', '&#39;'),
                    '{', '&#123;'),
                    '}', '&#125;');
$$;

COMMENT ON FUNCTION app.html_escape(text) IS
  'S7b. Échappe TOUTE valeur substituée dans un document. `&` en premier, sinon '
  'les entités écrites juste avant seraient ré-échappées. Échappe AUSSI `{` et '
  '`}` : sans cela une donnée contenant `{{vars.x}}` serait re-substituée au '
  'tour suivant — injection de gabarit par la donnée, qu''un échappement HTML '
  'seul ne voit pas.';

REVOKE ALL ON FUNCTION app.html_escape(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.html_escape(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- 1quater · Le moteur de rendu — SUBSTITUTION, ET RIEN D'AUTRE
-- ---------------------------------------------------------------------------
-- LE RENDU SE FAIT EN BASE, PAS EN TYPESCRIPT, et c'est une décision de
-- sécurité, pas de commodité (§B3). `rendered_html` est LA PIÈCE JURIDIQUE.
-- S'il était rendu côté client puis envoyé à la base, un appelant pourrait
-- poster n'importe quel HTML comme « le certificat émis » : le document figé ne
-- serait plus dérivé du modèle. La base rend, la base fige.
--
-- CE MOTEUR N'EST PAS UN LANGAGE DE GABARIT. Il n'a ni expression, ni fonction,
-- ni boucle, ni condition, ni inclusion, ni partiel, ni traversée JSON
-- arbitraire. Il remplace des marqueurs `{{prefixe.cle}}` par des valeurs
-- échappées. C'est tout, et c'est délibéré : chaque capacité ajoutée ici serait
-- une capacité offerte à qui écrirait un modèle.
--
-- ALLOWLIST FERMÉE de préfixes : patient, vars, praticien, cabinet. Un marqueur
-- hors allowlist — ou dont la clé est absente du contexte — est laissé
-- LITTÉRAL, jamais résolu dynamiquement. Contrôle 10.
--
-- AUCUN MODE HTML BRUT. `{{{ ... }}}` lève une exception au lieu d'être ignoré :
-- laisser passer silencieusement laisserait un futur auteur de modèle croire
-- qu'un tel mode existe et qu'il n'a « pas marché ». Le seul HTML du document
-- vient du modèle, écrit par un humain ; les données n'en produisent jamais.
CREATE OR REPLACE FUNCTION app.render_template(p_body text, p_ctx jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_out text;
  v_m   record;
  v_val text;
BEGIN
  IF p_body IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_body LIKE '%{{{%' THEN
    RAISE EXCEPTION 'Modèle invalide : la séquence {{{ n''existe pas dans ce moteur.'
      USING HINT = 'Il n''y a AUCUN mode HTML brut : toute valeur est échappée, sans exception.';
  END IF;

  v_out := p_body;

  -- `DISTINCT` : un marqueur répété est traité une fois, `replace` s'occupant de
  -- toutes ses occurrences. La valeur substituée ne peut pas contenir
  -- d'accolade (app.html_escape les neutralise), donc aucune substitution ne
  -- peut FABRIQUER un marqueur qu'un tour suivant résoudrait.
  FOR v_m IN
    SELECT DISTINCT m[1] AS marqueur, btrim(m[2]) AS chemin
      FROM regexp_matches(p_body, '(\{\{([^{}]*)\}\})', 'g') AS m
  LOOP
    -- Allowlist fermée. Tout le reste tombe au travers et reste littéral.
    IF v_m.chemin ~ '^(patient|vars|praticien|cabinet)\.[a-z0-9_]+$' THEN
      v_val := p_ctx #>> string_to_array(v_m.chemin, '.');

      -- Clé absente du contexte → littéral elle aussi. On ne devine pas, et on
      -- n'écrit surtout pas une chaîne vide silencieuse : un trou invisible
      -- dans un certificat est pire qu'un marqueur visible.
      IF v_val IS NOT NULL THEN
        v_out := replace(v_out, v_m.marqueur, app.html_escape(v_val));
      END IF;
    END IF;
  END LOOP;

  RETURN v_out;
END;
$$;

COMMENT ON FUNCTION app.render_template(text, jsonb) IS
  'S7b. Substitution pure : `{{prefixe.cle}}` → valeur ÉCHAPPÉE. Allowlist '
  'fermée (patient, vars, praticien, cabinet) ; marqueur inconnu ou clé absente '
  '→ laissé LITTÉRAL. Pas d''expression, pas de boucle, pas de condition, pas '
  'de traversée JSON arbitraire, pas de mode HTML brut ({{{ lève). Rendu EN '
  'BASE et non côté client : rendered_html est la pièce juridique, elle doit '
  'être dérivée du modèle et non postée par l''appelant.';

REVOKE ALL ON FUNCTION app.render_template(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.render_template(text, jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- 2 · Émettre un document — SECURITY DEFINER
-- ---------------------------------------------------------------------------
-- ⚠️ DÉFAUT TROUVÉ EN REVUE ADVERSARIALE, corrigé ici — DEUX FOIS. La première
-- version était SECURITY INVOKER et lisait `app.patients` en direct : `017
-- REVOKE SELECT ON app.patients FROM authenticated, service_role` (017:174)
-- ferme ça à TOUT rôle authentifié, le mur qu'ADR-019 a posé et que
-- `get_consultation` (026 §6) a déjà rencontré. Mesuré : « permission denied
-- for table patients », pour tous les rôles, y compris le propriétaire
-- légitime. La deuxième version isolait la lecture dans une porte DEFINER
-- SÉPARÉE, appelable seule : mesuré à l'exécution, cela rend un RPC PUBLIC qui
-- sort l'identité d'un patient PAR CLÉ PRIMAIRE sans passer par
-- `audit.log_read` — exactement le chemin non audité qu'ADR-019 existe pour
-- fermer, rouvert par la porte censée le respecter.
--
-- LE FIX : `issue_document` elle-même est DEFINER, et lit en DEUX TEMPS, motif
-- de `029 §5` / `026 §6` / `get_document` (§3 plus bas) : d'abord la clé
-- technique SEULE (`practitioner_id`, pas l'identité) sous le VERROU, pour
-- décider si l'émission est autorisée ; puis, UNE FOIS LA DÉCISION PRISE,
-- `audit.log_read(p_patient_id, 'fiche')` ; puis SEULEMENT ALORS la lecture
-- nominative (nom, prénom, date de naissance…) qui ira dans le certificat.
-- Aucune identité ne quitte jamais cette fonction sans trace.
--
-- `app_gatekeeper` N'A PAS BYPASSRLS (020, 021) : `patients_clinical` et
-- `patients_assistant_read` (004) s'appliquent donc EXACTEMENT comme si
-- l'appelante lisait la table elle-même — la visibilité ne change pas, seul le
-- DROIT DE LA LIRE change. `auth.uid()` et `app.current_role()` restent ceux de
-- l'appelante, quel que soit le propriétaire de la fonction.
--
-- FRONTIÈRE TRANSACTIONNELLE. Appelée par PostgREST, cette fonction s'exécute
-- dans UNE SEULE transaction implicite : validation, verrou, lecture du modèle,
-- rendu, allocation du numéro et INSERT réussissent ENSEMBLE ou ne laissent
-- RIEN. Aucun état partiel n'est observable — ni un document numéroté sans HTML
-- figé, ni un numéro consommé sans document. `app.next_number` (010) incrémente
-- une ligne de `app.counters`, et un ROLLBACK REND ce numéro : c'est exactement
-- ce qu'une SEQUENCE ne ferait pas, et toute la raison d'I17. Un trou dans une
-- numérotation médico-légale est une suspicion. Contrôles 15 et 15bis — ce
-- dernier sur le chemin d'ÉCHEC, où le numéro ne doit pas davantage rester
-- consommé.
--
-- ⚠️ L'ORDRE EST IMPOSÉ : le numéro est alloué EN DERNIER, après le rendu.
-- Allouer avant, c'est brûler un numéro à chaque modèle mal rempli.
--
-- `p_variables` voyage SÉRIALISÉ en text : `RpcArgs` (ADR-020) n'accepte que des
-- scalaires, exactement comme `save_note` en S5.
CREATE OR REPLACE FUNCTION app.issue_document(
  p_patient_id      uuid,
  p_doc_type        app.doc_type,
  p_variables       text,
  p_consultation_id uuid DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_vars      jsonb;
  v_attendues text[];
  v_recues    text[];
  v_prat      uuid;
  v_pat_id    uuid;
  v_pat       record;
  v_moi       record;
  v_cab       record;
  v_tpl       record;
  v_ctx       jsonb;
  v_html      text;
  v_num       bigint;
  v_numero    text;
  v_id        uuid;
  v_c_prat    uuid;
  v_c_pat     uuid;
BEGIN
  IF p_patient_id IS NULL OR p_doc_type IS NULL THEN
    RETURN NULL;
  END IF;

  -- (1) Le JSON d'abord : il ne dit rien du dossier, donc le refuser tôt ne
  -- divulgue rien. Un texte non parsable et un tableau JSON sont l'un et
  -- l'autre refusés — `vars` est un OBJET de clés nommées, pas autre chose.
  BEGIN
    v_vars := COALESCE(p_variables, '{}')::jsonb;
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'Variables illisibles : le document n''a pas été émis.'
      USING HINT = 'p_variables doit être un objet JSON sérialisé (ADR-020).';
  END;

  IF jsonb_typeof(v_vars) <> 'object' THEN
    RAISE EXCEPTION 'Variables invalides : un objet JSON est attendu.';
  END IF;

  -- (2) Le jeu de champs EXACT du type, fixé par ADR-011. Ni clé en trop — comme
  -- `save_note` refuse une clé hors SOAP — ni clé manquante : un certificat
  -- d'arrêt sans nombre de jours est un certificat défectueux, pas un
  -- brouillon, et il partira quand même à l'impression si on le laisse passer.
  --
  -- ⚠️ `doc_type` COUVRE AUJOURD'HUI LES 4 VALEURS DE L'ENUM (002), MAIS UN
  -- `CASE` SANS `ELSE` SERAIT SILENCIEUX LE JOUR OÙ UNE 5ᵉ VALEUR ARRIVE
  -- (`ordonnance`, §B9, annoncée mais hors périmètre) : `v_attendues` vaudrait
  -- NULL, `NOT (v_recues @> NULL AND …)` vaudrait NULL, et le `IF` ci-dessous
  -- NE SE DÉCLENCHERAIT PAS — un document partirait sans AUCUNE validation de
  -- champs. Défaut trouvé en revue. Le garde explicite ferme ce trou avant
  -- qu'il n'existe.
  v_attendues := CASE p_doc_type
    WHEN 'bonne_sante_mentale' THEN ARRAY['id_document_number','mairie']
    WHEN 'suivi_medical'       THEN ARRAY['jours','jours_lettres','date_debut']
    WHEN 'certificat_medical'  THEN ARRAY['date_naissance','traitement']
    WHEN 'justification'       THEN ARRAY['date_consultation']
  END;

  IF v_attendues IS NULL THEN
    RAISE EXCEPTION 'Type de document non pris en charge par ce moteur : %.', p_doc_type
      USING HINT = 'Un type ajouté à l''enum doit d''abord recevoir son propre jeu de champs ici.';
  END IF;

  SELECT array_agg(k ORDER BY k) INTO v_recues FROM jsonb_object_keys(v_vars) AS k;
  v_recues := COALESCE(v_recues, ARRAY[]::text[]);

  IF NOT (v_recues @> v_attendues AND v_recues <@ v_attendues) THEN
    RAISE EXCEPTION 'Champs du document incorrects. Attendus : %.',
                    array_to_string(v_attendues, ', ')
      USING HINT = 'Ni clé absente, ni clé en trop — le jeu est celui d''ADR-011.';
  END IF;

  -- ⚠️ LE JEU DE CLÉS NE SUFFIT PAS — DÉFAUT TROUVÉ EN REVUE. `{"jours": null}`
  -- passe le test ci-dessus (la clé existe) puis `#>>` rend NULL dans
  -- `render_template`, qui laisse le marqueur LITTÉRAL : un certificat part
  -- avec `{{vars.jours}}` écrit noir sur blanc. Une chaîne vide fait le même
  -- trou en silence. Chaque valeur doit donc être un SCALAIRE non vide — un
  -- objet ou un tableau imbriqué serait de toute façon injecté tel quel (JSON
  -- brut, illisible sur un certificat) par le même chemin.
  DECLARE
    v_cle text;
  BEGIN
    FOREACH v_cle IN ARRAY v_attendues LOOP
      IF v_vars -> v_cle IS NULL OR jsonb_typeof(v_vars -> v_cle) = 'null' THEN
        RAISE EXCEPTION 'Champ « % » vide : un certificat ne part pas avec un blanc.', v_cle;
      END IF;
      IF jsonb_typeof(v_vars -> v_cle) NOT IN ('string', 'number', 'boolean') THEN
        RAISE EXCEPTION 'Champ « % » invalide : une valeur simple est attendue, pas une structure.', v_cle;
      END IF;
      IF jsonb_typeof(v_vars -> v_cle) = 'string' AND btrim(v_vars ->> v_cle) = '' THEN
        RAISE EXCEPTION 'Champ « % » vide : un certificat ne part pas avec un blanc.', v_cle;
      END IF;
    END LOOP;
  END;

  -- (3) LE VERROU SUR LE DOSSIER, avant toute décision : il sérialise deux
  -- émissions concurrentes sur le même patient (contrôle 16).
  --
  -- DEUX TEMPS, motif de 029 §5 / 026 §6 / get_document (§3 plus bas) : ce
  -- premier SELECT ne lit AUCUNE identité — seulement la clé technique
  -- `practitioner_id`, qui sert à DÉCIDER si l'émission est autorisée. Rien de
  -- nominatif ne sort encore de cette fonction.
  SELECT p.id, p.practitioner_id
    INTO v_pat_id, v_prat
    FROM app.patients p
   WHERE p.id = p_patient_id
     FOR UPDATE;

  -- Dossier inexistant OU masqué par la RLS : la base ne distingue pas les deux,
  -- et cette porte non plus. MÊME RETOUR, jamais une erreur qui séparerait « ce
  -- dossier n'existe pas » de « ce dossier existe mais n'est pas le vôtre » —
  -- cloison ADR-003. Contrôles 5, 6, 7. Aucune lecture d'identité n'a eu lieu :
  -- rien à tracer.
  IF v_pat_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- ÉMETTRE EST PLUS ÉTROIT QUE LIRE. L'owner LIT le dossier d'une consœur
  -- (`can_see_clinical` lui rend true) et l'assistante aussi
  -- (`patients_assistant_read`, 004) — ce qui serait absurde ici : un
  -- certificat porte un NOM et engage une responsabilité médicale nominative.
  -- On ne signe pas pour une consœur, et l'assistante ne signe jamais rien.
  --
  -- ⚠️ DÉFAUT TROUVÉ EN REVUE, corrigé ici : les DEUX rôles qui voient la ligne
  -- (owner, assistant) ne reçoivent PAS le même traitement, et c'est délibéré,
  -- pas un oubli.
  --   - OWNER : refus EXPLICITE, jamais NULL. À ce stade il a déjà légitimement
  --     accès à la ligne (can_see_clinical lui rend true en LECTURE) : il n'y a
  --     plus rien à protéger, et un silence lui ferait croire que le document
  --     est parti. Même raisonnement que
  -- `start_consultation` (026 §1) et `set_consultation_price` (029 §2).
  --   - ASSISTANT : NULL, comme une praticienne masquée par la RLS. Sa
  --     visibilité vient d'une policy ADMINISTRATIVE (`patients_assistant_read`)
  --     qui ne lui donne AUCUNE prétention clinique sur le dossier — un refus
  --     parlant lui apprendrait qu'un document existe potentiellement là où elle
  --     n'a rien à faire. `app.current_role()` distingue les deux : c'est la
  --     SEULE fonction du fichier qui teste le rôle directement plutôt que de
  --     laisser la RLS décider seule, précisément parce que la RLS rend les deux
  --     rôles visibles pour des raisons différentes (clinique vs administratif)
  --     et que ce fichier doit les traiter différemment. Prouvé par un
  --     contrôle 5bis dans `checkpoint-s7b.sh` (owner → RAISE) et par le
  --     contrôle 6 gelé (assistant → NULL, identique à practitioner hors
  --     périmètre) — même motif que le 5bis déjà écrit et revu pour
  --     `set_consultation_price` (029 §2, `checkpoint-s7.sh`) : ce n'est pas un
  --     numéro inventé, c'est le complément que ce fichier ajoute à son propre
  --     checkpoint pour prouver une garantie plus étroite que le texte gelé.
  IF v_prat <> auth.uid() THEN
    IF app.current_role() = 'owner' THEN
      RAISE EXCEPTION 'Ce dossier n''est pas le vôtre : un certificat est signé par la praticienne qui suit le patient.';
    END IF;
    RETURN NULL;
  END IF;

  -- (4) La séance rattachée, si elle est fournie, doit être la sienne ET porter
  -- sur CE patient — même raisonnement que le rendez-vous obligatoire de 026.
  -- ⚠️ LES DEUX CONDITIONS, PAS UNE SEULE : vérifier seulement le praticien
  -- laisserait une praticienne rattacher à un certificat de b1 une séance qui
  -- appartient à b2 — même praticienne, mauvais dossier. `document.patient_id`
  -- et `document.consultation_id` pointeraient alors deux patients différents,
  -- une incohérence qui ne se voit à l'écran qu'en ouvrant la séance liée.
  IF p_consultation_id IS NOT NULL THEN
    SELECT c.practitioner_id, c.patient_id INTO v_c_prat, v_c_pat
      FROM app.consultations c
     WHERE c.id = p_consultation_id;

    IF v_c_prat IS NULL OR v_c_prat <> auth.uid() OR v_c_pat <> p_patient_id THEN
      RAISE EXCEPTION 'Séance introuvable, hors de votre périmètre, ou d''un autre patient : document non émis.';
    END IF;
  END IF;

  -- TEMPS 2 : la décision d'émettre est prise (patient autorisé, séance le cas
  -- échéant cohérente). Trace AVANT toute lecture nominative — même motif que
  -- `get_document` (§3) et `list_patient_documents` (§3) : la trace précède
  -- toujours le nom.
  PERFORM audit.log_read(p_patient_id, 'fiche');

  SELECT p.first_name, p.last_name, p.record_number, p.birth_date,
         p.id_document_number
    INTO v_pat
    FROM app.patients p
   WHERE p.id = p_patient_id;

  -- (5) Le modèle ACTIF le plus récent. AUCUN MODÈLE → EXCEPTION : on n'émet
  -- jamais un document sans modèle. Un certificat sans corps n'est pas un
  -- document vide, c'est une pièce qui sortira du cabinet quand même.
  SELECT t.title_fr, t.header_html, t.body_html, t.footer_html
    INTO v_tpl
    FROM app.document_templates t
   WHERE t.cabinet_id = app.current_cabinet()
     AND t.doc_type   = p_doc_type
     AND t.is_active
   ORDER BY t.version DESC
   LIMIT 1;

  IF v_tpl.body_html IS NULL THEN
    RAISE EXCEPTION 'Aucun modèle actif pour ce type de document (%).', p_doc_type
      USING HINT = 'Les modèles sont fournis par la praticienne — ils ne s''inventent pas (D-12).';
  END IF;

  SELECT pr.full_name, pr.title, pr.speciality_fr, pr.speciality_ar,
         pr.order_number, pr.phone
    INTO v_moi
    FROM app.profiles pr
   WHERE pr.id = auth.uid();

  SELECT cb.name, cb.address, cb.phone
    INTO v_cab
    FROM app.cabinets cb
   WHERE cb.id = app.current_cabinet();

  -- (6) Le contexte de rendu — construit ICI, à partir de la base, jamais reçu
  -- de l'appelant. Seul `vars` vient de lui, et il vient de passer l'allowlist.
  v_ctx := jsonb_build_object(
    'patient', jsonb_build_object(
        'first_name',         v_pat.first_name,
        'last_name',          v_pat.last_name,
        'record_number',      v_pat.record_number,
        'birth_date',         v_pat.birth_date,
        'id_document_number', v_pat.id_document_number),
    'praticien', jsonb_build_object(
        'full_name',     v_moi.full_name,
        'title',         v_moi.title,
        'speciality_fr', v_moi.speciality_fr,
        'speciality_ar', v_moi.speciality_ar,
        'order_number',  v_moi.order_number,
        'phone',         v_moi.phone),
    'cabinet', jsonb_build_object(
        'name',    v_cab.name,
        'address', v_cab.address,
        'phone',   v_cab.phone),
    'vars', v_vars);

  -- (7) LE RENDU, ET LE FIGEAGE. Si le modèle change en 2027, le document de
  -- 2026 reste RIGOUREUSEMENT ce qui a été remis au patient (010). Contrôle 11.
  v_html := app.render_template(v_tpl.header_html, v_ctx)
         || app.render_template(v_tpl.body_html,   v_ctx)
         || COALESCE(app.render_template(v_tpl.footer_html, v_ctx), '');

  -- (8) LE NUMÉRO, EN DERNIER — et un ROLLBACK le rend (I17, contrôles 15/15bis).
  -- Format `DOC-<année>-<compteur sur 5 chiffres>`, sur le modèle de `REC-` en
  -- 029.
  --
  -- ⚠️ DÉFAUT TROUVÉ EN REVUE, corrigé ici : « l'année vient de now() » est vrai
  -- côté serveur et FAUX côté cabinet. Postgres tourne en UTC ; Alger est à
  -- UTC+1. Un certificat émis entre 00h00 et 01h00 heure d'Alger le 1er janvier
  -- aurait reçu l'année UTC de la veille — `DOC-2026-000xx` alors que
  -- `issued_at` (010, timestamptz) marque déjà 2027, et imputé au compteur de
  -- la MAUVAISE période. C'est exactement le piège qu'029_payment_gates.sql
  -- §2quater a identifié et corrigé pour la caisse ; il rejoue ici sans
  -- `AT TIME ZONE`. `issued_at` lui-même n'a pas besoin de correction : un
  -- `timestamptz` est un instant absolu, la conversion ne concerne que ce texte
  -- LISIBLE qu'est l'année du numéro.
  v_num    := app.next_number(app.current_cabinet(), 'document',
                               to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY'));
  v_numero := 'DOC-' || to_char(now() AT TIME ZONE 'Africa/Algiers', 'YYYY')
                     || '-' || lpad(v_num::text, 5, '0');

  -- AUCUN de ces champs n'est choisi par l'appelant — la leçon de 023, rejouée.
  -- `is_synthetic` est DÉRIVÉ de l'environnement (ADR-016, ADR-001) : 016
  -- l'ajoute PAR DÉCOUVERTE à toute table portant `patient_id`, donc à
  -- `app.documents`, avec le trigger `assert_synthetic`. Écrit `true` en dur,
  -- chaque certificat d'une vraie patiente serait marqué « synthétique » le jour
  -- de la bascule ; écrit `false` en dur, le garde de 016 refuserait l'insertion
  -- en cloud-dev. `issued_at` vient du DÉFAUT de la table : le temps du serveur.
  INSERT INTO app.documents (cabinet_id, practitioner_id, patient_id,
                             consultation_id, doc_type, doc_number,
                             variables, rendered_html, is_synthetic)
  VALUES (app.current_cabinet(), auth.uid(), p_patient_id,
          p_consultation_id, p_doc_type, v_numero,
          v_vars, v_html, app.is_cloud_dev())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ⚠️ `OWNER TO` POSÉ IMMÉDIATEMENT APRÈS LA FONCTION, même motif qu'au §3 : un
-- `DROP` emporte le propriétaire et réattribue à `postgres` (`rolbypassrls`),
-- la cloison tombe pendant que la migration reste VERTE (défaut de 018).
ALTER FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) IS
  'S7b. Émet un document et FIGE son HTML. SECURITY DEFINER — app.patients '
  'n''est pas lisible en direct par authenticated depuis 017 ; app_gatekeeper '
  'n''a PAS BYPASSRLS (020, 021), donc la RLS de 004/010 s''applique EXACTEMENT '
  'comme sous l''appelante. Lit en DEUX TEMPS (motif 029 §5 / 026 §6) : clé '
  'technique seule sous verrou pour décider, PUIS audit.log_read(''fiche''), '
  'PUIS la lecture nominative qui ira dans le certificat — aucune identité ne '
  'sort sans trace. Dossier introuvable ou masqué par la RLS : NULL, aucune '
  'fuite (ADR-003). Émettre est plus étroit que lire : owner et assistante '
  'voient le dossier (can_see_clinical / patients_assistant_read) mais ne '
  'signent pas pour la praticienne qui suit le patient — SAUF que le '
  'traitement diffère entre les deux : owner → refus EXPLICITE (il a déjà '
  'légitimement accès, un silence mentirait) ; assistant → NULL, comme une '
  'praticienne masquée (sa visibilité est administrative, pas clinique). Rendu '
  'EN BASE, toute valeur échappée, chaque valeur validée non vide et scalaire. '
  'Le numéro est alloué EN DERNIER, sur l''année DU CABINET (Africa/Algiers, '
  'pas UTC serveur), et un ROLLBACK le rend (I17). cabinet_id, practitioner_id, '
  'doc_number, issued_at et is_synthetic sont DÉRIVÉS, jamais choisis par '
  'l''appelant (023). INSERT sur app.documents révoqué à authenticated (voir '
  '§1bis) : cette porte est désormais le SEUL chemin de création.';

-- ⚠️ OBLIGATOIRE, ET ICI POUR UNE RAISON DE PLUS QU'AU MOTIF HABITUEL (026 §7,
-- 029 §2) : Postgres accorde EXECUTE à `PUBLIC` sur TOUTE fonction neuve.
-- `issue_document` est DEFINER — la laisser exécutable par `PUBLIC` ou
-- `service_role` ne serait pas qu'un accès en trop, ce serait la cloison
-- ENTIÈRE : `service_role` (`rolbypassrls`) l'appellerait pour émettre un
-- certificat sur n'importe quel cabinet, au nom de n'importe quelle
-- praticienne. Seul `authenticated` reçoit EXECUTE ; c'est alors la RLS lue
-- SOUS le contexte de l'appelante (`auth.uid()`, `app.current_role()`) qui
-- referme la porte, exactement comme si la fonction était INVOKER.
REVOKE ALL ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.issue_document(uuid, app.doc_type, text, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 3 · Lire — SECURITY DEFINER, ET CES DEUX PORTES NOMMENT DES PATIENTS
-- ---------------------------------------------------------------------------
-- DEFINER pour la raison de 027 : `audit.log_read` n'a EXECUTE accordé qu'à
-- `app_gatekeeper` (020 §2). Ces deux portes rendent une identité → la trace est
-- écrite AVANT la lecture, comme `get_consultation` (026 §6).
--
-- ⚠️ `app_gatekeeper` n'a PAS BYPASSRLS et hérite de `authenticated` (020, 021).
-- `documents_clinical` (010) s'applique donc TOUJOURS sous ces fonctions, et
-- `auth.uid()` reste celui de l'APPELANTE. Le filtrage explicite ci-dessous
-- n'affaiblit rien : il redit en SQL ce que la RLS impose déjà, pour que la
-- règle soit LISIBLE là où elle est décidée. Deux barrières, pas une.
CREATE OR REPLACE FUNCTION app.get_document(p_id uuid)
RETURNS TABLE (
  document_id        uuid,
  doc_type           app.doc_type,
  doc_number         text,
  rendered_html      text,
  variables          jsonb,
  issued_at          timestamptz,
  printed_count      integer,
  consultation_id    uuid,
  patient_id         uuid,
  patient_first_name text,
  patient_last_name  text,
  record_number      text,
  practitioner_name  text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_pat uuid;
BEGIN
  IF p_id IS NULL THEN
    RETURN;
  END IF;

  -- Temps 1 : la clé technique seule, aucune identité, aucune jointure sur
  -- `app.patients`. Si la RLS ne rend rien, aucune trace n'est écrite — elle n'a
  -- rien lu, et journaliser une lecture qui n'a pas eu lieu serait une trace
  -- FAUSSE. Une pièce d'audit fausse vaut moins qu'une pièce absente.
  SELECT d.patient_id INTO v_pat
    FROM app.documents d
   WHERE d.id = p_id
     AND d.cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(d.practitioner_id);

  IF v_pat IS NULL THEN
    RETURN;
  END IF;

  -- `audit.log_read` n'admet QUE 'fiche', 'recherche', 'liste' (017 §1). Ouvrir
  -- UN document nommé est une consultation de fiche.
  PERFORM audit.log_read(v_pat, 'fiche');

  -- Temps 2 : la lecture nominative, une fois la trace écrite.
  RETURN QUERY
  SELECT d.id, d.doc_type, d.doc_number, d.rendered_html, d.variables,
         d.issued_at, d.printed_count, d.consultation_id, d.patient_id,
         pt.first_name, pt.last_name, pt.record_number, pr.full_name
    FROM app.documents d
    LEFT JOIN app.patients pt ON pt.id = d.patient_id
    LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
   WHERE d.id = p_id
     AND d.cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(d.practitioner_id);
END;
$$;

-- ⚠️ `OWNER TO` POSÉ EXPLICITEMENT, ET IMMÉDIATEMENT APRÈS LA FONCTION. Un DROP
-- emporte le propriétaire et réattribue à `postgres`, rôle `rolbypassrls` : la
-- cloison tombe pendant que la migration reste VERTE. C'est le défaut de 018,
-- réapparu en 024 et 025. Contrôle 18.
ALTER FUNCTION app.get_document(uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_document(uuid) IS
  'S7b. UN document, avec son HTML figé et le nom du patient — donc trace '
  '`fiche` dans audit.log AVANT toute lecture d''identité (026 §6, 027). '
  'SECURITY DEFINER, propriété app_gatekeeper qui n''a PAS BYPASSRLS : '
  'documents_clinical (010) s''applique. Assistante → zéro ligne et aucune '
  'trace, elle n''a rien lu. Accès par clé primaire.';

REVOKE ALL ON FUNCTION app.get_document(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.get_document(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION app.list_patient_documents(p_patient_id uuid)
RETURNS TABLE (
  document_id       uuid,
  doc_type          app.doc_type,
  doc_number        text,
  issued_at         timestamptz,
  printed_count     integer,
  consultation_id   uuid,
  practitioner_name text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_visible boolean;
BEGIN
  IF p_patient_id IS NULL THEN
    RETURN;
  END IF;

  -- Temps 1 : le dossier est-il seulement approchable ? Aucune identité lue,
  -- aucun nom rendu par cette porte — elle liste des documents, pas des
  -- personnes. La trace est néanmoins écrite : le dossier DEMANDÉ est nommé par
  -- l'appelante, et c'est bien une lecture de dossier (I4, motif 026 §6).
  SELECT EXISTS (
    SELECT 1 FROM app.patients p
     WHERE p.id = p_patient_id
       AND p.cabinet_id = app.current_cabinet()
       AND app.can_see_clinical(p.practitioner_id))
    INTO v_visible;

  -- L'assistante voit l'identité (004) mais JAMAIS le clinique : zéro ligne,
  -- zéro trace. `can_see_clinical` lui rend false — c'est le piège de la colonne
  -- `reason`, transposé aux documents.
  IF NOT v_visible THEN
    RETURN;
  END IF;

  PERFORM audit.log_read(p_patient_id, 'liste');

  -- Temps 2. `documents_patient_issued` (§1bis) sert cet accès — contrôle 13,
  -- vérifié par EXPLAIN.
  RETURN QUERY
  SELECT d.id, d.doc_type, d.doc_number, d.issued_at, d.printed_count,
         d.consultation_id, pr.full_name
    FROM app.documents d
    LEFT JOIN app.profiles pr ON pr.id = d.practitioner_id
   WHERE d.patient_id = p_patient_id
     AND d.cabinet_id = app.current_cabinet()
     AND app.can_see_clinical(d.practitioner_id)
   ORDER BY d.issued_at DESC;
END;
$$;

ALTER FUNCTION app.list_patient_documents(uuid) OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.list_patient_documents(uuid) IS
  'S7b. Les documents d''un dossier. Trace `liste` AVANT lecture, et seulement '
  'si le dossier est réellement approchable — sinon zéro ligne ET zéro trace. '
  'SECURITY DEFINER, propriété app_gatekeeper (pas postgres : un DROP '
  'réattribuerait à un rôle rolbypassrls et la cloison tomberait, migration '
  'verte — défaut de 018). Servie par documents_patient_issued.';

REVOKE ALL ON FUNCTION app.list_patient_documents(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.list_patient_documents(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · Compter les impressions — SECURITY INVOKER
-- ---------------------------------------------------------------------------
-- UNE SEULE INSTRUCTION. L'incrément est atomique en SQL ; une lecture préalable
-- suivie d'une écriture introduirait une perte de mise à jour sur deux
-- impressions simultanées. Contrôle 19.
--
-- NE TOUCHE À RIEN D'AUTRE : ni `rendered_html`, ni `variables`, ni `issued_at`.
-- C'est la SEULE colonne de `app.documents` qu'une porte de ce fichier modifie
-- après émission, et c'est un compteur opérationnel — pas le contenu de la
-- pièce.
--
-- CE QUI EST DIFFÉRÉ, ET ASSUMÉ : le contrat gelé (§B2 §4) demande un compteur,
-- rien de plus. Un journal d'impression daté par tirage — qui a imprimé, quand,
-- combien d'exemplaires — serait une autre table et une autre décision. Il n'est
-- ni construit ni préempté ici.
CREATE OR REPLACE FUNCTION app.mark_document_printed(p_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE app.documents
     SET printed_count = printed_count + 1
   WHERE id = p_id
  RETURNING printed_count INTO v_count;

  -- Introuvable ou hors périmètre : même retour, aucune fuite.
  RETURN v_count;
END;
$$;

COMMENT ON FUNCTION app.mark_document_printed(uuid) IS
  'S7b. Incrémente printed_count en UNE instruction — deux impressions '
  'simultanées ne perdent pas un tirage. Ne touche ni rendered_html, ni '
  'variables, ni issued_at. SECURITY INVOKER : la RLS de 010 décide. '
  'Introuvable ou hors périmètre : NULL.';

REVOKE ALL ON FUNCTION app.mark_document_printed(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.mark_document_printed(uuid) TO authenticated;

-- `get_document` et `list_patient_documents` s'exécutent sous `app_gatekeeper`,
-- qui a déjà EXECUTE sur `audit.log_read` depuis 020 §2 — aucun GRANT à poser.

-- ---------------------------------------------------------------------------
-- 5 · Refermer
-- ---------------------------------------------------------------------------
-- Symétrique du §0, même raison qu'en 026 §8, 027 §3 et 029 §6 : la propriété
-- des trois portes DEFINER (issue_document, get_document,
-- list_patient_documents) est acquise, CREATE sur le schéma n'a plus lieu
-- d'être. Un rôle qui peut créer des objets dans `app` pourrait y planter une
-- fonction masquant une fonction du catalogue dans le `search_path` figé des
-- portes.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('030_document_gates')
  ON CONFLICT DO NOTHING;

COMMIT;
