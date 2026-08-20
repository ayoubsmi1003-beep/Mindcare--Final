#!/usr/bin/env bash
# checkpoint-v6-finance — V6-FINANCE (D-23). La porte de ce lot.
#
#   bash scripts/checkpoint-v6-finance.sh
#
# ═══ TROIS VERDICTS, ET LE TROISIÈME EXISTE POUR UNE RAISON ═══
#   vert   — mesuré, conforme
#   ROUGE  — mesuré, non conforme
#   BLOQUÉ — NON MESURÉ. Ni vert ni rouge : personne ne l'a observé.
#
# Même discipline qu'en V2 et V3 : `bloque()` — le nom court, celui qu'on écrit
# sans réfléchir — est CRITIQUE et interdit la livraison. Ce qui n'a pas été
# classé explicitement est traité comme bloquant. Une porte qui, dans le doute,
# laisse passer ne protège rien.
#
# ═══ V3 EST LA BASE DE NON-RÉGRESSION, ET ELLE EST REJOUÉE ENTIÈRE ═══
# `checkpoint-v3.sh` tourne INCHANGÉ, en dernier (il construit, donc il détruit
# le serveur de développement dont la mesure V6 a besoin). Son verdict est repris
# tel quel : si le design v2 régresse, ce lot n'est pas livrable, quel que soit
# l'état de la finance.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

verts=0; rouges=0; bloques_critiques=0; bloques_decision=0
vert()   { printf '  vert   | %-58s | %s\n' "$1" "${2:-}"; verts=$((verts+1)); }
rouge()  { printf '  ROUGE  | %-58s | %s\n' "$1" "${2:-}"; rouges=$((rouges+1)); }
bloque() { printf '  BLOQUÉ | %-58s | %s\n' "$1" "${2:-}"; bloques_critiques=$((bloques_critiques+1)); }
bloque_decision() {
  printf '  bloqué¹| %-58s | %s\n' "$1" "${2:-}"; bloques_decision=$((bloques_decision+1));
}

echo "═══ CHECKPOINT V6-FINANCE — la période, la vérité, la cloison ═══"
echo

# ---------------------------------------------------------------------------
echo "── Qualité ─────────────────────────────────────────────────────────────"
if bash scripts/preflight.sh >/dev/null 2>&1; then
  vert "preflight.sh" "exit 0"
else
  rouge "preflight.sh" "exit non nul — relancer pour le détail"
fi
for cible in typecheck lint; do
  if pnpm "$cible" >/dev/null 2>&1; then
    vert "pnpm $cible" "exit 0"
  else
    rouge "pnpm $cible" "exit non nul"
  fi
done

# ---------------------------------------------------------------------------
echo
echo "── Contrôle 1 · le calendrier financier, hors base et hors navigateur ──"
# Les seules fonctions de la finance qu'un test unitaire peut couvrir : fuseau
# du cabinet, arithmétique de dates, bornes de période. Aucun lanceur de tests
# n'est installé dans ce dépôt et ce contrôle n'en installe pas (règle 10) — il
# compile avec le `tsc` déjà présent.
if node scripts/test-finance-calendrier.mjs > /tmp/v6-calendrier.log 2>&1; then
  n=$(grep -cE '^  vert' /tmp/v6-calendrier.log || echo 0)
  vert "calendrier financier (Africa/Algiers)" "$n assertions vertes"
else
  rouge "calendrier financier" "voir /tmp/v6-calendrier.log"
fi

# ---------------------------------------------------------------------------
echo
echo "── Contrôle 2 · la vérité financière EN BASE, sous trois rôles ─────────"
# ⚠️ CE CONTRÔLE POSE DES FIXTURES ET LES ANNULE (règle 8 : une fixture vit dans
# la transaction du checkpoint, jamais dans un seed livré). Il prouve ce que les
# deux paiements réels de la base ne peuvent pas prouver : une frontière de
# fuseau, une réconciliation sur trois grains, un taux partiel, et la cloison
# ADR-005 mesurée owner / praticienne / assistante.
DATABASE_URL_V6=$(grep -m1 '^DATABASE_URL=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r\n' | tr -d ' ')
if [ -z "${DATABASE_URL_V6:-}" ]; then
  bloque "vérité financière en base" "DATABASE_URL absent de .env"
elif ! docker info >/dev/null 2>&1; then
  # psql n'est pas installé sur ce poste : on passe par un conteneur jetable.
  bloque "vérité financière en base" "démon docker injoignable — aucune mesure"
else
  MSYS_NO_PATHCONV=1 docker run --rm -i -e PGURL="$DATABASE_URL_V6" postgres:15 \
    sh -c 'psql "$PGURL" -f -' < scripts/checkpoint-v6-finance.sql > /tmp/v6-sql.log 2>&1
  n_rouge=$(grep -c 'ROUGE' /tmp/v6-sql.log || true)
  n_bloq=$(grep -c 'BLOQUÉ' /tmp/v6-sql.log || true)
  n_vert=$(grep -c 'vert   |' /tmp/v6-sql.log || true)
  if grep -q 'name resolution\|could not translate\|No address' /tmp/v6-sql.log; then
    # Une panne DNS du conteneur n'est PAS un échec du produit. La dire ROUGE
    # ferait accuser la finance d'un défaut de réseau.
    bloque "vérité financière en base" "réseau du conteneur indisponible — NON MESURÉ"
  elif [ "${n_bloq:-0}" -gt 0 ]; then
    bloque "vérité financière en base" "$n_bloq contrôle(s) NON MESURÉ(S) — voir /tmp/v6-sql.log"
  elif [ "${n_rouge:-0}" -gt 0 ]; then
    rouge "vérité financière en base" "$n_rouge contrôle(s) rouge(s) — voir /tmp/v6-sql.log"
  elif [ "${n_vert:-0}" -eq 0 ]; then
    # ⚠️ LE FILET. Sortie sans rouge, sans bloqué ET sans vert : le script n'a
    # rien exécuté du tout. Sans cette branche, le contrôle DISPARAÎTRAIT du
    # verdict — plus dangereux qu'un faux rouge, parce qu'il ne laisse aucune
    # trace. Dans le doute, on BLOQUE. (Motif checkpoint-v3.sh, ligne 212.)
    bloque "vérité financière en base" "aucun contrôle exécuté — forme inconnue"
  else
    vert "vérité financière en base" "$n_vert contrôles verts, 3 rôles, fixtures annulées"
    if grep -q '0 fixture survivante' /tmp/v6-sql.log; then
      vert "ROLLBACK des fixtures vérifié" "la base n'a pas été polluée"
    else
      rouge "ROLLBACK des fixtures" "des fixtures ont SURVÉCU — base polluée"
    fi
  fi
fi

# ---------------------------------------------------------------------------
echo
echo "── Contrôle 3 · l'écran /finances au NAVIGATEUR RÉEL ───────────────────"
# ⚠️ CE BLOC APPELLE L'INSTRUMENT, IL NE RECOPIE PAS SON VERDICT (leçon V2 :
# huit `bloque` avaient été écrits EN DUR alors que la mesure était verte depuis
# deux jours). Pas de serveur en écoute → BLOQUÉ, jamais vert.
if ! curl -s -o /dev/null --max-time 6 http://localhost:3000/connexion 2>/dev/null; then
  bloque "écran /finances mesuré" "aucun serveur sur :3000 — lancer \`pnpm dev\`"
else
  if MESURE_COMPTE="${MESURE_COMPTE:-}" node scripts/mesure-v6-finance.mjs > /tmp/v6-ecran.log 2>&1; then
    n=$(grep -cE '^  vert' /tmp/v6-ecran.log || echo 0)
    vert "écran /finances mesuré" "$n contrôles verts — voir checkpoints/v6-preuves/"
  else
    # L'instrument distingue lui-même l'échec MESURÉ de l'écran NON OBSERVÉ.
    if grep -q 'BLOQUÉ' /tmp/v6-ecran.log; then
      n=$(grep -c 'BLOQUÉ' /tmp/v6-ecran.log || true)
      bloque "écran /finances" "$n contrôle(s) NON MESURÉ(S) — voir /tmp/v6-ecran.log"
    elif grep -q 'ROUGE' /tmp/v6-ecran.log; then
      rouge "écran /finances" "voir /tmp/v6-ecran.log"
    else
      bloque "écran /finances — échec NON CLASSÉ" "exit non nul, forme inconnue"
    fi
  fi
fi

# ---------------------------------------------------------------------------
echo
echo "── Contrôle 4 · aucune décision de rôle dans l'écran (règle 4) ─────────"
# La cloison se décide en base. Un `if (role === …)` dans un écran de finances
# serait un défaut de CONCEPTION, pas une précaution supplémentaire.
# ⚠️ COMMENTAIRES ÔTÉS AVANT DE COMPTER — motif `sans_commentaires` de
# checkpoint-v3.sh, et pour la raison exacte qu'il documente : ces fichiers
# CITENT la règle qu'ils respectent (« on ne lira jamais ici `if (role === …)` »).
# Un grep naïf compte l'explication comme une violation, et la « correction »
# évidente serait d'effacer l'explication — c'est-à-dire de payer deux fois la
# même enquête à la relecture suivante. Mesuré ROUGE le 2026-08-20.
n_role=$(find src/app/finances src/components/finance -type f \( -name '*.ts' -o -name '*.tsx' \) 2>/dev/null   | while read -r f; do sed -e 's#//.*##' -e '\#^\s*\*#d' -e '\#^\s*/\*#d' -e 's#/\*.*\*/##' "$f"; done   | grep -c "role ===" || true)
if [ "$n_role" -eq 0 ]; then
  vert "aucun test de rôle dans l'écran" "la RLS et la porte décident seules"
else
  rouge "test de rôle dans l'écran" "$n_role occurrence(s) — la cloison a fuité en JavaScript"
fi

# Aucun montant ne doit entrer dans un journal applicatif (règle 1, I5).
n_montant=$(grep -rnE 'log\.(info|error|warn)\([^)]*(montant|amount|Dzd)' src/services/finance*.ts 2>/dev/null | wc -l | tr -d ' ')
if [ "$n_montant" -eq 0 ]; then
  vert "aucun montant dans un journal" "une somme est une donnée de cabinet"
else
  rouge "montant journalisé" "$n_montant occurrence(s)"
fi

# ---------------------------------------------------------------------------
echo
echo "── Contrôle 5 · V3 REJOUÉE ENTIÈRE — la base de non-régression ─────────"
# ⚠️ DEUX EXIGENCES CONTRADICTOIRES DANS UN MÊME SCRIPT, ET ELLES ONT FABRIQUÉ
# DEUX FAUX VERDICTS DE SUITE. `checkpoint-v3.sh` fait deux choses :
#   sa MESURE au navigateur   → EXIGE un serveur de développement vivant
#   son `pnpm build` final    → EXIGE qu'aucun serveur n'écrive dans `.next`
# V3 documente le premier sens (« le build casse le serveur »). L'autre n'était
# écrit nulle part : un serveur vivant CASSE LE BUILD, qui meurt sur
# « Cannot find module for page: /_not-found/page » — un message qui accuse une
# page que personne n'a touchée.
#
# Mesuré le 2026-08-20, dans les deux sens :
#   serveur vivant  → mesure verte, build ROUGE (faux : le même build passe seul)
#   serveur arrêté  → build vert, 6 écrans NON OBSERVÉS → V3 exit 2 (faux aussi)
#
# On sépare donc les deux, chacun dans la condition qu'il exige. Aucun des deux
# n'est « arrangé » : ils sont mesurés là où leur mesure veut dire quelque chose.

# 5a — V3 avec le serveur VIVANT. On lit ses contrôles, pas seulement son code
# de sortie : son `pnpm build` est mesuré séparément en 5b.
bash scripts/checkpoint-v3.sh > /tmp/v6-v3.log 2>&1
v3_rouges_hors_build=$(grep 'ROUGE' /tmp/v6-v3.log | grep -vc 'pnpm build' || true)
v3_bloques=$(grep -c '^  BLOQUÉ' /tmp/v6-v3.log || true)
v3_verts=$(grep -c '^  vert' /tmp/v6-v3.log || true)

if [ "${v3_verts:-0}" -eq 0 ]; then
  # Le filet : V3 n'a rien exécuté du tout. Dans le doute, on BLOQUE.
  bloque "checkpoint-v3 (design v2)" "aucun contrôle exécuté — voir /tmp/v6-v3.log"
elif [ "${v3_bloques:-0}" -gt 0 ]; then
  bloque "checkpoint-v3 (design v2)" "$v3_bloques contrôle(s) NON MESURÉ(S) — voir /tmp/v6-v3.log"
elif [ "${v3_rouges_hors_build:-0}" -gt 0 ]; then
  rouge "checkpoint-v3 (design v2)" "$v3_rouges_hors_build rouge(s) hors build — voir /tmp/v6-v3.log"
else
  vert "checkpoint-v3 (design v2)" "$v3_verts contrôles verts — contraste, focus, jetons, fontes"
fi

# 5b — LE BUILD, serveur ARRÊTÉ. C'est la seule condition où son verdict porte
# sur le produit et non sur une concurrence d'écriture dans `.next`.
pid_dev=$(netstat -ano 2>/dev/null | grep "LISTENING" | grep ":3000" | head -1 | awk '{print $NF}')
if [ -n "${pid_dev:-}" ]; then
  echo "  (arrêt du serveur de développement PID $pid_dev — il corromprait le build)"
  taskkill //F //PID "$pid_dev" >/dev/null 2>&1 || kill -9 "$pid_dev" 2>/dev/null
  sleep 3
fi
if pnpm build > /tmp/v6-build.log 2>&1; then
  taille=$(grep -E '^├ ○ /finances' /tmp/v6-build.log | awk '{print $4, $5}')
  vert "pnpm build (serveur arrêté)" "/finances ${taille:-?} · 0 dépendance ajoutée"
else
  rouge "pnpm build" "voir /tmp/v6-build.log"
fi

# ---------------------------------------------------------------------------
echo
# Reportés par DÉCISION, écrits et datés — pas des oublis. Chacun a sa ligne
# dans DOC-AUTHORITY.md §4, avec son échéance et sa sortie.
bloque_decision "charges · dépenses · résultat net" "aucune table (ADR-010) — arbitrage praticienne"
bloque_decision "objectifs financiers"              "gelés ABSENTS par la praticienne (Q14, SPRINT-V1 §V4)"
bloque_decision "vieillissement des impayés"        "2 paiements en base — un seuil y décrirait le hasard"
bloque_decision "narration IA de la finance"        "rejetée — un montant ne sort pas de la machine"

echo
# Le serveur a été arrêté avant le build (voir contrôle 5). Il faut le relancer
# pour toute observation ultérieure — le dire ici, au moment où on le constate.
if ! netstat -ano 2>/dev/null | grep -q "LISTENING.*:3000"; then
  echo "ℹ️  Le serveur de développement a été ARRÊTÉ avant le build (nécessaire)."
  echo "    Le relancer avant toute observation :  pnpm dev"
fi

echo "═══════════════════════════════════════════════════════════════════════"
printf 'VERDICT V6-FINANCE : %d verts · %d rouges · %d bloqués critiques · %d bloqués par décision\n' \
  "$verts" "$rouges" "$bloques_critiques" "$bloques_decision"

if [ "$rouges" -ne 0 ]; then
  echo "V6-FINANCE N'EST PAS VERT : $rouges contrôle(s) MESURÉ(S) NON CONFORME(S)."
  exit 1
fi
if [ "$bloques_critiques" -ne 0 ]; then
  echo "V6-FINANCE N'EST PAS VERT : $bloques_critiques contrôle(s) NON MESURÉ(S) et exigés."
  echo "LIVRAISON INTERDITE tant qu'ils ne sont pas observés."
  exit 2
fi
if [ "$bloques_decision" -ne 4 ]; then
  echo "V6-FINANCE N'EST PAS VERT : $bloques_decision report(s) par décision, 4 attendus."
  echo "Ni plus (une décision non écrite), ni moins (un périmètre qui a bougé)."
  exit 3
fi
echo "V6-FINANCE EST VERT — aux QUATRE réserves NOMMÉES, et à elles seules."
exit 0
