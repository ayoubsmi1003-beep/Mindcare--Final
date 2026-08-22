#!/usr/bin/env bash
# CHECKPOINT V8 — DOCUMENTS. Le contenu, pas seulement la mécanique.
#
#   bash scripts/checkpoint-v8-documents.sh
#
# ⚠️ CE QU'IL PROUVE, ET CE QU'IL NE PROUVE PAS.
#
# `checkpoint-s7b.sh` prouve la MÉCANIQUE des portes de 030 : cloison, audit,
# échappement, numérotation, verrouillage de table. Il continue de le faire et
# DOIT ÊTRE REJOUÉ AVANT CELUI-CI — ce fichier ne le remplace pas.
#
# Ce checkpoint-ci prouve ce que V8 ajoute : que les modèles v2 semés par 045 se
# rendent SANS LAISSER UN SEUL MARQUEUR LITTÉRAL sur le papier, que l'appelante
# ne peut rien y écrire elle-même, que la clé FACULTATIVE de 045 se comporte
# comme une clé vide et non comme une clé absente, et que les migrations
# 042-045 n'ont pas rouvert la cloison d'ADR-019.
#
# ⚠️ IL NE CLÔT PAS V8. Deux contrôles ne s'automatisent pas :
#   · la saisie du profil réel sur l'instance (nom, n° d'ordre, téléphone,
#     spécialités FR/AR, signature_block.full_name_ar) — sans elle, l'en-tête
#     sort avec des marqueurs littéraux ;
#   · le TIRAGE PAPIER, posé à côté d'un certificat de la praticienne, et son
#     approbation.
# Un vert ici ne dit rien de ces deux-là. Il le redit à la fin.
#
# TROIS VERDICTS, comme S7a/S7b :
#   VERT   — tous les contrôles exécutés passent.
#   ROUGE  — au moins un contrôle exécuté a échoué.
#   BLOQUÉ — les contrôles STATIQUES passent, ceux qui exigent la base n'ont pas
#            pu s'exécuter. CE N'EST PAS UN VERT (code 2).

set -uo pipefail
trap '' PIPE
cd "$(dirname "$0")/.." || exit 1

fail=0
blocked=0
n=0
echo "CHECKPOINT V8 — DOCUMENTS (contenu et rendu)"
echo

green() { n=$((n+1)); printf '%-2s %-64s VERT\n' "$n" "$1"; }
red()   { n=$((n+1)); printf '%-2s %-64s ROUGE  %s\n' "$n" "$1" "$2"; fail=1; }
skip()  { n=$((n+1)); printf '%-2s %-64s BLOQUÉ %s\n' "$n" "$1" "$2"; blocked=1; }

# ═══ CONTRÔLES STATIQUES ══════════════════════════════════════════════════════

# 1 · Le service ne nomme aucune table — le contrôle 1 de S7b, rejoué parce que
# ce lot a MODIFIÉ documents.ts (ajout de nombreEnLettres et des jeux de champs).
out=$(grep -nE '\.from\(' src/services/documents.ts 2>/dev/null)
[ -z "$out" ] && green "documents.ts : aucune table nommée (.from)" \
              || red "documents.ts nomme une table" "$(printf '%s' "$out" | head -1)"

# 2 · Aucune des trois migrations de ce lot ne fait de DROP FUNCTION. C'est LA
# précaution qui empêche qu'un `CREATE OR REPLACE` devienne un changement de
# propriétaire : un DROP réattribue la fonction à `postgres` (rolbypassrls) et
# la cloison tombe pendant que la migration reste verte (défaut de 018).
out=$(sed -e 's/--.*$//' supabase/migrations/04[2345]_*.sql | grep -inE 'DROP[[:space:]]+FUNCTION')
[ -z "$out" ] && green "042-045 : aucun DROP FUNCTION (la cloison ne se rouvre pas)" \
              || red "DROP FUNCTION trouvé dans 042-045" "$(printf '%s' "$out" | head -1)"

# 3 · 043 ET 045 ne doivent redéfinir QUE issue_document. Redéfinir
# render_template au passage rouvrirait le moteur de rendu — la fonction dont
# dépend tout entière la garantie « aucun marqueur littéral sur le papier ».
out=$(sed -e 's/--.*$//' supabase/migrations/043_document_render_context.sql \
        supabase/migrations/045_document_templates_v2.sql \
      | grep -oiE 'CREATE[[:space:]]+OR[[:space:]]+REPLACE[[:space:]]+FUNCTION[[:space:]]+app\.[a-z_]+' \
      | sed -E 's/.*app\.//' | sort -u)
[ "$out" = "issue_document" ] && green "043/045 ne redéfinissent que issue_document" \
                             || red "043/045 redéfinissent autre chose" "trouvé : ${out:-rien}"

# 4 · L'écran existe et est déclaré construit dans le rail. Un écran livré mais
# absent de ECRANS_CONSTRUITS reste marqué « bientôt » et n'est pas atteignable.
if [ -f src/app/documents/page.tsx ] \
   && grep -q '"documents"' src/components/AppShell.tsx; then
  green "écran /documents présent et déclaré construit"
else
  red "écran /documents" "page absente ou non listée dans ECRANS_CONSTRUITS"
fi

# 5 · Les cinq états sont ÉCRITS. Le contrôle ne prouve pas qu'ils s'affichent —
# c'est le rôle du paramètre ?etat= en développement — mais qu'aucun n'a été
# oublié à l'écriture, ce qui est le défaut le plus fréquent.
manquants=""
for cle in chargement vide erreur horsligne; do
  grep -q "\"$cle\"" src/app/documents/page.tsx || manquants="$manquants $cle"
done
grep -q "statut: \"charge\"" src/app/documents/page.tsx || manquants="$manquants contenu"
[ -z "$manquants" ] && green "les cinq états sont écrits et déclenchables (?etat=)" \
                    || red "état(s) absent(s) de l'écran" "$manquants"

# 6 · Le déclencheur d'états est INERTE en production. Un paramètre d'URL qui
# force un écran vide serait, en cabinet, un moyen de faire croire à une
# praticienne qu'un dossier n'a aucun certificat.
grep -q 'NODE_ENV === "production"' src/app/documents/page.tsx \
  && green "?etat= inerte en production" \
  || red "?etat= sans garde NODE_ENV" "un paramètre d'URL pourrait vider l'écran en cabinet"

# 7 · Aucune chaîne en dur dans l'écran (ADR-008). On cherche un attribut ou un
# nœud de texte JSX qui ne passe pas par `fr.` — grossier mais suffisant pour
# attraper l'oubli le plus courant, un libellé de bouton écrit à la volée.
out=$(grep -nE '>[A-ZÉÈÀ][a-zéèêàçù]{3,}' src/app/documents/page.tsx \
       src/components/documents/*.tsx 2>/dev/null | grep -v 'fr\.' | grep -v '^\s*\*')
[ -z "$out" ] && green "aucune chaîne d'interface en dur (ADR-008)" \
              || red "chaîne en dur dans l'écran" "$(printf '%s' "$out" | head -1)"

for gate in "pnpm typecheck" "pnpm lint" "pnpm build"; do
  if $gate >/dev/null 2>&1; then green "$gate"; else red "$gate" "voir la sortie complète"; fi
done

if bash scripts/preflight.sh >/dev/null 2>&1; then green "preflight muet"; else red "preflight" "sortie non vide"; fi

# ═══ CONTRÔLES BASE ═══════════════════════════════════════════════════════════

CONTAINER="${SUPABASE_DB_CONTAINER:-supabase_db_Final_Mindcare}"
V8_DB="${V8_DB:-v8fresh}"

reachable=0
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1 \
   && docker exec "$CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then
  reachable=1
fi

LIB_BASE=(
  "rejeu intégral du corpus sur base neuve (042 à 045 comprises)"
  "cloison : issue_document appartient à app_gatekeeper, DEFINER, GRANT intact"
  "cloison : app_gatekeeper n'a PAS BYPASSRLS"
  "catalogue : aucun marqueur hors du contexte de rendu (liste blanche)"
  "les 4 modèles émettent SANS AUCUN marqueur littéral sur le papier"
  "l'appelante n'ecrit RIEN sur le papier via jours_lettres (v2)"
  "la colonne variables garde la SAISIE, pas la valeur recalculée"
  "donnée hostile : {{patient.last_name}} dans un champ reste littéral"
  "dossier sans sexe ni date de naissance : émission REFUSÉE, pas de blanc"
  "jours non entier / hors bornes : refus explicite en français"
  "champ manquant, en trop, vide : refus, et le compteur n'avance pas"
  "garde d'enum de 030 toujours présent (contrôle par lecture, faible)"
  "nombre_en_lettres : les pièges du français, sur la base réelle"
  "045 : traitement_2 VIDE est accepté, et n'imprime aucune puce"
  "045 : traitement_2 ABSENTE est refusée (vide ≠ absent)"
)

if [ $reachable -eq 0 ]; then
  for t in "${LIB_BASE[@]}"; do skip "$t" "base injoignable (supabase start ?)"; done
else
  docker exec "$CONTAINER" psql -U postgres -d postgres -qtAX \
    -c "DROP DATABASE IF EXISTS $V8_DB;" -c "CREATE DATABASE $V8_DB;" >/dev/null 2>&1
  docker exec "$CONTAINER" pg_dump -U postgres -d postgres --schema=auth --schema-only 2>/dev/null \
    | docker exec -i "$CONTAINER" psql -U postgres -d "$V8_DB" -qtAX >/dev/null 2>&1

  rejeu_ok=1
  for f in supabase/migrations/*.sql; do
    out=$(docker exec -i "$CONTAINER" psql -U postgres -d "$V8_DB" -qtAX -v ON_ERROR_STOP=1 < "$f" 2>&1)
    if [ $? -ne 0 ]; then
      rejeu_ok=0
      rejeu_err="$(basename "$f") : $(printf '%s' "$out" | grep -iE '^ERROR' | head -1)"
      break
    fi
  done

  n_fichiers=$(ls supabase/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
  if [ $rejeu_ok -eq 1 ]; then
    n_mig=$(docker exec "$CONTAINER" psql -U postgres -d "$V8_DB" -qtAX -c "SELECT count(*) FROM app.schema_migrations;")
    [ "$n_mig" = "$n_fichiers" ] && green "${LIB_BASE[0]}" \
                                 || red "${LIB_BASE[0]}" "attendu $n_fichiers, obtenu $n_mig"
  else
    red "${LIB_BASE[0]}" "${rejeu_err:-échec inconnu}"
    reachable=0
  fi
fi

if [ $reachable -eq 1 ]; then
  # ⚠️ MÊME LEÇON QUE S7b : `tail -1` sur une sortie qui peut contenir une
  # erreur psql fabrique des VERTS FAUX — la dernière ligne d'un message
  # d'erreur est « non vide » comme l'est un uuid. On rend « ERREUR », qui ne
  # vaut ni un uuid, ni « NULL », ni « 0 », ni un compteur.
  q() {
    local out rc
    out=$(docker exec "$CONTAINER" psql -U postgres -d "$V8_DB" -qtAX -v ON_ERROR_STOP=1 -c "$1" 2>&1)
    rc=$?
    if [ $rc -ne 0 ] || printf '%s\n' "$out" | grep -qiE '^(ERROR|ERREUR|FATAL)'; then
      printf 'ERREUR'
      return 0
    fi
    printf '%s\n' "$out" | tail -1
  }
  qfull(){ docker exec "$CONTAINER" psql -U postgres -d "$V8_DB" -qtAX -c "$1" 2>&1; }
  refused(){ printf '%s\n' "$1" | grep -qiE 'ERROR|ERREUR'; }

  OWNER='00000000-0000-0000-0000-0000000000a1'
  PAT1='00000000-0000-0000-0000-0000000000b1'
  CAB='00000000-0000-0000-0000-000000000001'
  as_owner="SET LOCAL role='authenticated'; SET LOCAL request.jwt.claim.sub='$OWNER';"

  # ── 2/3 · La cloison, sur la base ────────────────────────────────────────
  own=$(q "SELECT pg_get_userbyid(proowner) || '/' || prosecdef::text || '/' ||
             has_function_privilege('authenticated','app.issue_document(uuid, app.doc_type, text, uuid)','EXECUTE')::text
             FROM pg_proc p JOIN pg_namespace nn ON nn.oid=p.pronamespace
            WHERE nn.nspname='app' AND p.proname='issue_document';")
  [ "$own" = "app_gatekeeper/true/true" ] && green "${LIB_BASE[1]}" \
                                          || red "${LIB_BASE[1]}" "propriétaire/definer/grant = $own"

  byp=$(q "SELECT rolbypassrls FROM pg_roles WHERE rolname='app_gatekeeper';")
  [ "$byp" = "f" ] && green "${LIB_BASE[2]}" || red "${LIB_BASE[2]}" "rolbypassrls=$byp"

  # ── 4 · La liste blanche du catalogue, rejouée hors migration ────────────
  # C'est la seule défense STRUCTURELLE contre le retour du défaut de 031 : un
  # marqueur sans source ne lève rien, il s'imprime tel quel.
  bad=$(q "SELECT COALESCE(string_agg(DISTINCT m[1], ', '), 'AUCUN')
             FROM app.document_templates t,
                  LATERAL regexp_matches(
                    coalesce(t.header_html,'') || coalesce(t.body_html,'') || coalesce(t.footer_html,''),
                    '\{\{([^{}]*)\}\}', 'g') AS m
            WHERE t.is_active
              AND btrim(m[1]) NOT IN (
                'patient.first_name','patient.last_name','patient.record_number',
                'patient.birth_date','patient.birth_date_fr','patient.id_document_number',
                'patient.civilite','patient.age',
                'praticien.full_name','praticien.full_name_ar','praticien.title',
                'praticien.speciality_fr','praticien.speciality_ar',
                'praticien.order_number','praticien.phone',
                'cabinet.name','cabinet.address','cabinet.phone',
                'vars.date_affichee','vars.id_document_number','vars.mairie',
                'vars.jours','vars.jours_lettres','vars.date_debut',
                'vars.traitement_1','vars.traitement_2','vars.date_consultation');")
  [ "$bad" = "AUCUN" ] && green "${LIB_BASE[3]}" || red "${LIB_BASE[3]}" "marqueurs orphelins : $bad"

  # ── La fixture, DANS la base jetable de ce checkpoint (règle 8) ──────────
  # Le seed 015 laisse `sex` et `birth_date` vides sur b1 : sans conséquence
  # tant qu'aucun modèle n'en dérivait, bloquant depuis 043. On complète ici,
  # jamais dans un seed livré.
  qfull "UPDATE app.patients SET sex='F', birth_date='1990-03-14' WHERE id='$PAT1';" >/dev/null
  # Le profil : sans lui, l'en-tête sort avec des marqueurs littéraux — ce que
  # le contrôle 5 attraperait, mais pour la mauvaise raison. Valeurs neutres.
  qfull "UPDATE app.profiles SET full_name='Praticienne Test', title='Dr',
           speciality_fr='Medecin Specialiste en Psychiatrie', speciality_ar='طبيبة',
           order_number='00/00000', phone='0000000000',
           signature_block='{\"full_name_ar\": \"الدكتورة\"}'::jsonb
         WHERE id='$OWNER';" >/dev/null
  qfull "UPDATE app.cabinets SET name='Cabinet Test', address='Alger', phone='0000000000'
         WHERE id='$CAB';" >/dev/null

  VARS_BSM='{"id_document_number":"AB123456","mairie":"Hydra"}'
  VARS_SM='{"jours":"30","jours_lettres":"VALEUR-DE-LAPPELANTE","date_debut":"01/09/2026"}'
  # 045 : deux lignes de traitement. `traitement_2` est renseignee ICI — le cas
  # VIDE a son propre controle plus bas, parce que c'est lui qui est neuf.
  VARS_CM='{"date_naissance":"14/03/1990","traitement_1":"Traitement de test","traitement_2":"Seconde ligne"}'
  VARS_J='{"date_consultation":"09/08/2026"}'

  d1=$(q "$as_owner SELECT app.issue_document('$PAT1','bonne_sante_mentale','$VARS_BSM');")
  d2=$(q "$as_owner SELECT app.issue_document('$PAT1','suivi_medical','$VARS_SM');")
  d3=$(q "$as_owner SELECT app.issue_document('$PAT1','certificat_medical','$VARS_CM');")
  d4=$(q "$as_owner SELECT app.issue_document('$PAT1','justification','$VARS_J');")

  # ── 5 · AUCUN marqueur littéral sur une pièce réellement émise ───────────
  # Le contrôle central de ce lot. Le défaut de 031 aurait fait sortir un
  # certificat destiné à un notaire avec « {{praticien.titre}} » imprimé dessus.
  if [ "$d1" = "ERREUR" ] || [ "$d2" = "ERREUR" ] || [ "$d3" = "ERREUR" ] || [ "$d4" = "ERREUR" ]; then
    red "${LIB_BASE[4]}" "une émission a échoué : bsm=$d1 sm=$d2 cm=$d3 just=$d4"
  else
    restes=$(q "SELECT COALESCE(string_agg(DISTINCT m[1], ', '), 'AUCUN')
                  FROM app.documents d,
                       LATERAL regexp_matches(d.rendered_html, '(\{\{[^{}]*\}\})', 'g') AS m
                 WHERE d.doc_number LIKE 'DOC-%';")
    [ "$restes" = "AUCUN" ] && green "${LIB_BASE[4]}" \
                            || red "${LIB_BASE[4]}" "MARQUEUR LITTÉRAL SUR UN CERTIFICAT : $restes"
  fi

  # ── 6 · Le nombre en lettres vient de la base ────────────────────────────
  # `VARS_SM` envoie délibérément une valeur ABSURDE. Si elle apparaît sur le
  # papier, l'écrasement de 043 §5bis ne fonctionne pas — et un certificat
  # d'arrêt de travail peut alors porter des chiffres et des lettres qui se
  # contredisent, c'est-à-dire un faux.
  # ⚠️ CE CONTROLE A CHANGE DE NATURE AVEC v2, ET CE N'EST PAS UN AFFAIBLISSEMENT
  # DEGUISE — le dire est la seule facon honnete de rendre compte.
  # v1 imprimait « 30 Jours (trente jours) » : on lisait donc SUR LA PIECE que
  # l'ecrasement de 043 §5bis avait bien eu lieu. DOCUMENT-TEMPLATES-v2 §2
  # n'imprime plus les lettres — cette verification-la n'est plus possible, et
  # continuer a chercher « trente jours » ferait ROUGIR un produit sain.
  #
  # Ce qui reste verifiable, et qui EST la garantie de securite : la valeur
  # absurde envoyee par l'appelante n'atteint jamais le papier, et le nombre en
  # chiffres imprime est bien celui qui a ete soumis. Que `jours_lettres` soit
  # toujours recalculee est prouve ailleurs — controle 24, sur la fonction
  # elle-meme — et la valeur soumise reste tracee (controle suivant).
  html2=$(q "SELECT replace(rendered_html, chr(10), ' ') FROM app.documents WHERE id='$d2';")
  if printf '%s' "$html2" | grep -qF 'de 30 jours' \
     && ! printf '%s' "$html2" | grep -qF 'VALEUR-DE-LAPPELANTE'; then
    green "${LIB_BASE[5]}"
  else
    red "${LIB_BASE[5]}" "extrait : $(printf '%s' "$html2" | grep -oE '.{0,60}jours.{0,20}' | head -1)"
  fi

  # ── 7 · …et la colonne `variables` garde la SAISIE ───────────────────────
  # Les deux ne disent pas la même chose et ne doivent pas se confondre :
  # `variables` est la trace de ce que la praticienne a soumis, `rendered_html`
  # est la pièce. Les aligner ferait mentir l'une ou l'autre.
  saisi=$(q "SELECT variables ->> 'jours_lettres' FROM app.documents WHERE id='$d2';")
  [ "$saisi" = "VALEUR-DE-LAPPELANTE" ] && green "${LIB_BASE[6]}" \
                                        || red "${LIB_BASE[6]}" "variables.jours_lettres = $saisi"

  # ── 8 · Une donnée ne peut pas fabriquer un marqueur ─────────────────────
  # `app.html_escape` échappe `{` et `}` précisément pour ça (030 §1ter).
  d8=$(q "$as_owner SELECT app.issue_document('$PAT1','certificat_medical',
            '{\"date_naissance\":\"14/03/1990\",\"traitement_1\":\"Prendre {{patient.last_name}} deux fois par jour\",\"traitement_2\":\"\"}');")
  # ⚠️ `replace(…, chr(10), ' ')` OBLIGATOIRE : `q()` termine par `tail -1`,
  # et `rendered_html` est multiligne. Sans l'aplatissement, le contrôle
  # n'inspecte que la DERNIÈRE ligne du certificat — où la chaîne échappée
  # ne se trouve pas. Le contrôle 6 le fait déjà ; celui-ci l'avait oublié
  # et rendait un ROUGE sur un produit sain.
  html8=$(q "SELECT replace(rendered_html, chr(10), ' ') FROM app.documents WHERE id='$d8';")
  if printf '%s' "$html8" | grep -qF '&#123;&#123;patient.last_name&#125;&#125;'; then
    green "${LIB_BASE[7]}"
  else
    red "${LIB_BASE[7]}" "la donnée n'a pas été échappée : $(printf '%s' "$html8" | grep -oE '.{0,50}Prendre.{0,50}' | head -1)"
  fi

  # ── 9 · Dossier incomplet : refus, jamais un blanc ───────────────────────
  qfull "UPDATE app.patients SET sex=NULL WHERE id='$PAT1';" >/dev/null
  msg9=$(qfull "$as_owner SELECT app.issue_document('$PAT1','justification','$VARS_J');")
  qfull "UPDATE app.patients SET sex='F' WHERE id='$PAT1';" >/dev/null
  if refused "$msg9" && printf '%s' "$msg9" | grep -qiF 'Dossier incomplet'; then
    green "${LIB_BASE[8]}"
  else
    red "${LIB_BASE[8]}" "aucun refus explicite : $(printf '%s' "$msg9" | head -1)"
  fi

  # ── 9bis · 045 · LA CLE FACULTATIVE ──────────────────────────────────────
  # DOCUMENT-TEMPLATES-v2 §3 autorise UNE ligne de traitement. C'est donc le cas
  # NOMINAL du certificat medical, pas un cas limite, et il doit passer.
  #
  # ⚠️ ET IL DOIT PASSER SANS LAISSER DE PUCE BLANCHE NI DE MARQUEUR. Les deux
  # echecs possibles sont opposes et se ressemblent en JSON :
  #   · clé ABSENTE  → `#>>` rend NULL → « {{vars.traitement_2}} » IMPRIME ;
  #   · clé VIDE     → substitution reelle → « <li></li> », masque par li:empty.
  # On verifie donc les DEUX faces, et le contenu du HTML, pas seulement le
  # succes de l'appel.
  VARS_CM1='{"date_naissance":"14/03/1990","traitement_1":"Une seule ligne","traitement_2":""}'
  d9b=$(q "$as_owner SELECT app.issue_document('$PAT1','certificat_medical','$VARS_CM1');")
  if [ "$d9b" = "ERREUR" ]; then
    red "${LIB_BASE[13]}" "emission refusee alors que traitement_2 a le droit d etre vide"
  else
    h9b=$(q "SELECT replace(rendered_html, chr(10), ' ') FROM app.documents WHERE id='$d9b';")
    if printf '%s' "$h9b" | grep -qF '<li></li>'        && printf '%s' "$h9b" | grep -qF 'Une seule ligne'        && ! printf '%s' "$h9b" | grep -qF '{{'; then
      green "${LIB_BASE[13]}"
    else
      red "${LIB_BASE[13]}" "puce vide absente, ou marqueur reste : $(printf '%s' "$h9b" | grep -oE '<ul.{0,90}' | head -1)"
    fi
  fi

  # L'autre face : « facultatif » ne doit JAMAIS devenir « omissible ». Si la
  # base acceptait la cle absente, le marqueur partirait litteral sur le papier.
  m9c=$(qfull "$as_owner SELECT app.issue_document('$PAT1','certificat_medical','{\"date_naissance\":\"14/03/1990\",\"traitement_1\":\"x\"}');")
  if refused "$m9c"; then
    green "${LIB_BASE[14]}"
  else
    red "${LIB_BASE[14]}" "cle absente ACCEPTEE — un marqueur partira sur le papier"
  fi

  # ── 10 · La forme de `jours` ─────────────────────────────────────────────
  # Sans le garde de 043, le cast lèverait un 22P02 brut, illisible pour la
  # praticienne et porteur de la valeur saisie.
  m10a=$(qfull "$as_owner SELECT app.issue_document('$PAT1','suivi_medical','{\"jours\":\"trente\",\"jours_lettres\":\"x\",\"date_debut\":\"01/09/2026\"}');")
  m10b=$(qfull "$as_owner SELECT app.issue_document('$PAT1','suivi_medical','{\"jours\":\"400\",\"jours_lettres\":\"x\",\"date_debut\":\"01/09/2026\"}');")
  m10c=$(qfull "$as_owner SELECT app.issue_document('$PAT1','suivi_medical','{\"jours\":\"0\",\"jours_lettres\":\"x\",\"date_debut\":\"01/09/2026\"}');")
  if refused "$m10a" && refused "$m10b" && refused "$m10c" \
     && ! printf '%s' "$m10a" | grep -qiF 'invalid input syntax'; then
    green "${LIB_BASE[9]}"
  else
    red "${LIB_BASE[9]}" "trente=$(refused "$m10a" && echo refusé || echo ACCEPTÉ) 400=$(refused "$m10b" && echo refusé || echo ACCEPTÉ) 0=$(refused "$m10c" && echo refusé || echo ACCEPTÉ)"
  fi

  # ── 11 · Le jeu de champs, et le compteur qui ne doit pas avancer ────────
  # Le numéro est alloué EN DERNIER (030 §8) : un chemin d'échec ne doit
  # consommer aucun numéro. Un trou dans une numérotation médico-légale est
  # une suspicion.
  cpt_avant=$(q "SELECT current_value FROM app.counters WHERE scope='document';")
  m11a=$(qfull "$as_owner SELECT app.issue_document('$PAT1','justification','{}');")
  m11b=$(qfull "$as_owner SELECT app.issue_document('$PAT1','justification','{\"date_consultation\":\"09/08/2026\",\"enTrop\":\"x\"}');")
  m11c=$(qfull "$as_owner SELECT app.issue_document('$PAT1','justification','{\"date_consultation\":\"   \"}');")
  m11d=$(qfull "$as_owner SELECT app.issue_document('$PAT1','justification','pas du json');")
  cpt_apres=$(q "SELECT current_value FROM app.counters WHERE scope='document';")
  if refused "$m11a" && refused "$m11b" && refused "$m11c" && refused "$m11d" \
     && [ "$cpt_avant" = "$cpt_apres" ]; then
    green "${LIB_BASE[10]}"
  else
    red "${LIB_BASE[10]}" "manquant=$(refused "$m11a" && echo refusé || echo ACCEPTÉ) enTrop=$(refused "$m11b" && echo refusé || echo ACCEPTÉ) vide=$(refused "$m11c" && echo refusé || echo ACCEPTÉ) nonJson=$(refused "$m11d" && echo refusé || echo ACCEPTÉ) compteur $cpt_avant→$cpt_apres"
  fi

  # ── 12 · Le garde d'enum ─────────────────────────────────────────────────
  # ⚠️ CONTRÔLE FAIBLE, ET DÉCLARÉ TEL. On ne peut pas ajouter une valeur à
  # `app.doc_type` pour l'éprouver — ce serait créer un type absent de
  # 01-SCHEMA.md (règle 9). On vérifie donc par LECTURE que le garde de 030 est
  # toujours là. Le jour où `recu` arrive, c'est lui qui empêchera un document
  # de partir sans aucune validation de champs.
  garde=$(q "SELECT (prosrc LIKE '%v_attendues IS NULL%')::text
               FROM pg_proc p JOIN pg_namespace nn ON nn.oid=p.pronamespace
              WHERE nn.nspname='app' AND p.proname='issue_document';")
  [ "$garde" = "true" ] && green "${LIB_BASE[11]}" || red "${LIB_BASE[11]}" "garde absent (prosrc=$garde)"

  # ── 13 · Les pièges du français, sur la base réelle ──────────────────────
  # 042 les vérifie déjà à l'application ; on les rejoue ici pour que le
  # checkpoint reste probant sur une base qu'on n'a pas migrée soi-même.
  ecarts=""
  for cas in "21|vingt et un" "71|soixante et onze" "80|quatre-vingts" \
             "81|quatre-vingt-un" "91|quatre-vingt-onze" "100|cent" \
             "180|cent quatre-vingts" "200|deux cents" "201|deux cent un"; do
    nb="${cas%%|*}"; attendu="${cas##*|}"
    obtenu=$(q "SELECT app.nombre_en_lettres($nb);")
    [ "$obtenu" = "$attendu" ] || ecarts="$ecarts $nb→«$obtenu»(attendu «$attendu»)"
  done
  [ -z "$ecarts" ] && green "${LIB_BASE[12]}" || red "${LIB_BASE[12]}" "$ecarts"
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
echo "⚠️  V8 N'EST PAS CLOS POUR AUTANT. Deux contrôles ne s'automatisent pas :"
echo "    · la saisie du profil réel sur l'instance (nom, n° d'ordre, téléphone,"
echo "      spécialités FR/AR, signature_block.full_name_ar) — sans elle,"
echo "      l'en-tête sort avec des marqueurs littéraux ;"
echo "    · le tirage papier, posé à côté d'un certificat de la praticienne,"
echo "      et son approbation. Les marges (tokens.css) sont une HYPOTHESE."
echo "    Le logo N'EST PLUS un écart : les maquettes v2 approuvées portent"
echo "    exactement public/marque-certificat.svg (vérifié le 2026-08-22)."
