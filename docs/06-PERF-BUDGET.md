# 06 — PERF BUDGET
**Combien de temps un écran a le droit de prendre, et comment on le mesure.**
v1 — 2026-08-09 · contrat vérifiable, pas une intention

> L'application met aujourd'hui **1 à 4 secondes** par navigation. C'est le premier
> reproche de l'utilisatrice, avant même le design.
>
> Une exigence de performance sans méthode de mesure n'est qu'un souhait. Ce document
> fixe les deux : le chiffre, et la façon de l'obtenir.

---

## 1. LA MÉTHODE — sinon les chiffres ne veulent rien dire

**Toute mesure se fait en `next build && next start`. Jamais en `next dev`.**

En développement, Next recompile la route à chaque navigation. Sur le poste actuel
(i7 3ᵉ génération, 8 Go), cette recompilation domine tout le reste : le chiffre obtenu
décrit le compilateur, pas le produit. Un correctif jugé sur du `next dev` est un
correctif jugé sur du bruit.

**Trois chiffres à relever, écrits dans STATE.md à chaque checkpoint :**
```
1. Nombre d'appels réseau au chargement de l'écran      onglet Réseau
2. Temps jusqu'au premier contenu utile                 chronomètre
3. Temps jusqu'à l'écran complet                        chronomètre
```

**Trois répétitions, on garde la médiane.** Un seul essai mesure le cache, pas l'écran.

---

## 2. LE BUDGET

| Écran | Appels max | Premier contenu | Complet |
|---|---|---|---|
| Tableau de bord | **1** | 100 ms | 400 ms |
| Patients (liste) | **1** | 100 ms | 400 ms |
| Fiche patient | **2** | 100 ms | 500 ms |
| Agenda (jour) | **1** | 100 ms | 400 ms |
| Agenda (semaine) | **1** | 100 ms | 600 ms |
| Consultation | **2** | 100 ms | 500 ms |
| Finances | **1** | 100 ms | 400 ms |
| Documents | **2** | 100 ms | 500 ms |
| Jarvis — premier mot | — | **800 ms** | streaming |

🔴 **Un écran au-dessus de son budget est ROUGE au checkpoint.** Pas « à surveiller » :
rouge, au même titre qu'un test RLS qui échoue.

**Les 100 ms de premier contenu ne dépendent d'aucun réseau.** C'est le squelette
(`05-UX-CONTRACT.md` §2). Ils sont donc toujours atteignables, quelle que soit la base.

---

## 3. LA RÈGLE QUI RÈGLE 80 % DU PROBLÈME

**Un écran = un appel serveur.**

L'application enchaîne aujourd'hui 3 à 6 appels **séquentiels** par écran. Chacun
attend le précédent. Sur Supabase Cloud depuis Alger, à ~180 ms d'aller-retour,
cinq appels en cascade coûtent **900 ms avant la première requête utile** — et aucune
optimisation de code ne récupère ça.

```
✗ AVANT                              ✅ APRÈS
get_profile()          180 ms        app.dashboard_today()    180 ms
get_agenda()           180 ms        ─────────────────────────────────
get_waiting_room()     180 ms        total : 180 ms
day_revenue()          180 ms
list_day_payments()    180 ms
─────────────────────────────
total : 900 ms
```

**Comment.** Une porte SQL par écran, qui rend tout en une fois — même discipline que
`029` et `030` : transaction unique, bornes `Africa/Algiers`, cloisonnement par rôle
**en base**. Ce n'est pas un raccourci de performance, c'est la même architecture.

**Quand deux appels sont légitimes.** Quand le second dépend d'un choix de
l'utilisatrice (ouvrir un onglet, sélectionner un patient). Jamais parce que le
premier a rendu un identifiant dont le second avait besoin — ça, c'est une cascade,
et elle se résout en base.

---

## 4. LES QUATRE AUTRES LEVIERS, PAR ORDRE DE RENDEMENT

**1. Cache client (TanStack Query).**
`staleTime` raisonné par nature de donnée : agenda du jour 30 s, liste de patients
60 s, référentiels 1 h. **`refetchOnWindowFocus: false`** — elle bascule sans arrêt
entre l'écran et son patient ; refetcher à chaque retour, c'est refaire tout le travail
pour rien.

**2. Index documentés.** Toute requête d'écran a son index nommé dans la migration qui
l'introduit — pattern déjà appliqué en `030 §1bis`. Une requête sans index est une
requête qui ralentira le jour où il y aura 800 dossiers, pas aujourd'hui avec 2.

**3. Mise à jour optimiste.** Fixer un tarif, marquer un patient arrivé, déplacer un
rendez-vous : l'écran change **immédiatement**, le serveur confirme après. En cas
d'échec, on revient en arrière avec un message. La perception de vitesse se joue là.

**4. Pas de pagination inutile.** Elle a moins de 1 000 patients. Charger 50 lignes et
filtrer côté client est plus rapide qu'un aller-retour par frappe. La recherche serveur
sert quand le filtre local ne suffit plus, pas avant.

---

## 5. CE QUI EST HORS DE PORTÉE DU CODE — et qu'il faut dire

| Cause | Effet | Sortie |
|---|---|---|
| Supabase Cloud depuis Alger | ~180 ms par appel | migration auto-hébergée → ~1 ms |
| Poste i7 3ᵉ gén / 8 Go | rendu et compilation lents | poste du cabinet i7/16 Go |
| `next dev` | recompilation à chaque navigation | mesurer en build |

**Ces trois-là ne se corrigent pas en optimisant du code.** Les nommer évite de passer
une session à chercher un défaut de programmation là où il n'y en a pas. Mais elles ne
sont pas une excuse : le §3 rend 700 ms **même sur le cloud**, et c'est la différence
entre « lent » et « acceptable ».

---

## 6. LE CONTRÔLE, À CHAQUE CHECKPOINT

```bash
# À relever et à écrire dans STATE.md, pour les écrans touchés par la session
#   appels réseau · premier contenu · complet · verdict
# Trois répétitions, médiane, en build.
```

Un écran dont les trois chiffres ne sont pas écrits est réputé **hors budget**.
Une mesure absente n'est pas une mesure réussie.
