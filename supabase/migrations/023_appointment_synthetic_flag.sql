-- 023_appointment_synthetic_flag — répare `app.create_appointment` face au
-- garde-fou ADR-016.
--
-- ═══ CE QUI S'EST PASSÉ ════════════════════════════════════════════════════
--
-- La migration 022 a livré la première VOIE D'ÉCRITURE applicative du dépôt.
-- Elle a donc été la première à rencontrer le garde-fou de 016, et elle est
-- tombée dessus à l'exécution :
--
--   ADR-016 — déploiement cloud-dev : seules les données synthétiques sont
--   acceptées (table app.appointments, is_synthetic doit valoir true).
--
-- 016 pose `is_synthetic boolean NOT NULL DEFAULT false` sur toute table
-- Tier 0/1, et son en-tête dit pourquoi le défaut est `false` : « une insertion
-- distraite ÉCHOUE, elle ne passe pas ». Le garde-fou a fait exactement son
-- travail. Ce n'est pas lui qu'on corrige.
--
-- ⚠️ CE DÉFAUT N'A PAS ÉTÉ VU PAR LE CHECKPOINT S4, et c'est la leçon à retenir
-- de ce fichier. Les dix-neuf contrôles étaient VERTS : aucun n'exerçait le
-- chemin de création. Les contrôles d'écriture vérifiaient tous un REFUS
-- (`update_appointment` refuse `practitioner_id`, un RDV annulé ne bouge plus),
-- et un refus reste vert quand la fonction échoue pour une tout autre raison.
-- Un checkpoint qui ne teste que des refus ne prouve pas que le chemin nominal
-- fonctionne. Le contrôle 20 ajouté plus bas le teste, et il aurait rougi.
--
-- ═══ LA VALEUR EST DÉRIVÉE, JAMAIS DÉCLARÉE PAR L'APPELANT ════════════════
--
-- `is_synthetic := app.is_cloud_dev()`. Trois options ont été pesées :
--
--   RETENU — dériver de l'environnement. La base SAIT où elle tourne ; elle
--   n'a besoin de personne pour le lui dire. En cloud-dev la donnée EST
--   synthétique, parce qu'ADR-016 interdit qu'une donnée réelle y entre ; en
--   auto-hébergé (ADR-001) la valeur devient `false` toute seule, sans qu'une
--   ligne de code change. Aucune affirmation fausse n'est écrite dans aucun des
--   deux environnements.
--
--   REJETÉ — écrire `true` en dur. Le jour de la bascule ADR-001, chaque
--   rendez-vous d'une vraie patiente serait marqué « synthétique ». Un
--   garde-fou qui déclare quelque chose de faux est pire qu'un garde-fou
--   absent : on lui fait confiance. C'est mot pour mot la faute que 015 a
--   corrigée en retirant l'identité réelle de la praticienne.
--
--   REJETÉ — un paramètre passé par l'écran. Un formulaire n'a aucun moyen de
--   savoir sur quelle base il tape, et il répondrait `true` en toutes
--   circonstances. On aurait déplacé le mensonge de la base vers l'interface,
--   là où personne ne le relit.
--
-- ⚠️ LIMITE, ÉCRITE ICI PARCE QU'ELLE EXISTE ET QU'ELLE EST RÉELLE.
-- Tant que `app.deployment` vaut `cloud-dev`, ce garde-fou NE BLOQUE PLUS les
-- écritures de rendez-vous de l'application : elles se déclarent synthétiques
-- toutes seules. Ce qui protège encore l'instance cloud d'une donnée patient
-- réelle n'est donc PAS ce trigger, mais : aucun écran de création de dossier
-- patient n'existe, aucun accès n'est ouvert à la Dr. Larbi (condition 1
-- d'ADR-016), et l'engagement de migrer avant le premier patient réel. Ne pas
-- présenter la couverture de 016 comme totale sur les tables où l'application
-- écrit — elle ne l'est plus. Le trigger continue en revanche d'arrêter net
-- toute écriture par un chemin qui ne passe pas par cette porte.

BEGIN;

-- Le corps est celui de 022, à une affectation près. On le réécrit en entier
-- plutôt que par un correctif partiel : une fonction ne se répare pas à moitié,
-- et la version lisible dans le dernier fichier qui la touche doit être la
-- version qui tourne.
CREATE OR REPLACE FUNCTION app.create_appointment(
  p_patient_id       uuid,
  p_practitioner_id  uuid,
  p_starts_at        timestamptz,
  p_duration_minutes integer,
  p_notes_admin      text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_id     uuid;
  v_source app.appt_source;
BEGIN
  IF p_patient_id IS NULL OR p_practitioner_id IS NULL OR p_starts_at IS NULL THEN
    RAISE EXCEPTION 'Rendez-vous incomplet : patient, praticien et date sont requis.';
  END IF;

  IF p_duration_minutes IS NULL OR p_duration_minutes < 5 OR p_duration_minutes > 240 THEN
    RAISE EXCEPTION 'Durée hors bornes : de 5 à 240 minutes.';
  END IF;

  v_source := CASE WHEN app.current_role() = 'assistant' THEN 'assistant' ELSE 'doctor' END;

  INSERT INTO app.appointments (cabinet_id, practitioner_id, patient_id,
                                starts_at, ends_at, status, source,
                                notes_admin, created_by, is_synthetic)
  VALUES (app.current_cabinet(), p_practitioner_id, p_patient_id,
          p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes),
          'confirmed', v_source,
          nullif(btrim(coalesce(p_notes_admin, '')), ''), auth.uid(),
          -- Dérivé, pas déclaré. Voir l'en-tête de ce fichier.
          app.is_cloud_dev())
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION app.create_appointment(uuid, uuid, timestamptz, integer, text) IS
  'ADR-021. SECURITY INVOKER : aucune élévation. `cabinet_id` vient de la '
  'session, `source` du rôle, `is_synthetic` de l''environnement (ADR-016) — '
  'aucune de ces trois valeurs n''est choisie par l''appelant.';

NOTIFY pgrst, 'reload schema';

INSERT INTO app.schema_migrations (version) VALUES ('023_appointment_synthetic_flag')
  ON CONFLICT DO NOTHING;

COMMIT;
