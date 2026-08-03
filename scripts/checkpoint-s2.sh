#!/usr/bin/env bash
# CHECKPOINT S2 — la couche src/services/*, ADR-019 et ADR-020.
# VERT ou ROUGE. Rien entre les deux.
#
#   bash scripts/checkpoint-s2.sh
#
# TROIS VERDICTS, ET LE TROISIÈME EST LA RAISON D'ÊTRE DE CE DÉCOUPAGE :
#   VERT   — les 12 contrôles ont été exécutés et passent.
#   ROUGE  — au moins un contrôle exécuté a échoué.
#   BLOQUÉ — les contrôles STATIQUES passent, mais ceux qui exigent la base
#            n'ont pas pu être exécutés (DATABASE_URL absent, ou schéma non
#            appliqué). Ce n'est PAS un vert. Un checkpoint qui rendrait vert
#            après avoir sauté la moitié de ses contrôles est pire qu'un
#            checkpoint absent : il autorise à commiter en croyant avoir prouvé.
#            Code de sortie 2, distinct du 1 de ROUGE, pour qu'un enchaînement
#            de scripts ne confonde pas les deux.
#
# psql n'est pas installé sur ce poste : les contrôles base passent par un
# conteneur jetable, comme db-migrate.sh. LE SECRET N'EST JAMAIS AFFICHÉ.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
blocked=0
n=0
echo "CHECKPOINT S2"
echo

ADAPTER="src/services/db/supabase.ts"

green() { n=$((n+1)); printf '%-2s %-56s VERT\n' "$n" "$1"; }
red()   { n=$((n+1)); printf '%-2s %-56s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
skip()  { n=$((n+1)); printf '%-2s %-56s BLOQUÉ %s\n' "$n" "$1" "$2"; blocked=1; }

# ═══ CONTRÔLES STATIQUES — toujours exécutés ═══════════════════════════════════

# 1 · un seul import de Supabase dans tout src/ (I3, ADR-020)
out=$(grep -rln "@supabase/supabase-js\|@supabase/ssr" --include="*.ts" --include="*.tsx" src/ 2>/dev/null \
      | grep -v "^$ADAPTER$")
[ -z "$out" ] && green "un seul import Supabase ($ADAPTER)" \
              || red "un seul import Supabase" "$(printf '%s' "$out" | tr '\n' ' ')"

# 2 · `patients` et `appointments` jamais requêtées en direct (ADR-019, ADR-017)
out=$(grep -rnE "relation:[[:space:]]*[\"'](patients|appointments)[\"']|from\([\"'](patients|appointments)[\"']\)" \
        --include="*.ts" --include="*.tsx" src/ 2>/dev/null)
[ -z "$out" ] && green "patients/appointments jamais requêtées en direct" \
              || red "patients/appointments requêtées en direct" "$(printf '%s' "$out" | head -1)"

# 3 · aucun composant n'importe un service de base sans passer par src/services
#     (I3 : le sens de la dépendance, pas seulement son existence)
out=$(grep -rn "from \"@/services/db/supabase\"\|from '../services/db/supabase'" \
        --include="*.tsx" src/ 2>/dev/null)
[ -z "$out" ] && green "aucun composant n'atteint l'adaptateur directement" \
              || red "composant → adaptateur en direct" "$(printf '%s' "$out" | head -1)"

# 4 · le bandeau ADR-016 lit la base, et n'est pas piloté par une variable
#     d'environnement. Un bandeau qui se fie à .env se trompe en silence.
banner="src/components/SyntheticDataBanner.tsx"
if [ ! -f "$banner" ]; then
  red "bandeau ADR-016 présent" "$banner absent"
elif grep -q "getDeploymentEnvironment" "$banner" \
     && ! grep -q "process\.env" "$banner"; then
  green "bandeau ADR-016 : valeur lue en base, pas dans .env"
else
  red "bandeau ADR-016 : source de la valeur" "lit process.env ou n'appelle pas le service"
fi

# 5 · le bandeau n'emploie ni le jeton critique ni le verre (§4.1, §4.2)
#     Le rouge est un budget ; un bandeau permanent en rouge le vide, et le jour
#     où le disque sature réellement, personne ne le voit.
#
# ⚠️ ON DÉPOUILLE LES COMMENTAIRES AVANT DE CHERCHER. Sans ça, le contrôle mord
# sur la PHRASE du composant qui explique justement qu'il n'emploie pas le jeton
# critique — constaté au premier lancement. C'est le troisième contrôle de ce
# dépôt à tomber dans ce piège (préflight, verify-migrations, puis celui-ci) :
# un garde-fou qui inspecte du CODE doit voir du code, pas de la prose.
if [ ! -f "$banner" ]; then
  red "bandeau : jetons" "$banner absent"
elif sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' "$banner" \
     | grep -qE '\-\-critical|backdrop-filter|\-\-glass'; then
  red "bandeau : jetons interdits" "jeton critique ou verre détecté dans le code"
else
  green "bandeau : --attention, sans jeton critique ni verre"
fi

# 6 · aucune chaîne d'interface en dur dans le bandeau (I8)
if [ -f "$banner" ] && grep -q "fr.bandeauSynthetique" "$banner"; then
  green "bandeau : libellés depuis src/i18n/fr.ts"
else
  red "bandeau : libellés" "chaîne en dur ou i18n absente"
fi

# 7 · le port est injectable — preuve de l'inversion de dépendance (ADR-020)
if grep -q "export function setDbPort" src/services/db/index.ts 2>/dev/null \
   && grep -q "export function db()" src/services/db/index.ts 2>/dev/null; then
  green "DbPort injectable (setDbPort) — ADR-001 reste configurable"
else
  red "DbPort injectable" "setDbPort/db() absents de src/services/db/index.ts"
fi

# 8 · les quatre portes du dépôt
for gate in "pnpm typecheck" "pnpm lint" "pnpm build"; do
  if $gate >/dev/null 2>&1; then green "$gate"; else red "$gate" "voir la sortie complète"; fi
done
if bash scripts/preflight.sh >/dev/null 2>&1; then green "preflight muet"; else red "preflight" "sortie non vide"; fi

# ═══ CONTRÔLES BASE — exigent le schéma appliqué ═══════════════════════════════

# Résolution partagée avec db-migrate.sh et checkpoint-j1a.sh. La version locale
# qui vivait ici ne réencodait PAS le mot de passe : un mot de passe Supabase
# contenant `#` ou `/` faisait échouer la connexion, et les trois contrôles base
# tombaient en BLOQUÉ « base injoignable » — un diagnostic faux, qui masquait la
# vraie cause. Un garde-fou corrigé dans un script sur trois est absent.
# shellcheck source=scripts/lib/dburl.sh
. scripts/lib/dburl.sh
DBURL=$(resolve_dburl)

# La requête voyage par variable d'environnement : aucun guillemet du SQL ne peut
# refermer la chaîne, et le secret reste hors de la ligne de commande de l'hôte.
q() { docker run --rm -e PGURL="$DBURL" -e SQL="$1" postgres:15 \
        sh -c 'psql "$PGURL" -qtAX -c "$SQL"' 2>&1 | tail -1; }

# SONDE DE CONNEXION AVANT TOUT. Sans elle, une base injoignable rendait ROUGE
# sur chaque contrôle base — « obtenu : Is the server running locally… ». C'est
# faux et c'est coûteux : ROUGE veut dire « le garde-fou a cédé », et envoie
# chercher un défaut de sécurité là où il n'y a qu'un câble débranché. Une
# absence de preuve n'est pas une preuve d'échec.
reachable=0
if [ -n "$DBURL" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  probe=$(q "SELECT 1;")
  [ "$probe" = "1" ] && reachable=1
fi

if [ $reachable -eq 0 ]; then
  skip "SELECT direct sur app.patients refusé (ADR-019)" "base injoignable"
  skip "app.get_patient écrit une ligne d'audit (I4)"     "base injoignable"
  skip "audit.log refuse UPDATE (I4)"                      "base injoignable"
else

  # `qfull` ne tronque pas : une erreur Postgres tient sur plusieurs lignes
  # (`ERROR:` puis `HINT:`), et le `tail -1` de `q` rend la dernière — celle où
  # « permission denied » n'apparaît plus. Trois contrôles ci-dessous cherchent
  # précisément ce mot.
  qfull(){ docker run --rm -e PGURL="$DBURL" -e SQL="$1" postgres:15 \
             sh -c 'psql "$PGURL" -qtAX -c "$SQL"' 2>&1; }
  denied(){ printf '%s\n' "$1" | grep -qiE 'permission denied|ajout seul|append-only|droit'; }

  # 9 · le chemin direct est FERMÉ. C'est la ligne qui porte tout ADR-019 :
  #     sans elle, les deux fonctions ne sont qu'une politesse.
  out=$(qfull "BEGIN; SET LOCAL role='authenticated'; SELECT count(*) FROM app.patients; ROLLBACK;")
  denied "$out" && green "SELECT direct sur app.patients refusé (ADR-019)" \
                || red "SELECT direct sur app.patients refusé" "$(printf '%s\n' "$out" | head -1)"

  # 10 · la lecture par la porte officielle laisse une trace, et une seule.
  #      DEUX PIÈGES DE MESURE, tous deux rencontrés à l'exécution :
  #      `PERFORM` n'existe qu'en PL/pgSQL — en SQL direct c'est une erreur de
  #      syntaxe, et le delta revenait VIDE, pas zéro. Et le comptage doit se
  #      faire sous un rôle qui VOIT `audit.log` : la policy `audit_read_owner`
  #      de 013 le réserve à l'owner. La lecture reste faite sous le rôle
  #      applicatif ; seul le comptage sort du rôle. Transaction annulée.
  PAT=$(qfull "SELECT id FROM app.patients LIMIT 1;" | grep -Eo '^[0-9a-f-]{36}$' | tail -1)
  if [ -n "$PAT" ]; then
    delta=$(qfull "BEGIN;
      CREATE TEMP TABLE avant AS SELECT count(*) c FROM audit.log WHERE operation='select';
      SET LOCAL role='authenticated';
      SELECT count(*) FROM app.get_patient('$PAT');
      RESET ROLE;
      SELECT (SELECT count(*) FROM audit.log WHERE operation='select') - (SELECT c FROM avant);
      ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
    [ "$delta" = "1" ] && green "app.get_patient écrit exactement 1 ligne d'audit (I4)" \
                       || red "app.get_patient → audit" "delta attendu=1 obtenu=$delta"
  else
    skip "app.get_patient écrit une ligne d'audit (I4)" "aucun patient en base (seed 015 ?)"
  fi

  # 11 · le journal reste en ajout seul, sinon il ne prouve rien.
  #      ON INTERROGE LE RÔLE APPLICATIF. 013 protège par RLS et par REVOKE, ce
  #      qui ne contraint ni le propriétaire de la table ni un rôle BYPASSRLS —
  #      or le rôle de connexion est justement les deux. Testé sous lui,
  #      l'UPDATE passait et le contrôle criait à la violation d'I4 en
  #      interrogeant le seul rôle non concerné.
  out=$(qfull "BEGIN; SET LOCAL role='authenticated'; UPDATE audit.log SET operation='insert' WHERE true; ROLLBACK;")
  denied "$out" && green "audit.log refuse UPDATE à authenticated (I4)" \
                || red "audit.log refuse UPDATE" "$(printf '%s\n' "$out" | head -1)"

  # 12 · la porte n'est pas possédée par un rôle qui contourne la RLS.
  #      C'est le contrôle qui aurait attrapé 018 avant qu'elle n'atteigne la base.
  bad=$(qfull "SELECT coalesce(string_agg(p.proname, ', '), '')
               FROM pg_proc p
               JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
               JOIN pg_roles r ON r.oid = p.proowner
               WHERE nsp.nspname='app' AND p.prosecdef
                 AND p.prosrc LIKE '%app.patients%'
                 AND (r.rolsuper OR r.rolbypassrls);" | grep -vE '^\s*$' | tail -1)
  [ -z "$bad" ] && green "aucune porte patient possédée par un rôle BYPASSRLS" \
               || red "porte patient possédée par un rôle BYPASSRLS" "$bad"
fi

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — arrêt de la progression. Corriger la cause, pas le contrôle."
  exit 1
fi
if [ $blocked -ne 0 ]; then
  echo "VERDICT : BLOQUÉ — les contrôles statiques passent, ceux qui exigent la base"
  echo "          n'ont pas pu s'exécuter. CE N'EST PAS UN VERT : ne pas commiter S2"
  echo "          sur cette base. Appliquer les migrations, puis rejouer."
  exit 2
fi
echo "VERDICT : VERT — $n contrôles."
exit 0
