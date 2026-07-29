#!/usr/bin/env bash
# CHECKPOINT J1-A — les 8 tests d'acceptation du §15 de 01-SCHEMA.md.
# VERT ou ROUGE. Rien entre les deux. Si on ne peut pas prouver, c'est ROUGE.
#
# Prérequis : DATABASE_URL pointant sur la base migrée + seed 015 appliqué.
#   DATABASE_URL="postgresql://postgres:...@127.0.0.1:54322/postgres" bash scripts/checkpoint-j1a.sh

set -uo pipefail
fail=0
echo "CHECKPOINT J1-A"

red()  { printf 'T%-2s %-46s ROUGE  %s\n' "$1" "$2" "$3"; fail=1; }
green(){ printf 'T%-2s %-46s VERT\n' "$1" "$2"; }

if [ -z "${DATABASE_URL:-}" ]; then
  echo "ROUGE — DATABASE_URL non défini. Aucun test n'a pu être exécuté."
  echo "VERDICT : ROUGE — arrêt de la progression"
  exit 1
fi
if ! command -v psql >/dev/null 2>&1; then
  echo "ROUGE — psql introuvable. Aucun test n'a pu être exécuté."
  echo "VERDICT : ROUGE — arrêt de la progression"
  exit 1
fi

q() { psql "$DATABASE_URL" -qtAX -c "$1" 2>&1; }

# --- résolution des identifiants issus du seed 015 ------------------------------
CABINET=$(q "SELECT id FROM app.cabinets ORDER BY created_at LIMIT 1;")
ASSISTANT=$(q "SELECT id FROM app.profiles WHERE role='assistant' AND is_active LIMIT 1;")
OWNER=$(q "SELECT id FROM app.profiles WHERE role='owner' AND is_active LIMIT 1;")
DR2=$(q "SELECT id FROM app.profiles WHERE role='practitioner' AND is_active LIMIT 1;")
PATIENT=$(q "SELECT id FROM app.patients LIMIT 1;")
LOCKED_NOTE=$(q "SELECT id FROM app.clinical_notes WHERE signed_at IS NOT NULL ORDER BY signed_at LIMIT 1;")

uuid_ok() { printf '%s' "$1" | grep -Eq '^[0-9a-f-]{36}$'; }

# --- T1 : l'assistante ne voit AUCUNE note clinique ----------------------------
if uuid_ok "$ASSISTANT"; then
  n=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$ASSISTANT';
         SELECT count(*) FROM app.clinical_notes; ROLLBACK;" | tail -1)
  [ "$n" = "0" ] && green 1 "assistante → notes cliniques" || red 1 "assistante → notes cliniques" "attendu=0 obtenu=$n"
else
  red 1 "assistante → notes cliniques" "profil assistant introuvable (seed 015 ?)"
fi

# --- T2 : la Dr. #2 ne voit pas les patients de la Dr. Larbi -------------------
if uuid_ok "$DR2"; then
  n=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2';
         SELECT count(*) FROM app.patients WHERE practitioner_id <> '$DR2'; ROLLBACK;" | tail -1)
  [ "$n" = "0" ] && green 2 "cloison praticiens" || red 2 "cloison praticiens" "attendu=0 obtenu=$n"
else
  red 2 "cloison praticiens" "profil practitioner introuvable (seed 015 ?)"
fi

# --- T3 : une note signée et verrouillée est immuable --------------------------
if uuid_ok "$LOCKED_NOTE"; then
  out=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
           UPDATE app.clinical_notes SET subjective='modifié' WHERE id='$LOCKED_NOTE'; ROLLBACK;")
  printf '%s' "$out" | grep -qi 'ERROR\|exception\|verrou' \
    && green 3 "note signée immuable" || red 3 "note signée immuable" "attendu=EXCEPTION obtenu=succès"
else
  red 3 "note signée immuable" "aucune note signée en base — test non prouvable"
fi

# --- T4 : impossible de supprimer une note -------------------------------------
note=$(q "SELECT id FROM app.clinical_notes LIMIT 1;")
if uuid_ok "$note"; then
  q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
     DELETE FROM app.clinical_notes WHERE id='$note'; COMMIT;" >/dev/null 2>&1
  n=$(q "SELECT count(*) FROM app.clinical_notes WHERE id='$note';" | tail -1)
  [ "$n" = "1" ] && green 4 "suppression de note impossible" || red 4 "suppression de note impossible" "attendu=1 obtenu=$n"
else
  red 4 "suppression de note impossible" "aucune note en base — test non prouvable"
fi

# --- T5 : numérotation sans trou sous concurrence ------------------------------
if uuid_ok "$CABINET"; then
  period="test-$$"
  seq 1 100 | xargs -P 20 -I{} psql "$DATABASE_URL" -qtAX \
    -c "SELECT app.next_number('$CABINET','payment','$period');" >/dev/null 2>&1
  v=$(q "SELECT current_value FROM app.counters
         WHERE cabinet_id='$CABINET' AND scope='payment' AND period='$period';" | tail -1)
  q "DELETE FROM app.counters WHERE cabinet_id='$CABINET' AND scope='payment' AND period='$period';" >/dev/null 2>&1
  [ "$v" = "100" ] && green 5 "next_number 100x concurrent" || red 5 "next_number 100x concurrent" "attendu=100 obtenu=$v"
else
  red 5 "next_number 100x concurrent" "cabinet introuvable (seed 015 ?)"
fi

# --- T6 : Jarvis ne peut pas exécuter sans confirmation ------------------------
if uuid_ok "$CABINET" && uuid_ok "$OWNER"; then
  out=$(q "BEGIN; INSERT INTO app.jarvis_actions
             (cabinet_id, actor_id, conversation_id, user_utterance, tool_name, tool_args, state, confirmed_at)
           VALUES ('$CABINET','$OWNER',gen_random_uuid(),'test','create_appointment','{}'::jsonb,'executed',NULL);
           ROLLBACK;")
  printf '%s' "$out" | grep -qi 'ERROR\|violat' \
    && green 6 "executed sans confirmed_at refusé" || red 6 "executed sans confirmed_at refusé" "attendu=violation obtenu=succès"
else
  red 6 "executed sans confirmed_at refusé" "cabinet/owner introuvable (seed 015 ?)"
fi

# --- T7 : l'assistante ne voit pas le motif ------------------------------------
out=$(q "SELECT reason FROM app.appointments_admin LIMIT 1;")
printf '%s' "$out" | grep -qi 'ERROR\|does not exist\|n.existe pas' \
  && green 7 "appointments_admin sans reason" || red 7 "appointments_admin sans reason" "la colonne reason est exposée"

# --- T8 : l'audit capture les modifications ------------------------------------
if uuid_ok "$PATIENT"; then
  q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
     UPDATE app.patients SET phone='0555000000' WHERE id='$PATIENT'; COMMIT;" >/dev/null 2>&1
  cf=$(q "SELECT changed_fields::text FROM audit.log ORDER BY occurred_at DESC LIMIT 1;" | tail -1)
  printf '%s' "$cf" | grep -q 'phone' \
    && green 8 "audit.log capture le champ modifié" || red 8 "audit.log capture le champ modifié" "attendu={phone} obtenu=$cf"
else
  red 8 "audit.log capture le champ modifié" "aucun patient en base — test non prouvable"
fi

echo
if [ $fail -eq 0 ]; then
  echo "VERDICT : VERT"
else
  echo "VERDICT : ROUGE — arrêt de la progression"
fi
exit $fail
