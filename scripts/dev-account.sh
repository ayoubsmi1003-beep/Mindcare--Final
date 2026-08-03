#!/usr/bin/env bash
# dev-account — rend connectable LE SEUL compte de développement
# `00000000-0000-0000-0000-0000000000a1` (rôle `owner`, owner.dev@invalid.local).
#
#   bash scripts/dev-account.sh
#   DATABASE_URL="postgresql://..." bash scripts/dev-account.sh
#
# POURQUOI UN SCRIPT ET PAS UNE MIGRATION.
# Le mot de passe posé ici est un secret. Une migration vit dans
# `supabase/migrations/`, donc dans le dépôt Git : y écrire un secret le rend
# permanent, partagé et irrévocable — c'est exactement ce que l'invariant I1
# interdit. Le secret reste dans `.env` (couvert par .gitignore) et n'est lu
# qu'à l'exécution. La migration 015 pose le compte avec un hash volontairement
# invalide ; ce script ne crée rien, n'invente aucun UUID, il remplace ce hash.
# Les comptes …a2 (praticien 2) et …a3 (assistante) gardent le leur : ils ne
# doivent pas devenir connectables.
#
# POURQUOI LE GARDE-FOU ADR-016.
# La condition 1 d'ADR-016 dit : aucun accès praticien sur l'instance cloud, et
# données synthétiques uniquement. Un compte connectable n'a de sens que pendant
# cette phase cloud bornée. Sur l'instance auto-hébergée du cabinet, qui portera
# de vrais dossiers psychiatriques, poser un mot de passe de développement sur
# un compte `owner` serait une porte ouverte sur des données réelles. Le script
# lit donc `app.deployment.environment` AVANT toute écriture et refuse tout ce
# qui n'est pas exactement `cloud-dev`. Le doute (lecture impossible, table
# absente, zéro ligne) vaut refus : un garde-fou qui passe en force quand il
# n'est pas sûr n'est pas un garde-fou.
#
# CIRCULATION DU SECRET — CE QUI EST VRAI, ET CE QUI NE L'EST PAS.
#
# Il est lu depuis `.env`, exporté vers le conteneur par pass-through
# `docker run -e NOM` (sans valeur sur la ligne de commande : rien dans `ps`
# côté hôte), puis lu par psql lui-même via `\getenv`. Le script ne l'interpole
# dans aucun texte SQL qu'il construit, et n'imprime jamais la sortie brute de
# la commande qui le porte (§4).
#
# CE QUI RESTE VRAI MALGRÉ TOUT, ET QU'IL NE FAUT PAS MAQUILLER :
#   - `docker inspect` sur le conteneur éphémère expose son environnement —
#     donc `DEV_ACCOUNT_PASSWORD` ET `PGURL`, qui porte le mot de passe
#     Postgres — pendant toute sa durée de vie. Quiconque a accès au démon
#     Docker de ce poste les lit. C'est acceptable ICI parce que ce poste est
#     la machine de développement et que la base ne porte que des données
#     synthétiques (ADR-016) ; ce ne le serait pas sur le serveur du cabinet.
#   - `:'devpw'` est développé côté psql, donc le mot de passe voyage dans le
#     texte de la requête et peut apparaître dans les journaux du serveur
#     Postgres si `log_statement` est actif.
# Une version antérieure de cet en-tête affirmait qu'aucune sortie ne permettait
# de reconstituer le secret. C'était faux — et une affirmation rassurante et
# fausse dans un en-tête est ce qui empêche le relecteur suivant de regarder.

set -uo pipefail

cd "$(dirname "$0")/.." || exit 1

PGIMAGE="postgres:15"
DEV_UID="00000000-0000-0000-0000-0000000000a1"
DEV_EMAIL="owner.dev@invalid.local"

echo "COMPTE DE DÉVELOPPEMENT — $DEV_EMAIL"

# --- 1 · cible ------------------------------------------------------------------
. scripts/lib/dburl.sh
DBURL=$(resolve_dburl)

if [ -z "$DBURL" ]; then
  echo "ROUGE — DATABASE_URL introuvable (ni dans l'environnement, ni dans .env)."
  echo
  echo "  Dashboard Supabase → Settings → Database → Connection string → URI."
  echo "  Ajouter dans .env (déjà couvert par .gitignore) :"
  echo "      DATABASE_URL=postgresql://postgres.<ref>:<mot-de-passe>@<hôte>:5432/postgres"
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi

if dburl_is_direct "$DBURL"; then
  echo "ROUGE — DATABASE_URL utilise la connexion DIRECTE (db.<ref>.supabase.co)."
  dburl_direct_advice
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi

command -v docker >/dev/null 2>&1 || { echo "ROUGE — docker introuvable."; echo "VERDICT : ROUGE"; exit 1; }
docker info >/dev/null 2>&1 || { echo "ROUGE — démon docker injoignable."; echo "VERDICT : ROUGE"; exit 1; }

echo "Cible : $(dburl_host "$DBURL")"

# --- 2 · le secret ---------------------------------------------------------------
# `grep`+`cut` plutôt que `source .env` : on n'exécute aucune ligne d'un fichier
# de secrets, et on ne charge que la variable dont on a besoin.
#
# PIÈGE RENCONTRÉ À L'EXÉCUTION, ET SILENCIEUX : `.env` portait une affectation
# VIDE (`DEV_ACCOUNT_PASSWORD=`) laissée par le gabarit `.env.example`. Un
# `grep -m1` retient cette première ligne, rend une valeur vide, et le script
# conclut « introuvable » alors que le secret est présent quelques lignes plus
# bas. Le message d'erreur envoie alors ajouter une variable qui existe déjà.
# On ignore donc les affectations vides et on retient la DERNIÈRE qui porte
# réellement une valeur — c'est aussi la sémantique qu'appliquent la plupart des
# chargeurs de `.env` en cas de doublon.
if [ -z "${DEV_ACCOUNT_PASSWORD:-}" ] && [ -f .env ]; then
  DEV_ACCOUNT_PASSWORD=$(grep '^DEV_ACCOUNT_PASSWORD=' .env 2>/dev/null \
    | cut -d= -f2- | tr -d '\r' | grep -v '^[[:space:]]*$' | tail -n 1)
fi
# `.env` écrit sous Windows est en CRLF ; les guillemets d'encadrement feraient
# partie du mot de passe si on les gardait.
DEV_ACCOUNT_PASSWORD=$(printf '%s' "${DEV_ACCOUNT_PASSWORD:-}" | tr -d '\r\n')
DEV_ACCOUNT_PASSWORD="${DEV_ACCOUNT_PASSWORD%\"}"; DEV_ACCOUNT_PASSWORD="${DEV_ACCOUNT_PASSWORD#\"}"
DEV_ACCOUNT_PASSWORD="${DEV_ACCOUNT_PASSWORD%\'}"; DEV_ACCOUNT_PASSWORD="${DEV_ACCOUNT_PASSWORD#\'}"

if [ -z "$DEV_ACCOUNT_PASSWORD" ]; then
  echo "ROUGE — DEV_ACCOUNT_PASSWORD introuvable (ni dans l'environnement, ni dans .env)."
  echo
  echo "  Choisir un mot de passe de développement (il n'ouvre que des données"
  echo "  synthétiques, mais il ouvre un compte owner : traite-le comme un secret)."
  echo "  L'ajouter dans .env, couvert par .gitignore, sur une seule ligne :"
  echo "      DEV_ACCOUNT_PASSWORD=<mot-de-passe>"
  echo
  echo "  Ne jamais l'écrire dans une migration : le dépôt le garderait (I1)."
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi
export DEV_ACCOUNT_PASSWORD

# `$PGURL` et `$DEV_ACCOUNT_PASSWORD` sont développés DANS le conteneur, jamais
# sur la ligne de commande de l'hôte : `-e NOM` sans valeur reprend la variable
# exportée du processus courant. Rien n'apparaît dans `ps` ni dans l'historique.
# MSYS_NO_PATHCONV empêche Git Bash de réécrire les chemins au passage.
psql_run() {
  MSYS_NO_PATHCONV=1 docker run --rm -i \
    -e PGURL="$DBURL" -e DEV_ACCOUNT_PASSWORD \
    "$PGIMAGE" sh -c "psql \"\$PGURL\" $*" 2>&1
}

# --- 3 · garde-fou ADR-016, AVANT toute écriture ---------------------------------
# `count(*) = 1 AND bool_and(...)` plutôt que `LIMIT 1` : sans ORDER BY, `LIMIT 1`
# sur une table à plusieurs lignes rend une ligne ARBITRAIRE, et un garde-fou qui
# lit au hasard n'est pas un garde-fou. Si `app.deployment` portait un jour deux
# lignes, on refuse au lieu d'en élire une.
env_out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT count(*) = 1 AND bool_and(environment = 'cloud-dev') FROM app.deployment\"")
rc=$?
deployment_env=$(printf '%s' "$env_out" | tr -d '\r' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

if [ $rc -ne 0 ] || [ -z "$deployment_env" ] || [ "$deployment_env" != "t" ]; then
  echo "ROUGE — garde-fou ADR-016 : environnement de déploiement non confirmé « cloud-dev »."
  echo
  echo "  Un compte connectable n'existe que pendant la phase cloud bornée"
  echo "  d'ADR-016, sur des données SYNTHÉTIQUES. Sur une instance"
  echo "  auto-hébergée portant de vrais dossiers, ce script n'a rien à faire :"
  echo "  il poserait un accès owner sur des données patient réelles."
  echo
  if [ $rc -ne 0 ] || [ -z "$deployment_env" ]; then
    echo "  Lecture de app.deployment impossible ou vide → refus."
    echo "  En cas de doute, on refuse ; on ne passe pas en force."
    if [ $rc -ne 0 ]; then
      printf '%s\n' "$env_out" | sed 's/^/      /'
    fi
  else
    echo "  app.deployment ne confirme pas une phase cloud synthétique unique"
    echo "  (attendu : exactement une ligne, environment = cloud-dev)."
  fi
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi
echo "Garde-fou ADR-016 : environment = cloud-dev · vert"

# --- 3bis · pgcrypto joignable, AVANT d'envoyer quoi que ce soit de sensible -------
# Cette requête NE PORTE AUCUN SECRET : elle vérifie seulement que `crypt` et
# `gen_salt` sont appelables sur cette connexion. C'est le contrôle qui rend
# inoffensif le seul déclencheur réaliste de la fuite décrite ci-dessous — une
# extension absente du `search_path` du pooler. La migration 001 installe
# `pgcrypto`, mais SUPPOSER qu'une extension est joignable et le VÉRIFIER ne
# coûtent pas le même prix quand le prix de l'erreur est un mot de passe imprimé.
crypto_out=$(psql_run -qtAX -v ON_ERROR_STOP=1 -c "\"SELECT length(crypt('sonde', gen_salt('bf'))) > 0\"")
if [ $? -ne 0 ] || [ "$(printf '%s' "$crypto_out" | tr -d '\r[:space:]')" != "t" ]; then
  echo "ROUGE — pgcrypto injoignable sur cette connexion (crypt/gen_salt)."
  echo
  echo "  La migration 001 installe l'extension, mais elle n'est pas sur le"
  echo "  search_path de cette session. Rien n'a été écrit, et surtout aucun"
  echo "  mot de passe n'a été envoyé au serveur."
  printf '%s\n' "$crypto_out" | sed 's/^/      /'
  echo "VERDICT : ROUGE — rien n'a été écrit."
  exit 1
fi

# --- 4 · écriture, une transaction ------------------------------------------------
# `\getenv` fait lire la variable d'environnement par psql LUI-MÊME : le script
# n'interpole le secret dans aucun texte SQL qu'il construit.
#
# ⚠️ MAIS `:'devpw'` EST DÉVELOPPÉ CÔTÉ PSQL, AVANT L'ENVOI. Le serveur reçoit
# donc le mot de passe comme littéral dans le texte de la requête, et toute
# erreur Postgres dont le contexte `LINE n:` tombe sur cette ligne LE RENVOIE
# dans le message. Une version antérieure capturait `2>&1` et réimprimait cette
# sortie telle quelle : le mot de passe du compte owner s'affichait en clair,
# sous un en-tête affirmant qu'aucune sortie ne permettait de le reconstituer.
# Deux mesures, parce qu'une seule serait une politique et pas un mécanisme :
#   1. le contrôle pgcrypto ci-dessus supprime le déclencheur réaliste ;
#   2. la sortie de CETTE commande n'est JAMAIS réimprimée telle quelle — seul
#      le SQLSTATE en est extrait, et il n'identifie rien.
# L'UPDATE est une transaction implicite : s'il ne touche aucune ligne, rien
# n'est écrit. Le CTE ne renvoie que le NOMBRE de lignes touchées.
out=$(psql_run -qtAX -v ON_ERROR_STOP=1 <<'SQL'
\getenv devpw DEV_ACCOUNT_PASSWORD
WITH maj AS (
  UPDATE auth.users
     SET encrypted_password = crypt(:'devpw', gen_salt('bf')),
         email_confirmed_at = now(),
         updated_at         = now(),
         -- COLONNES DE JETONS À '' ET NON À NULL — sans quoi la connexion
         -- échoue en HTTP 500 `unexpected_failure`, ET LE MESSAGE NE DIT PAS
         -- POURQUOI. GoTrue est écrit en Go : il lit ces colonnes dans des
         -- `string`, qui n'acceptent pas NULL, et le scan casse avant toute
         -- vérification du mot de passe. La migration 015 ne les renseigne pas
         -- parce qu'elle crée des comptes DÉLIBÉRÉMENT inutilisables ; c'est
         -- donc ici, au moment où l'on rend un compte connectable, que la
         -- normalisation a sa place. Diagnostiqué en base, pas supposé.
         confirmation_token         = coalesce(confirmation_token, ''),
         recovery_token             = coalesce(recovery_token, ''),
         email_change_token_new     = coalesce(email_change_token_new, ''),
         email_change_token_current = coalesce(email_change_token_current, ''),
         email_change               = coalesce(email_change, ''),
         phone_change               = coalesce(phone_change, ''),
         phone_change_token         = coalesce(phone_change_token, ''),
         reauthentication_token     = coalesce(reauthentication_token, ''),
         -- Métadonnées attendues par GoTrue. `providers` décrit COMMENT ce
         -- compte s'authentifie ; aucune donnée personnelle n'y entre.
         raw_app_meta_data  = coalesce(raw_app_meta_data,
                                '{"provider":"email","providers":["email"]}'::jsonb),
         raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
   WHERE id = '00000000-0000-0000-0000-0000000000a1'
  RETURNING 1
)
SELECT count(*) FROM maj;
SQL
)
rc=$?
touched=$(printf '%s' "$out" | tr -d '\r' | tail -n 1 | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')

if [ $rc -ne 0 ] || [ "$touched" != "1" ]; then
  echo "ROUGE — le mot de passe n'a pas été posé."
  if [ $rc -ne 0 ]; then
    # ⚠️ NE JAMAIS RÉIMPRIMER `$out` ICI : il peut contenir le contexte
    # `LINE n:` de Postgres, donc le mot de passe en clair. On n'extrait que le
    # SQLSTATE, qui n'identifie personne — même raison qu'`errors.ts` côté
    # applicatif, où le message brut de Postgres n'atteint jamais l'écran.
    sqlstate=$(printf '%s' "$out" | grep -o 'SQLSTATE[: ]*[0-9A-Z]\{5\}' | head -n 1)
    echo "      Échec côté serveur. ${sqlstate:-SQLSTATE non identifié}."
    echo "      La sortie brute est volontairement supprimée : elle porterait"
    echo "      le mot de passe (contexte « LINE n: » de Postgres)."
  else
    echo "      L'UPDATE a touché ${touched:-0} ligne(s) au lieu de 1."
    echo "      Le compte $DEV_UID est-il bien en base (migration 015) ?"
  fi
  echo "VERDICT : ROUGE."
  exit 1
fi

echo
echo "VERT — compte de développement …a1 connectable"
echo "  Adresse : $DEV_EMAIL   (rôle owner)"
echo "  Hôte    : $(dburl_host "$DBURL")"
echo "  Mot de passe : celui de DEV_ACCOUNT_PASSWORD dans .env — il n'est jamais affiché."
echo "  …a2 et …a3 restent non connectables, comme voulu."
echo "VERDICT : VERT"
