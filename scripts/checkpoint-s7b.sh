#!/usr/bin/env bash
# CHECKPOINT S7b PHASE 1 — Documents, mécanique seule. VERT ou ROUGE.
#
#   bash scripts/checkpoint-s7b.sh
#
# ⚠️ CE VERT NE CLÔT PAS S7b. Le contrat gelé (docs/S7B-DOCUMENTS.md §B7) le dit
# noir sur blanc : seul le CONTRÔLE PAPIER — imprimer un certificat réel et le
# poser à côté d'un vrai — clôt le jalon, et il reste inexécutable tant que
# B1.1→B1.5 (en-tête, logo, fontes, texte des 4 modèles) ne sont pas fournis.
# Ce script prouve la MÉCANIQUE (portes, échappement, cloison, numérotation,
# verrouillage de table) contre une FIXTURE créée dans sa propre transaction —
# jamais un modèle livré (règle 8 : pas de donnée fictive dans une
# fonctionnalité LIVRÉE, une fixture de contrôle n'en est pas une).
#
# TROIS VERDICTS, comme S7a :
#   VERT   — tous les contrôles exécutés passent.
#   ROUGE  — au moins un contrôle exécuté a échoué.
#   BLOQUÉ — les contrôles STATIQUES passent, ceux qui exigent la base n'ont
#            pas pu s'exécuter. CE N'EST PAS UN VERT (code 2).
#
# ⚠️ ACCÈS BASE PAR `docker exec` sur le conteneur de `supabase start`, motif et
# raison identiques à checkpoint-s7.sh (Docker Hub injoignable sur ce poste).
#
# LES CONTRÔLES DE CONCURRENCE EXIGENT DEUX SESSIONS SIMULTANÉES, réalisées par
# `coproc` — pas un FIFO fichier (SIGPIPE sous MSYS/Docker Desktop, défaut déjà
# trouvé et corrigé en S7a).

set -uo pipefail
trap '' PIPE
cd "$(dirname "$0")/.." || exit 1

fail=0
blocked=0
n=0
echo "CHECKPOINT S7b PHASE 1 — DOCUMENTS (mécanique)"
echo

green() { n=$((n+1)); printf '%-2s %-62s VERT\n' "$n" "$1"; }
red()   { n=$((n+1)); printf '%-2s %-62s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
skip()  { n=$((n+1)); printf '%-2s %-62s BLOQUÉ %s\n' "$n" "$1" "$2"; blocked=1; }

# ═══ CONTRÔLES STATIQUES — toujours exécutés ══════════════════════════════════

# 1 · documents.ts ne nomme aucune table (grep sur `.from(`).
out=$(grep -rnE '\.from\(' --include="*.ts" src/services/documents.ts 2>/dev/null)
[ -z "$out" ] && green "documents.ts : aucune table nommée (.from)" \
              || red "documents.ts nomme une table" "$(printf '%s' "$out" | head -1)"

# 2 · 030 ne contient pas CREATE SEQUENCE (I17).
out=$(grep -in "CREATE SEQUENCE" supabase/migrations/030_document_gates.sql 2>/dev/null)
[ -z "$out" ] && green "030 : aucune SEQUENCE (I17, next_number seul)" \
              || red "030 contient CREATE SEQUENCE" "$(printf '%s' "$out" | head -1)"

# 3 · 030 ne définit ni update_document ni delete_document. Recherche la
# DÉFINITION d'une fonction, pas la chaîne littérale — ce fichier NOMME ces deux
# mots à plusieurs reprises dans ses propres commentaires explicatifs (« aucune
# porte update_document ni delete_document »), et un grep sur la chaîne brute
# rougirait sur sa propre documentation plutôt que sur du code.
out=$(grep -inE 'CREATE[[:space:]]+(OR[[:space:]]+REPLACE[[:space:]]+)?FUNCTION[[:space:]]+app\.(update|delete)_document' \
       supabase/migrations/030_document_gates.sql 2>/dev/null)
[ -z "$out" ] && green "030 : aucune fonction update_document ni delete_document" \
              || red "030 définit une porte interdite" "$(printf '%s' "$out" | head -1)"

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

# ═══ CONTRÔLES BASE — exigent 030 appliquée ═══════════════════════════════════

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Final_Mindcare}"
S7B_DB="${S7B_DB:-s7bfresh}"

reachable=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 \
   && docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  reachable=1
fi

# Rejeu 001→030 sur une base DÉDIÉE, neuve — même geste qui a trouvé le défaut
# n°1 de S6 et les trois défauts de la revue adversariale de 030 elle-même.
if [ $reachable -eq 1 ]; then
  docker exec "$CONTAINER" psql -U postgres -d postgres -qtAX \
    -c "DROP DATABASE IF EXISTS $S7B_DB;" -c "CREATE DATABASE $S7B_DB;" >/dev/null 2>&1
  docker exec "$CONTAINER" pg_dump -U postgres -d postgres --schema=auth --schema-only 2>/dev/null \
    | docker exec -i "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX >/dev/null 2>&1

  rejeu_ok=1
  for f in supabase/migrations/*.sql; do
    out=$(docker exec -i "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX -v ON_ERROR_STOP=1 < "$f" 2>&1)
    if [ $? -ne 0 ]; then
      rejeu_ok=0
      rejeu_err="$(basename "$f") : $(printf '%s' "$out" | grep -iE '^ERROR' | head -1)"
      break
    fi
  done

  if [ $rejeu_ok -eq 1 ]; then
    n_mig=$(docker exec "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX -c "SELECT count(*) FROM app.schema_migrations;")
    [ "$n_mig" = "30" ] && green "rejeu 001→030 sur base neuve, migration 030 comprise" \
                        || red "rejeu 001→030" "attendu 30 migrations, obtenu $n_mig"
  else
    red "rejeu 001→030 sur base neuve" "${rejeu_err:-échec inconnu}"
    reachable=0
  fi
fi

q()    { docker exec "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX -c "$1" 2>&1 | tail -1; }
qfull(){ docker exec "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX -c "$1" 2>&1; }
refused(){ printf '%s\n' "$1" | grep -qiE 'ERROR|ERREUR'; }

LIB_BASE=(
  "owner a1 émet sur son patient b1 : doc_number + rendered_html non vide"
  "practitioner a2 émet sur le patient b1 de a1 : NULL"
  "assistant a3 émet sur b1 : NULL, identique à a2 (aucun message ni l'un ni l'autre)"
  "patient_id inexistant, appelé par a1 : même retour encore"
  "get_document / list_patient_documents par a3 : zéro ligne"
  "patient hostile (b9) : rendered_html échappé, jamais de HTML brut"
  "marqueur inconnu {{secret.token}} : rendu littéral"
  "modèle modifié après émission : rendered_html du document déjà émis inchangé"
  "next_number('document') ×100 concurrent : 1..100 sans trou"
  "EXPLAIN list_patient_documents : aucun Seq Scan sur app.documents"
  "aucune porte de 030 ne prend de timestamptz en paramètre"
  "BEGIN → issue_document (champ invalide) → ROLLBACK : compteur inchangé"
  "deux sessions émettent sur le même patient : deux documents, deux numéros distincts"
  "get_document par a1 → audit.log : ligne de lecture écrite"
  "get_document / list_patient_documents : owner app_gatekeeper, pas postgres"
  "mark_document_printed ×2 : printed_count=2, rendered_html intact"
  "owner a1 sur patient b2 (consœur) : refus EXPLICITE, pas NULL"
  "INSERT / UPDATE colonne figée / DELETE direct par authenticated : tous refusés"
  "séance d'un AUTRE patient rattachée à l'émission : refusée"
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

  # ── Fixture, DANS LA TRANSACTION DE CE CHECKPOINT, jamais livrée (règle 8) ──
  #
  # Un modèle minimal pour 'justification' (un seul champ variable, ADR-011),
  # avec DEUX pièges volontaires dans le corps : `{{secret.token}}` (hors
  # allowlist, contrôle 7) et une substitution du patient (contrôle 6, sur un
  # patient au nom hostile b9 créé plus bas).
  qfull "INSERT INTO app.document_templates
      (id, cabinet_id, doc_type, version, title_fr, header_html, body_html, footer_html, is_active)
    VALUES
      ('00000000-0000-0000-0000-0000000000f0', '$CAB', 'justification', 1,
       'Justification (test)',
       '<h1>{{patient.first_name}} {{patient.last_name}}</h1>',
       '<p>Réf {{patient.record_number}} — {{vars.date_consultation}} — {{secret.token}}</p>',
       NULL, true)
    ON CONFLICT (id) DO NOTHING;" >/dev/null

  # Patient hostile, DÉDIÉ (b9, pas b1/b2) : b1/b2 restent ce que 015 en a fait,
  # aucune donnée de seed livrée n'est touchée.
  qfull "INSERT INTO app.patients (id, cabinet_id, practitioner_id, record_number,
                                  first_name, last_name, phone, created_by, is_synthetic)
    VALUES ('00000000-0000-0000-0000-0000000000b9', '$CAB', '$OWNER', 'TEST-0009',
            'Patient', '<script>alert(1)</script> & O''Brien {{vars.x}}',
            '0555000009', '$OWNER', true)
    ON CONFLICT (id) DO NOTHING;" >/dev/null
  PAT9='00000000-0000-0000-0000-0000000000b9'

  VARS='{"date_consultation":"2026-08-09"}'

  # 1 · owner a1 émet sur b1.
  doc1=$(q "$as_owner SELECT app.issue_document('$PAT1','justification','$VARS');")
  html1=$(q "SELECT rendered_html FROM app.documents WHERE id='$doc1';")
  docnum1=$(q "SELECT doc_number FROM app.documents WHERE id='$doc1';")
  if [ -n "$doc1" ] && [ "$doc1" != "" ] && [ -n "$html1" ] && [ -n "$docnum1" ]; then
    green "${LIB_BASE[0]}"
  else
    red "${LIB_BASE[0]}" "doc=$doc1 doc_number=$docnum1 html_vide=$([ -z "$html1" ] && echo oui || echo non)"
  fi

  # 2/3/4 · les trois cas indiscernables (défaut owner mis à part, contrôle 17).
  r2=$(q "$as_dr2 SELECT COALESCE(app.issue_document('$PAT1','justification','$VARS')::text,'NULL');")
  [ "$r2" = "NULL" ] && green "${LIB_BASE[1]}" || red "${LIB_BASE[1]}" "rendu $r2"

  r3=$(q "$as_asst SELECT COALESCE(app.issue_document('$PAT1','justification','$VARS')::text,'NULL');")
  msg3=$(qfull "$as_asst SELECT app.issue_document('$PAT1','justification','$VARS');" | grep -iE 'ERROR|ERREUR')
  msg2=$(qfull "$as_dr2 SELECT app.issue_document('$PAT1','justification','$VARS');" | grep -iE 'ERROR|ERREUR')
  if [ "$r3" = "NULL" ] && [ -z "$msg2" ] && [ -z "$msg3" ]; then
    green "${LIB_BASE[2]}"
  else
    red "${LIB_BASE[2]}" "a3=$r3 message_a2='$msg2' message_a3='$msg3' (les deux doivent être NULL sans message)"
  fi

  r4=$(q "$as_owner SELECT COALESCE(app.issue_document('ffffffff-ffff-ffff-ffff-ffffffffffff','justification','$VARS')::text,'NULL');")
  [ "$r4" = "NULL" ] && green "${LIB_BASE[3]}" || red "${LIB_BASE[3]}" "rendu $r4"

  # 5 · get_document / list_patient_documents par l'assistante : zéro ligne.
  g5a=$(q "$as_asst SELECT count(*) FROM app.get_document('$doc1');")
  g5b=$(q "$as_asst SELECT count(*) FROM app.list_patient_documents('$PAT1');")
  [ "$g5a" = "0" ] && [ "$g5b" = "0" ] && green "${LIB_BASE[4]}" \
                                        || red "${LIB_BASE[4]}" "get_document=$g5a list=$g5b"

  # 6/7 · patient hostile — échappement, et marqueur hors allowlist littéral.
  doc6=$(q "$as_owner SELECT app.issue_document('$PAT9','justification','$VARS');")
  html6=$(q "SELECT rendered_html FROM app.documents WHERE id='$doc6';")
  if printf '%s' "$html6" | grep -q '&lt;script&gt;' && ! printf '%s' "$html6" | grep -qF '<script>'; then
    green "${LIB_BASE[5]}"
  else
    red "${LIB_BASE[5]}" "aucune trace de <script> brut attendue ; extrait: $(printf '%s' "$html6" | head -c 120)"
  fi

  if printf '%s' "$html6" | grep -qF '{{secret.token}}'; then
    green "${LIB_BASE[6]}"
  else
    red "${LIB_BASE[6]}" "marqueur hors allowlist non retrouvé littéral ; extrait: $(printf '%s' "$html6" | head -c 200)"
  fi

  # 8 · modèle modifié après émission : le document déjà émis ne change pas.
  qfull "UPDATE app.document_templates SET body_html = '<p>MODÈLE RÉÉCRIT</p>' WHERE id='00000000-0000-0000-0000-0000000000f0';" >/dev/null
  html1_apres=$(q "SELECT rendered_html FROM app.documents WHERE id='$doc1';")
  [ "$html1_apres" = "$html1" ] && green "${LIB_BASE[7]}" || red "${LIB_BASE[7]}" "rendered_html a changé après modification du modèle"

  # 9 · next_number('document') ×100 concurrent, sans trou — même motif que S7a
  # contrôle 13, sur un scope dédié pour ne pas interférer avec les émissions
  # ci-dessus.
  seq 1 100 | xargs -P 20 -I{} docker exec "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX \
    -c "SELECT app.next_number('$CAB','document_stress','2099');" >/dev/null 2>&1
  final9=$(q "SELECT current_value FROM app.counters WHERE scope='document_stress' AND period='2099';")
  [ "$final9" = "100" ] && green "${LIB_BASE[8]}" || red "${LIB_BASE[8]}" "valeur finale=$final9 (attendu 100, aucun trou)"

  # 10 · EXPLAIN sur list_patient_documents, sur un volume qui rend le Seq Scan
  # réellement plus coûteux que l'index — pas 3 lignes de fixture.
  qfull "INSERT INTO app.documents (cabinet_id, practitioner_id, patient_id, doc_type,
                                    doc_number, variables, rendered_html, is_synthetic)
    SELECT '$CAB','$OWNER','$PAT1','justification','BULK-'||g::text,
           '{}'::jsonb, 'x', true
      FROM generate_series(1,20000) g;
    ANALYZE app.documents;" >/dev/null
  plan10=$(qfull "$as_owner EXPLAIN SELECT * FROM app.documents
    WHERE patient_id='$PAT1' ORDER BY issued_at DESC;")
  if printf '%s' "$plan10" | grep -qi "Seq Scan on documents"; then
    red "${LIB_BASE[9]}" "Seq Scan détecté sur app.documents"
  else
    green "${LIB_BASE[9]}"
  fi

  # 11 · aucune porte de 030 ne prend de timestamptz en paramètre.
  out11=$(docker exec "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX -c "
    SELECT p.proname || '(' || pg_get_function_arguments(p.oid) || ')'
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='app' AND p.proname IN
       ('issue_document','get_document','list_patient_documents','mark_document_printed')
       AND pg_get_function_arguments(p.oid) ILIKE '%timestamptz%';")
  [ -z "$out11" ] && green "${LIB_BASE[10]}" || red "${LIB_BASE[10]}" "$out11"

  # 12 · rollback du compteur — un appel par ailleurs VALIDE, sous un ROLLBACK
  # explicite : le numéro alloué par next_number (010) doit être rendu, comme
  # toute autre écriture de la transaction. C'est ce qu'une SEQUENCE ne ferait
  # jamais, et toute la raison d'I17.
  avant12=$(q "SELECT current_value FROM app.counters WHERE cabinet_id='$CAB' AND scope='document' AND period=to_char(now() AT TIME ZONE 'Africa/Algiers','YYYY');")
  qfull "BEGIN; $as_owner SELECT app.issue_document('$PAT1','justification','$VARS'); ROLLBACK;" >/dev/null
  apres12=$(q "SELECT current_value FROM app.counters WHERE cabinet_id='$CAB' AND scope='document' AND period=to_char(now() AT TIME ZONE 'Africa/Algiers','YYYY');")
  [ "$avant12" = "$apres12" ] && green "${LIB_BASE[11]}" || red "${LIB_BASE[11]}" "avant=$avant12 après=$apres12"

  # 13 · CONCURRENCE RÉELLE — deux sessions simultanées émettent sur le MÊME
  # patient. `coproc`, motif éprouvé en S7a (les FIFO fichier meurent par
  # SIGPIPE sous MSYS/Docker Desktop).
  # ⚠️ Verrou pris EN SUPERUTILISATEUR (postgres), délibérément SANS
  # `$as_owner` : `SELECT ON app.patients` est révoqué à `authenticated` (017,
  # 030 §1bis-2 — défaut trouvé en revue), donc un `SET LOCAL role=
  # 'authenticated'` avant ce SELECT échouerait en « permission denied » sans
  # jamais poser le verrou, et la session 2 ne rencontrerait aucune contention
  # — un faux vert qui ne prouverait rien. Le contexte d'autorisation n'a
  # aucune importance ici : on ne teste que le verrou de ligne, identique quel
  # que soit le rôle qui le pose.
  coproc PSQL1 { docker exec -i "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX 2>&1; }

  printf '%s\n' "BEGIN;
    SELECT id FROM app.patients WHERE id = '$PAT1' FOR UPDATE;" >&"${PSQL1[1]}"
  sleep 1

  t0=$(date +%s)
  timeout 5 docker exec "$CONTAINER" psql -U postgres -d "$S7B_DB" -qtAX \
    -c "$as_owner SELECT app.issue_document('$PAT1','justification','$VARS');" >/tmp/s7b_c13_out 2>&1 &
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
  # Restreint aux numéros `DOC-…` réellement émis par issue_document : le
  # contrôle 10 (EXPLAIN) a rempli app.documents de 20000 lignes `BULK-…` sur
  # ce même patient pour rendre le Seq Scan mesurable, et les inclure ici ne
  # ferait que noyer le signal dans un compte qui ne prouverait plus rien.
  nb_docs_pat1=$(q "SELECT count(*) FROM app.documents WHERE patient_id='$PAT1' AND doc_number LIKE 'DOC-%';")
  nb_num_distincts=$(q "SELECT count(DISTINCT doc_number) FROM app.documents WHERE patient_id='$PAT1' AND doc_number LIKE 'DOC-%';")
  if [ "$toujours_bloque" = "1" ] && [ "$duree" -ge 2 ] && [ "$nb_docs_pat1" = "$nb_num_distincts" ]; then
    green "${LIB_BASE[12]}"
  else
    red "${LIB_BASE[12]}" "bloqué=$toujours_bloque durée=${duree}s documents=$nb_docs_pat1 numéros_distincts=$nb_num_distincts"
  fi

  # 14 · get_document par a1 → audit.log.
  avant14=$(q "SELECT count(*) FROM audit.log WHERE operation='select' AND 'fiche'=ANY(changed_fields);")
  qfull "$as_owner SELECT count(*) FROM app.get_document('$doc1');" >/dev/null
  apres14=$(q "SELECT count(*) FROM audit.log WHERE operation='select' AND 'fiche'=ANY(changed_fields);")
  [ "$apres14" -gt "$avant14" ] && green "${LIB_BASE[13]}" || red "${LIB_BASE[13]}" "audit avant=$avant14 après=$apres14"

  # 15 · propriétaires des portes DEFINER nommant un patient.
  own_gd=$(q "SELECT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='get_document';")
  own_lp=$(q "SELECT pg_get_userbyid(proowner) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='app' AND p.proname='list_patient_documents';")
  if [ "$own_gd" = "app_gatekeeper" ] && [ "$own_lp" = "app_gatekeeper" ]; then
    green "${LIB_BASE[14]}"
  else
    red "${LIB_BASE[14]}" "get_document=$own_gd list_patient_documents=$own_lp"
  fi

  # 16 · mark_document_printed ×2 : compteur à 2, HTML intact.
  qfull "$as_owner SELECT app.mark_document_printed('$doc1');" >/dev/null
  c1=$(q "$as_owner SELECT app.mark_document_printed('$doc1');")
  html_apres16=$(q "SELECT rendered_html FROM app.documents WHERE id='$doc1';")
  [ "$c1" = "2" ] && [ "$html_apres16" = "$html1" ] && green "${LIB_BASE[15]}" \
                                                     || red "${LIB_BASE[15]}" "compteur=$c1 html_intact=$([ "$html_apres16" = "$html1" ] && echo oui || echo non)"

  # 17 · L'OWNER n'est PAS masqué comme practitioner/assistant sur un dossier
  # d'une consœur : refus EXPLICITE. Défaut trouvé en revue adversariale,
  # corrigé dans 030 §2 — ce contrôle prouve que le fix tient.
  msg17=$(qfull "$as_owner SELECT app.issue_document('$PAT2','justification','$VARS');" | grep -iE 'ERROR|ERREUR')
  [ -n "$msg17" ] && green "${LIB_BASE[16]}" || red "${LIB_BASE[16]}" "owner sur patient de a2 : aucun message d'erreur (NULL au lieu d'un refus explicite ?)"

  # 18 · LE VERROU DE TABLE — défaut trouvé en revue adversariale : sans lui,
  # authenticated pouvait écrire app.documents en direct, RPC ou pas.
  ins18=$(qfull "$as_owner INSERT INTO app.documents (cabinet_id, practitioner_id, patient_id, doc_type, doc_number, variables, rendered_html)
    VALUES ('$CAB','$OWNER','$PAT1','justification','DOC-FAUX-00001','{}'::jsonb,'<h1>FAUX</h1>');")
  upd18=$(qfull "$as_owner UPDATE app.documents SET rendered_html = 'RÉÉCRIT APRÈS ÉMISSION' WHERE id='$doc1';")
  # `is_synthetic` : défaut trouvé en 3e revue — absent de la première liste de
  # colonnes protégées, un document émis pouvait être re-étiqueté après coup.
  upd18_synth=$(qfull "$as_owner UPDATE app.documents SET is_synthetic = NOT is_synthetic WHERE id='$doc1';")
  del18=$(qfull "$as_owner DELETE FROM app.documents WHERE id='$doc1';")
  upd18_ok=$(qfull "$as_owner UPDATE app.documents SET printed_count = printed_count WHERE id='$doc1';")
  if refused "$ins18" && refused "$upd18" && refused "$upd18_synth" && refused "$del18" && ! refused "$upd18_ok"; then
    green "${LIB_BASE[17]}"
  else
    red "${LIB_BASE[17]}" "insert=$(refused "$ins18" && echo refusé || echo ACCEPTÉ) update_html=$(refused "$upd18" && echo refusé || echo ACCEPTÉ) update_is_synthetic=$(refused "$upd18_synth" && echo refusé || echo ACCEPTÉ) delete=$(refused "$del18" && echo refusé || echo ACCEPTÉ) update_printed_count=$(refused "$upd18_ok" && echo REFUSÉ || echo accepté)"
  fi

  # 19 · une séance appartenant à un AUTRE patient ne peut pas être rattachée,
  # même si elle appartient à la même praticienne. Défaut trouvé en revue.
  F1='00000000-0000-0000-0000-0000000000f1'
  qfull "INSERT INTO app.consultations (id, cabinet_id, practitioner_id, patient_id, status, is_synthetic)
    VALUES ('$F1','$CAB','$OWNER','$PAT9','closed',true) ON CONFLICT (id) DO NOTHING;" >/dev/null
  msg19=$(qfull "$as_owner SELECT app.issue_document('$PAT1','justification','$VARS','$F1');" | grep -iE 'ERROR|ERREUR')
  [ -n "$msg19" ] && green "${LIB_BASE[18]}" || red "${LIB_BASE[18]}" "séance de b9 rattachée à un document de b1 sans refus"
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
echo
echo "⚠️  S7b reste OUVERT : ce vert prouve la mécanique, pas le jalon. Le"
echo "    contrôle papier (docs/S7B-DOCUMENTS.md §B7) est le seul qui le clôt,"
echo "    et il attend B1.1→B1.5."
