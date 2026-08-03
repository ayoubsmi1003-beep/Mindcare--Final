#!/usr/bin/env bash
# CHECKPOINT S4 — le module Agenda, ses portes et ses deux murs.
# VERT ou ROUGE. Rien entre les deux.
#
#   bash scripts/checkpoint-s4.sh
#
# TROIS VERDICTS, et le troisième est la raison d'être du découpage :
#   VERT   — tous les contrôles ont été exécutés et passent.
#   ROUGE  — au moins un contrôle exécuté a échoué.
#   BLOQUÉ — les contrôles STATIQUES passent, mais ceux qui exigent la base
#            n'ont pas pu être exécutés. Ce n'est PAS un vert : un checkpoint
#            qui rendrait vert après avoir sauté la moitié de ses contrôles est
#            pire qu'un checkpoint absent, il autorise à commiter en croyant
#            avoir prouvé. Code de sortie 2, distinct du 1 de ROUGE.
#
# psql n'est pas installé sur ce poste : les contrôles base passent par un
# conteneur jetable, comme db-migrate.sh. LE SECRET N'EST JAMAIS AFFICHÉ.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

fail=0
blocked=0
n=0
echo "CHECKPOINT S4"
echo

green() { n=$((n+1)); printf '%-2s %-56s VERT\n' "$n" "$1"; }
red()   { n=$((n+1)); printf '%-2s %-56s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
skip()  { n=$((n+1)); printf '%-2s %-56s BLOQUÉ %s\n' "$n" "$1" "$2"; blocked=1; }

# ═══ CONTRÔLES STATIQUES — toujours exécutés ═══════════════════════════════════

# 1 · ni la table ni la vue ne sont requêtées depuis src/ (ADR-017, ADR-021).
#     La vue est incluse, à la différence du contrôle 9c du préflight : depuis
#     022, l'agenda passe par `app.list_agenda`, qui journalise. Requêter
#     `appointments_admin` en direct rendrait des rendez-vous SANS trace de
#     lecture — exactement le chemin non audité qu'ADR-019 a fermé pour les
#     dossiers, rouvert par la porte de service.
out=$(grep -rnE "relation:[[:space:]]*[\"'](appointments|appointments_admin)[\"']|from\([\"'](appointments|appointments_admin)[\"']\)" \
        --include="*.ts" --include="*.tsx" src/ 2>/dev/null)
[ -z "$out" ] && green "agenda : aucune relation appointments lue dans src/" \
              || red "agenda : relation appointments lue en direct" "$(printf '%s' "$out" | head -1)"

# 2 · le motif de consultation n'apparaît nulle part dans le front (ADR-017).
#     Il vit dans `app.appointment_reasons`, sans policy assistante. Un service
#     qui le nommerait signale un développeur qui n'a pas lu pourquoi la table
#     existe — et c'est là que le mur 1 commence à céder.
out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
        $(find src -type f \( -name "*.ts" -o -name "*.tsx" \) 2>/dev/null) 2>/dev/null \
      | grep -nE "appointment_reasons|appointmentReasons")
[ -z "$out" ] && green "motif de consultation absent de src/ (ADR-017)" \
              || red "motif de consultation référencé dans src/" "$(printf '%s' "$out" | head -1)"

# 3 · un seul import de Supabase dans tout src/ (I3, ADR-020).
out=$(grep -rln "@supabase/supabase-js\|@supabase/ssr" --include="*.ts" --include="*.tsx" src/ 2>/dev/null \
      | grep -v "^src/services/db/supabase.ts$")
[ -z "$out" ] && green "un seul import Supabase (adaptateur)" \
              || red "import Supabase hors adaptateur" "$(printf '%s' "$out" | tr '\n' ' ')"

# 4 · les écrans agenda existent et ne portent aucune chaîne d'interface en dur
#     (I8). On cherche le passage par `fr.` plutôt que l'absence de littéral :
#     l'absence ne se prouve pas par grep, la présence de la source unique si.
missing=""
for f in src/app/agenda/page.tsx src/app/agenda/nouveau/page.tsx src/app/agenda/\[id\]/page.tsx; do
  [ -f "$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  red "les trois écrans agenda existent" "absent :$missing"
elif grep -Lq "fr\." src/app/agenda/page.tsx src/app/agenda/nouveau/page.tsx "src/app/agenda/[id]/page.tsx" >/dev/null 2>&1 \
     && [ -n "$(grep -L "fr\." src/app/agenda/page.tsx src/app/agenda/nouveau/page.tsx "src/app/agenda/[id]/page.tsx" 2>/dev/null)" ]; then
  red "écrans agenda : libellés depuis i18n" "$(grep -L "fr\." src/app/agenda/page.tsx src/app/agenda/nouveau/page.tsx "src/app/agenda/[id]/page.tsx" 2>/dev/null | tr '\n' ' ')"
else
  green "les trois écrans agenda : libellés depuis src/i18n/fr.ts"
fi

# 5 · aucune décision d'autorisation dans les écrans agenda (règle 4).
#     La composition de navigation vit dans AppShell ; un écran qui teste un rôle
#     pour masquer une donnée est un bug de conception, pas une protection.
out=$(sed -e 's|//.*$||' -e '/^[[:space:]]*\*/d' -e '/^[[:space:]]*\/\*/d' \
        src/app/agenda/page.tsx "src/app/agenda/[id]/page.tsx" src/app/agenda/nouveau/page.tsx 2>/dev/null \
      | grep -nE 'role[[:space:]]*===[[:space:]]*"(assistant|owner|practitioner)"')
[ -z "$out" ] && green "écrans agenda : aucune décision de rôle en JavaScript" \
              || red "décision de rôle dans un écran agenda" "$(printf '%s' "$out" | head -1)"

# 6 · les quatre portes du dépôt.
for gate in "pnpm typecheck" "pnpm lint" "pnpm build"; do
  if $gate >/dev/null 2>&1; then green "$gate"; else red "$gate" "voir la sortie complète"; fi
done
if bash scripts/preflight.sh >/dev/null 2>&1; then green "preflight muet"; else red "preflight" "sortie non vide"; fi

# ═══ CONTRÔLES BASE — exigent 022 appliquée ════════════════════════════════════

# shellcheck source=scripts/lib/dburl.sh
. scripts/lib/dburl.sh
DBURL=$(resolve_dburl)

# La requête voyage par variable d'environnement : aucun guillemet du SQL ne peut
# refermer la chaîne, et le secret reste hors de la ligne de commande de l'hôte.
qfull(){ docker run --rm -e PGURL="$DBURL" -e SQL="$1" postgres:15 \
           sh -c 'psql "$PGURL" -qtAX -c "$SQL"' 2>&1; }
q()    { qfull "$1" | tail -1; }
denied(){ printf '%s\n' "$1" | grep -qiE 'permission denied|droit'; }
refused(){ printf '%s\n' "$1" | grep -qiE 'ERROR|ERREUR'; }

# SONDE DE CONNEXION AVANT TOUT. Une base injoignable n'est pas un garde-fou qui
# cède : ROUGE enverrait chercher un défaut de sécurité là où il n'y a qu'un
# démon Docker arrêté. Une absence de preuve n'est pas une preuve d'échec.
reachable=0
if [ -n "$DBURL" ] && command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  [ "$(q "SELECT 1;")" = "1" ] && reachable=1
fi

LIB_BASE=(
  "022 appliquée et les cinq portes présentes"
  "list_agenda : exactement 1 ligne d'audit, contexte liste"
  "get_patient : toujours exactement 1 ligne fiche (S3 intact)"
  "SELECT direct sur app.patients toujours refusé (ADR-019)"
  "aucune porte SECURITY DEFINER possédée par un BYPASSRLS"
  "mur 1 : l'assistante ne voit aucun motif de consultation"
  "mur 2 : la Dr #2 ne voit pas l'agenda de la Dr #1"
  "update_appointment refuse practitioner_id (ADR-003)"
  "un rendez-vous annulé ne se modifie plus (P0001)"
  "list_agenda refuse une plage de plus de 62 jours"
  "create_appointment crée réellement un rendez-vous"
  "cancel_appointment écrit le motif dans notes_admin"
)

if [ $reachable -eq 0 ]; then
  for t in "${LIB_BASE[@]}"; do skip "$t" "base injoignable"; done
else

  OWNER='00000000-0000-0000-0000-0000000000a1'
  DR2='00000000-0000-0000-0000-0000000000a2'
  ASSISTANT='00000000-0000-0000-0000-0000000000a3'
  APPT='00000000-0000-0000-0000-0000000000d1'

  # 7 · la migration est là, et les cinq fonctions avec elle. Un checkpoint qui
  #     testerait le comportement sans vérifier la présence rendrait des rouges
  #     illisibles (« function does not exist ») sur chaque contrôle suivant.
  cnt=$(q "SELECT count(*) FROM pg_proc p JOIN pg_namespace nsp ON nsp.oid=p.pronamespace
           WHERE nsp.nspname='app' AND p.proname IN
             ('list_agenda','get_appointment','create_appointment',
              'update_appointment','cancel_appointment');")
  [ "$cnt" = "5" ] && green "${LIB_BASE[0]}" \
                   || red "${LIB_BASE[0]}" "fonctions trouvées : $cnt/5"

  # 8 · LE CONTRÔLE QUI PORTE TOUT LE CHOIX DE CONCEPTION DE 022.
  #     Un agenda de douze rendez-vous doit laisser UNE trace, pas douze. On
  #     mesure le delta réel, on ne le déduit pas du code.
  #     Deux pièges de mesure hérités de checkpoint-s2, tous deux rencontrés à
  #     l'exécution : `PERFORM` n'existe qu'en PL/pgSQL, et le comptage doit se
  #     faire sous un rôle qui VOIT `audit.log` (policy `audit_read_owner`). La
  #     lecture reste sous le rôle applicatif ; seul le comptage sort du rôle.
  delta=$(qfull "BEGIN;
    CREATE TEMP TABLE avant AS SELECT count(*) c FROM audit.log WHERE operation='select';
    SET LOCAL role='authenticated';
    SET LOCAL request.jwt.claim.sub='$OWNER';
    SELECT count(*) FROM app.list_agenda(now() - interval '30 days', now() + interval '30 days');
    RESET ROLE;
    SELECT (SELECT count(*) FROM audit.log WHERE operation='select') - (SELECT c FROM avant);
    ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
  ctx=$(qfull "BEGIN;
    SET LOCAL role='authenticated';
    SET LOCAL request.jwt.claim.sub='$OWNER';
    SELECT count(*) FROM app.list_agenda(now() - interval '1 day', now() + interval '1 day');
    RESET ROLE;
    SELECT changed_fields[1] || ':' || coalesce(patient_id::text,'NULL')
      FROM audit.log WHERE operation='select' ORDER BY id DESC LIMIT 1;
    ROLLBACK;" | grep -E '^[a-z]+:' | tail -1)
  if [ "$delta" = "1" ] && [ "$ctx" = "liste:NULL" ]; then
    green "${LIB_BASE[1]}"
  else
    red "${LIB_BASE[1]}" "delta=$delta trace=$ctx (attendu 1 / liste:NULL)"
  fi

  # 9 · LA PREUVE DE S3 N'A PAS BOUGÉ. 022 ajoute un contexte de lecture ; elle
  #     ne doit rien changer à la sémantique de `fiche`. Ce contrôle est ici
  #     pour attraper une régression que S4 pourrait introduire sans le voir.
  PAT=$(qfull "SELECT id FROM app.patients LIMIT 1;" | grep -Eo '^[0-9a-f-]{36}$' | tail -1)
  if [ -n "$PAT" ]; then
    d=$(qfull "BEGIN;
      CREATE TEMP TABLE avant AS SELECT count(*) c FROM audit.log WHERE operation='select';
      SET LOCAL role='authenticated';
      SELECT count(*) FROM app.get_patient('$PAT');
      RESET ROLE;
      SELECT (SELECT count(*) FROM audit.log WHERE operation='select') - (SELECT c FROM avant);
      ROLLBACK;" | grep -E '^[0-9]+$' | tail -1)
    [ "$d" = "1" ] && green "${LIB_BASE[2]}" || red "${LIB_BASE[2]}" "delta attendu=1 obtenu=$d"
  else
    skip "${LIB_BASE[2]}" "aucun patient en base (seed 015 ?)"
  fi

  # 10 · ADR-019 intact. Sans cette ligne, toutes les portes ne sont qu'une
  #      politesse : PostgREST servirait `app.patients` en direct.
  out=$(qfull "BEGIN; SET LOCAL role='authenticated'; SELECT count(*) FROM app.patients; ROLLBACK;")
  denied "$out" && green "${LIB_BASE[3]}" \
                || red "${LIB_BASE[3]}" "$(printf '%s\n' "$out" | head -1)"

  # 11 · LE CONTRÔLE QUI AURAIT ARRÊTÉ 018. `rolsuper = f` ne prouve rien : une
  #      fonction possédée par un rôle `rolbypassrls` ne voit AUCUNE policy, et
  #      la Dr #2 lisait la patiente de la Dr Larbi. Étendu à `appointments` :
  #      `list_agenda` joint les deux tables, elle tomberait de la même façon.
  bad=$(qfull "SELECT coalesce(string_agg(p.proname, ', '), '')
               FROM pg_proc p
               JOIN pg_namespace nsp ON nsp.oid = p.pronamespace
               JOIN pg_roles r ON r.oid = p.proowner
               WHERE nsp.nspname='app' AND p.prosecdef
                 AND (p.prosrc LIKE '%app.patients%' OR p.prosrc LIKE '%app.appointments%')
                 AND (r.rolsuper OR r.rolbypassrls);" | grep -vE '^\s*$' | tail -1)
  [ -z "$bad" ] && green "${LIB_BASE[4]}" || red "${LIB_BASE[4]}" "$bad"

  # 12 · MUR 1 — le test T7 d'ADR-017, par le vecteur RÉEL. L'assistante voit
  #      l'agenda, et ZÉRO ligne de motif. On vérifie les deux : constater
  #      seulement l'absence de motif ne prouverait rien si elle ne voyait rien
  #      du tout.
  vus=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$ASSISTANT';
           SELECT count(*) FROM app.list_agenda(now() - interval '30 days', now() + interval '30 days'); ROLLBACK;")
  motifs=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$ASSISTANT';
              SELECT count(*) FROM app.appointment_reasons; ROLLBACK;")
  if [ "$motifs" = "0" ] && [ "${vus:-0}" -ge 1 ] 2>/dev/null; then
    green "${LIB_BASE[5]}"
  else
    red "${LIB_BASE[5]}" "rdv vus=$vus motifs vus=$motifs (attendu ≥1 / 0)"
  fi

  # 13 · MUR 2 — cloison ADR-003. Le RDV semé en 015 appartient à la Dr #1.
  #      La Dr #2 ne doit en voir aucun. C'est la propriété que 018 avait fait
  #      tomber sans que rien ne le signale.
  vus2=$(q "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$DR2';
            SELECT count(*) FROM app.list_agenda(now() - interval '30 days', now() + interval '30 days')
            WHERE id='$APPT'; ROLLBACK;")
  [ "$vus2" = "0" ] && green "${LIB_BASE[6]}" \
                    || red "${LIB_BASE[6]}" "la Dr #2 voit $vus2 RDV de la Dr #1"

  # 14 · L'allowlist refuse, elle n'ignore pas. Un champ ignoré en silence
  #      ferait croire à l'appelante que sa modification a été enregistrée.
  out=$(qfull "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
               SELECT app.update_appointment('$APPT', '{\"practitioner_id\":\"$DR2\"}'::jsonb); ROLLBACK;")
  refused "$out" && green "${LIB_BASE[7]}" \
                 || red "${LIB_BASE[7]}" "la porte a accepté practitioner_id"

  # 15 · La règle est sur la TABLE, pas dans la fonction : on annule, puis on
  #      tente de déplacer par un UPDATE DIRECT, sans passer par aucune porte.
  #      C'est le seul test qui prouve que Jarvis et le futur front assistante
  #      butent dessus eux aussi. Transaction annulée : rien ne persiste.
  out=$(qfull "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
               SELECT app.cancel_appointment('$APPT', 'Test de checkpoint');
               UPDATE app.appointments SET starts_at = starts_at + interval '1 hour'
                 WHERE id='$APPT'; ROLLBACK;")
  refused "$out" && green "${LIB_BASE[8]}" \
                 || red "${LIB_BASE[8]}" "un RDV annulé a pu être déplacé"

  # 16 · La borne de plage est l'analogue du `p_limit ≤ 100` de search_patients.
  #      Une plage sans limite n'est pas un agenda, c'est un export.
  out=$(qfull "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
               SELECT count(*) FROM app.list_agenda(now() - interval '5 years', now()); ROLLBACK;")
  refused "$out" && green "${LIB_BASE[9]}" \
                 || red "${LIB_BASE[9]}" "une plage de 5 ans a été servie"

  # 20 · LE CHEMIN NOMINAL, et il manquait. Les contrôles 14, 15 et 16 vérifient
  #      tous un REFUS — or un refus reste VERT quand la fonction échoue pour une
  #      raison qui n'a rien à voir. Les dix-neuf contrôles précédents étaient
  #      verts alors que `create_appointment` ne créait RIEN : elle butait sur le
  #      garde-fou `is_synthetic` d'ADR-016 (corrigé en 023). Un checkpoint qui
  #      ne teste que ce qui doit échouer ne prouve pas que le reste marche.
  #      Transaction annulée : la sonde ne laisse aucun rendez-vous derrière elle.
  PATIENT=$(qfull "SELECT id FROM app.patients WHERE practitioner_id='$OWNER' LIMIT 1;" \
            | grep -Eo '^[0-9a-f-]{36}$' | tail -1)
  if [ -z "$PATIENT" ]; then
    skip "${LIB_BASE[10]}" "aucun patient de la Dr #1 en base (seed 015 ?)"
  else
    cree=$(qfull "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
      SELECT app.create_appointment('$PATIENT', '$OWNER', now() + interval '3 days', 30, 'sonde checkpoint');
      SELECT count(*) FROM app.appointments WHERE notes_admin='sonde checkpoint'; ROLLBACK;" \
      | grep -E '^[0-9]+$' | tail -1)
    [ "$cree" = "1" ] && green "${LIB_BASE[10]}" \
                      || red "${LIB_BASE[10]}" "rendez-vous créés : ${cree:-aucun} (attendu 1)"
  fi

  # 21 · L'annulation ÉCRIT quelque chose de lisible. Vérifier seulement que le
  #      statut passe à `cancelled` laisserait passer un motif perdu — et un
  #      rendez-vous annulé sans motif ne se relit pas six mois plus tard.
  trace=$(qfull "BEGIN; SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';
    SELECT app.cancel_appointment('$APPT', 'sonde checkpoint');
    SELECT status || '|' || coalesce(notes_admin, '') FROM app.appointments WHERE id='$APPT';
    ROLLBACK;" | grep -F 'cancelled|' | tail -1)
  case "$trace" in
    *"sonde checkpoint"*) green "${LIB_BASE[11]}" ;;
    *) red "${LIB_BASE[11]}" "trace obtenue : ${trace:-aucune}" ;;
  esac
fi

echo
if [ $fail -ne 0 ]; then
  echo "VERDICT : ROUGE — arrêt de la progression. Corriger la cause, pas le contrôle."
  exit 1
fi
if [ $blocked -ne 0 ]; then
  echo "VERDICT : BLOQUÉ — les contrôles statiques passent, ceux qui exigent la base"
  echo "          n'ont pas pu s'exécuter. CE N'EST PAS UN VERT : ne pas commiter S4"
  echo "          sur cette base. Démarrer Docker, appliquer 022, puis rejouer."
  exit 2
fi
echo "VERDICT : VERT — $n contrôles."
exit 0
