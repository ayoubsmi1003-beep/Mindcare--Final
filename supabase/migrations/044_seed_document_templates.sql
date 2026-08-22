-- 044_seed_document_templates — V7 Documents. Les 4 modèles.
--
-- Source : les 4 documents Word de la praticienne (photographiés le 14/07/2026),
--          transcrits dans docs/DOCUMENT-TEMPLATES.md.
-- Arbitrages A1 → A10 : TOUS tranchés « corriger » par la praticienne (2026-08-09).
--
-- ═══ POURQUOI 044 ET PAS 031 ═══════════════════════════════════════════════
--
-- Un fichier `docs/031_seed_document_templates.sql` existe depuis le 2026-08-11.
-- Il n'a JAMAIS été appliqué, et il ne le sera pas : ses marqueurs sont écrits
-- en français ({{patient.nom}}, {{praticien.titre}}, {{vars.arret_jours}}) alors
-- que le contexte de rendu construit par `030 §2` est en anglais
-- (patient.last_name, praticien.title, vars.jours). Tous passaient l'allowlist
-- de `render_template` — donc aucune erreur — mais aucun n'avait de valeur, et
-- un marqueur sans valeur est laissé LITTÉRAL, délibérément (030 §1quater).
-- Semé tel quel, un certificat destiné à un notaire serait sorti avec
-- « {{praticien.titre}} » imprimé dessus. Pire : les clés `arret_*` du modèle
-- `suivi_medical` auraient de toute façon été refusées par la validation
-- d'ensemble exact de `issue_document`, rendant ce type INÉMETTABLE.
--
-- ⚠️ 031 RESTE DANS docs/, INTACT. On ne le déplace pas, on ne le corrige pas :
-- règle 9, et il garde la trace de la genèse et des dix corrections. Le numéro
-- 031 demeure VACANT dans supabase/migrations/, et AUCUNE ligne
-- `schema_migrations` n'est fabriquée pour lui : inscrire une migration qui n'a
-- jamais tourné serait une trace fausse, exactement ce que 030 refuse à propos
-- des lectures d'audit. `db-migrate.sh` applique les fichiers PRÉSENTS dans
-- l'ordre alphabétique ; un numéro absent n'est pas un trou d'exécution.
-- 031 et 035 : numéros brûlés, ne pas réutiliser.
--
-- ═══ CE FICHIER SUPPOSE 043 APPLIQUÉE ══════════════════════════════════════
--
-- `patient.civilite`, `patient.age`, `patient.birth_date_fr`,
-- `praticien.full_name_ar` et `vars.date_affichee` n'existent QUE depuis 043.
-- Le contrôle du §3 le vérifie sur le catalogue plutôt que de l'espérer.
--
-- ═══ AUCUNE DONNÉE NOMINATIVE ICI ══════════════════════════════════════════
--
-- La migration 015 a été expurgée le 2026-08-02 du nom, du téléphone et du
-- numéro d'ordre de la praticienne, pour qu'ils ne vivent pas dans un dépôt git
-- hébergé pendant la phase cloud (ADR-016, amendement du 03-08). Les
-- réintroduire ici annulerait cette précaution. L'en-tête ne contient donc QUE
-- des marqueurs {{praticien.*}} et {{cabinet.*}} ; les valeurs réelles vivent
-- dans app.profiles / app.cabinets, saisies sur l'instance, jamais commitées.
--
-- ⚠️ CONSÉQUENCE DIRECTE POUR L'ARBITRAGE A1. « Pychiaterie » → « Psychiatrie »
-- ne se corrige PAS dans ce fichier, et ce n'est pas un oubli : la spécialité
-- vient de `{{praticien.speciality_fr}}`, donc de `app.profiles`. A1 est une
-- CONSIGNE DE SAISIE sur l'instance du cabinet, pas une correction de texte.
-- Une relecture future qui chercherait A1 ici et ne le trouverait pas
-- conclurait à tort qu'il a été perdu.
--
-- ⚠️ LE LOGO N'EST PAS DANS CE FICHIER. Le `<div class="doc-entete__marque">`
-- est vide : le SVG est posé en fond par la feuille de style, côté écran et
-- impression. L'inscrire ici le dupliquerait quatre fois par cabinet dans du
-- HTML figé, et rendrait `rendered_html` illisible. ÉCART ASSUMÉ, à dire de
-- vive voix au contrôle papier : le logo utilisé est `docs/Mindcare mark.svg`,
-- alors que docs/DOCUMENT-TEMPLATES.md:41 établit que le logo des certificats
-- d'origine est un AUTRE dessin (cercle plein, arbre/cerveau dans une main),
-- jamais fourni en fichier source. Décision de la praticienne du 2026-08-21.
--
-- Marqueurs : allowlist fermée patient.* · vars.* · praticien.* · cabinet.*
--             Un marqueur inconnu reste littéral. Toute valeur est échappée.
--             Aucun {{{ }}}, aucun mode HTML brut — la séquence lève.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1 · L'EN-TÊTE COMMUN
-- ---------------------------------------------------------------------------
-- Identique sur les 4 documents : bloc français à gauche, bloc arabe dessous
-- entre deux filets, logo à droite, bloc Date/Nom/Prénom/Âge à droite.
-- Times New Roman 14 → --font-doc.
--
-- Copié dans les 4 lignes plutôt que partagé par référence : `030 §2` lit
-- `header_html` DE LA LIGNE DU MODÈLE, et un en-tête partagé rendrait le
-- catalogue incohérent avec lui-même le jour d'une correction de version.
--
-- Aucun « Fait à Alger le… », aucun bloc de signature imprimé, aucun numéro de
-- document : les originaux n'en portent pas, et `doc_number` reste interne
-- (ADR-010, redit par la praticienne le 2026-08-21). Ne pas en ajouter « pour
-- faire propre ».
CREATE TEMP TABLE _hdr(html text) ON COMMIT DROP;
INSERT INTO _hdr VALUES ($HDR$
<header class="doc-entete">
  <div class="doc-entete__identite">
    <p class="doc-entete__nom">{{praticien.title}} {{praticien.full_name}}</p>
    <p class="doc-entete__specialite">{{praticien.speciality_fr}}</p>
    <hr class="doc-entete__filet">
    <div class="doc-entete__ar" lang="ar" dir="rtl">
      <p class="doc-entete__nom-ar">{{praticien.full_name_ar}}</p>
      <p class="doc-entete__specialite-ar">{{praticien.speciality_ar}}</p>
    </div>
    <hr class="doc-entete__filet">
    <p class="doc-entete__ordre">N° d'Ordre : {{praticien.order_number}}</p>
    <p class="doc-entete__tel">Tel : {{praticien.phone}}</p>
  </div>

  <div class="doc-entete__marque" aria-hidden="true"></div>

  <div class="doc-entete__patient">
    <p><span>Date :</span> {{vars.date_affichee}}</p>
    <p><span>Nom :</span> {{patient.last_name}}</p>
    <p><span>Prénom :</span> {{patient.first_name}}</p>
    <p><span>Age :</span> {{patient.age}} ans</p>
  </div>
</header>
$HDR$);

-- ---------------------------------------------------------------------------
-- 2 · LES 4 MODÈLES
-- ---------------------------------------------------------------------------
INSERT INTO app.document_templates
       (cabinet_id, doc_type, version, title_fr, header_html, body_html, footer_html, is_active)
SELECT c.id, t.doc_type, 1, t.title_fr, h.html, t.body_html, NULL, true
FROM   app.cabinets c
CROSS  JOIN _hdr h
CROSS  JOIN (VALUES

-- ── 2.1 · Certificat de bonne santé mentale ─────────────────────────────────
--    Corrections appliquées, chacune annotée pour qu'aucune relecture ne les
--    « restaure » à l'envers en croyant retrouver l'original (D-22, 2026-08-09) :
--      A3 « Medecin » → « Médecin »
--      A4 « agé(e) »  → « âgé(e) »
--      A5 « piéce »   → « pièce »
--      A6 « patent a l'examen » → « patent à l'examen »
--      A7 « en vu d'établissement » → « en vue de l'établissement »
--    L'original écrivait « Mr/Mme/Mlle » en dur, les trois. Remplacé par
--    {{patient.civilite}}, qui choisit selon le dossier — et qui ne connaît
--    QUE Mr et Mme, `app.sex` n'ayant pas de troisième valeur (043).
 ('bonne_sante_mentale'::app.doc_type,
  'Certificat de bonne santé mentale',
  $B1$
<h1 class="doc-titre">Certificat de bonne santé mentale</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, Médecin spécialiste en psychiatrie.</p>

<p class="doc-alinea">Certifie avoir reçu et examiné {{patient.civilite}} {{patient.last_name}}
{{patient.first_name}}, âgé(e) de {{patient.age}} ans</p>

<p class="doc-alinea">Porteur de la pièce d'identité Numéro {{vars.id_document_number}}
délivrée par la mairie de {{vars.mairie}}</p>

<p class="doc-alinea">Et déclare qu'il ne présente aucun trouble psychique patent à l'examen
ce jour et apte d'assurer ses responsabilités civiles.</p>

<p>Certificat remis à l'intéressé en main propre en vue de l'établissement d'un acte notarié.</p>
  $B1$),

-- ── 2.2 · Certificat de suivi médical ───────────────────────────────────────
--      A2 titre « suivie » → « suivi »
--      A3 « Medecin » → « Médecin »
--      A4 « agé(e) »  → « âgé(e) »
--      A8 « dater du » → « à dater du »
--    Chiffres ET lettres, confirmé par l'original : « 30 Jours (trente jours) ».
--    {{vars.jours_lettres}} est CALCULÉE par app.nombre_en_lettres (042) et
--    ÉCRASE la valeur reçue au moment du rendu (043 §5bis). Ce qui s'imprime
--    ne peut donc pas contredire le nombre en chiffres.
 ('suivi_medical'::app.doc_type,
  'Certificat de suivi médical',
  $B2$
<h1 class="doc-titre">Certificat de suivi médical</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, Médecin spécialiste en psychiatrie,</p>

<p>Déclare que le patient(e) {{patient.last_name}} {{patient.first_name}}, âgé(e) de
{{patient.age}} ans nécessite un arrêt de travail de {{vars.jours}} Jours
({{vars.jours_lettres}} jours) à dater du {{vars.date_debut}}</p>
  $B2$),

-- ── 2.3 · Certificat médical ────────────────────────────────────────────────
--      A3 « Medecin » → « Médecin »
--      A9 « est établis » → « est établi »
--    {{vars.traitement}} : champ libre multiligne, saisi à l'émission. NON relié
--    au module Traitements (hors périmètre, mois 2).
--    ⚠️ La date affichée vient de {{patient.birth_date_fr}}, pas de
--    {{vars.date_naissance}} : la base connaît déjà la date du dossier. Le jeu
--    de `vars` gelé par 030 exige quand même `date_naissance` en saisie — le
--    formulaire la pré-remplit depuis le dossier (décision du 2026-08-21) et la
--    valeur soumise reste tracée dans la colonne `variables` comme confirmation
--    explicite de la praticienne. Incohérence du contrat gelé, signalée, pas
--    corrigée en douce.
 ('certificat_medical'::app.doc_type,
  'Certificat médical',
  $B3$
<h1 class="doc-titre">Certificat médical</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, Médecin spécialiste en psychiatrie,
certifie que {{patient.civilite}} {{patient.last_name}} {{patient.first_name}},
né(e) le {{patient.birth_date_fr}} présente une affection Psychique Chronique et Invalidante
nécessitant le traitement par</p>

<p class="doc-traitement">{{vars.traitement}}</p>

<p>Le présent certificat est établi pour servir et valoir ce que de droit.</p>
  $B3$),

-- ── 2.4 · Justification ─────────────────────────────────────────────────────
--      A3 « Medecin » → « Médecin »
--      A10 titre « justification » → « Justification »
--    « à la date sus-citée » renvoie au bloc d'en-tête. Pour CE modèle
--    seulement, {{vars.date_affichee}} vaut `vars.date_consultation` (043 §5bis)
--    — la praticienne peut donc justifier une consultation PASSÉE. Les trois
--    autres modèles portent la date du jour. Décision du 2026-08-21.
 ('justification'::app.doc_type,
  'Justification',
  $B4$
<h1 class="doc-titre">Justification</h1>

<p>Je soussignée, {{praticien.title}} {{praticien.full_name}}, Médecin spécialiste en psychiatrie,
certifie que {{patient.civilite}} {{patient.last_name}} {{patient.first_name}},
né(e) le {{patient.birth_date_fr}} a été présent(e) à la date sus-citée à ma consultation.</p>
  $B4$)

) AS t(doc_type, title_fr, body_html)
WHERE NOT EXISTS (
  SELECT 1 FROM app.document_templates d
  WHERE d.cabinet_id = c.id AND d.doc_type = t.doc_type AND d.version = 1
);

-- ---------------------------------------------------------------------------
-- 3 · CONTRÔLES — la migration échoue plutôt que de semer un modèle troué
-- ---------------------------------------------------------------------------
DO $ctl$
DECLARE
  v_n    integer;
  v_cab  integer;
  v_bad  text;
BEGIN
  -- (a) Semer à moitié serait pire que ne pas semer : `issue_document` lève
  -- « Aucun modèle actif » sur les types manquants, et l'écran promettrait
  -- quatre certificats dont deux seulement existent.
  SELECT count(*) INTO v_n   FROM app.document_templates WHERE is_active AND version = 1;
  SELECT count(*) INTO v_cab FROM app.cabinets;

  IF v_n <> v_cab * 4 THEN
    RAISE EXCEPTION '044 : % modeles actifs pour % cabinet(s), attendu 4 par cabinet.', v_n, v_cab;
  END IF;

  -- (b) LE CONTRÔLE CENTRAL, et la seule défense structurelle contre le retour
  -- du défaut de 031. Chaque {{…}} des modèles actifs est confronté à la liste
  -- EXHAUSTIVE des clés que `issue_document` met dans le contexte après 043.
  -- Un marqueur hors liste ne lève rien à l'exécution — il s'imprime tel quel
  -- sur le papier. Il doit donc lever ICI.
  --
  -- ⚠️ MAINTENANCE : toute clé ajoutée au contexte de rendu se répercute dans
  -- cette liste ET dans scripts/checkpoint-v8-documents.sh, qui la rejoue.
  SELECT string_agg(DISTINCT m[1], ', ' ORDER BY m[1]) INTO v_bad
    FROM app.document_templates t,
         LATERAL regexp_matches(
           coalesce(t.header_html, '') || coalesce(t.body_html, '') || coalesce(t.footer_html, ''),
           '\{\{([^{}]*)\}\}', 'g') AS m
   WHERE t.is_active
     AND btrim(m[1]) NOT IN (
       'patient.first_name', 'patient.last_name', 'patient.record_number',
       'patient.birth_date', 'patient.birth_date_fr', 'patient.id_document_number',
       'patient.civilite', 'patient.age',
       'praticien.full_name', 'praticien.full_name_ar', 'praticien.title',
       'praticien.speciality_fr', 'praticien.speciality_ar',
       'praticien.order_number', 'praticien.phone',
       'cabinet.name', 'cabinet.address', 'cabinet.phone',
       'vars.date_affichee', 'vars.id_document_number', 'vars.mairie',
       'vars.jours', 'vars.jours_lettres', 'vars.date_debut',
       'vars.traitement', 'vars.date_consultation');

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '044 : marqueur(s) sans source dans le contexte de rendu : %.', v_bad
      USING HINT = 'Un marqueur sans valeur ne leve pas — il s imprime tel quel sur le certificat.';
  END IF;

  -- (c) Les clés `vars` employées par chaque modèle doivent appartenir au jeu
  -- que `issue_document` valide POUR CE TYPE, sinon l'émission est impossible
  -- (clé absente du jeu → refus) ou le marqueur reste littéral. C'est
  -- exactement ce qui rendait `suivi_medical` inémettable dans 031.
  SELECT string_agg(DISTINCT t.doc_type || ' → ' || m[1], ', ') INTO v_bad
    FROM app.document_templates t,
         LATERAL regexp_matches(coalesce(t.body_html, '') || coalesce(t.header_html, ''),
                                '\{\{(vars\.[a-z0-9_]+)\}\}', 'g') AS m
   WHERE t.is_active
     AND m[1] <> 'vars.date_affichee'          -- ajoutée par 043 pour les 4 types
     AND btrim(m[1]) NOT IN (
       SELECT 'vars.' || k
         FROM unnest(CASE t.doc_type
                WHEN 'bonne_sante_mentale' THEN ARRAY['id_document_number','mairie']
                WHEN 'suivi_medical'       THEN ARRAY['jours','jours_lettres','date_debut']
                WHEN 'certificat_medical'  THEN ARRAY['date_naissance','traitement']
                WHEN 'justification'       THEN ARRAY['date_consultation']
              END) AS k);

  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION '044 : cle(s) vars hors du jeu valide par issue_document : %.', v_bad
      USING HINT = 'Le jeu par type est fixe par ADR-011 et gele dans 030 — c est le modele qui s y conforme.';
  END IF;
END $ctl$;

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('044_seed_document_templates')
  ON CONFLICT DO NOTHING;

COMMIT;

-- ---------------------------------------------------------------------------
-- CE QUE CETTE MIGRATION NE FAIT PAS, ET POURQUOI
--
-- · Elle ne pose PAS le nom, le n° d'ordre, le téléphone ni les spécialités.
--   → à saisir dans app.profiles / app.cabinets sur l'instance du cabinet,
--     jamais commités (ADR-016). Sans cette saisie, l'en-tête sort avec des
--     marqueurs littéraux : le module N'EST PAS vert avant elle.
--   → `signature_block` doit recevoir {"full_name_ar": "…"} pour le nom arabe.
--
-- · Elle ne pose PAS de modèle d'ordonnance. `ordonnance` n'existe pas dans
--   l'enum app.doc_type (002), et ADR-011 marque ce modèle « MANQUANT ».
--
-- · Elle ne pose PAS de modèle de reçu. `recu` est prévu pour la phase
--   suivante ; l'ajouter à l'enum réclame son propre jeu de champs dans
--   `issue_document`, faute de quoi le garde de 030 refusera d'émettre.
--
-- · Elle ne règle PAS les marges d'impression. Le contrôle est « poser le
--   papier à côté du sien ». Sans un certificat imprimé de référence, il n'est
--   pas signable — il reste ouvert, il n'est pas contourné.
-- ---------------------------------------------------------------------------
