---
description: Clôture de session — met STATE.md à jour et prépare la reprise.
---

Fais appeler `scribe` pour mettre `STATE.md` à jour, puis rends exactement ceci :

1. **Terminé et vert aujourd'hui** — une ligne par tâche, avec son checkpoint et son résultat.
2. **En cours** — le fichier et la **ligne exacte** où reprendre. Pas un thème, pas « en cours
   sur l'agenda ». Si rien n'est en cours, dis-le.
3. **Décisions prises en cours de route** qui ne sont pas encore dans `00-DECISIONS.md`.
4. **Dette assumée**, datée.
5. **Points EN LITIGE** encore ouverts (§7 de `WORKING-CONTEXT.md`).
6. **La première commande à taper à la prochaine session.**

Ne résume pas le code. La prochaine session le relira si elle en a besoin.
`STATE.md` doit tenir en 60 lignes. S'il dépasse, `scribe` élague avant de rendre.
