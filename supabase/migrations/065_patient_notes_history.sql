-- 065_patient_notes_history — L'HISTORIQUE COMPLET DES NOTES DE LA PRATICIENNE.
--
-- ═══ LE DÉFAUT QUE CETTE MIGRATION RÉPARE ═══
--
-- `analyze_session` ne disposait que de `app.get_previous_note` (027), qui rend
-- UNE seule consultation antérieure — la plus récente. L'analyse de séance
-- était donc structurellement incapable de voir au-delà d'un pas en arrière :
-- un changement de traitement décidé il y a trois séances, une idée noire
-- mentionnée deux fois à six mois d'écart, une observance qui se dégrade
-- lentement — rien de tout cela n'atteignait le modèle.
--
-- ⚠️ CE N'EST PAS UN `LIMIT` QU'ON AUGMENTE. 027 rend une ligne parce que sa
-- QUESTION est « quelle était la séance précédente ». La question d'ici est
-- différente — « qu'a écrit la praticienne sur ce patient » — et elle appelle
-- une porte différente, paginée, ordonnée, qui rend aussi les AMENDEMENTS.
-- 027 n'est pas modifiée : elle répond toujours correctement à sa question.
--
-- ═══ LES AMENDEMENTS, ET POURQUOI ILS COMPTENT ICI ═══
--
-- 008 a fait le choix qu'une correction est un AMENDEMENT VISIBLE, jamais un
-- écrasement. Conséquence directe pour l'analyse : sur une note amendée, le
-- dernier mot de la praticienne n'est PAS dans `subjective/objective/
-- assessment/plan` — il est dans l'amendement. Rendre la note sans ses
-- amendements ferait lire au modèle une version que la praticienne a
-- explicitement corrigée, et la préséance « les notes finalisées font foi »
-- désignerait alors le mauvais texte.
--
-- ═══ CE QUE CETTE PORTE NE FAIT PAS ═══
--
-- Elle ne trie pas par pertinence, ne résume pas, ne filtre pas les brouillons.
-- Elle rend les faits — statut, date de signature, contenu, amendements — et
-- la POLITIQUE de sélection reste dans le code applicatif, déterministe et
-- éprouvable hors ligne (`_shared/contexte-seance.ts`). Une politique enfouie
-- dans du SQL ne se teste qu'avec une base ; une politique en TypeScript se
-- teste sans rien.
--
-- ⚠️ `CREATE OR REPLACE` SEULEMENT — JAMAIS DE `DROP`. Un DROP sur une fonction
-- SECURITY DEFINER en emporte le propriétaire à la recréation (rôle `postgres`,
-- `rolbypassrls`) : la faute de 018, rejouée en 024/025, documentée en 026 §4
-- et en tête de 027. Cette fonction DOIT rester possédée par `app_gatekeeper`.
--
-- ⚠️ POURQUOI SECURITY DEFINER, ET POURQUOI CE N'EST PAS UN CONTOURNEMENT.
-- `audit.log_read` n'a EXECUTE accordé qu'à `app_gatekeeper` (017/020) : une
-- fonction INVOKER heurterait un 42501 au premier appel de journalisation.
-- La cloison, elle, ne repose PAS sur le mode de sécurité : `app_gatekeeper`
-- est NOBYPASSRLS et hérite de `authenticated` (020 §127, 021 §30), donc les
-- policies `FOR ALL TO authenticated` de 008 s'appliquent intégralement, et
-- `auth.uid()` rend toujours l'identifiant de l'APPELANTE à l'intérieur de la
-- fonction. Une praticienne ne voit que ce que 008 lui laisse voir.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0 · Privilège nécessaire au transfert de propriété, retiré au §4
-- ---------------------------------------------------------------------------
-- Même raison qu'en 027 §0 : `ALTER FUNCTION … OWNER TO app_gatekeeper` exige
-- que le NOUVEAU propriétaire possède CREATE sur le schéma qui porte l'objet.
-- 026 accorde ce privilège puis le retire dans sa propre transaction ; toute
-- migration ultérieure qui pose une porte DEFINER doit le reprendre ici.
GRANT CREATE ON SCHEMA app TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 1 · Le privilège de table qui manquait
-- ---------------------------------------------------------------------------
-- `app.consultations` et `app.clinical_notes` sont déjà accordés (026 §3).
-- Les amendements ne l'étaient pas : aucune porte ne les avait encore lus.
-- Le privilège de TABLE ne donne rien à lui seul — la RLS de 008 décide
-- ensuite, ligne par ligne.
GRANT SELECT ON app.clinical_note_amendments TO app_gatekeeper;

-- ---------------------------------------------------------------------------
-- 2 · La porte
-- ---------------------------------------------------------------------------
-- CONTRAT EXPLICITE :
--   · ordre       : de la plus RÉCENTE à la plus ancienne (`started_at DESC`,
--                   `consultation_id DESC` pour départager sans hasard) ;
--   · pagination  : `p_before` est un curseur exclusif sur `started_at` ;
--   · plafond     : `p_limit` borné à [1, 50] — un appelant ne peut pas
--                   demander tout le dossier d'un coup ;
--   · périmètre   : un seul patient, celui passé en argument ;
--   · zéro ligne  : aucune note antérieure — état normal, pas une erreur.
CREATE OR REPLACE FUNCTION app.get_patient_notes_history(
  p_patient_id                uuid,
  p_excluding_consultation_id uuid        DEFAULT NULL,
  p_limit                     integer     DEFAULT 20,
  p_before                    timestamptz DEFAULT NULL)
RETURNS TABLE (
  consultation_id uuid,
  started_at      timestamptz,
  note_id         uuid,
  note_status     app.note_status,
  signed_at       timestamptz,
  subjective      text,
  objective       text,
  assessment      text,
  plan            text,
  structured      jsonb,
  amendments      jsonb)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = app, audit, pg_catalog
AS $$
DECLARE
  v_limit integer;
BEGIN
  IF p_patient_id IS NULL THEN
    RETURN;   -- rien à lire sans patient : une absence, pas une erreur.
  END IF;

  -- ⚠️ LE PLAFOND EST IMPOSÉ ICI, PAS SEULEMENT CÔTÉ APPELANT. Une borne qui
  -- ne vit que dans le client n'est pas une borne : c'est une convention. Le
  -- coût d'un dossier de dix ans lu d'un seul coup se paie en mémoire serveur
  -- et en jetons chez le fournisseur, deux endroits que le client ne voit pas.
  v_limit := LEAST(GREATEST(COALESCE(p_limit, 20), 1), 50);

  -- Trace AVANT toute lecture (I4, motif de 020/026/027) : la TENTATIVE
  -- d'ouverture d'un dossier est journalisée, y compris quand la RLS ne rend
  -- ensuite aucune ligne. Une lecture sans trace serait un `permission denied`
  -- déguisé en absence.
  PERFORM audit.log_read(p_patient_id, 'fiche');

  RETURN QUERY
  SELECT
    c.id,
    c.started_at,
    n.id,
    n.status,
    n.signed_at,
    n.subjective,
    n.objective,
    n.assessment,
    n.plan,
    n.structured,
    -- Les amendements, du plus ancien au plus récent : ils se lisent dans
    -- l'ordre où la praticienne les a écrits. `'[]'` quand il n'y en a pas —
    -- jamais NULL, pour que l'appelant n'ait pas deux cas à distinguer.
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'reason',     a.reason,
               'body',       a.body,
               'created_at', a.created_at)
             ORDER BY a.created_at, a.id)
        FROM app.clinical_note_amendments a
       WHERE a.note_id = n.id), '[]'::jsonb)
  FROM app.consultations c
  -- INNER JOIN, délibérément : une consultation SANS note n'apporte rien à une
  -- analyse fondée sur ce que la praticienne a écrit. La rendre obligerait
  -- l'appelant à filtrer du vide, et gonflerait la page pour rien.
  JOIN app.clinical_notes n ON n.consultation_id = c.id
  WHERE c.patient_id = p_patient_id
    AND (p_excluding_consultation_id IS NULL OR c.id <> p_excluding_consultation_id)
    AND (p_before IS NULL OR c.started_at < p_before)
  ORDER BY c.started_at DESC, c.id DESC
  LIMIT v_limit;
END;
$$;

ALTER FUNCTION app.get_patient_notes_history(uuid, uuid, integer, timestamptz)
  OWNER TO app_gatekeeper;

COMMENT ON FUNCTION app.get_patient_notes_history(uuid, uuid, integer, timestamptz) IS
  '065. L''historique des notes cliniques d''un patient, de la plus récente à '
  'la plus ancienne, amendements inclus. Paginée par `p_before` (curseur '
  'exclusif sur started_at), plafonnée à 50 lignes CÔTÉ SERVEUR. Complète '
  'app.get_previous_note (027), qui répond à une autre question et reste '
  'inchangée. Trace `fiche` AVANT lecture. La RLS de 008 décide.';

-- ---------------------------------------------------------------------------
-- 3 · Qui peut franchir la porte
-- ---------------------------------------------------------------------------
-- `PUBLIC` reçoit EXECUTE par défaut sur toute fonction neuve ; `service_role`
-- doit rester exclu par construction (il contourne la RLS). Révocation
-- explicite, puis le seul GRANT voulu — même raisonnement qu'en 026 §7 et 027 §2.
REVOKE ALL ON FUNCTION app.get_patient_notes_history(uuid, uuid, integer, timestamptz)
  FROM PUBLIC;

GRANT EXECUTE ON FUNCTION app.get_patient_notes_history(uuid, uuid, integer, timestamptz)
  TO authenticated;

-- ---------------------------------------------------------------------------
-- 4 · On referme
-- ---------------------------------------------------------------------------
-- La propriété de la porte est acquise ; CREATE sur le schéma n'a plus lieu
-- d'être. Un rôle qui peut créer des objets dans `app` pourrait y planter une
-- fonction masquant une fonction du catalogue dans le `search_path` figé des
-- portes.
REVOKE CREATE ON SCHEMA app FROM app_gatekeeper;

-- PostgREST met son cache de schéma à jour sur notification.
NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('065_patient_notes_history')
  ON CONFLICT DO NOTHING;

COMMIT;
