#!/usr/bin/env bash
# verify-migrations — contrôle STATIQUE du corpus de migrations, AVANT qu'il ne
# touche une base. Lecture seule : n'ouvre aucune connexion, n'écrit rien.
#
#   bash scripts/verify-migrations.sh
#
# POURQUOI AVANT ET PAS SEULEMENT APRÈS. `checkpoint-j1a.sh` vérifie les mêmes
# propriétés sur une base DÉJÀ écrite (T10). C'est nécessaire, mais tardif : sur
# le cloud, constater après coup qu'une table est arrivée sans RLS veut dire
# qu'elle a existé sans RLS. Ce script rend le même verdict pendant qu'il ne
# coûte encore rien. Les deux se gardent : l'un lit le texte, l'autre la base,
# et seule la base fait foi. Ne pas retirer T10 en croyant que ceci le remplace.
#
# PIÈGE FERMÉ ICI, rencontré en écrivant le contrôle : chercher
# `SECURITY DEFINER` dans le fichier brut fait mordre sur les COMMENTAIRES qui
# parlent de SECURITY DEFINER — et 013 comme 016 en contiennent, pour de bonnes
# raisons. Un contrôle qui crie au loup sur ses propres commentaires finit
# désactivé, donc protège moins. On dépouille donc les commentaires `--` avant
# toute recherche. Limite assumée : les commentaires par blocs `/* */` ne sont
# pas dépouillés — le corpus n'en emploie aucun, et le jour où il en emploiera,
# ce contrôle criera plutôt que de se taire. C'est le bon sens du défaut.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
MIGDIR="supabase/migrations"
fail=0

echo "VÉRIFICATION STATIQUE — $MIGDIR"
echo

# Corpus dépouillé de ses commentaires de ligne, concaténé dans l'ordre.
SQL=$(mktemp)
trap 'rm -f "$SQL"' EXIT
for f in $(ls "$MIGDIR"/*.sql | sort); do
  sed -e 's/--.*$//' "$f"
done > "$SQL"

note() { printf '  %-58s %s\n' "$1" "$2"; }
bad()  { note "$1" "ROUGE"; shift; printf '        %s\n' "$@"; fail=1; }

# --- 1 · RLS ENABLE et FORCE sur chaque table créée (I2) -------------------------
# Les deux : `ENABLE` seul laisse le PROPRIÉTAIRE de la table passer outre.
for schema in app audit; do
  missing=""
  for t in $(grep -oiE "CREATE TABLE (IF NOT EXISTS )?$schema\.[a-z_]+" "$SQL" \
             | sed -E "s/.*$schema\.//" | sort -u); do
    grep -qiE "ALTER TABLE $schema\.$t[[:space:]]+ENABLE[[:space:]]+ROW LEVEL SECURITY" "$SQL" \
      || missing="$missing $t(ENABLE)"
    grep -qiE "ALTER TABLE $schema\.$t[[:space:]]+FORCE[[:space:]]+ROW LEVEL SECURITY" "$SQL" \
      || missing="$missing $t(FORCE)"
  done
  if [ -n "$missing" ]; then bad "1 · RLS ENABLE+FORCE sur $schema" "$missing"
  else note "1 · RLS ENABLE+FORCE sur $schema" "vert"; fi
done

# --- 2 · toute table `app` porte au moins une policy ----------------------------
# `FORCE RLS` sans policy = table murée pour tout le monde, y compris les
# migrations suivantes. Le symptôme arrive loin de la cause ; on le prend ici.
missing=""
for t in $(grep -oiE "CREATE TABLE (IF NOT EXISTS )?app\.[a-z_]+" "$SQL" \
           | sed -E 's/.*app\.//' | sort -u); do
  grep -qiE "CREATE POLICY [a-z_]+ ON app\.$t\b" "$SQL" || missing="$missing $t"
done
if [ -n "$missing" ]; then bad "2 · au moins une policy par table app" "$missing"
else note "2 · au moins une policy par table app" "vert"; fi

# --- 3 · SECURITY DEFINER toujours avec un search_path figé ---------------------
# Une fonction SECURITY DEFINER sans search_path explicite est une escalade de
# privilèges classique : l'appelant choisit le schéma, donc le code exécuté.
#
# ⚠️ LE PIÈGE DE L'EN-TÊTE S'EST ROUVERT PAR UN AUTRE CHEMIN, corrigé ici.
# L'en-tête de ce fichier explique qu'on dépouille les commentaires `--` avant
# de chercher `SECURITY DEFINER`, sinon le contrôle mord sur les commentaires
# qui PARLENT de SECURITY DEFINER. Exact — mais insuffisant depuis S7b : `030`
# écrit `SECURITY DEFINER` à l'intérieur de LITTÉRAUX SQL, dans ses
# `COMMENT ON FUNCTION` (030:647, 758, 824). Ces trois-là ne sont pas des
# déclarations, ne peuvent pas porter de `search_path`, et faisaient donc
# compter 29 déclarations pour 26 `search_path` — un ROUGE PERMANENT sur un
# corpus sain, dont le verdict est « ne rien appliquer avant correction ».
#
# C'est le défaut que l'en-tête redoute nommément : « un contrôle qui crie au
# loup […] finit désactivé, donc protège moins ». Vérifié à la main avant de
# corriger : les 26 déclarations réelles portent TOUTES leur `search_path` à la
# ligne suivante ; les 3 surnuméraires sont bien les 3 littéraux de 030.
#
# On dépouille donc AUSSI les littéraux entre apostrophes — mais UNIQUEMENT
# pour ce contrôle-ci, sur une copie séparée. Surtout pas pour tout le
# fichier : le contrôle 6 cherche des NOMS, qui vivent précisément dans les
# littéraux des `INSERT` de seed. Le dépouiller globalement rendrait aveugle le
# seul contrôle qui ait déjà trouvé une identité réelle dans `015`.
SQL_NOSTR=$(mktemp)
trap 'rm -f "$SQL" "$SQL_NOSTR"' EXIT
sed -e "s/'[^']*'//g" "$SQL" > "$SQL_NOSTR"
defs=$(grep -ciE "SECURITY DEFINER" "$SQL_NOSTR")
paths=$(grep -A3 -iE "SECURITY DEFINER" "$SQL_NOSTR" | grep -ciE "SET[[:space:]]+search_path")
if [ "$defs" -gt 0 ] && [ "$paths" -lt "$defs" ]; then
  bad "3 · SECURITY DEFINER + search_path figé" "$defs déclaration(s), $paths search_path"
else note "3 · SECURITY DEFINER + search_path figé ($defs)" "vert"; fi

# --- 4 · aucune policy permissive sur une table portant patient_id --------------
# `USING (true)` sur du Tier 0/1 annule la cloison entre praticiennes.
out=$(grep -iE "CREATE POLICY" -A6 "$SQL" | grep -iE "USING[[:space:]]*\([[:space:]]*true" || true)
ctx=$(grep -iE "CREATE POLICY [a-z_]+ ON app\.(patients|consultations|clinical_notes|transcript_segments|live_insights|diagnoses|prescriptions|appointment_reasons)\b" -A6 "$SQL" \
      | grep -iE "USING[[:space:]]*\([[:space:]]*true" || true)
if [ -n "$ctx" ]; then bad "4 · aucune policy permissive sur le clinique" "$ctx"
else note "4 · aucune policy permissive sur le clinique" "vert"; fi

# --- 5 · une transaction par fichier, et une ligne de version -------------------
# Sans BEGIN/COMMIT, un échec en milieu de fichier laisse un schéma à moitié
# appliqué — l'état le plus coûteux à diagnostiquer.
for f in $(ls "$MIGDIR"/*.sql | sort); do
  v=$(basename "$f" .sql)
  grep -qE '^BEGIN;' "$f"  || { bad "5 · $v" "BEGIN; absent"; }
  grep -qE '^COMMIT;' "$f" || { bad "5 · $v" "COMMIT; absent"; }
  grep -q "schema_migrations" "$f" || { bad "5 · $v" "n'enregistre pas sa version"; }
done
[ $fail -eq 0 ] && note "5 · transaction + version par fichier" "vert"

# --- 6 · aucune donnée nominative dans le corpus (I19, ADR-016) -----------------
# Un nom réel ou vraisemblable dans une migration est une donnée fictive livrée —
# et si 016 la marque `is_synthetic = true` alors qu'elle ne l'est pas, le
# garde-fou affirme quelque chose de faux. C'est ce contrôle qui a trouvé
# l'identité réelle de la praticienne dans le seed de 015.
#
# BOGUE CORRIGÉ ICI, et il rendait le contrôle à moitié aveugle : l'exclusion des
# commentaires était `grep -v "^\s*--"` appliquée à une sortie `grep` PRÉFIXÉE de
# `fichier:ligne:`. Le motif ne pouvait donc jamais correspondre, et le contrôle
# criait sur ses propres commentaires. Un contrôle qui crie à tort finit
# désactivé, donc protège moins. On dépouille désormais fichier par fichier, en
# conservant le numéro de ligne.
out=""
for f in $(ls "$MIGDIR"/*.sql | sort); do
  hit=$(sed -e 's/--.*$//' "$f" | grep -inE "larbi|benali|ayoub|mohamed|fatima" || true)
  [ -n "$hit" ] && out="$out$(printf '%s' "$hit" | sed "s|^|$f:|")"$'\n'
done
out=$(printf '%s' "$out" | sed '/^$/d')
if [ -n "$out" ]; then bad "6 · aucun nom réel ou vraisemblable" "$out"
else note "6 · aucun nom réel ou vraisemblable dans le corpus" "vert"; fi

echo
if [ $fail -eq 0 ]; then
  echo "VERDICT : VERT — le corpus peut être appliqué."
  exit 0
fi
echo "VERDICT : ROUGE — ne rien appliquer avant correction."
exit 1
