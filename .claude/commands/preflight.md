---
description: Exécute les garde-fous de sécurité avant tout commit.
---

Exécute `bash scripts/preflight.sh` et rapporte la **sortie brute**, sans la résumer.

Toute sortie non vide = **ne pas commiter**. C'est un fait, pas une opinion.

Rappel de ce que le script vérifie :
1. aucun `fetch` externe hors de `_shared/external-call.ts`
2. aucun secret côté client
3. aucun fichier audio sur le disque
4. aucune valeur hexadécimale en dur hors des tokens
5. aucun front assistante attaquant la **table** `appointments` au lieu de la vue

Si une règle sort rouge, nomme la ligne exacte. Ne propose pas de désactiver le contrôle.
