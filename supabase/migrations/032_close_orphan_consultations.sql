-- 032_close_orphan_consultations — V1.3 (SPRINT-V1.md §V1.3).
--
-- ⚠️ PORTÉE RÉELLE PAR RAPPORT AU CHECKLIST DE §V1.3. La ligne exacte de
-- `docs/SPRINT-V1.md` (§V1.3) est : « Séances orphelines existantes :
-- clôturées par migration datée, jamais supprimées. » Cette case N'EST PAS
-- cochée par ce fichier, ni par aucune migration : automatiser la clôture de
-- la séance identifiée par l'inventaire du 2026-08-10 par un script exécuté
-- par un agent a été refusé par le classificateur de permissions de la
-- session (écriture non supervisée sur une donnée réelle de production).
--
-- Une procédure SQL MANUELLE existe, documentée dans `STATE.md` section
-- "GESTE MANUEL" — mais son exécution a rendu ZÉRO ligne modifiée : la
-- consultation ciblée était DÉJÀ dans l'état visé (`status='closed'`,
-- `ended_at` NULL) au moment où la procédure a été lancée, PAR UNE CAUSE
-- NON IDENTIFIÉE, non tracée par cette procédure ni par aucune migration.
-- `app.appointments` associé n'a PAS été recontrôlé (lecture seule restant à
-- faire, voir `STATE.md`).
--
-- `SPRINT-V1.md` (rang 5 de `DOC-AUTHORITY.md` §1) n'est amendé ni par ce
-- commentaire ni par `STATE.md` (rang 6, « périssable, jamais normatif ») :
-- la case du checklist reste NON cochée, à la lettre, tant qu'aucune
-- migration ni aucun geste TRAÇABLE n'a produit cet état — même si l'état
-- constaté, aujourd'hui, correspond au résultat visé. Ce que CE fichier
-- remplit réellement du §V1.3 : le garde-fou contre la récidive, ci-dessous.
--
-- Historique de revue adversariale : voir `STATE.md`, section "Step 10-11".
-- AUCUN décompte de passes n'est répété ici — un décompte écrit dans un
-- commentaire SQL devient faux à la revue suivante, et deux versions
-- antérieures de ce fichier l'ont prouvé. Ce commentaire décrit ce que le
-- code FAIT et POURQUOI, une fois pour toutes ; il ne raconte pas comment on
-- y est arrivé.
--
-- Le désaccord de fond qui a fixé la forme actuelle du fichier : cibler un
-- `id` de PRODUCTION dans un fichier dont le CONTRAT est « rejouable sur
-- n'importe quelle base » mélange deux choses incompatibles. Un geste
-- d'exploitation ponctuel (fermer CETTE séance-là, sur CETTE base-là) n'est
-- pas un changement de schéma : il n'a pas sa place dans
-- `supabase/migrations/`, portable ou non, identifiant inclus ou non. Ce
-- geste-là vit dans `STATE.md`, section "GESTE MANUEL" — exécuté et confirmé
-- le 2026-08-10, sans rapport d'exécution avec le code ci-dessous.
--
-- Le rôle qui applique cette migration — `postgres`, via
-- `DATABASE_URL`/`scripts/db-migrate.sh` — a `rolsuper=false` MAIS
-- `rolbypassrls=true`, MESURÉ sur cette base par
-- `019_revert_definer_doors.sql:13-14`, jamais supposé ici. C'est cet
-- attribut précis, et lui seul, qui le fait échapper à
-- `FORCE ROW LEVEL SECURITY` (007:57-58) sur `app.consultations` — pas le
-- fait d'être propriétaire (que `FORCE` soumet explicitement aux policies),
-- et pas un statut superutilisateur qu'il n'a PAS.
--
-- ═══ POURQUOI LE GARDE-FOU CI-DESSOUS EXISTE ════════════════════════════════
--
-- Le 09/08, un chronomètre à l'écran affichait `125:44:26`. `chrono()`
-- (src/app/consultation/[id]/page.tsx) est correcte : elle calcule
-- `maintenant - started_at` et s'arrête déjà à `ended_at`. Ce que le chiffre
-- prouvait, c'est qu'il existe en base des `app.consultations` `status='open'`
-- restées ouvertes des jours durant — une séance ORPHELINE, pas un défaut
-- d'affichage. `one_open_consult` (007) est un index UNIQUE sur
-- `practitioner_id` filtré `status='open'` : tant que cette ligne reste
-- ouverte, LA PRATICIENNE CONCERNÉE NE PEUT PLUS DÉMARRER AUCUNE NOUVELLE
-- SÉANCE. C'est un défaut fonctionnel qui bloque le travail, pas un détail
-- d'affichage.
--
-- ═══ LA SÉMANTIQUE DE `ended_at` — DÉCISION UTILISATEUR EXPLICITE (porte G2) ═
--
-- `ended_at` alimente `duration_seconds`, colonne GÉNÉRÉE de 007
-- (`EXTRACT(EPOCH FROM (ended_at - started_at))`), c'est-à-dire une DURÉE DE
-- CONSULTATION — une donnée clinique, dans un dossier opposable, écrite de
-- façon irréversible (règle 3, aucun DELETE).
--
-- Trois options ont été soumises à l'utilisateur. Décision retenue :
-- **OPTION C — `ended_at` reste NULL.** La base affirme « close, durée
-- inconnue », jamais une durée plausible mais inventée (règle 8 : aucune
-- donnée fictive dans une fonctionnalité livrée). Aucune contrainte SQL
-- n'exige `ended_at NOT NULL` sur une ligne `closed` (007/026 relus avant
-- d'écrire cette migration) : `duration_seconds` devient simplement NULL, ce
-- qui est exactement la vérité — personne ne sait quand une séance orpheline
-- s'est réellement terminée. Le garde-fou ci-dessous applique la même
-- option : il n'écrit jamais `ended_at`.
--
-- Complément identifié PENDANT l'arbitrage, hors du SQL mais nécessaire pour
-- que la correction soit complète : `chrono()` affichait `maintenant` tant
-- que `endedAt===null`, y compris sur une séance déjà `status==='closed'` —
-- ce qui aurait fait courir le chiffre à l'écran indéfiniment et reproduit le
-- symptôme même que cette migration corrige en base. Corrigé côté écran dans
-- le même lot (V1.3e), pas ici : cette migration ne décide que de la donnée.
--
-- ═══ CE QUE CETTE MIGRATION NE FAIT JAMAIS ═════════════════════════════════
--   ❌ aucun DELETE (règle 3)
--   ❌ aucune écriture sur une note dont `locked_at`/`lock_after` n'est pas
--      NULL (ADR-004) — cette migration ne touche PAS `clinical_notes`
--   ❌ aucune table, colonne, type ou valeur d'enum nouveaux (règle 9)
--   ❌ aucun test de rôle applicatif dans la fonction (règle 4 — la RLS décide)
--   ❌ aucune valeur inventée dans `ended_at` (règle 8)
--   ❌ aucun identifiant de production (le geste ponctuel vit dans STATE.md,
--      exécuté manuellement — jamais dans ce fichier)
--
-- ═══ NUMÉROTATION — `031` A ÉTÉ DÉPLACÉ, IL N'EST PLUS UNE MIGRATION ═══════
-- État actuel, vérifié le 2026-08-10 APRÈS déplacement :
--
--     $ ls supabase/migrations/ | grep 031   →  (rien)
--     $ ls docs/ | grep 031                  →  031_seed_document_templates.sql
--
-- ⚠️ CE N'A PAS TOUJOURS ÉTÉ VRAI, et le noter importe plus que le résultat.
-- Une version antérieure de ce paragraphe affirmait déjà cet état — À TORT :
-- le fichier était alors bel et bien dans `supabase/migrations/`. Deux passes
-- de revue adversariale ont « confirmé » l'affirmation fausse en prétendant
-- avoir exécuté ce `ls`. Le défaut n'a été vu qu'au Step 12, quand
-- `verify-migrations.sh` (contrôle 5) a signalé que `031` n'inscrivait pas sa
-- version — contrôle jusque-là MASQUÉ par un faux positif du contrôle 3.
-- Une preuve citée n'est une preuve que si on la rejoue soi-même.
--
-- POURQUOI IL A ÉTÉ SORTI (arbitrage utilisateur, 2026-08-10). `031` est du
-- périmètre V6 (seed des 4 modèles de certificats, S7b phase 2). Il porte
-- `BEGIN;`/`COMMIT;` mais n'inscrit PAS sa version dans
-- `app.schema_migrations`, et son `INSERT INTO app.document_templates` n'a
-- aucun `ON CONFLICT`. Or `scripts/db-migrate.sh` applique
-- `ls migrations/*.sql | sort` en sautant ce qui est déjà inscrit : `031` ne
-- s'inscrivant jamais, il aurait été RÉAPPLIQUÉ À CHAQUE EXÉCUTION, y
-- redéposant ses modèles — et il se triait AVANT `032`, donc appliquer cette
-- migration-ci l'aurait entraîné avec elle. Il est donc déplacé dans `docs/`
-- jusqu'à la session V6, qui le reprendra et le corrigera.
--
-- Le fichier n'a pas été modifié d'un octet (10429 avant et après), il était
-- non suivi par git et le reste. `032` ne dépend de lui en rien.

BEGIN;

-- ---------------------------------------------------------------------------
-- Le garde-fou contre la récidive — rejouable, idempotent, PLANCHÉ
-- ---------------------------------------------------------------------------
-- Pas de `pg_cron` : indisponible en auto-hébergé sans installation
-- supplémentaire, et la porte de livraison (SPRINT-V1.md §0) ne doit pas
-- gagner une dépendance qu'elle n'avait pas. Cette fonction est donc
-- APPELABLE À LA DEMANDE — connectée par `DATABASE_URL`, comme
-- `scripts/db-migrate.sh`, si une maintenance future en a besoin ; AUCUN
-- script de ce genre n'existe aujourd'hui dans ce dépôt, et jamais par un
-- écran de V1 : aucun service TypeScript ne l'invoque dans ce lot (hors
-- périmètre, règle 10).
--
-- `p_threshold` est un paramètre PLANCHÉ EN BASE, dans le corps de la
-- fonction : aucune valeur passée par l'appelant ne peut descendre sous
-- 12 h, quel que soit l'argument (y compris `NULL` ou une valeur négative —
-- `GREATEST` les couvre). Sans ce plancher, `close_stale_consultations
-- (interval '0 seconds')`, appelé par n'importe quelle praticienne
-- authentifiée, aurait fermé sa PROPRE séance vivante ouverte depuis deux
-- minutes — et, appelé par l'owner (`can_see_clinical` rend `true` pour tout
-- le cabinet, 003:55-63), les séances vivantes de TOUTES les praticiennes
-- d'un seul appel. La RLS décide QUELLES LIGNES sont visibles, elle ne dit
-- RIEN d'un seuil temporel — ce n'est pas son rôle, et lui en faire porter un
-- serait le même défaut de conception qu'un `if (role === …)` en application
-- (règle 4, à l'envers). Le paramètre reste utile pour ALLONGER le seuil
-- (une maintenance qui veut ne fermer que ce qui dépasse 48 h, par exemple),
-- jamais pour le raccourcir. Le plancher est conservé même sans GRANT à
-- `authenticated` : une fonction de sécurité ne doit pas dépendre de rester
-- non exposée pour être sûre — c'est la même discipline que la RLS elle-même.
--
-- COMPORTEMENT RÉEL SOUS LE SEUL CHEMIN D'INVOCATION PRÉVU (`postgres` via
-- `DATABASE_URL`, `rolbypassrls=true` — voir l'en-tête de ce fichier) : cette
-- fonction balaie TOUTES les séances orphelines de TOUS les cabinets, sans
-- filtre par `practitioner_id` ni `cabinet_id` — un balayage administratif
-- global, assumé, au même niveau de privilège que l'application de la
-- migration elle-même. Si cette fonction était un jour exposée à un rôle
-- `authenticated` (elle ne l'est pas — voir le `REVOKE ALL … FROM PUBLIC,
-- authenticated` juste après sa définition, plus bas dans ce même fichier), la RLS de 007
-- la scoperait alors par praticienne/cabinet, exactement comme
-- `app.close_consultation`. `SECURITY INVOKER` reste le bon choix : il
-- garantit qu'aucun chemin futur ne peut élever silencieusement les
-- privilèges d'un appelant `authenticated` via cette fonction.
--
-- Complète elle aussi la transition côté rendez-vous, pour la même raison
-- que `app.close_consultation` le fait (026, section « clore la séance »).
--
-- RÉSERVE, NON BLOQUANTE, traitée ici par un commentaire plutôt qu'un
-- mécanisme supplémentaire : `close_consultation` REFUSE bruyamment
-- (`RAISE EXCEPTION`) une séance déjà close, parce qu'un double clic humain
-- sur « Terminer la séance » doit être visible. Cette fonction, elle, IGNORE
-- silencieusement les lignes déjà closes (`WHERE status='open'` les exclut
-- avant même de les toucher) : c'est un balayage de maintenance, pas un geste
-- ponctuel, et son idempotence en dépend. Les deux chemins coexistent avec
-- des règles différentes PARCE QU'ils répondent à des intentions différentes
-- — pas par oubli.
--
-- Idempotente par construction : rejouée sans nouvelle orpheline, son `WHERE`
-- ne trouve plus aucune ligne et elle rend un ensemble vide — aucune erreur,
-- aucun effet second.
CREATE OR REPLACE FUNCTION app.close_stale_consultations(
  p_threshold interval DEFAULT interval '12 hours'
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = app, pg_catalog
AS $$
DECLARE
  v_threshold interval := GREATEST(p_threshold, interval '12 hours');
  v_row       record;
BEGIN
  FOR v_row IN
    UPDATE app.consultations c
       SET status = 'closed'
     WHERE c.status = 'open'
       AND c.started_at < now() - v_threshold
    RETURNING c.id, c.appointment_id
  LOOP
    IF v_row.appointment_id IS NOT NULL THEN
      UPDATE app.appointments a
         SET status = 'completed', updated_at = now()
       WHERE a.id = v_row.appointment_id
         AND a.status NOT IN ('completed', 'cancelled');
    END IF;
    RETURN NEXT v_row.id;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION app.close_stale_consultations(interval) IS
  'V1.3 — clôture administrative des séances restées `open` au-delà du seuil '
  '(12 h PLANCHER, quel que soit l''argument reçu — sans ce plancher, un '
  'seuil sous 12 h aurait fermé une séance vivante). Complète aussi la '
  'transition du rendez-vous en `completed`, comme app.close_consultation. '
  'N''écrit JAMAIS `ended_at` (option C, porte G2 — voir STATE.md). '
  'SECURITY INVOKER : aucune élévation de privilège possible pour '
  'l''appelant. Le rôle `postgres` (DATABASE_URL) a `rolbypassrls=true`, '
  'mesuré sur cette base par 019_revert_definer_doors.sql — donc échappe à '
  'la RLS de 007 et balaie ALORS toutes les séances orphelines de TOUS les '
  'cabinets, sans filtre practitioner_id/cabinet_id — un balayage '
  'administratif global, assumé, pas un défaut. La RLS de 007 ne scoperait '
  'cette fonction que si elle était un jour exposée à un rôle authenticated '
  '— ce qu''elle n''est PAS : un REVOKE ALL ... FROM PUBLIC, authenticated '
  'est appliqué juste après cette déclaration, dans cette même migration. Idempotente, '
  'rejouable. AUCUN appelant actuel dans ce dépôt (grep -rn '
  '"close_stale_consultations" src/ scripts/ -> 0) : provisionnée pour une '
  'maintenance future, connectée par DATABASE_URL, jamais depuis le '
  'navigateur. NE PAS CONFONDRE avec la procédure manuelle de STATE.md '
  '(fermeture ponctuelle du 2026-08-10) : cette dernière n''appelle PAS '
  'cette fonction, elle écrit directement sur un identifiant unique.';

-- Cette section n'accorde RIEN à `authenticated` : une v1 antérieure de cette
-- migration, jamais appliquée nulle part mais dont le texte a existé, en
-- accordait un, exposant la fonction en RPC PostgREST au navigateur,
-- atteignable depuis la console par n'importe quelle praticienne
-- authentifiée, vers une transition IRRÉVERSIBLE
-- (`app.assert_appointment_transition`, 022, rend `'completed'` TERMINAL —
-- aucun retour arrière) — sans qu'aucun appelant réel n'en ait besoin
-- (`grep -rn "close_stale_consultations" src/` → 0).
--
-- ⚠️ `REVOKE ALL … FROM PUBLIC` seul NE SUFFIT PAS à garantir l'absence
-- d'exposition, et l'écrire comme une garantie complète serait exactement le
-- défaut que cette migration existe pour éviter : `PUBLIC` reçoit EXECUTE
-- par défaut sur toute fonction neuve, donc le retirer FERME ce chemin — mais
-- `CREATE OR REPLACE FUNCTION` PRÉSERVE tout GRANT déjà accordé À UN AUTRE
-- rôle. Sur une base où un brouillon aurait un jour posé
-- `GRANT EXECUTE … TO authenticated` (le contrat de ce fichier est d'être
-- rejouable sur N'IMPORTE QUELLE base, y compris une qui porterait cette
-- trace), rejouer cette seule ligne ne le retirerait PAS. Le `REVOKE`
-- ci-dessous cible donc explicitement les deux rôles, `PUBLIC` ET
-- `authenticated` — le second par précaution défensive, même si aucune base
-- connue de ce dépôt n'a jamais accordé ce GRANT.
--
-- Un script de maintenance futur se connecterait par `DATABASE_URL` (comme
-- `scripts/db-migrate.sh`), donc en tant que `postgres` — rôle propriétaire
-- du schéma, PAS superutilisateur (`rolsuper=false`, `rolbypassrls=true`,
-- mesuré par 019, voir l'en-tête de ce fichier) — qui n'a jamais eu besoin
-- d'un GRANT explicite pour exécuter une fonction du schéma qu'il possède.
REVOKE ALL ON FUNCTION app.close_stale_consultations(interval) FROM PUBLIC, authenticated;

-- Pas de NOTIFY pgrst ici : sans GRANT à `authenticated`, PostgREST ne doit
-- exposer aucune route pour cette fonction — un rafraîchissement de cache
-- n'y changerait rien, et son absence documente l'intention plutôt que de
-- suggérer une exposition RPC qui n'existe pas.

INSERT INTO app.schema_migrations (version) VALUES ('032_close_orphan_consultations')
  ON CONFLICT DO NOTHING;

COMMIT;
