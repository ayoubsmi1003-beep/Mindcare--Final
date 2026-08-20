#!/usr/bin/env bash
# checkpoint-v3 — V3 « DESIGN v2 ». Les 5 contrôles de SPRINT-V1.md §V3,
# la palette d'ADR-022, et les garde-fous que le renommage a rendus nécessaires.
#
#   bash scripts/checkpoint-v3.sh
#
# ⛔ CE SCRIPT NE LIT JAMAIS `.env`, NE TOUCHE AUCUNE BASE, N'APPELLE AUCUNE URL.
# V3 est une session purement visuelle : un checkpoint qui aurait besoin d'une
# base pour juger d'une couleur mesurerait autre chose que ce qu'il annonce.
#
# ═══ TROIS VERDICTS, ET LE TROISIÈME EXISTE POUR UNE RAISON ═══
#   vert   — mesuré, conforme
#   ROUGE  — mesuré, non conforme
#   BLOQUÉ — NON MESURÉ. Ni vert ni rouge : personne ne l'a observé.
#
# Même discipline qu'en V2 : `bloque()` — le nom court, celui qu'on écrit sans
# réfléchir — est CRITIQUE et interdit la livraison. Ce qui n'a pas été classé
# explicitement est traité comme bloquant. Une porte qui, dans le doute, laisse
# passer ne protège rien.

set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

verts=0; rouges=0; bloques_critiques=0; bloques_decision=0
vert()   { printf '  vert   | %-58s | %s\n' "$1" "${2:-}"; verts=$((verts+1)); }
rouge()  { printf '  ROUGE  | %-58s | %s\n' "$1" "${2:-}"; rouges=$((rouges+1)); }
bloque() { printf '  BLOQUÉ | %-58s | %s\n' "$1" "${2:-}"; bloques_critiques=$((bloques_critiques+1)); }
bloque_decision() {
  printf '  bloqué¹| %-58s | %s\n' "$1" "${2:-}"; bloques_decision=$((bloques_decision+1));
}

# `sans_commentaires` — REPRIS DE checkpoint-v2.sh, ET POUR LA MÊME RAISON.
# Les fichiers de V3 CITENT les choses qu'ils ont retirées : le dégradé composé
# à la main qu'on a supprimé, le nom `teal-` qu'on a remplacé, les valeurs de
# contraste qui ont motivé un choix. Un grep naïf compte ces explications comme
# des violations — et la « correction » évidente serait d'effacer l'explication,
# c'est-à-dire de payer deux fois la même enquête à la relecture suivante.
sans_commentaires() {
  sed -e 's#//.*##' -e '\#^\s*\*#d' -e '\#^\s*/\*#d' -e 's#/\*.*\*/##' "$1"
}

# Concatène tout le code applicatif, commentaires ôtés.
code_nu() {
  find src -type f \( -name '*.ts' -o -name '*.tsx' \) ! -name 'tokens.css' \
    | while read -r f; do sans_commentaires "$f"; done
}

echo "═══ CHECKPOINT V3 — DESIGN v2 ═══"
echo

echo "── Portes héritées ─────────────────────────────────────────────────────"
if bash scripts/preflight.sh >/dev/null 2>&1; then
  vert "preflight.sh" "exit 0"
else
  rouge "preflight.sh" "exit non nul — relancer pour le détail"
fi

echo
echo "── Qualité ─────────────────────────────────────────────────────────────"
for cible in typecheck lint; do
  if pnpm "$cible" >/dev/null 2>&1; then
    vert "pnpm $cible" "exit 0"
  else
    rouge "pnpm $cible" "exit non nul"
  fi
done

# ⚠️ `pnpm build` NE TOURNE PAS ICI, ET L'ORDRE EST LE SUJET.
#
# Il écrase le `.next` d'un `next dev` en cours : le serveur de développement
# sert alors des chunks 404 et plus rien n'hydrate. Piège déjà payé en V2. Placé
# AVANT la mesure au navigateur, il détruirait le serveur que cette mesure
# interroge, et fabriquerait un ROUGE qui ne dit rien du produit.
#
# Le build est donc rejoué APRÈS la mesure, plus bas. Ce n'est pas un détail de
# confort : c'est la seule position où les deux contrôles peuvent être verts
# dans le même passage.

echo
echo "── Contrôle 1 · aucune couleur en dur hors tokens.css ──────────────────"
# SPRINT-V1 §V3 contrôle 1. `tokens.css` est la source unique (I10) et le seul
# fichier autorisé à contenir un littéral de couleur.
n_hex=$(code_nu | grep -cE '#[0-9a-fA-F]{3,8}\b' || true)
n_hex_css=$(sans_commentaires src/styles/tokens.css >/dev/null 2>&1; \
  find src -name '*.css' ! -name 'tokens.css' -exec grep -cE '#[0-9a-fA-F]{3,8}\b' {} + 2>/dev/null \
  | awk -F: '{s+=$NF} END {print s+0}')
n_hex_total=$((n_hex + n_hex_css))
if [ "$n_hex_total" -eq 0 ]; then
  vert "aucun hex hors tokens.css" "0 occurrence, commentaires ôtés"
else
  rouge "hex en dur hors tokens.css" "$n_hex_total occurrence(s)"
fi

echo
echo "── Contrôle 2 · la palette v2 a bien remplacé l'ancienne ───────────────"
# ADR-022 : `--teal-*` était une ESTIMATION du teal de la marque, et elle était
# fausse. Deux noms pour une même couleur est la pathologie qui a déjà coûté des
# sessions à ce dépôt : le nom retiré ne doit pas revenir par une copie.
n_teal=$(code_nu | grep -c 'teal-' || true)
if [ "$n_teal" -eq 0 ]; then
  vert "aucun \`teal-\` résiduel" "0 occurrence"
else
  rouge "\`teal-\` encore présent" "$n_teal occurrence(s)"
fi

# Le jeton de blanc atténué a été RETIRÉ après mesure : sur la partie claire
# d'un dégradé de marque, aucun alpha < 1 ne passe 4.5:1. Le voir revenir
# signifierait que quelqu'un l'a réintroduit sans refaire le calcul.
n_muted=$(code_nu | grep -c 'on-brand-muted' || true)
if [ "$n_muted" -eq 0 ]; then
  vert "aucun blanc atténué sur la marque" "jeton retiré, non ressuscité"
else
  rouge "\`on-brand-muted\` réintroduit" "$n_muted occurrence(s) — refaire le calcul de contraste"
fi

echo
echo "── Contrôle 3 · la liste des dégradés reste FERMÉE ─────────────────────"
# ADR-022 : « Aucun autre dégradé n'existe. Un dégradé inventé dans un écran est
# un défaut de revue, pas une variation. »
#
# ⚠️ CE CONTRÔLE CHERCHE `gradient(`, PAS UNE COULEUR. C'est délibéré : le
# dégradé trouvé en V3 sur l'écran de connexion était composé de JETONS
# LÉGITIMES (`--brand-050` → `--card`) et passait donc le contrôle 1 sans
# broncher. Ce qui est fermé, c'est la LISTE, pas la provenance des couleurs.
n_grad=$(code_nu | grep -c 'gradient(' || true)
n_grad_css=$(find src -name '*.css' ! -name 'tokens.css' -exec grep -c 'gradient(' {} + 2>/dev/null \
  | awk -F: '{s+=$NF} END {print s+0}')
n_grad_total=$((n_grad + n_grad_css))
if [ "$n_grad_total" -eq 0 ]; then
  vert "aucun dégradé composé hors tokens.css" "les 3 d'ADR-022 y vivent seuls"
else
  rouge "dégradé composé hors tokens.css" "$n_grad_total — liste fermée violée"
fi

# Les trois dégradés existent-ils encore, et exactement trois ?
n_declares=$(grep -cE '^\s*--grad-[a-z]+:' src/styles/tokens.css || true)
if [ "$n_declares" -eq 3 ]; then
  vert "exactement 3 dégradés déclarés" "grad-brand · grad-orb · grad-auth"
else
  rouge "nombre de dégradés déclarés" "$n_declares au lieu de 3"
fi

echo
echo "── Contrôle 4 · la garantie d'opacité est STRUCTURELLE ─────────────────"
# La règle « aucune brillance derrière une valeur » ne vit plus dans la
# vigilance du relecteur : `Carte` refuse `lueur` sur les niveaux qui portent
# une valeur (clinique · financier · document), au niveau du TYPE.
# `pnpm typecheck` ci-dessus EST donc la mesure de cette règle — ce contrôle
# vérifie seulement que le garde-fou n'a pas été aplati en cours de route.
if grep -q 'readonly lueur?: never' src/components/ui/Surfaces.tsx \
   && grep -q 'NiveauPorteur' src/components/ui/Surfaces.tsx; then
  vert "union discriminée de \`Carte\` intacte" "lueur interdite sur un niveau porteur"
else
  rouge "garde-fou de \`Carte\` absent" "la règle est retombée sur la relecture"
fi
echo "── Contrôle 6 · mouvement réduit ───────────────────────────────────────"
if grep -q 'prefers-reduced-motion' src/styles/tokens.css; then
  vert "règle \`prefers-reduced-motion\` déclarée" "portée globale, tokens.css"
else
  rouge "\`prefers-reduced-motion\` absent" "§8.4 non tenu"
fi

echo
echo "── Contrôles au NAVIGATEUR RÉEL ────────────────────────────────────────"
#
# ⚠️ CE BLOC APPELLE L'INSTRUMENT, IL NE RECOPIE PAS SON VERDICT.
#
# La leçon vient de V2 : huit lignes `bloque` avaient été ÉCRITES EN DUR dans le
# checkpoint, alors que les contrôles correspondants étaient mesurés verts depuis
# deux jours. Un verdict qui vit dans un fichier d'état et pas dans la porte
# n'est pas reproductible — c'est un souvenir. Symétriquement, un `bloque` en dur
# reste bloqué même une fois la mesure faite, et on finit par l'ignorer.
#
# Ici, la porte LANCE `mesure-v3-navigateur.mjs`, qui pilote un vrai Chromium :
# contraste effectif de chaque texte sur son fond COMPOSÉ, détection du texte
# posé sur un dégradé, et extinction réelle du mouvement sous `reduce`.
# Pas de serveur en écoute → BLOQUÉ, jamais vert.
if ! curl -s -o /dev/null --max-time 4 http://localhost:3000/connexion 2>/dev/null; then
  bloque "contraste · dégradés · mouvement réduit" "aucun serveur sur :3000 — lancer \`pnpm dev\`"
  bloque "parcours clavier du rail" "non mesuré : même prérequis"
else
  # ⚠️ NE PAS lancer pendant un `pnpm build` : le build écrase le `.next` du
  # serveur de développement, qui sert alors des chunks 404 et n'hydrate plus.
  # Piège déjà payé en V2, et il fabrique un ROUGE qui n'a rien de réel.
  # MESURE_COMPTE=praticienne : la porte mesure sous le compte ...a2, PAS sous
  # ...a1. La fenetre ADR-016 d'...a1 est refermee et doit le rester ; une porte
  # qui exigerait de la rouvrir a chaque passage transformerait un garde-fou en
  # formalite qu'on desarme par habitude. ...a2 est l'identite praticienne
  # synthetique de 015, ouverte par scripts/compte-praticienne.sh et refermable
  # par --fermer. Voir l'amendement du 2026-08-20 dans docs/00-DECISIONS.md.
  if MESURE_COMPTE=praticienne node scripts/mesure-v3-navigateur.mjs > /tmp/mesure-v3.log 2>&1; then
    vert "contraste · dégradés · mouvement réduit" "tous les écrans observés, 0 échec"
  else
    # L'instrument distingue lui-même l'échec MESURÉ de l'écran NON OBSERVÉ.
    # Un écran redirigé vers /connexion faute de session n'est pas rouge : il
    # n'a pas été regardé, et le premier passage de ce script rendait « vert »
    # pour quatre écrans qu'il n'avait jamais vus.
    n_non_observes=$(grep -c 'BLOQUÉ' /tmp/mesure-v3.log || true)
    n_rouges_mesure=$(grep -c 'sous le plancher' /tmp/mesure-v3.log | head -1 || echo 0)
    # ⚠️ L'ORDRE COMPTE, ET IL A ÉTÉ FAUX. Cette porte a annoncé un ROUGE
    # « contraste mesuré au navigateur » alors que les six écrans n'avaient
    # simplement PAS ÉTÉ OUVERTS (fenêtre ADR-016 refermée). Un écran non
    # observé n'est ni vert ni rouge ; le dire rouge est le symétrique exact du
    # faux vert, et il se débusque plus mal parce qu'un rouge inspire confiance.
    if [ "${n_non_observes:-0}" -gt 0 ]; then
      bloque "écrans NON OBSERVÉS" "$n_non_observes non ouvert(s) — session ADR-016 requise"
    elif grep -q 'ROUGE' /tmp/mesure-v3.log; then
      rouge "contraste mesuré au navigateur" "voir /tmp/mesure-v3.log"
    elif grep -q 'ERREUR' /tmp/mesure-v3.log; then
      rouge "navigation échouée pendant la mesure" "voir /tmp/mesure-v3.log"
    else
      # ⚠️ LE FILET, ET IL A DÉJÀ SERVI.
      # L'instrument est sorti EN ÉCHEC, mais aucune des formes reconnues plus
      # haut n'apparaît dans son journal. Sans cette branche, la porte
      # n'imprimait RIEN : le contrôle ne passait ni ne échouait, il
      # DISPARAISSAIT — et le verdict final annonçait « V3 EST VERT » avec un
      # échec avalé au passage. Mesuré le 2026-08-20 sur un `net::ERR_ABORTED`.
      #
      # Un `else` qui ne dit rien est le pire des cas : plus dangereux qu'un
      # faux rouge, parce qu'il ne laisse aucune trace à débusquer. Dans le
      # doute, on BLOQUE.
      bloque "mesure navigateur — échec NON CLASSÉ" "exit non nul, forme inconnue — voir /tmp/mesure-v3.log"
    fi
  fi
  # ── Le parcours clavier, LU DANS LE RAPPORT et non plus « à l'œil ».
  #
  # Il était BLOQUÉ ici, avec la mention « à l'œil » — c'est-à-dire jamais. Or il
  # s'automatise : on tabule, et on demande à chaque arrêt s'il porte un contour
  # de focus non nul. C'est même le contrôle qu'il faut le plus automatiser,
  # parce qu'un focus INVISIBLE ne se voit pas, par définition : une revue à l'œil
  # est le pire instrument possible pour ce défaut précis.
  #
  # L'enjeu est propre à V3 : l'anneau par défaut est `--action-600`, soit la
  # marque elle-même — invisible sur le rail, qui EST la marque. `.sur-marque` le
  # bascule en blanc, et c'est cette bascule que la mesure vérifie.
  arrets=$(grep -oE 'parcours clavier du rail · [0-9]+ arrêts · [0-9]+ sans focus' /tmp/mesure-v3.log | head -1)
  if [ -z "$arrets" ]; then
    bloque "parcours clavier du rail" "rapport muet — instrument non exécuté"
  elif echo "$arrets" | grep -q '· 0 sans focus'; then
    vert "parcours clavier du rail" "$arrets"
  else
    rouge "parcours clavier du rail" "$arrets"
  fi
fi

echo
echo "── Build — APRÈS la mesure, jamais avant (voir plus haut) ──────────────"
# ⚠️ Ce build ÉCRASE le `.next` du serveur de développement encore en cours. Le
# serveur devient inutilisable jusqu'à son redémarrage ; c'est assumé, la mesure
# est déjà faite. Et `pnpm build` n'est PAS la preuve que les fontes sont là :
# il réussit même quand `fonts.gstatic.com` est injoignable (mesuré le
# 2026-08-20 : `getaddrinfo ENOTFOUND`, trois tentatives, puis build vert).
# C'est le contrôle 5 qui compte les fichiers RÉELLEMENT émis.
if pnpm build >/dev/null 2>&1; then
  vert "pnpm build" "exit 0"
else
  rouge "pnpm build" "exit non nul"
fi

echo
echo "── Contrôle 5 · les fontes se chargent SANS RÉSEAU ─────────────────────"
# SPRINT-V1 §V3 contrôle 5. Trois conditions, toutes nécessaires : des fichiers
# émis, les quatre variables posées, et AUCUNE URL externe dans le CSS servi.
if [ ! -d .next ]; then
  bloque "fontes auto-hébergées" "pas de build à inspecter"
else
  n_woff=$(find .next -name '*.woff2' 2>/dev/null | wc -l | tr -d ' ')
  n_vars=$(grep -rho '\-\-font-[a-z]*-emise' .next/static/css/*.css 2>/dev/null | sort -u | wc -l | tr -d ' ')
  n_ext=$(grep -rl 'fonts\.gstatic\.com\|fonts\.googleapis\.com' .next/static/css/ 2>/dev/null | wc -l | tr -d ' ')

  if [ "$n_woff" -gt 0 ]; then
    vert "fichiers de fonte émis" "$n_woff .woff2 auto-hébergés"
  else
    rouge "aucune fonte émise" "le build a réussi SANS télécharger les fontes"
  fi

  if [ "$n_vars" -eq 4 ]; then
    vert "les 4 familles sont câblées" "ui · num · doc · ar"
  else
    rouge "familles câblées" "$n_vars sur 4"
  fi

  if [ "$n_ext" -eq 0 ]; then
    vert "aucune requête de fonte à l'exécution" "0 URL Google dans le CSS émis"
  else
    rouge "URL de fonte externe dans le CSS" "$n_ext fichier(s) — le poste appellerait Google"
  fi
fi

echo

# Reporté par DÉCISION, écrite et datée — pas un oubli.
bloque_decision "primitive Toast" "aucun appelant dans src/ — reportée à V4"
bloque_decision "primitive Tableau" "aucun écran tabulaire — reportée à V4"
bloque_decision "tableau de bord hérosé" "l'écran n'existe pas — V4 (D-18)"

echo
# ⚠️ AVERTISSEMENT DE SORTIE — CE SCRIPT LAISSE UNE MINE DERRIÈRE LUI.
#
# `pnpm build` ci-dessus écrase le `.next` d'un `next dev` en cours. Le serveur
# de développement continue de répondre HTTP 200 sur les PAGES, mais sert 404 sur
# ses feuilles de style : l'application s'affiche alors en HTML brut, sérif, sans
# aucune mise en page. Constaté le 2026-08-20 — et l'écran ressemble à s'y
# méprendre à une application cassée, alors que rien dans le code ne l'est.
#
# Le dire ICI plutôt que dans un fichier d'état : c'est ce script qui pose la
# mine, c'est donc à lui de prévenir, au moment exact où il vient de la poser.
if netstat -ano 2>/dev/null | grep -q "LISTENING.*:3000"; then
  echo
  echo "⚠️  UN SERVEUR ÉCOUTE ENCORE SUR :3000 ET SON .next VIENT D'ÊTRE ÉCRASÉ."
  echo "    Il servira des feuilles de style en 404 — écran sans style, non hydraté."
  echo "    Le RELANCER avant toute observation :  pnpm dev"
fi

echo "═══════════════════════════════════════════════════════════════════════"
printf 'VERDICT V3 : %d verts · %d rouges · %d bloqués critiques · %d bloqués par décision\n' \
  "$verts" "$rouges" "$bloques_critiques" "$bloques_decision"

# Trois conditions, toutes nécessaires — mêmes qu'en V2.
if [ "$rouges" -ne 0 ]; then
  echo "V3 N'EST PAS VERT : $rouges contrôle(s) MESURÉ(S) NON CONFORME(S)."
  exit 1
fi
if [ "$bloques_critiques" -ne 0 ]; then
  echo "V3 N'EST PAS VERT : $bloques_critiques contrôle(s) NON MESURÉ(S) et exigés."
  echo "LIVRAISON INTERDITE tant qu'ils ne sont pas observés."
  exit 2
fi
if [ "$bloques_decision" -ne 3 ]; then
  echo "V3 N'EST PAS VERT : $bloques_decision report(s) par décision, 3 attendus."
  echo "Ni plus (une décision non écrite), ni moins (un périmètre qui a bougé)."
  exit 3
fi
echo "V3 EST VERT — aux TROIS réserves NOMMÉES, et à elles seules."
exit 0
