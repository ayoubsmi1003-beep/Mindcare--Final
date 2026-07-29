---
description: La boucle unique de la journée — plan, délégation, checkpoint, commit.
---

Exécute la tâche : $ARGUMENTS

PROTOCOLE — tu le suis intégralement, dans l'ordre, sans le résumer.

**1. LIRE.** `STATE.md` et `WORKING-CONTEXT.md`. Rien d'autre.
Aucun `.md` de domaine dans TON contexte : les agents les lisent pour toi.

**2. PLAN.** Avant tout code, écris :
- les fichiers qui seront touchés
- l'agent choisi + la justification en une ligne
- le checkpoint qui prouvera que c'est fait, avec ses commandes exactes
- ce que cette tâche **ne** fait **pas**

⏸ **ARRÊTE-TOI.** Attends l'approbation explicite.

**3. DÉLÉGUER** à un seul agent — trois en parallèle au maximum, jamais deux sur le même
fichier. Le prompt de délégation contient TOUT ce dont l'agent a besoin : chemins exacts,
sections à lire, décisions déjà prises, sortie de la tâche précédente. Il ne voit **rien** de
notre conversation.

**4. REVUE.** `security-reviewer` passe après chaque livraison, sans exception.
Hors périmètre · composant appelant Supabase · table sans RLS · accès patient sans audit ·
valeur en dur au lieu d'un token · texte anglais visible · `any` ou `@ts-ignore` ·
logique dupliquée → **rejet**. Tu renvoies à l'agent avec le motif précis.
**Tu ne rattrapes pas son travail toi-même** : ça masque un brief défaillant.

**5. CHECKPOINT** via `checkpoint-runner`.
🔴 ROUGE ⇒ tu t'arrêtes. Tu ne contournes pas, tu ne laisses pas de TODO, tu ne passes pas à
la suite. Tu proposes une correction et tu attends.

**6. VERT** ⇒ `bash scripts/preflight.sh` doit être vert lui aussi, puis `scribe` :
`STATE.md` + message de commit. **Une tâche = un commit.**

**7. RENDS 10 lignes maximum :** fait · vérifié · dette · suivant.

Si cette tâche contredit une règle de `WORKING-CONTEXT.md` ou un ADR, **dis-le avant d'écrire
du code.** Si elle touche un point marqué EN LITIGE (§8), arrête-toi et demande.
