-- mesure-jarvis-phase5-fuite.sql — LE SCÉNARIO L, CÔTÉ BASE.
--
-- ═══ POURQUOI CETTE COMPARAISON A LIEU ICI, ET NON DANS L'INSTRUMENT ═══
--
-- L'instrument de phase 5 capture la charge réellement émise vers la
-- passerelle et l'écrit dans un fichier. Pour affirmer qu'aucun nom de patient
-- n'y figure, il faut CONNAÎTRE ces noms — et un script Node qui les
-- extrairait de Postgres les sortirait de la base, les écrirait sur le disque
-- et les tiendrait en mémoire, pour prouver qu'ils ne sortent pas. Le remède
-- serait exactement le mal.
--
-- Donc la comparaison a lieu DANS la base. Les identités ne quittent jamais
-- Postgres ; il n'en sort qu'un COMPTE et une CLASSE. Si le compte est nul,
-- c'est prouvé sans que personne — ni le modèle, ni le disque, ni la console,
-- ni l'agent qui écrit ces lignes — n'ait eu à lire un seul nom.
--
--   docker run --rm -i -v "<preuves>:/preuves:ro" postgres:17 \
--     psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f - < scripts/mesure-jarvis-phase5-fuite.sql
--
-- ⚠️ LE FICHIER EST LU EN CSV AVEC DES SÉPARATEURS IMPOSSIBLES. La charge est
-- du JSON : elle contient des tabulations, des virgules, des guillemets et des
-- antislashs. Le format texte par défaut les interpréterait et corromprait la
-- comparaison — une charge mal chargée rendrait « aucune fuite » pour la pire
-- des raisons.

\set ON_ERROR_STOP on

CREATE TEMP TABLE charge_brute (ligne text);
\copy charge_brute FROM '/preuves/charges-passerelle.txt' WITH (FORMAT csv, DELIMITER E'\x01', QUOTE E'\x02')

-- Garde de sanité : une charge vide passerait TOUS les contrôles négatifs.
SELECT
  count(*)                        AS lignes_de_charge,
  coalesce(sum(length(ligne)), 0) AS octets_de_charge,
  CASE WHEN coalesce(sum(length(ligne)), 0) > 200
       THEN 'charge non vide — la comparaison a un sens'
       ELSE 'ROUGE : charge vide ou minuscule, le test ne prouve RIEN'
  END                             AS sanite
FROM charge_brute;

-- La comparaison. `v` ne sort jamais : seules la classe et le compte sortent.
WITH identites AS (
  SELECT 'nom'              AS classe, last_name           AS v FROM app.patients
  UNION ALL SELECT 'prenom',           first_name                FROM app.patients
  UNION ALL SELECT 'numero_dossier',   record_number             FROM app.patients
  UNION ALL SELECT 'telephone',        phone                     FROM app.patients
  UNION ALL SELECT 'telephone_alt',    phone_alt                 FROM app.patients
  UNION ALL SELECT 'adresse',          address                   FROM app.patients
  UNION ALL SELECT 'piece_identite',   id_document_number        FROM app.patients
  UNION ALL SELECT 'contact_urgence',  emergency_contact::text   FROM app.patients
  UNION ALL SELECT 'notes_admin',      notes_admin               FROM app.patients
  UNION ALL SELECT 'identifiant_reel', id::text                  FROM app.patients
),
retenues AS (
  -- Seuil à 3 caractères : en deçà, une sous-chaîne se retrouve partout par
  -- hasard (« Ali » dans « qualité ») et la mesure ne dirait plus rien.
  SELECT classe, v FROM identites WHERE v IS NOT NULL AND length(trim(v)) >= 3
)
SELECT
  r.classe,
  count(*) FILTER (
    WHERE EXISTS (SELECT 1 FROM charge_brute c WHERE c.ligne ILIKE '%' || r.v || '%')
  ) AS occurrences_dans_la_charge,
  count(*) AS valeurs_examinees
FROM retenues r
GROUP BY r.classe
ORDER BY 2 DESC, 1;

-- LE VERDICT, en une ligne lisible sans interprétation.
WITH identites AS (
  SELECT last_name AS v FROM app.patients
  UNION ALL SELECT first_name FROM app.patients
  UNION ALL SELECT record_number FROM app.patients
  UNION ALL SELECT phone FROM app.patients
  UNION ALL SELECT phone_alt FROM app.patients
  UNION ALL SELECT address FROM app.patients
  UNION ALL SELECT id_document_number FROM app.patients
  UNION ALL SELECT emergency_contact::text FROM app.patients
  UNION ALL SELECT notes_admin FROM app.patients
  UNION ALL SELECT id::text FROM app.patients
),
retenues AS (
  SELECT v FROM identites WHERE v IS NOT NULL AND length(trim(v)) >= 3
),
fuites AS (
  SELECT count(*) AS n
    FROM retenues r
   WHERE EXISTS (SELECT 1 FROM charge_brute c WHERE c.ligne ILIKE '%' || r.v || '%')
)
SELECT CASE WHEN n = 0
            THEN 'VERDICT L : VERT — aucune valeur identifiante dans la charge émise'
            ELSE 'VERDICT L : ROUGE — ' || n || ' valeur(s) identifiante(s) ont franchi'
       END AS verdict
  FROM fuites;
