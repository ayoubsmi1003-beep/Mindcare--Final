#!/usr/bin/env bash
# CHECKPOINT S5 — la séance, la note clinique, et le verrou qui porte la valeur
# juridique du dossier. VERT ou ROUGE. Rien entre les deux.
#
#   bash scripts/checkpoint-s5.sh
#
# TROIS VERDICTS, comme S4 :
#   VERT   — tous les contrôles ont été exécutés et passent.
#   ROUGE  — au moins un contrôle exécuté a échoué.
#   BLOQUÉ — les contrôles STATIQUES passent, mais ceux qui exigent la base
#            n'ont pas pu être exécutés. Ce n'est PAS un vert (code 2).
#
# ═══ LA LEÇON DE 023, APPLIQUÉE ICI DÈS L'ÉCRITURE ════════════════════════════
# Dix-neuf contrôles S4 étaient VERTS pendant que `create_appointment` ne créait
# rien : tous vérifiaient un REFUS, et un refus reste vert quand la fonction
# échoue pour une tout autre raison. Dans ce fichier, CHAQUE refus vérifié est
# accompagné du succès correspondant : 13 répond à 14, 17 à 18, 19 à 20, 22 à 21
# et 24 à 25. Retirer l'un des succès rendrait son refus ininterprétable.
#
# ⚠️ SECOND PIÈGE DE MESURE, PAYÉ ICI. Une écriture faite par une fonction
# appelée DANS une instruction n'est pas visible du SELECT qui l'englobe — ni
# depuis un CTE, dont toutes les branches partagent le même instantané. Quatre
# contrôles rendaient 0 sur des portes parfaitement fonctionnelles, ce qui
# envoie corriger du code qui marche. L'identifiant transite donc par une table
# temporaire, et l'appel est TOUJOURS une instruction séparée de sa relecture.
#
# psql n'est pas installé sur ce poste : les contrôles base passent par un
# conteneur jetable, comme db-migrate.sh. LE SECRET N'EST JAMAIS AFFICHÉ.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
blocked=0
n=0
echo "CHECKPOINT S5"
echo

green() { n=$((n+1)); printf '%-2s %-58s VERT\n' "$n" "$1"; }
red()   { n=$((n+1)); printf '%-2s %-58s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
skip()  { n=$((n+1)); printf '%-2s %-58s BLOQUÉ %s\n' "$n" "$1" "$2"; blocked=1; }

# ═══ CONTRÔLES STATIQUES — toujours exécutés ══════════════════════════════════

# 1 · aucune table clinique lue en direct depuis src/ (ADR-019, ADR-021).
#     Ces cinq tables n'ont AUCUNE policy assistante : les lire par PostgREST
#     fonctionnerait pour la praticienne tout en produisant des lectures de
#     dossier SANS trace d'audit — le chemin exact qu'ADR-019 a fermé.
out=$(grep -rnE "relation:[[:space:]]*[\"'](consultations|clinical_notes|clinical_note_amendments|transcript_segments|live_insights)[\"']|from\([\"'](consultations|clinical_notes|clinical_note_amendments|transcript_segments|live_insights)[\"']\)" \
        --include="*.ts" --include="*.tsx" src/ 2>/dev/null)
[ -z "$out" ] && green "aucune table clinique lue en direct dans src/" \
              || red "table clinique lue en direct" "$(printf '%s' "$out" | head -1)"

# 2 · aucun outil interdit nommé dans src/ (CLAUDE.md).
#     `sign_note` est la porte de l'interface, appelée après un clic humain ;
#     `sign_clinical_note` est l'outil Jarvis INTERDIT. Le second ne doit
#     exister nulle part — et le jour où quelqu'un l'écrit, c'est ici qu'on le
#     voit, pas en revue de code six semaines plus tard.
out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
        $(find src -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null) 2>/dev/null \
      | grep -nE "sign_clinical_note|delete_clinical_note|execute_sql|export_patient_data")
[ -z "$out" ] && green "aucun outil interdit nommé dans src/" \
              || red "outil interdit nommé dans src/" "$(printf '%s' "$out" | head -1)"

# 3 · le motif de consultation reste absent du front (ADR-017), y compris de
#     l'écran de consultation — c'est l'écran qui aurait le plus de raisons
#     apparentes de le vouloir.
out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
        $(find src -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null) 2>/dev/null \
      | grep -nE "appointment_reasons|appointmentReasons")
[ -z "$out" ] && green "motif de consultation absent de src/ (ADR-017)" \
              || red "motif de consultation référencé dans src/" "$(printf '%s' "$out" | head -1)"

# 4 · un seul import de Supabase dans tout src/ (I3, ADR-020).
out=$(grep -rln "@supabase/supabase-js\|@supabase/ssr" --include="*.ts" --include="*.tsx" src/ 2>/dev/null \
      | grep -v "^src/services/db/supabase.ts$")
[ -z "$out" ] && green "un seul import Supabase (adaptateur)" \
              || red "import Supabase hors adaptateur" "$(printf '%s' "$out" | tr '\n' ' ')"

# 5 · l'écran de consultation existe et prend ses libellés dans i18n (I8).
ECRAN="src/app/consultation/[id]/page.tsx"
if [ ! -f "$ECRAN" ]; then
  red "l'écran de consultation existe" "absent : $ECRAN"
elif ! grep -q "fr\." "$ECRAN" 2>/dev/null; then
  red "écran consultation : libellés depuis i18n" "aucun passage par fr."
else
  green "écran consultation : libellés depuis src/i18n/fr.ts"
fi

# 6 · aucune décision d'autorisation dans l'écran de consultation (règle 4).
out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
        "$ECRAN" 2>/dev/null \
      | grep -nE 'role[[:space:]]*===[[:space:]]*"(assistant|owner|practitioner)"')
[ -z "$out" ] && green "écran consultation : aucune décision de rôle en JavaScript" \
              || red "décision de rôle dans l'écran consultation" "$(printf '%s' "$out" | head -1)"

# 7 · UNE SEULE définition de la fenêtre de verrouillage côté interface.
#     C'est la leçon de `repartition()` en S4 : deux calculs pour une même
#     vérité divergent toujours. `lock_after` / `lockAfter` ne doit être
#     interprété QUE dans src/services/consultations.ts ; partout ailleurs on
#     lit `noteEstVerrouillee`. Un écran qui recalcule la fenêtre afficherait un
#     jour « modifiable » sur une note que la base refuse d'écrire.
out=$(grep -rln "lockAfter\|lock_after" --include="*.ts" --include="*.tsx" src/ 2>/dev/null \
      | grep -v "^src/services/consultations.ts$")
[ -z "$out" ] && green "fenêtre de verrouillage : une seule source de vérité" \
              || red "fenêtre de verrouillage recalculée ailleurs" "$(printf '%s' "$out" | tr '\n' ' ')"

# 8 · les quatre portes du dépôt.
for gate in "pnpm typecheck" "pnpm lint" "pnpm build"; do
  if $gate >/dev/null 2>&1; then green "$gate"; else red "$gate" "voir la sortie complète"; fi
done
if bash scripts/preflight.sh >/dev/null 2>&1; then green "preflight muet"; else red "preflight" "sortie non vide"; fi

# ═══ CONTRÔLES BASE — exigent 026 appliquée ═══════════════════════════════════

# shellcheck source=scripts/lib/dburl.sh
. scripts/lib/dburl.sh
DBURL=$(resolve_dburl)

qfull(){ docker run --rm -e PGURL="$DBURL" -e SQL="$1" postgres:15 \
           sh -c 'psql "$PGURL" -qtAX -c "$SQL"' 2>&1; }
q()    { qfull "$1" | tail -1; }
denied(){ printf '%s\n' "$1" | grep -qiE 'permission denied|droit'; }
refused(){ printf '%s\n' "$1" | grep -qiE 'ERROR|ERREUR'; }

# SONDE DE CONNEXION AVANT TOUT. Une base injoignable n'est pas un garde-fou qui
# cède : ROUGE enverrait chercher un défaut de sécurité là où il n'y a qu'un
# démon Docker arrêté.
reachable=0
if [ -n "$DBURL" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  [ "$(q "SELECT 1;")" = "1" ] && reachable=1
fi

LIB_BASE=(
  "026 appliquée et les neuf portes présentes"
  "start_consultation OUVRE réellement une séance"
  "deuxième séance ouverte refusée (one_open_consult)"
  "reprise : le même rendez-vous rend la même séance"
  "get_consultation : exactement 1 ligne d'audit, contexte fiche"
  "save_note ÉCRIT réellement les quatre champs SOAP"
  "save_note refuse une clé hors allowlist (status)"
  "sign_note SIGNE, et la base pose signed_at/by/lock_after"
  "sign_note refuse une note vide"
  "note verrouillée : UPDATE direct refusé (I15)"
  "note en fenêtre de 15 min : correction ACCEPTÉE"
  "DELETE sur clinical_notes reste sans effet (ADR-004)"
  "amend_note AJOUTE, et la note d'origine ne bouge pas"
  "amend_note refuse un brouillon"
  "get_consultation appartient à app_gatekeeper, sans BYPASSRLS"
  "cloison : l'assistante ne voit aucune séance, aucune note"
  "cloison : la Dr #2 ne voit pas la séance de la Dr #1"
  "aucune séance sans rendez-vous (ADR-003, garde de 026)"
)

if [ $reachable -eq 0 ]; then
  for t in "${LIB_BASE[@]}"; do skip "$t" "base injoignable"; done
else

  OWNER='00000000-0000-0000-0000-0000000000a1'
  DR2='00000000-0000-0000-0000-0000000000a2'
  ASSISTANT='00000000-0000-0000-0000-0000000000a3'
  PAT='00000000-0000-0000-0000-0000000000b1'
  # Le rendez-vous du seed 015 : praticienne a1, patiente b1, `confirmed`.
  # `start_consultation` EXIGE un rendez-vous depuis 026 — c'est lui qui prouve
  # que le dossier relève de l'appelante (ADR-003).
  APPT='00000000-0000-0000-0000-0000000000d1'
  NOTE_SEED='00000000-0000-0000-0000-0000000000c1'

  # Préfixe réutilisé : se placer dans la peau d'un rôle applicatif. `SET LOCAL`
  # meurt avec la transaction, et TOUTES les transactions de ce fichier sont
  # annulées — un checkpoint ne laisse aucune trace dans un dossier médical.
  as_owner="SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';"

  # ⚠️ UN CHECKPOINT NE DÉPEND PAS DE L'ÉTAT AMBIANT. `one_open_consult`
  # n'autorise qu'une séance ouverte par praticienne : une séance laissée
  # ouverte par un essai à l'écran faisait échouer SEPT contrôles d'un coup,
  # avec des messages qui envoyaient chercher un défaut dans les portes. On
  # referme donc les séances ouvertes AU DÉBUT de chaque transaction — qui est
  # toujours annulée, donc rien ne persiste et aucun dossier n'est touché.
  frais="$as_owner UPDATE app.consultations SET status='closed', ended_at=now()
         WHERE practitioner_id='$OWNER' AND status='open';"

  # 9 · la migration est là, et les neuf portes avec elle. Sans ce contrôle, les
  #     suivants rendraient des rouges illisibles (« function does not exist »).
  cnt=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
           WHERE nsp.nspname='app' AND p.proname IN
             ('start_consultation','get_open_consultation','save_raw_notes',
              'close_consultation','save_note','sign_note','amend_note',
              'list_amendments','get_consultation');")
  [ "$cnt" = "9" ] && green "${LIB_BASE[0]}" \
                   || red "${LIB_BASE[0]}" "fonctions trouvées : $cnt/9"

  # 10 · LE CHEMIN NOMINAL. Le contrôle qui manquait à S4, écrit en premier ici.
  #      On ouvre une séance et on vérifie qu'une LIGNE EXISTE — pas qu'un appel
  #      n'a pas levé. `is_synthetic` est vérifié dans le même souffle : c'est
  #      le garde-fou d'ADR-016 que 023 a rencontré, et cette porte est la
  #      première écriture clinique du dépôt.
  #      ⚠️ L'APPEL ET LA RELECTURE SONT DEUX INSTRUCTIONS, ET C'EST OBLIGATOIRE.
  #      Une première version écrivait `WHERE c.id = app.start_consultation(…)` :
  #      la ligne insérée par la fonction n'est pas visible du SELECT qui
  #      l'englobe — même instantané — et le contrôle rendait 0 sur des portes
  #      parfaitement fonctionnelles. Un checkpoint qui rougit à tort est aussi
  #      nuisible qu'un checkpoint qui verdit à tort : il envoie corriger du
  #      code qui marche. L'identifiant transite donc par une table temporaire.
  res=$(qfull "BEGIN; $frais
    CREATE TEMP TABLE s AS SELECT app.start_consultation('$PAT', '$APPT') AS id;
    SELECT count(*) FROM app.consultations c, s
     WHERE c.id = s.id AND c.status='open' AND c.practitioner_id='$OWNER'
       AND c.is_synthetic = app.is_cloud_dev();
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$res" = "1" ] && green "${LIB_BASE[1]}" \
                   || red "${LIB_BASE[1]}" "séance créée et conforme : $res (attendu 1)"

  # 11 · le refus correspondant. Deux séances ouvertes pour une praticienne
  #      voudraient dire deux patients dans le même bureau.
  #      Le SECOND rendez-vous est créé pour l'occasion : rejouer le même
  #      rendez-vous déclencherait la REPRISE (contrôle 12), pas le refus.
  out=$(qfull "BEGIN; $frais
    SELECT app.start_consultation('$PAT', '$APPT');
    SELECT app.start_consultation('$PAT',
      app.create_appointment('$PAT', '$OWNER', now() + interval '3 days', 30));
    ROLLBACK;")
  refused "$out" && green "${LIB_BASE[2]}" \
                 || red "${LIB_BASE[2]}" "une deuxième séance a été ouverte"

  # 12 · LA REPRISE. Un rechargement de page ne doit pas heurter l'unicité :
  #      la porte rend la séance déjà ouverte quand c'est le même rendez-vous.
  #      Sans ce contrôle, le contrôle 11 seul pousserait à « corriger » la
  #      reprise en la supprimant.
  res=$(qfull "BEGIN; $frais
    SELECT count(DISTINCT x) FROM (
      SELECT app.start_consultation('$PAT', '$APPT') AS x
      UNION ALL
      SELECT app.start_consultation('$PAT', '$APPT')) t;
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$res" = "1" ] && green "${LIB_BASE[3]}" \
                   || red "${LIB_BASE[3]}" "identifiants distincts rendus : $res (attendu 1)"

  # 13 · LA FAILLE REFERMÉE EN RELECTURE, et le contrôle qui l'empêche de
  #      revenir. Sans rendez-vous, `p_patient_id` était libre : le WITH CHECK de
  #      `consultations_clinical` (007) ne porte que sur `practitioner_id`, donc
  #      une praticienne pouvait ouvrir une séance — puis écrire une note — sur
  #      le dossier d'une patiente de sa consœur. Aucune identité ne fuyait,
  #      mais une note signée par la mauvaise praticienne est un faux, et 008 la
  #      rendrait ineffaçable.
  out=$(qfull "BEGIN; $frais SELECT app.start_consultation('$PAT', NULL); ROLLBACK;")
  refused "$out" && green "${LIB_BASE[17]}"                  || red "${LIB_BASE[17]}" "une séance sans rendez-vous a été ouverte"

  # 14 · L'AUDIT. Ouvrir une séance EST une ouverture de dossier : contexte
  #      `fiche`, avec le patient nommé, exactement UNE ligne. La preuve I4 de
  #      S3 (« une fiche ouverte = +1 ligne ») doit rester vraie après S5.
  #      Le comptage sort du rôle applicatif : `audit.log` n'est lisible que par
  #      le propriétaire (policy `audit_read_owner`).
  delta=$(qfull "BEGIN;
    CREATE TEMP TABLE avant AS SELECT count(*) c FROM audit.log WHERE operation='select';
    $frais
    SELECT count(*) FROM app.get_consultation(app.start_consultation('$PAT', '$APPT'));
    RESET ROLE;
    SELECT (SELECT count(*) FROM audit.log WHERE operation='select') - (SELECT c FROM avant);
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  ctx=$(qfull "BEGIN; $frais
    SELECT count(*) FROM app.get_consultation(app.start_consultation('$PAT', '$APPT'));
    RESET ROLE;
    SELECT changed_fields[1] || ':' || coalesce(patient_id::text,'NULL')
      FROM audit.log WHERE operation='select' ORDER BY id DESC LIMIT 1;
    ROLLBACK;" | grep -E '^[a-z]+:' | tail -1)
  # La séance ouverte compte pour 1 ligne `fiche` ; `start_consultation` n'en
  # produit aucune (elle ne nomme personne).
  if [ "$delta" = "1" ] && [ "$ctx" = "fiche:$PAT" ]; then
    green "${LIB_BASE[4]}"
  else
    red "${LIB_BASE[4]}" "delta=$delta trace=$ctx (attendu 1 / fiche:$PAT)"
  fi

  # 14 · LE CHEMIN NOMINAL DE LA NOTE. Les quatre champs, relus depuis la table.
  #      Même précaution qu'au contrôle 10 : l'écriture et sa relecture sont
  #      deux instructions. Un CTE ne suffit PAS — toutes ses branches partagent
  #      l'instantané de l'instruction, donc la note créée y est invisible.
  res=$(qfull "BEGIN; $frais
    CREATE TEMP TABLE s AS SELECT app.start_consultation('$PAT', '$APPT') AS id;
    CREATE TEMP TABLE n AS SELECT app.save_note((SELECT id FROM s),
      '{\"subjective\":\"S\",\"objective\":\"O\",\"assessment\":\"A\",\"plan\":\"P\"}') AS id;
    SELECT count(*) FROM app.clinical_notes cn, n
     WHERE cn.id = n.id AND cn.status='draft'
       AND cn.subjective='S' AND cn.objective='O'
       AND cn.assessment='A' AND cn.plan='P';
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$res" = "1" ] && green "${LIB_BASE[5]}" \
                   || red "${LIB_BASE[5]}" "note relue conforme : $res (attendu 1)"

  # 15 · le refus correspondant. `status` dans la charge signerait la note par
  #      une modification de routine, sans le geste qui engage sa responsabilité.
  out=$(qfull "BEGIN; $frais
    SELECT app.save_note(app.start_consultation('$PAT', '$APPT'), '{\"status\":\"signed\"}');
    ROLLBACK;")
  refused "$out" && green "${LIB_BASE[6]}" \
                 || red "${LIB_BASE[6]}" "la porte a accepté la clé status"

  # 16 · LA SIGNATURE, ET CE QUE LA BASE POSE TOUTE SEULE. `sign_note` n'écrit
  #      ni signed_at, ni signed_by, ni lock_after : `trg_note_sign` le fait.
  #      Si ce contrôle rougit sur `lock_after`, c'est que quelqu'un a dupliqué
  #      l'horodatage de signature — donc que le document légal peut mentir.
  res=$(qfull "BEGIN; $frais
    CREATE TEMP TABLE s AS SELECT app.start_consultation('$PAT', '$APPT') AS id;
    CREATE TEMP TABLE n AS SELECT app.save_note((SELECT id FROM s), '{\"subjective\":\"S\"}') AS id;
    SELECT app.sign_note((SELECT id FROM n));
    SELECT count(*) FROM app.clinical_notes cn, n
     WHERE cn.id = n.id AND cn.status='signed'
       AND cn.signed_at IS NOT NULL AND cn.signed_by='$OWNER'
       AND cn.lock_after > cn.signed_at + interval '14 minutes'
       AND cn.lock_after < cn.signed_at + interval '16 minutes';
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$res" = "1" ] && green "${LIB_BASE[7]}" \
                   || red "${LIB_BASE[7]}" "note signée conforme : $res (attendu 1)"

  # 17 · le refus correspondant. Une note signée sans contenu atteste de rien et
  #      se retourne contre la praticienne : le dossier affirme qu'une
  #      consultation a été documentée.
  out=$(qfull "BEGIN; $frais
    SELECT app.sign_note(app.save_note(app.start_consultation('$PAT', '$APPT'), '{\"plan\":\"\"}'));
    ROLLBACK;")
  refused "$out" && green "${LIB_BASE[8]}" \
                 || red "${LIB_BASE[8]}" "une note vide a été signée"

  # 18 · LE VERROU, PAR UPDATE DIRECT — sans passer par aucune porte. C'est le
  #      seul test qui prouve que Jarvis, un script de reprise et le futur front
  #      assistante butent dessus eux aussi. La note du seed 015 est signée et
  #      verrouillée depuis un jour : c'est exactement le cas du checkpoint S5
  #      du sprint (« signer, attendre 16 min, tenter une modification »), sans
  #      attendre seize minutes réelles.
  out=$(qfull "BEGIN; $as_owner
    UPDATE app.clinical_notes SET subjective='réécrite' WHERE id='$NOTE_SEED';
    ROLLBACK;")
  refused "$out" && green "${LIB_BASE[9]}" \
                 || red "${LIB_BASE[9]}" "une note verrouillée a été réécrite"

  # 19 · LE SUCCÈS CORRESPONDANT, et il compte autant. La fenêtre de 15 minutes
  #      est un DISPOSITIF CLINIQUE d'I15, pas une tolérance : elle signe, le
  #      patient sort, elle corrige une posologie dans la minute. Un checkpoint
  #      qui ne vérifierait que le refus laisserait passer un verrou fermé trop
  #      tôt — c'est-à-dire une correction légitime devenue impossible.
  res=$(qfull "BEGIN; $frais
    CREATE TEMP TABLE s AS SELECT app.start_consultation('$PAT', '$APPT') AS id;
    CREATE TEMP TABLE n AS SELECT app.save_note((SELECT id FROM s), '{\"subjective\":\"avant\"}') AS id;
    SELECT app.sign_note((SELECT id FROM n));
    SELECT app.save_note((SELECT id FROM s), '{\"subjective\":\"corrigée\"}');
    SELECT count(*) FROM app.clinical_notes cn, n
     WHERE cn.id = n.id AND cn.subjective='corrigée' AND cn.status='signed';
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$res" = "1" ] && green "${LIB_BASE[10]}" \
                   || red "${LIB_BASE[10]}" "correction en fenêtre acceptée : $res (attendu 1)"

  # 20 · la règle `no_delete_notes` (008). DO INSTEAD NOTHING ne lève PAS : elle
  #      ne fait rien. Un test qui chercherait une exception rendrait rouge sur
  #      un garde-fou qui fonctionne. On compte les lignes après coup.
  res=$(qfull "BEGIN; $as_owner
    DELETE FROM app.clinical_notes WHERE id='$NOTE_SEED';
    SELECT count(*) FROM app.clinical_notes WHERE id='$NOTE_SEED';
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$res" = "1" ] && green "${LIB_BASE[11]}" \
                   || red "${LIB_BASE[11]}" "la note a disparu après DELETE"

  # 21 · L'AMENDEMENT AJOUTE, IL N'ÉCRASE PAS. On vérifie les deux moitiés dans
  #      la même transaction : l'amendement existe ET le texte d'origine est
  #      intact, mot pour mot. Vérifier seulement la première laisserait passer
  #      une porte qui amende puis réécrit.
  res=$(qfull "BEGIN; $as_owner
    SELECT app.amend_note('$NOTE_SEED', 'Motif de contrôle', 'Corps de contrôle');
    SELECT (SELECT count(*) FROM app.clinical_note_amendments
             WHERE note_id='$NOTE_SEED' AND reason='Motif de contrôle' AND author_id='$OWNER')
         + (SELECT count(*) FROM app.clinical_notes
             WHERE id='$NOTE_SEED' AND subjective='Note de test, signée et verrouillée.');
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$res" = "2" ] && green "${LIB_BASE[12]}" \
                   || red "${LIB_BASE[12]}" "amendement + note intacte : $res (attendu 2)"

  # 22 · le refus correspondant. Un brouillon se corrige ; l'amender produirait
  #      des dossiers où la même correction est tantôt visible, tantôt non.
  out=$(qfull "BEGIN; $frais
    SELECT app.amend_note(
      app.save_note(app.start_consultation('$PAT', '$APPT'), '{\"plan\":\"P\"}'),
      'Motif', 'Corps');
    ROLLBACK;")
  refused "$out" && green "${LIB_BASE[13]}" \
                 || red "${LIB_BASE[13]}" "un brouillon a été amendé"

  # 23 · LE CONTRÔLE QUI AURAIT ARRÊTÉ 018, étendu au clinique. `rolsuper = f`
  #      ne prouve rien : une fonction possédée par un rôle `rolbypassrls` ne
  #      voit AUCUNE policy. Et un DROP emporte le propriétaire — 024/025 l'ont
  #      failli rejouer. On vérifie la propriété ET l'absence de BYPASSRLS.
  proprio=$(qfull "SELECT count(*) FROM pg_proc p
                   JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
                   JOIN pg_roles r ON r.oid=p.proowner
                   WHERE nsp.nspname='app' AND p.proname='get_consultation'
                     AND r.rolname='app_gatekeeper' AND NOT r.rolbypassrls
                     AND NOT r.rolsuper;" | grep -E '^[0-9]+$' | tail -1)
  bad=$(qfull "SELECT coalesce(string_agg(p.proname, ', '), '')
               FROM pg_proc p
               JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
               JOIN pg_roles r ON r.oid = p.proowner
               WHERE nsp.nspname='app' AND p.prosecdef
                 AND (p.prosrc LIKE '%app.consultations%' OR p.prosrc LIKE '%app.clinical_notes%')
                 AND (r.rolsuper OR r.rolbypassrls);" | grep -vE '^\s*$' | tail -1)
  if [ "$proprio" = "1" ] && [ -z "$bad" ]; then
    green "${LIB_BASE[14]}"
  else
    red "${LIB_BASE[14]}" "propriété=$proprio portes élevées=[$bad]"
  fi

  # 24 · LA CLOISON ASSISTANTE — le test T1 du §15, par le vecteur RÉEL de S5.
  #      Ces tables n'ont AUCUNE policy assistante : elle ne voit rien, même par
  #      les portes. Deux mesures, parce qu'une seule ne prouverait rien : la
  #      porte de lecture ET la table en SQL direct.
  as_assist="SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$ASSISTANT';"
  vues=$(q "BEGIN; $as_assist SELECT count(*) FROM app.consultations; ROLLBACK;")
  notes=$(q "BEGIN; $as_assist SELECT count(*) FROM app.clinical_notes; ROLLBACK;")
  if [ "$vues" = "0" ] && [ "$notes" = "0" ]; then
    green "${LIB_BASE[15]}"
  else
    red "${LIB_BASE[15]}" "séances vues=$vues notes vues=$notes (attendu 0 / 0)"
  fi

  # 25 · LA CLOISON ENTRE PRATICIENNES (ADR-003). La séance est ouverte par la
  #      Dr Larbi ; la Dr #2 ne doit pas la lire. C'est la propriété que 018
  #      avait fait tomber sans que rien ne le signale.
  vues2=$(qfull "BEGIN; $frais
    CREATE TEMP TABLE cible AS SELECT app.start_consultation('$PAT', '$APPT') AS id;
    RESET ROLE;
    SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2';
    SELECT count(*) FROM app.consultations c, cible WHERE c.id = cible.id;
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  [ "$vues2" = "0" ] && green "${LIB_BASE[16]}" \
                     || red "${LIB_BASE[16]}" "la Dr #2 voit $vues2 séance(s) de la Dr #1"
fi

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — arrêt de la progression. Corriger la cause, pas le contrôle."
  exit 1
fi
if [ $blocked -ne 0 ]; then
  echo "VERDICT : BLOQUÉ — les contrôles statiques passent, ceux qui exigent la base"
  echo "          n'ont pas pu s'exécuter. CE N'EST PAS UN VERT : ne pas commiter S5"
  echo "          sur cette base. Démarrer Docker, appliquer 026, puis rejouer."
  exit 2
fi
echo "VERDICT : VERT — $n contrôles."
exit 0
