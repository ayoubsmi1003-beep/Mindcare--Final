#!/usr/bin/env bash
# CHECKPOINT ADR-019 — la porte auditée vers le dossier patient, et le mur.
#
#   bash scripts/checkpoint-adr019.sh
#
# Ce fichier existe parce que TROIS implémentations successives ont échoué, et
# que deux d'entre elles paraissaient correctes à la relecture. 018 affirmait
# par écrit que la cloison tenait ; seule l'exécution a montré le contraire.
# Aucune propriété n'est donc « évidente » ici : chacune est mesurée.
#
# VERT / ROUGE / BLOQUÉ (code 2), comme les autres checkpoints du dépôt.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# shellcheck source=scripts/lib/dburl.sh
. scripts/lib/dburl.sh

fail=0
n=0
PGIMAGE="postgres:15"
DBURL=$(resolve_dburl)

echo "CHECKPOINT ADR-019 — audit des lectures et cloison praticiennes"

green(){ n=$((n+1)); printf '%-2s %-56s VERT\n'  "$n" "$1"; }
red()  { n=$((n+1)); printf '%-2s %-56s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }

bail(){ echo "$1"; echo; echo "VERDICT : BLOQUÉ — rien n'a été prouvé."; exit 2; }

[ -n "$DBURL" ]                   || bail "BLOQUÉ — DATABASE_URL introuvable."
command -v docker >/dev/null 2>&1 || bail "BLOQUÉ — docker introuvable."
docker info >/dev/null 2>&1       || bail "BLOQUÉ — démon docker injoignable."
dburl_is_direct "$DBURL"          && bail "BLOQUÉ — connexion directe (IPv6 seul)."

q(){ docker run --rm -e PGURL="$DBURL" -e SQL="$1" "$PGIMAGE" \
       sh -c 'psql "$PGURL" -qtAX -c "$SQL"' 2>&1; }

# ─── EXTRACTION DES RÉSULTATS ─────────────────────────────────────────────────
# Une erreur Postgres tient sur PLUSIEURS lignes : `ERROR:` d'abord, puis
# `HINT:` et `CONTEXT:`. Un `tail -1` rend donc la dernière ligne du HINT, où le
# mot « permission denied » n'apparaît plus. Écrit ainsi la première fois, ce
# fichier a rendu SIX faux ROUGE — il accusait la sécurité alors qu'il lisait la
# mauvaise ligne. Un contrôle qui se trompe de ligne est pire qu'absent : il
# envoie corriger ce qui fonctionne.
num(){    printf '%s\n' "$1" | grep -E '^[0-9]+$'        | tail -1; }
uuid(){   printf '%s\n' "$1" | grep -Eo '^[0-9a-f-]{36}$' | tail -1; }
word(){   printf '%s\n' "$1" | grep -vE '^\s*$'          | tail -1; }
denied(){ printf '%s\n' "$1" | grep -qiE 'permission denied|ajout seul|append-only|droit'; }
first(){  printf '%s\n' "$1" | head -1; }

[ "$(num "$(q 'SELECT 1;')")" = "1" ] || bail "BLOQUÉ — base injoignable."
echo "Cible : $(dburl_host "$DBURL")"
echo

# ─── identités du seed ────────────────────────────────────────────────────────
OWNER=$(uuid  "$(q "SELECT id FROM app.profiles WHERE role='owner'        AND is_active LIMIT 1;")")
DR2=$(uuid    "$(q "SELECT id FROM app.profiles WHERE role='practitioner' AND is_active LIMIT 1;")")
ASSIST=$(uuid "$(q "SELECT id FROM app.profiles WHERE role='assistant'    AND is_active LIMIT 1;")")
[ -n "$OWNER" ] && [ -n "$DR2" ] || bail "BLOQUÉ — profils du seed 015 introuvables."

MINE_DR2=$(num "$(q "SELECT count(*) FROM app.patients WHERE practitioner_id='$DR2' AND is_active;")")
MINE=$(uuid    "$(q "SELECT id FROM app.patients WHERE practitioner_id='$DR2' LIMIT 1;")")
OTHERS=$(uuid  "$(q "SELECT id FROM app.patients WHERE practitioner_id<>'$DR2' LIMIT 1;")")
TOTAL=$(num    "$(q "SELECT count(*) FROM app.patients WHERE is_active;")")

# Sans patient d'une AUTRE praticienne, la cloison est INVÉRIFIABLE — et un
# contrôle qui passerait au vert sur un jeu de données incapable de le
# contredire ne prouve rien. On refuse de rendre un verdict dans ce cas.
[ -n "$OTHERS" ] || bail "BLOQUÉ — le seed ne contient aucun patient d'une autre praticienne."
[ -n "$MINE" ]   || bail "BLOQUÉ — la Dr #2 n'a aucun patient dans le seed."

# Joue une requête sous un rôle applicatif et une identité. Transaction annulée :
# un checkpoint ne laisse pas de trace.
as(){ q "BEGIN; SET LOCAL role='$1'; SET LOCAL request.jwt.claim.sub='$2'; $3 ROLLBACK;"; }

# ═══ 1 · La praticienne ne voit QUE ses patients ══════════════════════════════
v=$(num "$(as authenticated "$DR2" "SELECT count(*) FROM app.search_patients(NULL,100,0);")")
[ "$v" = "$MINE_DR2" ] && green "Dr B ne voit que ses patients ($v)" \
                       || red "Dr B ne voit que ses patients" "vus=$v siens=$MINE_DR2"

# ═══ 2 · Elle ne lit PAS le dossier d'une autre ═══════════════════════════════
# La porte rend 0 LIGNE, elle n'échoue pas : un refus explicite révélerait
# l'existence du dossier, un ensemble vide ne révèle rien.
v=$(num "$(as authenticated "$DR2" "SELECT count(*) FROM app.get_patient('$OTHERS');")")
[ "$v" = "0" ] && green "Dr B ne lit pas le dossier de Dr A (0 ligne)" \
               || red "Dr B ne lit pas le dossier de Dr A" "obtenu $v — CLOISON TOMBÉE"

# ═══ 3 · Elle lit BIEN le sien (un mur qui bloque tout n'est pas un mur) ══════
v=$(num "$(as authenticated "$DR2" "SELECT count(*) FROM app.get_patient('$MINE');")")
[ "$v" = "1" ] && green "Dr B lit bien son propre dossier" \
               || red "Dr B lit son propre dossier" "obtenu $v"

# ═══ 4 · L'owner voit le cabinet entier (ADR-005) ════════════════════════════
v=$(num "$(as authenticated "$OWNER" "SELECT count(*) FROM app.search_patients(NULL,100,0);")")
[ "$v" = "$TOTAL" ] && green "Dr A (owner) voit tout le cabinet ($v)" \
                    || red "Dr A (owner) voit tout le cabinet" "vus=$v total=$TOTAL"

# ═══ 5 · SELECT direct refusé ════════════════════════════════════════════════
out=$(as authenticated "$OWNER" "SELECT count(*) FROM app.patients;")
denied "$out" && green "SELECT direct sur app.patients refusé" \
              || red "SELECT direct sur app.patients refusé" "$(first "$out")"

# ═══ 6 · Lecture réussie = EXACTEMENT une ligne d'audit ══════════════════════
# DEUX PIÈGES DE MESURE, tous deux rencontrés ici :
#   • `PERFORM` n'existe qu'en PL/pgSQL. En SQL direct c'est une erreur de
#     syntaxe, et le delta revenait vide — pas zéro, VIDE.
#   • le comptage doit se faire sous un rôle qui VOIT `audit.log`. La policy
#     `audit_read_owner` de 013 le réserve à l'owner : la Dr #2 comptait donc à
#     l'aveugle et trouvait 0. On lit AVANT/APRÈS hors du rôle applicatif, la
#     lecture elle-même restant faite sous ce rôle. Tout est dans une seule
#     transaction annulée.
d=$(num "$(q "BEGIN;
  CREATE TEMP TABLE av AS SELECT count(*) c FROM audit.log WHERE operation='select';
  SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2';
  SELECT count(*) FROM app.get_patient('$MINE');
  RESET ROLE;
  SELECT (SELECT count(*) FROM audit.log WHERE operation='select')-(SELECT c FROM av);
  ROLLBACK;")")
[ "$d" = "1" ] && green "lecture réussie → exactement 1 ligne d'audit" \
               || red "lecture réussie → 1 ligne d'audit" "delta=$d"

# ═══ 7 · Lecture infructueuse : tracée aussi, et SANS doublon ════════════════
# La TENTATIVE doit être tracée — « qui a cherché à ouvrir quel dossier » est ce
# qu'un audit doit savoir dire. Ce qu'on refuse ici, c'est le DOUBLON.
d=$(num "$(q "BEGIN;
  CREATE TEMP TABLE av2 AS SELECT count(*) c FROM audit.log WHERE operation='select';
  SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2';
  SELECT count(*) FROM app.get_patient('$OTHERS');
  RESET ROLE;
  SELECT (SELECT count(*) FROM audit.log WHERE operation='select')-(SELECT c FROM av2);
  ROLLBACK;")")
[ "$d" = "1" ] && green "lecture refusée → 1 ligne d'audit, sans doublon" \
               || red "lecture refusée → 1 ligne d'audit" "delta=$d"

# ═══ 8 · audit.log en ajout seul ═════════════════════════════════════════════
# ON TESTE LES RÔLES APPLICATIFS, pas le rôle de connexion.
# 013 rend `audit.log` append-only par RLS (aucune policy UPDATE/DELETE) ET par
# REVOKE. Ni l'un ni l'autre ne contraint `postgres`, qui possède la table et
# porte `BYPASSRLS` : testé sous ce rôle, l'UPDATE passait — et le contrôle
# criait à la violation d'I4 alors qu'il interrogeait le seul rôle qui n'est pas
# concerné. LIMITE RÉELLE, écrite plutôt qu'enjolivée : un superutilisateur ou
# le propriétaire modifie toujours le journal. Même portée qu'ADR-016 §3 —
# EFFECTIVEMENT append-only pour l'application, PostgREST, les edge functions
# et Jarvis ; pas INVIOLABLE. `pgaudit` en auto-hébergé sera le second filet.
for r in authenticated anon service_role; do
  out=$(q "BEGIN; SET LOCAL role='$r'; UPDATE audit.log SET operation='insert' WHERE true; ROLLBACK;")
  denied "$out" && green "audit.log refuse UPDATE à $r" \
                || red "audit.log refuse UPDATE à $r" "$(first "$out")"
  out=$(q "BEGIN; SET LOCAL role='$r'; DELETE FROM audit.log WHERE true; ROLLBACK;")
  denied "$out" && green "audit.log refuse DELETE à $r" \
                || red "audit.log refuse DELETE à $r" "$(first "$out")"
done

# ═══ 9 · Nul ne peut FABRIQUER une trace de lecture ══════════════════════════
out=$(as authenticated "$DR2" "SELECT audit.log_read('$MINE','fiche');")
denied "$out" && green "audit.log_read injoignable directement" \
              || red "audit.log_read injoignable directement" "traces falsifiables"

# ═══ 10 · LE contrôle qui aurait attrapé 018 ═════════════════════════════════
# Aucune fonction SECURITY DEFINER touchant le dossier patient ne doit être
# possédée par un rôle capable de contourner la RLS. Par DÉCOUVERTE, pas par
# liste : une porte ajoutée demain tombe sous le même contrôle.
bad=$(word "$(q "SELECT coalesce(string_agg(p.proname || ' → ' || pg_get_userbyid(p.proowner), ', '), '')
  FROM pg_proc p
  JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
  JOIN pg_roles r ON r.oid = p.proowner
  WHERE nsp.nspname='app' AND p.prosecdef AND p.prosrc LIKE '%app.patients%'
    AND (r.rolsuper OR r.rolbypassrls);")")
[ -z "$bad" ] && green "aucune porte SECURITY DEFINER possédée par un rôle BYPASSRLS" \
              || red "porte possédée par un rôle BYPASSRLS" "$bad — RLS CONTOURNÉE"

# ═══ 11 · Le porteur lui-même ════════════════════════════════════════════════
a=$(word "$(q "SELECT rolsuper::text||'/'||rolbypassrls::text||'/'||rolcanlogin::text
               FROM pg_roles WHERE rolname='app_gatekeeper';")")
[ "$a" = "false/false/false" ] && green "app_gatekeeper : ni SUPERUSER, ni BYPASSRLS, ni LOGIN" \
                              || red "app_gatekeeper : attributs" "super/bypass/login=$a"

# ═══ 12 · L'héritage effectif — la panne muette du design ════════════════════
# Sans lui, aucune policy de 004 ne s'applique et les portes rendent zéro ligne
# SANS ERREUR. C'est le piège qui a coûté le plus de temps.
a=$(word "$(q "SELECT pg_has_role('app_gatekeeper','authenticated','USAGE')::text;")")
[ "$a" = "true" ] && green "app_gatekeeper hérite effectivement de authenticated" \
                  || red "héritage effectif" "pg_has_role USAGE=$a — policies inertes"

# ═══ 13 · Il n'est pas propriétaire de la table ══════════════════════════════
a=$(word "$(q "SELECT pg_get_userbyid(relowner) FROM pg_class c
               JOIN pg_namespace nsp ON nsp.oid=c.relnamespace
               WHERE nsp.nspname='app' AND c.relname='patients';")")
[ "$a" != "app_gatekeeper" ] && green "app_gatekeeper n'est pas propriétaire de app.patients" \
                             || red "app_gatekeeper propriétaire de la table" "FORCE RLS contournable"

# ═══ 14 · Il ne peut rien créer dans `app` (attaque de search_path) ══════════
a=$(word "$(q "SELECT has_schema_privilege('app_gatekeeper','app','CREATE')::text;")")
[ "$a" = "false" ] && green "app_gatekeeper ne peut rien créer dans le schéma app" \
                   || red "app_gatekeeper a CREATE sur app" "peut masquer une fonction du search_path"

# ═══ 15 · authenticated n'a pas retrouvé SELECT par la bande ════════════════
a=$(word "$(q "SELECT has_table_privilege('authenticated','app.patients','SELECT')::text;")")
[ "$a" = "false" ] && green "authenticated n'a toujours pas SELECT sur app.patients" \
                   || red "authenticated a SELECT sur app.patients" "ADR-019 annulée"

# ═══ 16 · `anon` ne franchit aucune porte ═══════════════════════════════════
out=$(q "BEGIN; SET LOCAL role='anon'; SELECT count(*) FROM app.search_patients(NULL,10,0); ROLLBACK;")
denied "$out" && green "anon ne franchit pas les portes" \
              || red "anon ne franchit pas les portes" "$(first "$out")"

# ═══ 17 · L'écriture ne déplace pas un patient d'une praticienne à l'autre ═══
out=$(as authenticated "$OWNER" "SELECT count(*) FROM app.update_patient('$MINE','{\"practitioner_id\":\"$OWNER\"}'::jsonb);")
printf '%s\n' "$out" | grep -q "Champ non modifiable" \
  && green "update_patient refuse practitioner_id (ADR-003)" \
  || red "update_patient refuse practitioner_id" "CLOISON CONTOURNABLE"

# ═══ 18 · L'écriture respecte la cloison ════════════════════════════════════
v=$(num "$(as authenticated "$DR2" "SELECT count(*) FROM app.update_patient('$OTHERS','{\"notes_admin\":\"x\"}'::jsonb);")")
[ "$v" = "0" ] && green "Dr B ne peut pas modifier le patient de Dr A" \
               || red "Dr B ne peut pas modifier le patient de Dr A" "obtenu $v"

# ═══ 19 · L'assistante ne voit aucun clinique (§6) ══════════════════════════
if [ -n "$ASSIST" ]; then
  v=$(num "$(as authenticated "$ASSIST" "SELECT count(*) FROM app.clinical_notes;")")
  [ "$v" = "0" ] && green "assistante → 0 note clinique" \
                 || red "assistante → notes cliniques" "obtenu $v"
else
  red "assistante → notes cliniques" "profil assistant introuvable"
fi

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — $n contrôles joués. Corriger la cause, jamais le contrôle."
  exit 1
fi
echo "VERDICT : VERT — $n contrôles."
exit 0
