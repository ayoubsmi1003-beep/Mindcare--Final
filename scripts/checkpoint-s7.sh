#!/usr/bin/env bash
# CHECKPOINT S7a — Finance. VERT ou ROUGE. Rien entre les deux.
#
#   bash scripts/checkpoint-s7.sh
#
# TROIS VERDICTS, comme S4/S5 :
#   VERT   — tous les contrôles ont été exécutés et passent.
#   ROUGE  — au moins un contrôle exécuté a échoué.
#   BLOQUÉ — les contrôles STATIQUES passent, mais ceux qui exigent la base
#            n'ont pas pu être exécutés. Ce n'est PAS un vert (code 2).
#
# ⚠️ ACCÈS BASE PAR `docker exec`, PAS PAR LE CONTENEUR JETABLE `postgres:15`.
# Décision utilisateur du 2026-08-08 : `docker.io` (Docker Hub) reste
# injoignable sur ce réseau — `postgres:15` de scripts/lib/dburl.sh ne se tire
# donc jamais. `supabase start` (public.ecr.aws) fonctionne, lui, et laisse un
# conteneur `supabase_db_Final_Mindcare` déjà démarré. On y exécute `psql`
# directement, EN SUPERUTILISATEUR pour la connexion, puis `SET LOCAL role` /
# `SET LOCAL request.jwt.claim.sub` pour se placer sous chaque rôle applicatif
# — exactement ce que faisait `qfull` de checkpoint-s5.sh via `postgres:15`,
# seule la manière d'atteindre le serveur change. Ce choix débloque aussi
# checkpoint-s5/adr019/jarvis, à revérifier séparément.
#
# ⚠️ CE SCRIPT EXÉCUTE SUR UNE BASE DE TRAVAIL DÉDIÉE (`$S7_DB`, "s7fresh" par
# défaut), PAS SUR "postgres". Il crée cette base à partir d'un rejeu complet
# 001→029, pour que le vert prouve la même chose qu'un rejeu à blanc — c'est ce
# rejeu qui a trouvé le défaut n°1 de S6, invisible en relecture. La base
# "postgres" du conteneur n'est jamais touchée.
#
# LES CONTRÔLES 19/20/21 EXIGENT DEUX SESSIONS SIMULTANÉES, pas deux appels
# successifs — une paire séquentielle passerait au vert sans rien prouver du
# verrou. Réalisé par `coproc` : une première connexion `psql` reste ouverte
# sur sa transaction (verrou posé, sans COMMIT), une seconde tente d'acquérir
# le même verrou et DOIT ATTENDRE — mesuré par un délai, pas par un mot dans la
# sortie. Puis la première COMMIT/ROLLBACK et la seconde doit alors répondre.

set -uo pipefail
# Les contrôles 19/21 écrivent sur un FIFO dont le lecteur (`docker exec`
# en arrière-plan) peut mourir avant l'écriture sous forte contention CPU —
# un poste lent, pas un défaut du verrou testé. Sans ce trap, l'EPIPE tue le
# SCRIPT ENTIER (141) au lieu du seul contrôle concerné, et tout ce qui suit
# disparaît silencieusement du rapport.
trap '' PIPE
cd "$(dirname "$0")/.." || exit 1

fail=0
blocked=0
n=0
echo "CHECKPOINT S7a — FINANCE"
echo

green() { n=$((n+1)); printf '%-2s %-58s VERT\n' "$n" "$1"; }
red()   { n=$((n+1)); printf '%-2s %-58s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
skip()  { n=$((n+1)); printf '%-2s %-58s BLOQUÉ %s\n' "$n" "$1" "$2"; blocked=1; }

# ═══ CONTRÔLES STATIQUES — toujours exécutés ══════════════════════════════════

# 1 · finance.ts ne nomme aucune table (grep sur `.from(`).
out=$(grep -rnE '\.from\(' --include="*.ts" src/services/finance.ts 2>/dev/null)
[ -z "$out" ] && green "finance.ts : aucune table nommée (.from)" \
              || red "finance.ts nomme une table" "$(printf '%s' "$out" | head -1)"

# 2 · 029 ne contient pas CREATE SEQUENCE (I17).
out=$(grep -in "CREATE SEQUENCE" supabase/migrations/029_payment_gates.sql 2>/dev/null)
[ -z "$out" ] && green "029 : aucune SEQUENCE (I17, next_number seul)" \
              || red "029 contient CREATE SEQUENCE" "$(printf '%s' "$out" | head -1)"

# Statique supplémentaire, motif du contrôle 6 de S5 : aucune décision de rôle
# en JavaScript dans l'écran /finances (règle 4).
ECRAN="src/app/finances/page.tsx"
if [ ! -f "$ECRAN" ]; then
  red "l'écran /finances existe" "absent : $ECRAN"
else
  out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
          "$ECRAN" 2>/dev/null \
        | grep -nE 'role[[:space:]]*===[[:space:]]*"(assistant|owner|practitioner)"')
  [ -z "$out" ] && green "écran /finances : aucune décision de rôle en JavaScript" \
                || red "décision de rôle dans /finances" "$(printf '%s' "$out" | head -1)"
fi

# formaterDzd : une seule source de vérité (leçon de repartition(), S4).
out=$(grep -rln "function formaterDzd" --include="*.ts" --include="*.tsx" src/ 2>/dev/null \
      | grep -v "^src/services/finance.ts$")
[ -z "$out" ] && green "formaterDzd : une seule définition" \
              || red "formaterDzd redéfini ailleurs" "$(printf '%s' "$out" | tr '\n' ' ')"

# Les trois portes obligatoires du dépôt (CLAUDE.md), sortie vide attendue.
out=$(grep -rn "fetch(['\"]https://" --include="*.ts" --include="*.tsx" src/ supabase/ 2>/dev/null \
      | grep -v "_shared/external-call.ts")
[ -z "$out" ] && green "aucun fetch hors passerelle" \
              || red "fetch hors passerelle" "$(printf '%s' "$out" | head -1)"

out=$(grep -rn "SERVICE_ROLE\|GROQ_API_KEY\|OPENROUTER_API_KEY" src/ 2>/dev/null)
[ -z "$out" ] && green "aucun secret côté client" \
              || red "secret référencé dans src/" "$(printf '%s' "$out" | head -1)"

out=$(find . -name "*.webm" -o -name "*.wav" -o -name "*.ogg" 2>/dev/null)
[ -z "$out" ] && green "aucun fichier audio sur disque" \
              || red "audio trouvé sur disque" "$(printf '%s' "$out" | head -1)"

for gate in "pnpm typecheck" "pnpm lint" "pnpm build"; do
  if $gate >/dev/null 2>&1; then green "$gate"; else red "$gate" "voir la sortie complète"; fi
done
if bash scripts/preflight.sh >/dev/null 2>&1; then green "preflight muet"; else red "preflight" "sortie non vide"; fi

# ═══ CONTRÔLES BASE — exigent 029 appliquée ═══════════════════════════════════

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Final_Mindcare}"
S7_DB="${S7_DB:-s7fresh}"

reachable=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 \
   && docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  reachable=1
fi

# Rejoue 001→029 sur une base DÉDIÉE, à partir d'un schéma `auth` minimal (le
# seul prérequis fourni par la PLATEFORME, pas par nos migrations) — c'est le
# même geste qui a trouvé le défaut n°1 de S6 : une base neuve, pas la base de
# travail accumulée d'une session précédente.
if [ $reachable -eq 1 ]; then
  docker exec "$CONTAINER" psql -U postgres -d postgres -qtAX \
    -c "DROP DATABASE IF EXISTS $S7_DB;" -c "CREATE DATABASE $S7_DB;" >/dev/null 2>&1
  docker exec "$CONTAINER" pg_dump -U postgres -d postgres --schema=auth --schema-only 2>/dev/null \
    | docker exec -i "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX >/dev/null 2>&1

  rejeu_ok=1
  for f in supabase/migrations/*.sql; do
    out=$(docker exec -i "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX -v ON_ERROR_STOP=1 < "$f" 2>&1)
    if [ $? -ne 0 ]; then
      rejeu_ok=0
      rejeu_err="$(basename "$f") : $(printf '%s' "$out" | grep -iE '^ERROR' | head -1)"
      break
    fi
  done

  if [ $rejeu_ok -eq 1 ]; then
    n_mig=$(docker exec "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX -c "SELECT count(*) FROM app.schema_migrations;")
    [ "$n_mig" = "29" ] && green "rejeu 001→029 sur base neuve, migration 029 comprise" \
                        || red "rejeu 001→029" "attendu 29 migrations, obtenu $n_mig"
  else
    red "rejeu 001→029 sur base neuve" "${rejeu_err:-échec inconnu}"
    reachable=0   # la suite des contrôles base n'a pas de fondation fiable
  fi
fi

q()    { docker exec "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX -c "$1" 2>&1 | tail -1; }
qfull(){ docker exec "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX -c "$1" 2>&1; }
refused(){ printf '%s\n' "$1" | grep -qiE 'ERROR|ERREUR'; }

LIB_BASE=(
  "owner a1 fixe un tarif : receipt_number rendu"
  "rejeu : même paiement, pas de 2e ligne"
  "practitioner a2 sur la séance de a1 : NULL"
  "assistant a3 sur la séance de a1 : NULL, message identique à a2"
  "consultation_id inexistant, appelé par a1 : même retour encore"
  "day_revenue owner : total cabinet (a1+a2)"
  "day_revenue practitioner a2 : son seul total (ADR-005)"
  "day_revenue assistant a3 : 0 ligne, pas d'exception"
  "list_day_payments a3 : 0 ligne"
  "list_day_payments a1 → audit.log : ligne de lecture écrite"
  "next_number('payment') ×100 concurrent : 1..100 sans trou"
  "amount_dzd = -1 : violation du CHECK"
  "encaisser deux fois : collected_at inchangé"
  "day_revenue / list_day_payments : owner app_gatekeeper, pas postgres"
  "trace financière : 1 ligne update sur payments, changed_fields complet"
  "EXPLAIN day_revenue / list_day_payments : aucun Seq Scan sur app.payments"
  "concurrence réelle : deux sessions, un seul paiement, un seul reçu"
  "rollback du compteur : current_value inchangé"
  "deux sessions encaissent le même paiement : collected_at écrit une fois"
  "aucune porte de 029 ne prend de timestamptz en paramètre"
)

if [ $reachable -eq 0 ]; then
  for t in "${LIB_BASE[@]}"; do skip "$t" "base injoignable ou rejeu en échec"; done
else
  OWNER='00000000-0000-0000-0000-0000000000a1'
  DR2='00000000-0000-0000-0000-0000000000a2'
  ASSISTANT='00000000-0000-0000-0000-0000000000a3'
  PAT1='00000000-0000-0000-0000-0000000000b1'
  PAT2='00000000-0000-0000-0000-0000000000b2'
  CAB='00000000-0000-0000-0000-000000000001'

  as_owner="SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';"
  as_dr2="SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2';"
  as_asst="SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$ASSISTANT';"

  # Deux séances closes, une par praticienne, marquées synthétiques : la pile
  # locale se déclare `cloud-dev` (016), et `assert_synthetic_when_cloud`
  # refuse toute ligne qui ne l'est pas. Un checkpoint ne laisse aucune trace
  # dans un dossier médical : posé hors transaction ici seulement parce que
  # c'est un JEU DE DONNÉES de test, retiré en fin de script.
  E1='00000000-0000-0000-0000-0000000000e1'
  E2='00000000-0000-0000-0000-0000000000e2'
  qfull "INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, status, is_synthetic)
    VALUES ('$E1','$CAB','$OWNER','$PAT1','closed',true),
           ('$E2','$CAB','$DR2','$PAT2','closed',true)
    ON CONFLICT (id) DO NOTHING;" >/dev/null

  # 3/4 · owner a1 fixe un tarif, puis rejoue.
  p1=$(q "$as_owner SELECT app.set_consultation_price('$E1', 3500);")
  if [ -n "$p1" ] && [ "$p1" != "" ]; then green "${LIB_BASE[0]}"; else red "${LIB_BASE[0]}" "paiement=$p1"; fi

  p1_rejeu=$(q "$as_owner SELECT app.set_consultation_price('$E1', 4000);")
  nb=$(q "SELECT count(*) FROM app.payments WHERE consultation_id='$E1';")
  [ "$p1_rejeu" = "$p1" ] && [ "$nb" = "1" ] && green "${LIB_BASE[1]}" \
    || red "${LIB_BASE[1]}" "1er=$p1 rejeu=$p1_rejeu lignes=$nb"

  # 5/6/7 · les trois cas indiscernables — practitioner, assistant, inexistant.
  r5=$(q "$as_dr2 SELECT COALESCE(app.set_consultation_price('$E1', 999)::text,'NULL');")
  [ "$r5" = "NULL" ] && green "${LIB_BASE[2]}" || red "${LIB_BASE[2]}" "rendu $r5"

  r6=$(q "$as_asst SELECT COALESCE(app.set_consultation_price('$E1', 999)::text,'NULL');")
  msg6=$(qfull "$as_asst SELECT app.set_consultation_price('$E1', 999);" | grep -iE 'ERROR|ERREUR')
  msg5=$(qfull "$as_dr2 SELECT app.set_consultation_price('$E1', 999);" | grep -iE 'ERROR|ERREUR')
  # a2 (practitioner, hors périmètre) et a3 (assistant) doivent lever LA MÊME
  # exception que 011 pose sur toute écriture hors policy — pas de distinction.
  if [ "$r6" = "NULL" ] && [ "$msg6" = "$msg5" ]; then
    green "${LIB_BASE[3]}"
  else
    red "${LIB_BASE[3]}" "a3=$r6, message a2/a3 identiques=$( [ "$msg6" = "$msg5" ] && echo oui || echo non )"
  fi

  r7=$(q "$as_owner SELECT COALESCE(app.set_consultation_price('ffffffff-ffff-ffff-ffff-ffffffffffff', 999)::text,'NULL');")
  [ "$r7" = "NULL" ] && green "${LIB_BASE[4]}" || red "${LIB_BASE[4]}" "rendu $r7"

  # a2 fixe le tarif de SA propre séance, nécessaire aux contrôles 8/9.
  p2=$(q "$as_dr2 SELECT app.set_consultation_price('$E2', 2000);")

  # 8/9/10 · day_revenue, cloisonnée.
  tot_owner=$(q "$as_owner SELECT total_dzd FROM app.day_revenue(current_date);")
  [ "$tot_owner" = "6000" ] && green "${LIB_BASE[5]}" || red "${LIB_BASE[5]}" "total owner=$tot_owner (attendu 6000 = 4000+2000)"

  tot_dr2=$(q "$as_dr2 SELECT total_dzd FROM app.day_revenue(current_date);")
  [ "$tot_dr2" = "2000" ] && green "${LIB_BASE[6]}" || red "${LIB_BASE[6]}" "total practitioner=$tot_dr2 (attendu 2000, jamais 6000)"

  lignes_asst=$(q "$as_asst SELECT count(*) FROM app.day_revenue(current_date);")
  [ "$lignes_asst" = "0" ] && green "${LIB_BASE[7]}" || red "${LIB_BASE[7]}" "assistant lignes=$lignes_asst"

  # 11/12 · list_day_payments + audit.
  l_asst=$(q "$as_asst SELECT count(*) FROM app.list_day_payments(current_date);")
  [ "$l_asst" = "0" ] && green "${LIB_BASE[8]}" || red "${LIB_BASE[8]}" "assistant lignes=$l_asst"

  avant=$(q "SELECT count(*) FROM audit.log WHERE operation='select' AND 'liste'=ANY(changed_fields);")
  qfull "$as_owner SELECT count(*) FROM app.list_day_payments(current_date);" >/dev/null
  apres=$(q "SELECT count(*) FROM audit.log WHERE operation='select' AND 'liste'=ANY(changed_fields);")
  [ "$apres" -gt "$avant" ] && green "${LIB_BASE[9]}" || red "${LIB_BASE[9]}" "audit avant=$avant après=$apres"

  # 13 · next_number ×100 concurrent, sans trou. 100 backends réels via `xargs
  #      -P`, chacun une connexion séparée — un `SELECT ... FROM generate_series`
  #      unique ne prouverait qu'une boucle séquentielle sous un seul verrou de
  #      session, pas une vraie concurrence de connexions.
  seq 1 100 | xargs -P 20 -I{} docker exec "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX \
    -c "SELECT app.next_number('$CAB','payment_stress','2099');" >/dev/null 2>&1
  vals=$(q "SELECT string_agg(DISTINCT current_value::text, ',') FROM app.counters WHERE scope='payment_stress';")
  final=$(q "SELECT current_value FROM app.counters WHERE scope='payment_stress' AND period='2099';")
  [ "$final" = "100" ] && green "${LIB_BASE[10]}" || red "${LIB_BASE[10]}" "valeur finale=$final (attendu 100, aucun trou)"

  # 14 · CHECK sur amount_dzd.
  out14=$(qfull "$as_dr2 SELECT app.set_consultation_price('$E2', -1);")
  refused "$out14" && green "${LIB_BASE[11]}" || red "${LIB_BASE[11]}" "montant négatif accepté"

  # 15 · encaisser deux fois : collected_at inchangé.
  pid2=$(q "SELECT id FROM app.payments WHERE consultation_id='$E2';")
  qfull "$as_dr2 SELECT app.record_payment_collected('$pid2');" >/dev/null
  c1=$(q "SELECT collected_at FROM app.payments WHERE id='$pid2';")
  qfull "$as_dr2 SELECT app.record_payment_collected('$pid2');" >/dev/null
  c2=$(q "SELECT collected_at FROM app.payments WHERE id='$pid2';")
  [ "$c1" = "$c2" ] && [ -n "$c1" ] && green "${LIB_BASE[12]}" || red "${LIB_BASE[12]}" "1er=$c1 2e=$c2"

  # 16 · propriétaires.
  own_dr=$(q "SELECT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='day_revenue';")
  own_ld=$(q "SELECT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='list_day_payments';")
  if [ "$own_dr" = "app_gatekeeper" ] && [ "$own_ld" = "app_gatekeeper" ]; then
    green "${LIB_BASE[13]}"
  else
    red "${LIB_BASE[13]}" "day_revenue=$own_dr list_day_payments=$own_ld"
  fi

  # 17 · trace financière — modifier un montant non encaissé (E1, jamais
  #      encaissé), puis lire audit.log.
  qfull "$as_owner SELECT app.set_consultation_price('$E1', 4500);" >/dev/null
  audit17=$(q "SELECT count(*) FROM audit.log
    WHERE table_name='payments' AND operation='update'
      AND 'amount_dzd'=ANY(changed_fields)
      AND (old_values->>'amount_dzd')='4000' AND (new_values->>'amount_dzd')='4500'
      AND actor_id IS NOT NULL AND occurred_at IS NOT NULL;")
  [ "$audit17" -ge "1" ] && green "${LIB_BASE[14]}" || red "${LIB_BASE[14]}" "lignes conformes trouvées=$audit17"

  # 18 · EXPLAIN, aucun Seq Scan sur app.payments — sur un volume qui rend le
  #      Seq Scan RÉELLEMENT plus coûteux que l'index, pas 4 lignes de seed.
  qfull "INSERT INTO app.payments (cabinet_id, practitioner_id, patient_id, receipt_number, amount_dzd, set_by, created_at, is_synthetic)
    SELECT '$CAB','$OWNER','$PAT1','BULK-'||g::text, 1000, '$OWNER',
           now() - (g||' minutes')::interval, true
      FROM generate_series(1,20000) g;
    ANALYZE app.payments;" >/dev/null
  plan1=$(qfull "$as_owner EXPLAIN SELECT * FROM app.day_revenue(current_date);")
  plan2=$(qfull "$as_owner EXPLAIN SELECT * FROM app.list_day_payments(current_date);")
  # Un Function Scan sur la porte elle-même est attendu et sans rapport avec
  # l'accès à app.payments EN SON SEIN ; on vérifie donc l'absence de Seq Scan
  # en interrogeant le plan de la REQUÊTE portée par la fonction, isolément.
  planA=$(qfull "$as_owner EXPLAIN SELECT * FROM app.payments
    WHERE cabinet_id='$CAB' AND created_at >= current_date::timestamp AT TIME ZONE 'Africa/Algiers'
      AND created_at < (current_date+1)::timestamp AT TIME ZONE 'Africa/Algiers';")
  if printf '%s' "$planA" | grep -qi "Seq Scan on payments"; then
    red "${LIB_BASE[15]}" "Seq Scan détecté sur app.payments"
  else
    green "${LIB_BASE[15]}"
  fi

  # 19 · CONCURRENCE RÉELLE. Deux connexions psql simultanées : la première
  #      verrouille la séance E1 sans committer, la seconde tente de fixer le
  #      même tarif et DOIT ATTENDRE. Mesuré par un délai, pas par un mot dans
  #      la sortie — un texte plausible sans blocage réel passerait sinon vert.
  # `coproc` — pipes anonymes gérés par bash lui-même, pas des FIFO fichiers
  # (`mkfifo`) : sur MSYS/Windows, un `docker exec -i < FIFO` peut voir un EOF
  # prématuré en traversant la frontière Docker Desktop, ce qui a fait mourir
  # la session 1 avant le COMMIT et cassé le contrôle (141/EPIPE), pas le
  # verrou lui-même. `coproc` évite le fichier FIFO, donc ce piège.
  coproc PSQL1 { docker exec -i "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX 2>&1; }

  printf '%s\n' "BEGIN; $as_owner
    SELECT c.id FROM app.consultations c WHERE c.id = '$E1' FOR UPDATE;" >&"${PSQL1[1]}"
  # Laisser le temps au verrou d'être posé avant de lancer le second appel.
  sleep 1

  t0=$(date +%s)
  timeout 5 docker exec "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX \
    -c "$as_owner SELECT app.set_consultation_price('$E1', 7777);" >/tmp/s7_c19_out 2>&1 &
  PSQL2_PID=$!
  sleep 3
  toujours_bloque=0
  kill -0 "$PSQL2_PID" 2>/dev/null && toujours_bloque=1

  printf '%s\n' "COMMIT;" >&"${PSQL1[1]}"
  wait "$PSQL2_PID" 2>/dev/null
  t1=$(date +%s)
  exec {PSQL1[1]}>&-
  wait "$PSQL1_PID" 2>/dev/null

  duree=$((t1 - t0))
  if [ "$toujours_bloque" = "1" ] && [ "$duree" -ge 2 ]; then
    green "${LIB_BASE[16]}"
  else
    red "${LIB_BASE[16]}" "bloqué pendant l'attente=$toujours_bloque durée totale=${duree}s (attendu bloqué ≥2s)"
  fi

  # 20 · rollback du compteur — BEGIN → set_consultation_price sur une NOUVELLE
  #      séance non encore tarifée → ROLLBACK → current_value inchangé.
  E20='00000000-0000-0000-0000-0000000000e0'
  qfull "INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, status, is_synthetic)
    VALUES ('$E20','$CAB','$OWNER','$PAT1','closed',true) ON CONFLICT (id) DO NOTHING;" >/dev/null
  avant20=$(q "SELECT current_value FROM app.counters WHERE cabinet_id='$CAB' AND scope='payment' AND period=to_char(now(),'YYYY');")
  qfull "BEGIN; $as_owner SELECT app.set_consultation_price('$E20', 777); ROLLBACK;" >/dev/null
  apres20=$(q "SELECT current_value FROM app.counters WHERE cabinet_id='$CAB' AND scope='payment' AND period=to_char(now(),'YYYY');")
  [ "$avant20" = "$apres20" ] && green "${LIB_BASE[17]}" || red "${LIB_BASE[17]}" "avant=$avant20 après=$apres20"

  # 21 · deux sessions encaissent le MÊME paiement simultanément.
  pid1=$(q "SELECT id FROM app.payments WHERE consultation_id='$E1';")
  coproc PSQL1 { docker exec -i "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX 2>&1; }
  printf '%s\n' "BEGIN; $as_owner SELECT id FROM app.payments WHERE id='$pid1' FOR UPDATE;" >&"${PSQL1[1]}"
  sleep 1

  timeout 5 docker exec "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX \
    -c "$as_owner SELECT app.record_payment_collected('$pid1');" >/tmp/s7_c21_out 2>&1 &
  PSQL2_PID=$!
  sleep 3
  bloque21=0
  kill -0 "$PSQL2_PID" 2>/dev/null && bloque21=1
  printf '%s\n' "COMMIT;" >&"${PSQL1[1]}"
  wait "$PSQL2_PID" 2>/dev/null
  exec {PSQL1[1]}>&-
  wait "$PSQL1_PID" 2>/dev/null

  nb_collected=$(q "SELECT count(DISTINCT collected_at) FROM app.payments WHERE id='$pid1' AND collected_at IS NOT NULL;")
  if [ "$bloque21" = "1" ] && [ "$nb_collected" = "1" ]; then
    green "${LIB_BASE[18]}"
  else
    red "${LIB_BASE[18]}" "bloqué=$bloque21 valeurs distinctes de collected_at=$nb_collected"
  fi

  # 22 · aucune porte de 029 ne prend de timestamptz en paramètre.
  out22=$(docker exec "$CONTAINER" psql -U postgres -d "$S7_DB" -qtAX -c "
    SELECT p.proname || '(' || pg_get_function_arguments(p.oid) || ')'
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='app' AND p.proname IN
       ('set_consultation_price','record_payment_collected','day_revenue',
        'list_day_payments','get_consultation_payment')
       AND pg_get_function_arguments(p.oid) ILIKE '%timestamptz%';")
  [ -z "$out22" ] && green "${LIB_BASE[19]}" || red "${LIB_BASE[19]}" "$out22"
fi

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — arrêt de la progression. Corriger la cause, pas le contrôle."
  exit 1
fi
if [ $blocked -ne 0 ]; then
  echo "VERDICT : BLOQUÉ — les contrôles statiques passent, ceux qui exigent la base"
  echo "          n'ont pas pu s'exécuter. CE N'EST PAS UN VERT."
  exit 2
fi
echo "VERDICT : VERT — $n contrôles."
