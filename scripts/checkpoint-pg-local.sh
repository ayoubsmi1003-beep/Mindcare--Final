#!/usr/bin/env bash
# CHECKPOINT PG-LOCAL — le schéma part-il sur un PostgreSQL nu, sans Supabase ?
#
#   bash scripts/checkpoint-pg-local.sh
#
# Reconstruit une base VIERGE, y joue le bootstrap de compatibilité puis la
# chaîne de migrations SANS LA MODIFIER, et mesure les invariants de cloison.
# Jetable : le conteneur est détruit à chaque exécution. Aucune donnée du
# cabinet n'est approchée, aucune variable DATABASE_URL n'est lue — ce
# checkpoint ne peut pas toucher une base réelle par accident.
#
# VERT / ROUGE / BLOQUÉ (code 2), comme les autres checkpoints du dépôt.
#
# ═══ POURQUOI PG16 + PGVECTOR, ET NON 15 OU 17 VANILLA ════════════════════════
# La migration 020 écrit `GRANT authenticated TO app_gatekeeper WITH INHERIT
# TRUE`. Cette clause est une SYNTAXE POSTGRESQL 16+ ; sur 15 elle est une
# erreur de syntaxe, et la chaîne s'arrête à la migration 020. Mesuré, pas
# supposé. Le raisonnement même de 020 et 021 porte sur la sémantique
# d'héritage figée au GRANT, introduite en 16.
# La migration 092 exige de plus l'extension `vector` (pgvector 0.8.6,
# HNSW cosine m=16 ef_construction=64) : une image vanilla, 16 ou 17, échoue
# sur `CREATE EXTENSION vector`. La cible est donc pgvector/pgvector:0.8.6-pg16
# (PostgreSQL 16.15 + pgvector 0.8.6) — le même couple majeur+extension que le
# runtime canonique EDB 16.15 du paquet et que le conteneur de développement
# `mc-p3` depuis la réconciliation M07.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# Sous Git Bash (MSYS), un argument qui commence par `/` est converti en
# chemin Windows AVANT d'atteindre docker : `docker exec … -f /tmp/x.sql`
# devenait `-f C:/Users/…/Temp/x.sql`, introuvable DANS le conteneur (échec
# mesuré, pas supposé). On neutralise la conversion pour tout le script :
# les redirections `>/tmp/…` restent gérées par bash lui-même et continuent
# d'atteindre le vrai /tmp de l'hôte.
export MSYS_NO_PATHCONV=1

CONTENEUR="mindcare-checkpoint-pg"
PGIMAGE="pgvector/pgvector:0.8.6-pg16"
PGPASS="checkpoint-jetable"

fail=0
n=0
green(){ n=$((n+1)); printf '%-2s %-58s VERT\n'  "$n" "$1"; }
red(){   n=$((n+1)); printf '%-2s %-58s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
bail(){  echo "$1"; echo; echo "VERDICT : BLOQUÉ — rien n'a été prouvé."; nettoyer; exit 2; }
nettoyer(){ docker rm -f "$CONTENEUR" >/dev/null 2>&1 || true; }
trap nettoyer EXIT

command -v docker >/dev/null 2>&1 || bail "BLOQUÉ — docker introuvable."
docker info >/dev/null 2>&1       || bail "BLOQUÉ — démon docker injoignable."

q(){ docker exec "$CONTENEUR" psql -U postgres -d mindcare -tAX -c "$1" 2>&1; }
num(){ printf '%s\n' "$1" | grep -E '^[0-9]+$' | tail -1; }

echo "CHECKPOINT PG-LOCAL — PostgreSQL nu, sans Supabase"
echo

# ─── 1 · une base vierge ──────────────────────────────────────────────────────
# Locale ICU fr-DZ dès l'initialisation : le classement des noms accentués est
# figé à la création du cluster et ne se rattrape pas (SELF-HOST-SETUP §2.2).
nettoyer
docker run -d --name "$CONTENEUR" \
  -e POSTGRES_PASSWORD="$PGPASS" -e POSTGRES_DB=mindcare \
  -e POSTGRES_INITDB_ARGS="--locale-provider=icu --icu-locale=fr-DZ --encoding=UTF8 --locale=C" \
  "$PGIMAGE" >/dev/null 2>&1 || bail "BLOQUÉ — conteneur non démarré."

pret=0
for _ in $(seq 1 60); do
  docker exec "$CONTENEUR" pg_isready -U postgres -d mindcare >/dev/null 2>&1 && { pret=1; break; }
  sleep 1
done
[ "$pret" = "1" ] || bail "BLOQUÉ — PostgreSQL n'a pas démarré."

[ "$(num "$(q 'SELECT 1;')")" = "1" ] || bail "BLOQUÉ — base injoignable."

# `datlocprovider` est de type "char", pas text : sans le cast explicite, `||`
# ne sait pas choisir d'opérateur et la requête échoue au lieu de mesurer.
# `datlocale` n'existe qu'en PostgreSQL 17+ : sur PG16 on lit `daticulocale`
# (ICU) avec repli sur `datcollate` — les deux rendent « i fr-DZ » sur un
# cluster initialisé `--locale-provider=icu --icu-locale=fr-DZ`.
v=$(q "SELECT datlocprovider::text||' '||coalesce(daticulocale, datcollate, '?') FROM pg_database WHERE datname='mindcare';" | tail -1)
case "$v" in
  "i fr-DZ") green "cluster en ICU fr-DZ (classement des noms accentués)" ;;
  *)         red   "cluster en ICU fr-DZ" "lu=$v" ;;
esac

# ─── 2 · le bootstrap de compatibilité ────────────────────────────────────────
docker cp supabase/bootstrap/000_platform_compat.sql "$CONTENEUR:/tmp/bootstrap.sql" >/dev/null 2>&1 \
  || bail "BLOQUÉ — bootstrap introuvable."
if docker exec "$CONTENEUR" psql -U postgres -d mindcare -v ON_ERROR_STOP=1 -q -f /tmp/bootstrap.sql >/tmp/mc-boot.log 2>&1
then green "bootstrap de compatibilité appliqué"
else red   "bootstrap de compatibilité appliqué" "$(tail -3 /tmp/mc-boot.log | tr '\n' ' ')"
     echo; echo "VERDICT : ROUGE"; exit 1
fi

# Le bootstrap est rejoué : l'installateur doit pouvoir être relancé après un
# échec partiel sans qu'on ait à savoir où il s'était arrêté.
if docker exec "$CONTENEUR" psql -U postgres -d mindcare -v ON_ERROR_STOP=1 -q -f /tmp/bootstrap.sql >/dev/null 2>&1
then green "bootstrap idempotent (rejoué sans effet de bord)"
else red   "bootstrap idempotent" "le second passage échoue"; fi

# ─── 3 · la chaîne de migrations, INCHANGÉE ───────────────────────────────────
docker exec "$CONTENEUR" mkdir -p /mig >/dev/null 2>&1
docker cp supabase/migrations/. "$CONTENEUR:/mig/" >/dev/null 2>&1 || bail "BLOQUÉ — migrations introuvables."

attendu=$(find supabase/migrations -maxdepth 1 -name '*.sql' | wc -l | tr -d ' ')
casse=""
for f in $(find supabase/migrations -maxdepth 1 -name '*.sql' | sort); do
  b=$(basename "$f")
  if ! docker exec "$CONTENEUR" psql -U postgres -d mindcare -v ON_ERROR_STOP=1 -q -f "/mig/$b" >/tmp/mc-mig.log 2>&1; then
    casse="$b : $(grep -m1 -E '^(psql:)?.*ERROR' /tmp/mc-mig.log | cut -c1-90)"
    break
  fi
done
if [ -z "$casse" ]; then green "les $attendu migrations s'appliquent sans modification"
else red "les $attendu migrations s'appliquent sans modification" "$casse"
     echo; echo "VERDICT : ROUGE"; exit 1; fi

# Une migration appliquée qui ne s'enregistre pas laisserait `db-migrate.sh` la
# rejouer indéfiniment. Le 1:1 est la propriété qui rend la chaîne rejouable.
enr=$(num "$(q 'SELECT count(*) FROM app.schema_migrations;')")
[ "$enr" = "$attendu" ] && green "chaîne enregistrée 1:1 ($enr versions)" \
                        || red "chaîne enregistrée 1:1" "fichiers=$attendu enregistrées=$enr"

# ─── 4 · les invariants de cloison (ADR-019, I-RLS) ───────────────────────────
# Ce sont les propriétés que 018 affirmait tenir et qui ne tenaient pas. Chacune
# est MESURÉE sur la base, jamais déduite du texte des migrations.

v=$(q "SELECT has_table_privilege('authenticated','app.patients','SELECT');" | tail -1)
[ "$v" = "f" ] && green "SELECT direct sur app.patients révoqué (ADR-019)" \
               || red "SELECT direct sur app.patients révoqué" "lu=$v — audit contournable"

v=$(q "SELECT pg_has_role('app_gatekeeper','authenticated','USAGE');" | tail -1)
[ "$v" = "t" ] && green "app_gatekeeper hérite effectivement de authenticated" \
               || red "app_gatekeeper hérite de authenticated" "lu=$v — les portes rendraient zéro ligne"

v=$(q "SELECT rolsuper::text||rolbypassrls::text||rolcanlogin::text FROM pg_roles WHERE rolname='app_gatekeeper';" | tail -1)
[ "$v" = "fff" ] && green "app_gatekeeper sans SUPERUSER, BYPASSRLS ni LOGIN" \
                 || red "app_gatekeeper sans SUPERUSER/BYPASSRLS/LOGIN" "super/bypass/login=$v"

v=$(num "$(q "SELECT count(*) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role') AND (rolsuper OR rolbypassrls OR rolcanlogin);")")
[ "$v" = "0" ] && green "anon/authenticated/service_role sans privilège d'évasion" \
               || red "anon/authenticated/service_role sans privilège d'évasion" "$v rôle(s) en faute"

# T10 : aucune table du schéma applicatif sans RLS. Une seule suffit à ouvrir
# une fuite, et c'est toujours la dernière ajoutée qu'on oublie.
v=$(num "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace nsp ON nsp.oid=c.relnamespace WHERE nsp.nspname='app' AND c.relkind='r' AND NOT c.relrowsecurity;")")
[ "$v" = "0" ] && green "toutes les tables de app portent la RLS (T10)" \
               || red "toutes les tables de app portent la RLS" "$v table(s) sans RLS"

v=$(num "$(q "SELECT count(*) FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE r.rolname='app_gatekeeper';")")
[ "$v" -ge 40 ] 2>/dev/null && green "portes possédées par app_gatekeeper ($v)" \
                           || red "portes possédées par app_gatekeeper" "compte=$v"

# ─── 5 · l'identité de session, mécanisme des checkpoints RLS ─────────────────
# `auth.uid()` doit rendre NULL hors session et l'identité posée dedans. C'est
# le contrat exact que `SET LOCAL request.jwt.claim.sub` exerce déjà dans
# checkpoint-adr019.sh et checkpoint-j1a.sh.
v=$(q "SELECT coalesce(auth.uid()::text,'NULL');" | tail -1)
[ "$v" = "NULL" ] && green "auth.uid() rend NULL hors session" \
                  || red "auth.uid() rend NULL hors session" "lu=$v"

uid="00000000-0000-0000-0000-0000000000a2"
v=$(q "BEGIN; SET LOCAL request.jwt.claim.sub='$uid'; SELECT auth.uid(); ROLLBACK;" | grep -Eo '^[0-9a-f-]{36}$' | tail -1)
[ "$v" = "$uid" ] && green "auth.uid() rend l'identité posée par SET LOCAL" \
                  || red "auth.uid() rend l'identité posée" "lu=$v"

# LA propriété qui empêche une identité de fuir d'une requête à la suivante.
# `SET LOCAL` doit mourir avec sa transaction — sans quoi le pool de connexions
# de la phase 2 servirait le patient d'une praticienne à l'autre.
v=$(q "BEGIN; SET LOCAL request.jwt.claim.sub='$uid'; ROLLBACK; SELECT coalesce(auth.uid()::text,'NULL');" | tail -1)
[ "$v" = "NULL" ] && green "l'identité ne survit pas à sa transaction" \
                  || red "l'identité ne survit pas à sa transaction" "lu=$v — FUITE ENTRE REQUÊTES"

# ─── 6 · la cloison praticienne, mesurée ──────────────────────────────────────
# Le seed 015 porte deux praticiennes et des patients de chacune. La porte doit
# rendre à la Dr #2 ses patients, et EXACTEMENT ceux-là.
DR2=$(q "SELECT id FROM app.profiles WHERE role='practitioner' AND is_active LIMIT 1;" | grep -Eo '^[0-9a-f-]{36}$' | tail -1)
if [ -z "$DR2" ]; then
  red "cloison praticienne mesurable" "aucun profil practitioner dans le seed"
else
  siens=$(num "$(q "SELECT count(*) FROM app.patients WHERE practitioner_id='$DR2' AND is_active;")")
  autres=$(num "$(q "SELECT count(*) FROM app.patients WHERE practitioner_id<>'$DR2' AND is_active;")")
  if [ "${autres:-0}" -eq 0 ] 2>/dev/null; then
    red "cloison praticienne mesurable" "aucun patient d'une autre praticienne — invérifiable"
  else
    vus=$(num "$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2'; SELECT count(*) FROM app.search_patients(NULL,100,0); ROLLBACK;")")
    [ "$vus" = "$siens" ] && green "la praticienne ne voit que ses patients ($vus/$((siens+autres)))" \
                          || red "la praticienne ne voit que ses patients" "vus=$vus siens=$siens"
  fi
fi

# Lire un dossier sans laisser de trace doit être IMPOSSIBLE, pas déconseillé.
av=$(num "$(q 'SELECT count(*) FROM audit.read_log;')")
pid=$(q "SELECT id FROM app.patients WHERE practitioner_id='$DR2' LIMIT 1;" | grep -Eo '^[0-9a-f-]{36}$' | tail -1)
if [ -n "$pid" ] && [ -n "${av:-}" ]; then
  q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2'; SELECT count(*) FROM app.get_patient('$pid'); COMMIT;" >/dev/null 2>&1
  ap=$(num "$(q 'SELECT count(*) FROM audit.read_log;')")
  [ "${ap:-0}" -gt "${av:-0}" ] 2>/dev/null && green "la porte patient journalise la lecture (${av}→${ap})" \
                                            || red "la porte patient journalise la lecture" "avant=$av après=$ap"
fi

# ─── 7 · le contrat vectoriel M07 (migration 092) ────────────────────────────
# La chaîne vient de s'appliquer SANS MODIFICATION, donc 092 est passée sur
# ce runtime. On mesure ici ce qu'elle a posé : extension, colonne 1024d,
# index HNSW aux paramètres de la migration, portes de lecture, RLS.
v=$(q "SELECT extversion FROM pg_extension WHERE extname='vector';" | tail -1)
[ "$v" = "0.8.6" ] && green "extension vector 0.8.6" \
                   || red "extension vector 0.8.6" "lu=$v"

v=$(q "SELECT reloptions::text FROM pg_class WHERE relname='knowledge_chunks_embedding_hnsw';" | tail -1)
[ "$v" = "{m=16,ef_construction=64}" ] && green "HNSW m=16 ef_construction=64 (vector_cosine_ops)" \
                                       || red "HNSW m=16 ef_construction=64" "lu=$v"

v=$(q "SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid='app.knowledge_chunks'::regclass AND attname='embedding';" | tail -1)
[ "$v" = "vector(1024)" ] && green "colonne embedding vector(1024)" \
                           || red "colonne embedding vector(1024)" "lu=$v"

v=$(num "$(q "SELECT count(*) FROM pg_proc WHERE proname IN ('search_knowledge_lexical','search_knowledge_vector');")")
[ "$v" = "2" ] && green "portes search_knowledge_lexical + search_knowledge_vector" \
               || red "portes search_knowledge_lexical/vector" "trouvées=$v"

v=$(num "$(q "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='app' AND c.relname IN ('knowledge_sources','knowledge_chunks') AND c.relrowsecurity;")")
[ "$v" = "2" ] && green "RLS sur knowledge_sources + knowledge_chunks" \
               || red "RLS sur knowledge_sources/chunks" "trouvées=$v"

echo
if [ "$fail" = "0" ]; then echo "VERDICT : VERT — $n contrôles, le schéma tient sur PostgreSQL nu."; exit 0
else                       echo "VERDICT : ROUGE"; exit 1; fi
