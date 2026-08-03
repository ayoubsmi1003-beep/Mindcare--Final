#!/usr/bin/env bash
# dburl — résolution et assainissement de DATABASE_URL, partagés par
# db-migrate.sh, checkpoint-j1a.sh et checkpoint-s2.sh.
#
#   . scripts/lib/dburl.sh
#   DBURL=$(resolve_dburl)          # vide si introuvable
#   dburl_host "$DBURL"             # hôte SEUL, jamais les identifiants
#   dburl_is_direct "$DBURL"        # vrai si connexion directe (IPv6 seul)
#
# LE SECRET N'EST JAMAIS AFFICHÉ NI ÉCHO. Ces fonctions retournent une valeur
# sur stdout que l'appelant range dans une variable ; aucune ne journalise.
#
# Ce fichier existe parce que les trois pièges ci-dessous ont chacun coûté une
# session, et qu'ils étaient corrigés dans UN script sur trois. Un garde-fou
# dupliqué à deux exemplaires sur trois est un garde-fou absent.

# --- lecture ---------------------------------------------------------------
# `grep`+`cut` plutôt que `source .env` : on n'exécute aucune ligne d'un fichier
# de secrets, et on ne charge que la variable dont on a besoin.
resolve_dburl() {
  local url="${DATABASE_URL:-}"
  if [ -z "$url" ] && [ -f .env ]; then
    url=$(grep -m1 '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2-)
  fi

  # Deux pièges rencontrés à l'exécution, tous deux SILENCIEUX :
  #   - CRLF : `.env` écrit sous Windows emporte un retour chariot ;
  #   - espace de tête (`DATABASE_URL= postgresql://…`) : psql cesse alors de
  #     reconnaître une URI, la traite comme un nom de base, et retombe sur la
  #     socket LOCALE. Le message d'erreur parle d'un serveur local absent et
  #     envoie chercher au mauvais endroit pendant un moment.
  url=$(printf '%s' "$url" | tr -d '\r\n' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')
  url="${url%\"}"; url="${url#\"}"

  printf '%s' "$(dburl_encode_password "$url")"
}

# --- encodage du mot de passe ----------------------------------------------
# Les mots de passe générés par Supabase contiennent couramment `#`, `[`, `]`,
# `/`, `?`, `@` — tous RÉSERVÉS dans une URI. Non encodés, psql découpe l'URL au
# mauvais endroit : `#` ouvre un fragment, et le nom d'hôte devient un morceau du
# mot de passe (« could not translate host name "#2069]@db.…" »). Le message
# n'évoque jamais le mot de passe, donc on cherche ailleurs.
#
# Découpage sur le DERNIER `@` : un mot de passe peut contenir `@`, un nom
# d'hôte non — donc c'est le seul point de coupe qui ne se trompe jamais.
dburl_encode_password() {
  local url="$1" scheme rest creds tail_part user pass enc
  printf '%s' "$url" | grep -q '^postgres\(ql\)\?://[^/]*@' || { printf '%s' "$url"; return; }

  scheme=${url%%://*}
  rest=${url#*://}
  creds=${rest%@*}          # user:password  (dernier @)
  tail_part=${rest##*@}     # hôte:port/base
  user=${creds%%:*}
  pass=${creds#*:}

  [ "$user" = "$creds" ] && { printf '%s' "$url"; return; }   # pas de mot de passe

  # Déjà encodé ? On n'y touche pas : ré-encoder un `%23` donnerait `%2523`.
  if printf '%s' "$pass" | grep -q '%[0-9A-Fa-f][0-9A-Fa-f]'; then
    enc="$pass"
  else
    enc=$(printf '%s' "$pass" | sed \
      -e 's/%/%25/g'  -e 's/#/%23/g'  -e 's/\[/%5B/g' -e 's/\]/%5D/g' \
      -e 's|/|%2F|g'  -e 's/?/%3F/g'  -e 's/&/%26/g'  -e 's/@/%40/g' \
      -e 's/:/%3A/g'  -e 's/ /%20/g')
  fi
  printf '%s' "$scheme://$user:$enc@$tail_part"
}

# --- hôte seul, pour l'affichage -------------------------------------------
dburl_host() { printf '%s' "$1" | sed -E 's|.*@([^:/?]+).*|\1|'; }

# --- connexion directe = IPv6 seul -----------------------------------------
# `db.<ref>.supabase.co` ne publie plus d'enregistrement A : Supabase a rendu les
# connexions directes IPv6-only. Le réseau Docker par défaut n'a pas d'IPv6, donc
# psql rend « could not translate host name … Name or service not known » — un
# message qui accuse le DNS et ne mentionne jamais IPv6.
dburl_is_direct() { printf '%s' "$1" | grep -q '@db\.[a-z0-9]*\.supabase\.co'; }

# --- message unique, pour ne pas le réécrire à trois endroits ---------------
dburl_direct_advice() {
  echo "        L'hôte db.<ref>.supabase.co est IPv6 uniquement, et le réseau"
  echo "        Docker n'a pas d'IPv6."
  echo
  echo "  Prendre la chaîne du SESSION POOLER, compatible IPv4 :"
  echo "    Dashboard → Settings → Database → Connection string → onglet «Session pooler»"
  echo "  Elle a cette forme (noter le point dans l'utilisateur, et le host pooler) :"
  echo "    postgresql://postgres.<ref>:<mot-de-passe>@aws-0-<region>.pooler.supabase.com:5432/postgres"
  echo
  echo "  Le mot de passe peut être collé tel quel : ces scripts l'encodent eux-mêmes."
}
