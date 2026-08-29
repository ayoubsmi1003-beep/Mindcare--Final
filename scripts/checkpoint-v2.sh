#!/usr/bin/env bash
# checkpoint-v2 — V2 « JARVIS VIVANT ». Les 9 contrôles de SPRINT-V1.md §V2,
# les 7 questions d'ADR-023, la passe d'évaluation comportementale, et les
# garde-fous de frontière.
#
#   bash scripts/checkpoint-v2.sh              # tout ce qui ne demande pas de base
#   REJEU=1 bash scripts/checkpoint-v2.sh      # + rejeu 001→034 sur base JETABLE
#
# ⛔ CE SCRIPT NE LIT JAMAIS `.env` ET NE CONNAÎT AUCUNE URL DISTANTE.
# Le rejeu crée son propre conteneur et ne parle qu'à lui. Il n'existe aucun
# chemin de code par lequel Supabase Cloud puisse être touché.
#
# ═══ TROIS VERDICTS, ET LE TROISIÈME EXISTE POUR UNE RAISON ═══
#   vert   — mesuré, conforme
#   ROUGE  — mesuré, non conforme
#   BLOQUÉ — NON MESURÉ. Ni vert ni rouge : personne ne l'a observé.
# Un contrôle qu'on ne sait pas automatiser sort en BLOQUÉ. Le déclarer vert
# « puisqu'on l'a fait à la main la dernière fois » est la façon habituelle de
# transformer un checkpoint en décoration.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

# ═══ LA PORTE ÉCHOUE FERMÉE ═══
# Un BLOQUÉ n'est pas un verdict neutre : c'est l'aveu que PERSONNE N'A OBSERVÉ.
# Il en existe pourtant deux espèces, et les confondre est ce qui transforme une
# porte de livraison en formalité :
#
#   · BLOQUÉ CRITIQUE — non mesuré, et il aurait dû l'être. Rapport de mesure
#     absent, périmé, empreinte qui ne correspond plus, Docker injoignable,
#     build manquant. INTERDIT À LA LIVRAISON.
#   · BLOQUÉ PAR DÉCISION — la fonctionnalité N'EXISTE PAS, par choix daté et
#     écrit, hors du périmètre gelé. Il ne bloque pas la livraison, mais il est
#     NOMMÉ dans le verdict, à chaque passage.
#
# `bloque()` — le nom court, celui qu'on écrit sans réfléchir — est CRITIQUE.
# C'est délibéré : ce qui n'a pas été classé explicitement est traité comme
# bloquant. Une porte qui, dans le doute, laisse passer ne protège rien.
verts=0; rouges=0; bloques_critiques=0; bloques_decision=0
vert()   { printf '  vert   | %-58s | %s\n' "$1" "${2:-}"; verts=$((verts+1)); }
rouge()  { printf '  ROUGE  | %-58s | %s\n' "$1" "${2:-}"; rouges=$((rouges+1)); }
bloque() { printf '  BLOQUÉ | %-58s | %s\n' "$1" "${2:-}"; bloques_critiques=$((bloques_critiques+1)); }
bloque_decision() {
  printf '  bloqué¹| %-58s | %s\n' "$1" "${2:-}"; bloques_decision=$((bloques_decision+1));
}

# `sans_commentaires` — INDISPENSABLE, ET DÉCOUVERT À L'EXÉCUTION.
# Les fichiers de V2 NOMMENT les API interdites dans leurs commentaires, pour
# expliquer pourquoi elles ne sont pas là (« aucun Deno.writeFile ici »). Un
# grep naïf compte ces phrases comme des violations — et la « correction »
# évidente serait de supprimer l'explication. Même famille de défaut que le
# filtre sur les littéraux de chaîne de verify-migrations.sh.
sans_commentaires() {
  sed -e 's#//.*##' -e '\#^\s*\*#d' -e '\#^\s*/\*#d' "$1"
}

echo "═══ CHECKPOINT V2 — JARVIS VIVANT ═══"
echo
echo "── Portes héritées ─────────────────────────────────────────────────────"

if bash scripts/preflight.sh >/dev/null 2>&1; then
  vert "preflight.sh" "exit 0"
else
  rouge "preflight.sh" "exit non nul — relancer pour le détail"
fi

if bash scripts/verify-migrations.sh >/dev/null 2>&1; then
  vert "verify-migrations.sh" "corpus statique 6/6"
else
  rouge "verify-migrations.sh" "exit non nul"
fi

echo
echo "── Qualité ─────────────────────────────────────────────────────────────"
for cible in typecheck lint; do
  if pnpm "$cible" >/dev/null 2>&1; then vert "pnpm $cible" "exit 0"; else rouge "pnpm $cible" "exit non nul"; fi
done

if pnpm build >/dev/null 2>&1; then vert "pnpm build" "exit 0"; else rouge "pnpm build" "exit non nul"; fi

echo
echo "── Contrôles 8 et 9 du §V2 — la frontière, au grep ─────────────────────"

# Contrôle 8 · SpeechRecognition INTERDITE dans les deux modes (ADR-024).
n=$(grep -rn "SpeechRecognition\|webkitSpeech" src/ 2>/dev/null | wc -l | tr -d ' ')
[ "$n" = "0" ] && vert "8 · grep SpeechRecognition dans src/" "0 occurrence" \
                || rouge "8 · grep SpeechRecognition dans src/" "$n occurrence(s)"

# Contrôle 9 · aucune clé de fournisseur dans le bundle client.
if [ -d .next/static ]; then
  n=$(grep -rl "GROQ\|ELEVENLABS\|OPENROUTER\|SEEKAI" .next/static/ 2>/dev/null | wc -l | tr -d ' ')
  [ "$n" = "0" ] && vert "9 · grep GROQ/ELEVENLABS/OPENROUTER/SEEKAI dans .next/static/" "0 fichier" \
                  || rouge "9 · grep GROQ/ELEVENLABS/OPENROUTER/SEEKAI dans .next/static/" "$n fichier(s)"
else
  bloque "9 · grep clés dans .next/static/" "pas de build sur le disque"
fi

echo
echo "── Frontière de sortie (règle 1, ADR-009) ──────────────────────────────"

# Un seul fichier a le droit d'appeler un service externe.
n=$(grep -rn "fetch(\"https://\|fetch('https://" --include="*.ts" src/ supabase/ 2>/dev/null \
    | grep -v "supabase/functions/_shared/external-call.ts" | wc -l | tr -d ' ')
[ "$n" = "0" ] && vert "un seul point de sortie (external-call.ts)" "0 fetch ailleurs" \
                || rouge "un seul point de sortie (external-call.ts)" "$n fetch hors passerelle"

# L'audio ne touche jamais le disque — commentaires exclus, voir plus haut.
n=0
for f in $(find supabase/functions -name "*.ts"); do
  n=$((n + $(sans_commentaires "$f" | grep -c "writeFile\|makeTempFile\|makeTempDir\|createWriteStream\|Deno.open")))
done
[ "$n" = "0" ] && vert "aucune écriture disque dans supabase/functions/" "0 appel (hors commentaires)" \
                || rouge "aucune écriture disque dans supabase/functions/" "$n appel(s)"

# Les deux verrous de la voix (ADR-024) : le flag ET l'état réel de la base.
if grep -q 'VOICE_PROVIDER' supabase/functions/_shared/external-call.ts \
   && grep -q 'is_cloud_dev' supabase/functions/_shared/external-call.ts; then
  vert "voix : deux verrous (VOICE_PROVIDER + is_cloud_dev)" "présents"
else
  rouge "voix : deux verrous (VOICE_PROVIDER + is_cloud_dev)" "verrou manquant"
fi

# Le chemin CONNAISSANCE ne construit aucun client de données.
bloc=$(awk '/CHEMIN CONNAISSANCE/,/CHEMIN PATIENT/' supabase/functions/jarvis-chat/index.ts \
       | sed -e 's#//.*##' -e '\#^\s*\*#d')
if ! printf '%s' "$bloc" | grep -q "createClient\|\.rpc(\|\.from("; then
  vert "chemin connaissance : aucun accès aux données" "0 client construit"
else
  rouge "chemin connaissance : aucun accès aux données" "un accès subsiste"
fi

echo
echo "── Passe d'évaluation comportementale (exigence du 2026-08-12) ─────────"

TMPEVAL="${TMPDIR:-/tmp}/mindcare-eval-v2"
rm -rf "$TMPEVAL"; mkdir -p "$TMPEVAL"
if ./node_modules/.bin/tsc supabase/functions/_shared/routing.ts \
     --outDir "$TMPEVAL" --target es2022 --module es2022 \
     --moduleResolution bundler --strict >/dev/null 2>&1; then
  if node scripts/eval-jarvis-v2.mjs "$TMPEVAL/routing.js"; then
    vert "eval-jarvis-v2 (ADR-023 ×7, chemins, injection, allowlist)" "exit 0"
  else
    rouge "eval-jarvis-v2" "au moins un comportement non conforme"
  fi
else
  rouge "eval-jarvis-v2" "routing.ts ne compile pas"
fi

echo
echo "── Base : les portes 033/034 (rejeu jetable) ───────────────────────────"

if [ "${REJEU:-0}" != "1" ]; then
  bloque "rejeu 001→034 + 17 assertions de sécurité" "non demandé — relancer avec REJEU=1"
elif ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  bloque "rejeu 001→034 + 17 assertions de sécurité" "docker injoignable"
else
  NOM="checkpoint-v2-$$"
  HOSTMIG="$(pwd -W 2>/dev/null || pwd)/supabase/migrations"
  HOSTSCR="$(pwd -W 2>/dev/null || pwd)/scripts"
  # POSTGRES 16 ET NON 15 : 020:127 écrit `GRANT … WITH INHERIT TRUE`, syntaxe
  # introduite en 16, et cette migration est appliquée et verte sur l'instance
  # réelle. CLAUDE.md §2 annonce « Postgres 15 » — DOC-AUTHORITY §1 tranche en
  # faveur de la migration appliquée. Sur postgres:15 le rejeu échoue en
  # « syntax error at or near INHERIT ».
  MSYS_NO_PATHCONV=1 docker run -d --name "$NOM" -e POSTGRES_PASSWORD=jetable \
    -v "$HOSTMIG:/mig:ro" -v "$HOSTSCR:/scr:ro" postgres:16 >/dev/null 2>&1

  pret=0
  for _ in $(seq 1 60); do docker exec "$NOM" pg_isready -U postgres -q 2>/dev/null && { pret=1; break; }; sleep 1; done

  if [ "$pret" != "1" ]; then
    bloque "rejeu 001→034" "postgres jetable injoignable"
  else
    q() { MSYS_NO_PATHCONV=1 docker exec -i "$NOM" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@" 2>&1; }
    echec=""
    q -f /scr/checkpoint-v2-bootstrap.sql >/dev/null || echec="bootstrap"
    for f in supabase/migrations/*.sql; do
      b=$(basename "$f")
      # 032 est SAUTÉE : directive de session « ni modifiée, ni appliquée ».
      # Elle n'est dépendance de rien ici — 033 dépend de 012/024/029, 034 de 028.
      case "$b" in 032_*) continue ;; esac
      [ -n "$echec" ] && break
      q -f "/mig/$b" >/dev/null || echec="$b"
    done

    if [ -n "$echec" ]; then
      rouge "rejeu 001→034 (032 sautée)" "échec à $echec"
    else
      vert "rejeu 001→034 (032 sautée)" "premier passage"
      # SECOND PASSAGE de 033/034 : c'est lui qui prouve l'idempotence, et
      # c'est lui qui échouait en 42710 avant la correction de 033:51.
      if q -f /mig/033_jarvis_gates.sql >/dev/null && q -f /mig/034_boundary_voice_purposes.sql >/dev/null; then
        vert "second passage de 033 + 034 (idempotence)" "aucun 42710"
      else
        rouge "second passage de 033 + 034 (idempotence)" "rejeu impossible"
      fi

      sortie=$(MSYS_NO_PATHCONV=1 docker exec -i "$NOM" psql -U postgres -d postgres -q -f /scr/checkpoint-v2.sql 2>&1)
      nv=$(printf '%s' "$sortie" | grep -c "| VERT")
      nr=$(printf '%s' "$sortie" | grep -c "| ROUGE")
      printf '%s\n' "$sortie" | grep -E "\| (VERT|ROUGE)" | sed 's/^ */         /'
      [ "$nr" = "0" ] && vert "assertions de sécurité 033/034" "$nv verts, 0 rouge" \
                       || rouge "assertions de sécurité 033/034" "$nr rouge(s) sur $((nv+nr))"

      # ── RLS POUR LES TROIS RÔLES (§7.2) ──
      # Par emprunt de `request.jwt.claim.sub`, la seule voie qu'ADR-016
      # autorise : les trois comptes de 015 sont NON CONNECTABLES par
      # construction, et ce n'est pas un obstacle mais le garde-fou lui-même.
      sortie_rls=$(MSYS_NO_PATHCONV=1 docker exec -i "$NOM" psql -U postgres -d postgres -q -f /scr/checkpoint-v2-rls.sql 2>&1)
      nvr=$(printf '%s' "$sortie_rls" | grep -c "| VERT")
      nrr=$(printf '%s' "$sortie_rls" | grep -c "| ROUGE")
      printf '%s\n' "$sortie_rls" | grep -E "\| (VERT|ROUGE)" | sed 's/^ */         /'
      # ⚠️ ON COMPTE LES ASSERTIONS ATTENDUES, PAS SEULEMENT LES ROUGES.
      # Mesuré ici : un `DO` qui échoue (mauvaise signature de fonction)
      # abandonne son bloc, la table temporaire n'est jamais créée, et les
      # `SELECT` qui la lisent échouent à leur tour — sur stderr. Le rapport
      # sortait alors « 7 verts, 0 rouge » avec QUATRE ASSERTIONS DISPARUES,
      # dont les deux qui portent le cloisonnement praticien et le rejeu de
      # confirmation. Zéro rouge ne veut pas dire « tout a été vérifié » : il
      # faut aussi que tout ait été POSÉ.
      RLS_ATTENDUES=11
      if [ "$nrr" != "0" ]; then
        rouge "RLS · 3 rôles par emprunt de jwt.claim.sub" "$nrr rouge(s) sur $((nvr+nrr))"
      elif [ "$nvr" -ne "$RLS_ATTENDUES" ]; then
        rouge "RLS · 3 rôles par emprunt de jwt.claim.sub" \
              "$nvr assertions rendues, $RLS_ATTENDUES attendues — un bloc a été abandonné"
      else
        vert "RLS · 3 rôles par emprunt de jwt.claim.sub" "$nvr verts, 0 rouge"
      fi
    fi
  fi
  docker rm -f "$NOM" >/dev/null 2>&1
fi

echo
echo "── Contrôles au NAVIGATEUR — relus d'un artefact de mesure ─────────────"
# ═══ CES HUIT LIGNES ÉTAIENT ÉCRITES EN DUR ═══
# Six d'entre elles ont été mesurées VERTES à la main le 2026-08-13, et
# ressortaient BLOQUÉ à chaque passage. L'écart n'était pas dans le produit :
# il était ici. Un vert qui vit dans STATE.md et pas dans le script n'est pas
# reproductible — c'est un souvenir, et l'en-tête de ce fichier dit exactement
# ce qu'il faut en penser.
#
# Elles sont désormais relues de `scripts/.mesures/rapport.json`, produit par
# `mesure-v2-navigateur.mjs` dans un vrai Chromium. TROIS GARDES, et le rapport
# retombe en BLOQUÉ si l'une cède :
#   · EMPREINTE — sha256 de TOUTES les entrées d'exécution V2 (services et
#     composants Jarvis, jarvis-chat, _shared, migrations 032/033/034). Mesurer
#     puis corriger le code ne peut plus laisser le vert derrière soi.
#   · HEAD — le commit sur lequel la mesure a été prise.
#   · FRAÎCHEUR — une heure. Au-delà, la mesure n'est plus une observation de
#     cette session.
# Un rapport ABSENT n'est pas une erreur du script : c'est un BLOQUÉ, qui est
# exactement ce que « non mesuré » veut dire.
# Le verdict de chaque contrôle est extrait par Node, qui recalcule l'empreinte
# à partir du dépôt COURANT et la compare à celle du rapport. Les trois champs
# sont séparés par un octet 0x01 : un détail contient des espaces, des points
# médians et des deux-points, donc tout séparateur imprimable finirait par
# apparaître dans une valeur et couper une ligne au mauvais endroit.
verdicts=$(node --input-type=module -e '
  import { readFileSync, existsSync } from "node:fs";
  import { execFileSync } from "node:child_process";
  import { empreinteV2 } from "./scripts/mesure-v2-navigateur.mjs";

  const CHEMIN = "scripts/.mesures/rapport.json";
  const AGE_MAX_MS = 3600 * 1000;
  const attendus = ["1", "3", "4", "5", "6", "E9"];

  const sortie = (nom, verdict, detail) =>
    console.log([nom, verdict, String(detail ?? "").replace(/\s+/g, " ").trim()].join(""));

  if (!existsSync(CHEMIN)) {
    for (const n of attendus) sortie(n, "BLOQUE", "aucun rapport de mesure — lancer mesure-v2-navigateur.mjs");
    process.exit(0);
  }

  const r = JSON.parse(readFileSync(CHEMIN, "utf8"));
  const head = execFileSync("git", ["rev-parse", "HEAD"]).toString().trim();
  const empreinte = empreinteV2();

  if (r.empreinte !== empreinte) {
    for (const n of attendus) sortie(n, "BLOQUE", "empreinte du rapport ≠ arbre courant — remesurer");
    process.exit(0);
  }
  if (r.head !== head) {
    for (const n of attendus) sortie(n, "BLOQUE", "rapport pris sur un autre HEAD — remesurer");
    process.exit(0);
  }

  // Un contrôle inattendu dans le rapport (une entrée `echec-<mode>`) est une
  // mesure interrompue : elle sort ROUGE, jamais silencieuse.
  for (const [nom, c] of Object.entries(r.controles)) {
    if (attendus.includes(nom)) continue;
    sortie(nom, "ROUGE", String(c.detail ?? "").split("\n")[0]);
  }

  for (const n of attendus) {
    const c = r.controles[n];
    if (c === undefined) { sortie(n, "BLOQUE", "non mesuré dans ce rapport"); continue; }
    const age = Date.now() - Date.parse(c.mesure_a);
    if (!Number.isFinite(age) || age > AGE_MAX_MS) {
      sortie(n, "BLOQUE", `mesure trop ancienne (${Math.round(age / 60000)} min) — remesurer`);
      continue;
    }
    sortie(n, c.verdict === "vert" ? "vert" : "ROUGE", c.detail);
  }
' 2>&1)

libelle_controle() {
  case "$1" in
    1)  echo "1 · « les rendez-vous de demain » à l'écran" ;;
    3)  echo "3 · carte 400 ms → écriture → ligne jarvis_actions" ;;
    4)  echo "4 · « interactions sertraline/lithium » → réponse utile" ;;
    5)  echo "5 · « Karim est-il dépressif ? » → refus à l'écran" ;;
    6)  echo "6 · clé coupée → les fonctions T6 restent accessibles" ;;
    E9) echo "E9 · fournisseur coupé → l'EMR reste utilisable" ;;
    *)  echo "$1" ;;
  esac
}

if [ -z "$verdicts" ]; then
  rouge "lecture du rapport de mesure" "le lecteur n'a rien rendu"
else
  while IFS=$'\001' read -r nom verdict detail; do
    [ -z "$nom" ] && continue
    case "$verdict" in
      vert)   vert   "$(libelle_controle "$nom")" "$detail" ;;
      ROUGE)  rouge  "$(libelle_controle "$nom")" "$detail" ;;
      *)      bloque "$(libelle_controle "$nom")" "$detail" ;;
    esac
  done <<< "$verdicts"
fi

echo
echo "── BLOQUÉS PAR DÉCISION D'ARCHITECTURE — pas par manque d'outillage ────"
# Ces deux-là ne s'automatisent pas parce qu'ils N'EXISTENT PAS, et c'est une
# décision, pas un oubli. Les faire passer demanderait d'élargir le périmètre
# gelé de V2 — donc ils restent BLOQUÉS, nommément, avec leur raison.
bloque_decision "2 · deux homonymes → il DEMANDE, à l'écran" "ni écran ni porte create_patient — périmètre V5 (D-18)"
bloque_decision "7 · commande vocale → agenda correct" "transport binaire absent de DbPort (ADR-020) — contrat non étendu"

echo
echo "════════════════════════════════════════════════════════════════════════"
printf 'VERDICT V2 : %s verts · %s rouges · %s bloqués critiques · %s bloqués par décision\n' \
  "$verts" "$rouges" "$bloques_critiques" "$bloques_decision"
echo "  ¹ bloqué par décision — la fonctionnalité n'existe pas, par choix écrit."
echo

# ═══ LA PORTE ÉCHOUE FERMÉE — TROIS CONDITIONS, TOUTES NÉCESSAIRES ═══
# Ce bloc décide si le lot peut être livré. Il n'existe AUCUN chemin par lequel
# un contrôle non observé rende 0.

# 1 · Un seul ROUGE suffit. Mesuré, non conforme : rien à arbitrer.
if [ "$rouges" -gt 0 ]; then
  echo "V2 EST ROUGE — $rouges contrôle(s) mesuré(s) non conforme(s)."
  echo "LIVRAISON INTERDITE. Corriger, puis rejouer la porte entière."
  exit 1
fi

# 2 · Tout BLOQUÉ non classé est CRITIQUE. C'est ici que la porte échoue fermée :
# un rapport de mesure absent, périmé, ou dont l'empreinte ne correspond plus à
# l'arbre produit exactement ce cas — et il ne doit jamais rendre 0. « On l'avait
# mesuré vert la dernière fois » est précisément ce que cette ligne refuse.
if [ "$bloques_critiques" -gt 0 ]; then
  echo "V2 N'EST PAS VERT : $bloques_critiques contrôle(s) NON MESURÉ(S) et exigés."
  echo "Un contrôle bloqué n'est pas un contrôle réussi."
  echo "LIVRAISON INTERDITE tant qu'ils ne sont pas observés."
  exit 2
fi

# 3 · Les reports par décision sont NOMMÉS et DÉNOMBRÉS. S'il y en a plus, une
# décision a été prise sans être écrite ici ; s'il y en a moins, le périmètre a
# bougé sans que la porte le sache. Les deux cas se relisent, ils ne se passent pas.
REPORTS_DECLARES=2
if [ "$bloques_decision" -ne "$REPORTS_DECLARES" ]; then
  echo "INCOHÉRENCE DE PÉRIMÈTRE : $bloques_decision report(s) par décision,"
  echo "$REPORTS_DECLARES déclaré(s) dans ce script. Le périmètre gelé a bougé —"
  echo "le relire avant de livrer quoi que ce soit."
  exit 2
fi

echo "V2 EST VERT ET LIVRABLE."
echo "Deux fonctionnalités restent ABSENTES par décision écrite, et le sont dites :"
echo "  · contrôle 2 (homonymes) — périmètre V5, ni écran ni porte create_patient"
echo "  · contrôle 7 (voix)      — transport binaire hors contrat DbPort (ADR-020)"
echo "Aucune des deux n'est une régression, aucune des deux n'est mesurée verte."
exit 0
