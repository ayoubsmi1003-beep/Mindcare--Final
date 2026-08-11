-- 031_seed_document_templates.sql
-- Seed des 4 modèles de certificats. Débloque B1.5 de S7B-DOCUMENTS.md.
-- Source : les 4 documents Word de la praticienne (photographiés le 14/07/2026),
--          transcrits dans docs/DOCUMENT-TEMPLATES.md.
-- Arbitrages A1 → A10 : TOUS TRANCHÉS « corriger » par la praticienne (2026-08-09).
--
-- ⚠️ AUCUNE DONNÉE NOMINATIVE DANS CE FICHIER.
--    La migration 015 a été expurgée le 2026-08-02 du nom, du téléphone et du
--    numéro d'ordre de la praticienne, précisément pour qu'ils ne vivent pas dans
--    un dépôt git hébergé pendant la phase cloud (ADR-016, amendement du 03-08).
--    Les réintroduire ici en dur annulerait cette précaution.
--    → l'en-tête ne contient QUE des marqueurs {{praticien.*}} et {{cabinet.*}}.
--    → les valeurs réelles vivent dans app.profiles / app.cabinets, saisies
--      sur l'instance du cabinet, jamais commitées.
--
-- Marqueurs : allowlist fermée de S7B §B3 — patient.* · vars.* · praticien.* · cabinet.*
--             Un marqueur inconnu reste littéral. Toute valeur est échappée en HTML.
--             Aucun {{{ }}}, aucun mode HTML brut.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. L'EN-TÊTE COMMUN
--    Identique sur les 4 documents. Bloc FR à gauche, arabe dessous, logo,
--    bloc Date/Nom/Prénom/Age à droite. Times New Roman 14 → --font-doc.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _hdr(html text) ON COMMIT DROP;
INSERT INTO _hdr VALUES ($HDR$
<header class="doc-entete">
  <div class="doc-entete__identite">
    <p class="doc-entete__nom">{{praticien.titre}} {{praticien.nom}}</p>
    <p class="doc-entete__specialite">Médecin Spécialiste en Psychiatrie<br>et Psychothérapie</p>
    <hr class="doc-entete__filet">
    <div class="doc-entete__ar" lang="ar" dir="rtl">
      <p class="doc-entete__nom-ar">{{praticien.nom_ar}}</p>
      <p class="doc-entete__specialite-ar">طبيبة مختصة في الأمراض النفسية<br>العقلية والعصبية</p>
    </div>
    <hr class="doc-entete__filet">
    <p class="doc-entete__ordre">N° d'Ordre : {{praticien.numero_ordre}}</p>
    <p class="doc-entete__tel">Tel : {{praticien.telephone}}</p>
  </div>

  <div class="doc-entete__marque" aria-hidden="true"></div>

  <div class="doc-entete__patient">
    <p><span>Date :</span> {{vars.date}}</p>
    <p><span>Nom :</span> {{patient.nom}}</p>
    <p><span>Prénom :</span> {{patient.prenom}}</p>
    <p><span>Age :</span> {{patient.age}} ans</p>
  </div>
</header>
$HDR$);

-- Pas de pied de page : les documents d'origine n'en portent aucun.
-- Ni « Fait à Alger le… », ni bloc de signature imprimé, ni numéro de document.
-- doc_number reste interne (ADR-010). Ne pas en ajouter « pour faire propre ».

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. LES 4 MODÈLES
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO app.document_templates
       (cabinet_id, doc_type, version, title_fr, header_html, body_html, footer_html, is_active)
SELECT c.id, t.doc_type, 1, t.title_fr, h.html, t.body_html, NULL, true
FROM   app.cabinets c
CROSS  JOIN _hdr h
CROSS  JOIN (VALUES

-- ── 2.1 · Certificat de bonne santé mentale ─────────────────────────────────
--     A4 « agé(e) » → « âgé(e) » · A5 « piéce » → « pièce » · A6 « a l'examen » → « à »
--     A7 « en vu d'établissement » → « en vue de l'établissement » · A3 « Medecin » → « Médecin »
--     « Mr/Mme/Mlle » écrit en dur dans l'original → {{patient.civilite}}, choisi au dossier.
 ('bonne_sante_mentale'::app.doc_type,
  'Certificat de bonne santé mentale',
  $B1$
<h1 class="doc-titre">Certificat de bonne santé mentale</h1>

<p>Je soussignée, {{praticien.titre}} {{praticien.nom}}, Médecin spécialiste en psychiatrie.</p>

<p class="doc-alinea">Certifie avoir reçu et examiné {{patient.civilite}} {{patient.nom}}
{{patient.prenom}}, âgé(e) de {{patient.age}} ans</p>

<p class="doc-alinea">Porteur de la pièce d'identité Numéro {{vars.piece_identite_numero}}
délivrée par la mairie de {{vars.mairie}}</p>

<p class="doc-alinea">Et déclare qu'il ne présente aucun trouble psychique patent à l'examen
ce jour et apte d'assurer ses responsabilités civiles.</p>

<p>Certificat remis à l'intéressé en main propre en vue de l'établissement d'un acte notarié.</p>
  $B1$),

-- ── 2.2 · Certificat de suivi médical ───────────────────────────────────────
--     A2 « suivie » → « suivi » (titre) · A8 « dater du » → « à dater du »
--     Chiffres ET lettres confirmés par l'original : « 30 Jours (trente jours) ».
--     {{vars.arret_jours_lettres}} est CALCULÉE, jamais saisie.
 ('suivi_medical'::app.doc_type,
  'Certificat de suivi médical',
  $B2$
<h1 class="doc-titre">Certificat de suivi médical</h1>

<p>Je soussignée, {{praticien.titre}} {{praticien.nom}}, Médecin spécialiste en psychiatrie,</p>

<p>Déclare que le patient(e) {{patient.nom}} {{patient.prenom}}, âgé(e) de {{patient.age}} ans
nécessite un arrêt de travail de {{vars.arret_jours}} Jours ({{vars.arret_jours_lettres}} jours)
à dater du {{vars.arret_date_debut}}</p>
  $B2$),

-- ── 2.3 · Certificat médical ────────────────────────────────────────────────
--     A9 « est établis » → « est établi »
--     {{vars.traitement}} : champ libre multiligne, saisi à l'émission.
--     NON relié au module Traitements (hors périmètre, mois 2).
 ('certificat_medical'::app.doc_type,
  'Certificat médical',
  $B3$
<h1 class="doc-titre">Certificat médical</h1>

<p>Je soussignée, {{praticien.titre}} {{praticien.nom}}, Médecin spécialiste en psychiatrie,
certifie que {{patient.civilite}} {{patient.nom}} {{patient.prenom}},
né(e) le {{patient.date_naissance}} présente une affection Psychique Chronique et Invalidante
nécessitant le traitement par</p>

<p class="doc-traitement">{{vars.traitement}}</p>

<p>Le présent certificat est établi pour servir et valoir ce que de droit.</p>
  $B3$),

-- ── 2.4 · Justification ─────────────────────────────────────────────────────
--     A10 « justification » → « Justification »
--     « à la date sus-citée » renvoie au bloc d'en-tête. {{vars.date}} y est
--     modifiable à l'émission → la praticienne peut justifier une consultation
--     PASSÉE. Décision de l'utilisateur du 2026-08-09.
 ('justification'::app.doc_type,
  'Justification',
  $B4$
<h1 class="doc-titre">Justification</h1>

<p>Je soussignée, {{praticien.titre}} {{praticien.nom}}, Médecin spécialiste en psychiatrie,
certifie que {{patient.civilite}} {{patient.nom}} {{patient.prenom}},
né(e) le {{patient.date_naissance}} a été présent(e) à la date sus-citée à ma consultation.</p>
  $B4$)

) AS t(doc_type, title_fr, body_html)
WHERE NOT EXISTS (
  SELECT 1 FROM app.document_templates d
  WHERE d.cabinet_id = c.id AND d.doc_type = t.doc_type AND d.version = 1
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. CONTRÔLE — la migration échoue plutôt que de semer à moitié
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
  FROM   app.document_templates
  WHERE  is_active AND version = 1;

  IF n <> (SELECT count(*) * 4 FROM app.cabinets) THEN
    RAISE EXCEPTION
      '031 : % modèles actifs pour % cabinet(s), attendu 4 par cabinet',
      n, (SELECT count(*) FROM app.cabinets);
  END IF;
END $$;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- CE QUE CETTE MIGRATION NE FAIT PAS, ET POURQUOI
--
-- · Elle ne pose PAS le nom, le n° d'ordre ni le téléphone. Voir l'en-tête.
--   → à saisir dans app.profiles / app.cabinets sur l'instance du cabinet.
--
-- · Elle ne pose PAS de modèle d'ordonnance. 'ordonnance' n'existe pas dans
--   l'enum app.doc_type (002), et ADR-011 marque toujours ce modèle « MANQUANT ».
--
-- · Elle ne contient PAS la conversion nombre → lettres. C'est du code, testé,
--   côté rendu : {{vars.arret_jours_lettres}} n'est jamais saisie à la main.
--   Cas à couvrir : 71 « soixante et onze », 80 « quatre-vingts »,
--   81 « quatre-vingt-un », 100 « cent », 200 « deux cents », 180 « cent quatre-vingts ».
--
-- · Elle ne règle PAS les marges d'impression. Le checkpoint V6 est « poser le
--   papier à côté du sien ». Sans un certificat imprimé de référence, ce contrôle
--   n'est pas signable — il reste ouvert, il n'est pas contourné.
-- ─────────────────────────────────────────────────────────────────────────────
