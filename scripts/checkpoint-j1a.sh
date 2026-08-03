#!/usr/bin/env bash
# CHECKPOINT J1-A — les 8 tests d'acceptation du §15 de 01-SCHEMA.md.
#
#   bash scripts/checkpoint-j1a.sh
#
# TROIS VERDICTS, comme checkpoint-s2.sh :
#   VERT   — les contrôles ont été exécutés et passent.
#   ROUGE  — au moins un contrôle exécuté a échoué (code 1).
#   BLOQUÉ — la base n'est pas atteignable, donc RIEN n'a été prouvé (code 2).
#            Ce n'est pas un vert, et ce n'est pas un rouge : une absence de
#            preuve n'est pas une preuve d'échec. Rendre ROUGE sur un câble
#            débranché envoie chercher une faille de sécurité là où il n'y a
#            qu'un outil manquant — et un contrôle qui crie à tort finit
#            désactivé, donc protège moins.
#
# psql n'est PAS installé sur ce poste : comme db-migrate.sh et checkpoint-s2.sh,
# les requêtes passent par un conteneur jetable. LE SECRET N'EST JAMAIS AFFICHÉ :
# il est passé au conteneur par variable d'environnement, jamais sur la ligne de
# commande de l'hôte — donc absent de `ps` comme de l'historique.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1
# shellcheck source=scripts/lib/dburl.sh
. scripts/lib/dburl.sh

fail=0
blocked=0
echo "CHECKPOINT J1-A"

red()  { printf 'T%-2s %-46s ROUGE  %s\n' "$1" "$2" "$3"; fail=1; }
green(){ printf 'T%-2s %-46s VERT\n' "$1" "$2"; }
skip() { printf 'T%-2s %-46s BLOQUÉ %s\n' "$1" "$2" "$3"; blocked=1; }

PGIMAGE="postgres:15"
DBURL=$(resolve_dburl)

bail_blocked() {
  echo "$1"
  echo
  echo "VERDICT : BLOQUÉ — aucun test n'a été exécuté. Ce n'est pas un vert."
  exit 2
}

[ -n "$DBURL" ] || bail_blocked "BLOQUÉ — DATABASE_URL introuvable (ni environnement, ni .env)."
command -v docker >/dev/null 2>&1 || bail_blocked "BLOQUÉ — docker introuvable."
docker info >/dev/null 2>&1        || bail_blocked "BLOQUÉ — démon docker injoignable."
if dburl_is_direct "$DBURL"; then
  echo "BLOQUÉ — DATABASE_URL utilise la connexion DIRECTE (db.<ref>.supabase.co)."
  dburl_direct_advice
  echo
  echo "VERDICT : BLOQUÉ — aucun test n'a été exécuté."
  exit 2
fi

echo "Cible : $(dburl_host "$DBURL")"

# La requête voyage par variable d'environnement, pas par interpolation dans la
# commande du shell du conteneur : aucun guillemet du SQL ne peut refermer la
# chaîne, et le secret reste hors de la ligne de commande.
q() { docker run --rm -e PGURL="$DBURL" -e SQL="$1" "$PGIMAGE" \
        sh -c 'psql "$PGURL" -qtAX -c "$SQL"' 2>&1; }

# SONDE DE CONNEXION AVANT TOUT — sinon chaque test rendrait ROUGE en accusant
# la sécurité alors que la base est simplement injoignable.
if [ "$(q 'SELECT 1;' | tail -1)" != "1" ]; then
  bail_blocked "BLOQUÉ — base injoignable (schéma non appliqué, ou identifiants refusés)."
fi

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
# RÉÉCRIT POUR ADR-019. L'ancienne version interrogeait `app.patients` en direct,
# chemin fermé depuis 017 : elle rendait `permission denied` et donc ROUGE, en
# accusant la cloison alors qu'elle butait sur la révocation. On prouve
# désormais le mur PAR LA PORTE OFFICIELLE — le seul chemin qui existe encore,
# donc le seul dont la preuve ait une valeur.
if uuid_ok "$DR2"; then
  other=$(q "SELECT id FROM app.patients WHERE practitioner_id <> '$DR2' LIMIT 1;" \
           | grep -Eo '^[0-9a-f-]{36}$' | tail -1)
  if [ -z "$other" ]; then
    # Un jeu de données incapable de contredire le test ne le valide pas.
    red 2 "cloison praticiens" "aucun patient d'une AUTRE praticienne — non prouvable"
  else
    seen=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2';
              SELECT count(*) FROM app.get_patient('$other'); ROLLBACK;" \
           | grep -E '^[0-9]+$' | tail -1)
    [ "$seen" = "0" ] && green 2 "cloison praticiens (par app.get_patient)" \
                      || red 2 "cloison praticiens" "dossier d'autrui lu : $seen ligne(s)"
  fi
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
  # Les 100 appels tournent DANS UN SEUL conteneur : 100 `docker run` seraient
  # insupportablement lents, et 20 connexions ouvertes depuis l'hôte à travers
  # le Session pooler risqueraient de saturer le pool — un ROUGE qui ne dirait
  # alors rien sur `next_number`, qui est le seul objet du test.
  # AUCUN `-I` pour xargs : sa chaîne de remplacement s'applique au SQL DÉJÀ
  # développé par le shell. Avec `-I_`, le `_` de `next_number` était lui-même
  # remplacé — `app.next1number`, `app.next2number`… Les 100 appels échouaient
  # tous, le compteur restait vide, et le contrôle accusait `next_number` d'un
  # trou de concurrence qu'il n'avait pas. `-n 1` passe le numéro en argument
  # supplémentaire, que le script ignore.
  burst=$(docker run --rm -e PGURL="$DBURL" \
            -e SQL="SELECT app.next_number('$CABINET','payment','$period');" "$PGIMAGE" \
            sh -c 'seq 1 100 | xargs -P 20 -n 1 sh -c '"'"'psql "$PGURL" -qtAX -c "$SQL" >/dev/null'"'"' sh' 2>&1)
  v=$(q "SELECT current_value FROM app.counters
         WHERE cabinet_id='$CABINET' AND scope='payment' AND period='$period';" | tail -1)
  q "DELETE FROM app.counters WHERE cabinet_id='$CABINET' AND scope='payment' AND period='$period';" >/dev/null 2>&1

  if [ "$v" = "100" ]; then
    green 5 "next_number 100x concurrent"
  elif printf '%s' "$burst" | grep -qi 'too many\|connection\|pool\|timeout'; then
    # Pool saturé ≠ compteur troué. Confondre les deux ferait chercher un défaut
    # de concurrence dans une fonction qui n'a jamais été appelée 100 fois.
    skip 5 "next_number 100x concurrent" "connexions refusées ($v/100) — pool, pas compteur"
  else
    red 5 "next_number 100x concurrent" "attendu=100 obtenu=$v"
  fi
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

# --- T7 : l'assistante ne voit pas le motif (ADR-017) --------------------------
# Trois volets. L'ancien test ne gardait que le premier — or c'est le seul qui
# ne prouvait rien : constater qu'une VUE n'a pas de colonne ne dit pas que la
# donnée est inatteignable. C'était le trou de Q-A.
out=$(q "SELECT reason FROM app.appointments_admin LIMIT 1;")
printf '%s' "$out" | grep -qi 'ERROR\|does not exist\|n.existe pas' \
  && green "7a" "appointments_admin sans reason" \
  || red "7a" "appointments_admin sans reason" "la colonne reason est exposée"

# 7b — la colonne n'existe plus DU TOUT sur la table (ADR-017).
out=$(q "SELECT reason FROM app.appointments LIMIT 1;")
printf '%s' "$out" | grep -qi 'ERROR\|does not exist\|n.existe pas' \
  && green "7b" "app.appointments sans colonne reason" \
  || red "7b" "app.appointments sans colonne reason" "reason est encore sur la table"

# 7c — LE test qui compte : l'assistante interrogeant DIRECTEMENT la table des
# motifs ne voit aucune ligne. Et il faut qu'il y ait des lignes à voir, sinon
# le test passerait au vert sur une table vide sans rien démontrer.
if uuid_ok "$ASSISTANT"; then
  total=$(q "SELECT count(*) FROM app.appointment_reasons;" | tail -1)
  seen=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$ASSISTANT';
            SELECT count(*) FROM app.appointment_reasons; ROLLBACK;" | tail -1)
  if [ "${total:-0}" = "0" ]; then
    red "7c" "assistante -> motifs de consultation" "aucun motif en base — test non prouvable"
  elif [ "$seen" = "0" ]; then
    green "7c" "assistante -> motifs de consultation"
  else
    red "7c" "assistante -> motifs de consultation" "attendu=0 obtenu=$seen sur $total"
  fi
else
  red "7c" "assistante -> motifs de consultation" "profil assistant introuvable (seed 015 ?)"
fi

# --- T8 : l'audit capture les modifications ------------------------------------
if uuid_ok "$PATIENT"; then
  # Numéro DIFFÉRENT à chaque exécution : réécrire la même valeur ne change
  # aucun champ, `changed_fields` revient vide, et le test échoue au second
  # passage. Un checkpoint qui ne passe qu'une fois sur une base neuve ne prouve
  # rien — c'est ce qui l'a fait rougir en cours d'épreuve.
  newphone=$(printf '0555%06d' $(( ($$ + RANDOM) % 1000000 )))
  # RÉÉCRIT POUR ADR-019. L'`UPDATE` direct est impossible depuis 017 : Postgres
  # exige SELECT sur les colonnes du WHERE, et SELECT est révoqué. On passe donc
  # par la porte d'écriture, qui est le seul chemin restant — et le déclencheur
  # `trg_audit` de 013 journalise exactement comme avant.
  q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
     SELECT count(*) FROM app.update_patient('$PATIENT', '{\"phone\":\"$newphone\"}'::jsonb);
     COMMIT;" >/dev/null 2>&1
  cf=$(q "SELECT changed_fields::text FROM audit.log
          WHERE table_name='patients' AND operation='update'
          ORDER BY occurred_at DESC LIMIT 1;" | tail -1)
  printf '%s' "$cf" | grep -q 'phone' \
    && green 8 "audit.log capture le champ modifié" || red 8 "audit.log capture le champ modifié" "attendu={phone} obtenu=$cf"
else
  red 8 "audit.log capture le champ modifié" "aucun patient en base — test non prouvable"
fi

# --- T9 : couverture du garde-fou synthétique (ADR-016 §3.3) -------------------
# PAR DÉCOUVERTE, pas par liste : une table Tier 0/1 ajoutée demain doit faire
# ROUGIR ce test si elle échappe au garde-fou. Une liste en dur ne verrait rien.
missing=$(q "SELECT string_agg(c.relname, ', ')
             FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE n.nspname = 'app' AND c.relkind = 'r'
               AND (c.relname = 'patients' OR EXISTS (
                     SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                       AND a.attname = 'patient_id' AND a.attnum > 0 AND NOT a.attisdropped))
               AND NOT (
                 EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                         AND a.attname = 'is_synthetic' AND a.attnum > 0 AND NOT a.attisdropped)
                 AND EXISTS (SELECT 1 FROM pg_trigger g WHERE g.tgrelid = c.oid
                             AND g.tgname = 'assert_synthetic' AND NOT g.tgisinternal));" | tail -1)
[ -z "$missing" ] && green 9 "garde-fou synthetique sur tout Tier 0/1" \
  || red 9 "garde-fou synthetique sur tout Tier 0/1" "tables non couvertes : $missing"

# --- T10 : RLS armée partout (I2, ADR-016 §3.4) --------------------------------
# ENABLE ne suffit pas : sans FORCE, le propriétaire de la table passe outre.
norls=$(q "SELECT string_agg(c.relname, ', ')
           FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'app' AND c.relkind = 'r'
             AND NOT (c.relrowsecurity AND c.relforcerowsecurity);" | tail -1)
[ -z "$norls" ] && green 10 "RLS ENABLE + FORCE sur tout app.*" \
  || red 10 "RLS ENABLE + FORCE sur tout app.*" "tables sans RLS forcee : $norls"

# --- T11 : aucune porte patient possédée par un rôle qui contourne la RLS -----
# LE CONTRÔLE QUI AURAIT ATTRAPÉ 018. Une fonction SECURITY DEFINER possédée par
# un rôle `BYPASSRLS` ne voit aucune policy : la cloison tombe sans qu'aucune
# erreur ne soit levée, et la relecture ne le montre pas. Par DÉCOUVERTE, pas
# par liste — une porte ajoutée demain tombe sous le même contrôle.
bad=$(q "SELECT coalesce(string_agg(p.proname || ' → ' || pg_get_userbyid(p.proowner), ', '), '')
         FROM pg_proc p
         JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
         JOIN pg_roles r ON r.oid = p.proowner
         WHERE nsp.nspname = 'app' AND p.prosecdef
           AND p.prosrc LIKE '%app.patients%'
           AND (r.rolsuper OR r.rolbypassrls);" | grep -vE '^\s*$' | tail -1)
[ -z "$bad" ] && green 11 "aucune porte patient possédée par un rôle BYPASSRLS" \
             || red 11 "porte patient possédée par un rôle BYPASSRLS" "$bad"

# --- T13 : aucune table d'IDENTITÉ lisible sans passer par une porte ----------
# LE TROU DES MIGRATIONS FUTURES. `001` pose des privilèges PAR DÉFAUT sur le
# schéma `app` : toute table créée demain naît avec `arwd` pour `authenticated`
# ET pour `service_role` — lequel porte `BYPASSRLS`. `017` a dû révoquer
# `app.patients` explicitement pour cette raison. Une SECONDE table d'identité
# ajoutée plus tard hériterait du défaut et échapperait à ADR-019 SANS QU'AUCUN
# CONTRÔLE NE BRONCHE.
#
# On détecte donc PAR DÉCOUVERTE, comme T9 : toute table de `app` portant des
# colonnes d'identité (nom + téléphone) et restant lisible en direct par
# `authenticated` fait rougir ce contrôle. Aujourd'hui la liste est vide parce
# que `patients` est révoquée ; le jour où elle ne l'est plus, on le saura ici
# et pas devant un patient.
leaky=$(q "SELECT coalesce(string_agg(c.relname, ', '), '')
           FROM pg_class c
           JOIN pg_namespace nsp ON nsp.oid = c.relnamespace
           WHERE nsp.nspname = 'app' AND c.relkind = 'r'
             AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                         AND a.attname='last_name' AND a.attnum>0 AND NOT a.attisdropped)
             AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid=c.oid
                         AND a.attname='phone' AND a.attnum>0 AND NOT a.attisdropped)
             AND has_table_privilege('authenticated', c.oid, 'SELECT');" \
        | grep -vE '^\s*$' | tail -1)
[ -z "$leaky" ] && green 13 "aucune table d'identité lisible en direct (ADR-019)" \
               || red 13 "table d'identité lisible en direct" "$leaky — lecture non auditée"

# --- T12 : l'héritage effectif du porteur -------------------------------------
# Sans lui, aucune policy de 004 ne s'applique aux portes et elles rendent zéro
# ligne SANS ERREUR — une panne muette qu'on prendrait pour une base vide.
inh=$(q "SELECT pg_has_role('app_gatekeeper','authenticated','USAGE')::text;" \
        | grep -E '^(true|false)$' | tail -1)
[ "$inh" = "true" ] && green 12 "app_gatekeeper hérite effectivement de authenticated" \
                    || red 12 "héritage effectif du porteur" "pg_has_role USAGE=$inh"

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — arrêt de la progression. Corriger la cause, pas le contrôle."
  exit 1
fi
if [ $blocked -ne 0 ]; then
  echo "VERDICT : BLOQUÉ — un contrôle n'a pas pu être exécuté. CE N'EST PAS UN VERT."
  exit 2
fi
echo "VERDICT : VERT"
exit 0
