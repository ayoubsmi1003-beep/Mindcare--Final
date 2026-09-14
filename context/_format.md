# Format des manifestes `context/` (le format lui-même tient en une page)

> Un manifeste = le contexte minimal suffisant pour UNE tâche. Copier ce
> squelette, remplir, ne rien ajouter d'autre.

```text
TASK:        <verbe + objet, ex. corriger-recherche-patient>
DOMAIN:      <patients|consultation|finance|jarvis|...>
OBJECTIVE:   <1 phrase : comportement attendu + preuve>
ALLOWED_FILES:          <fichiers modifiables, ~6 max>
REQUIRED_CONTEXT:       <L0 + domaine + contrat + fichiers à LIRE>
FORBIDDEN_CONTEXT:      <DO NOT LOAD — interdiction, pas suggestion>
SECURITY_CONSTRAINTS:   <portes/RLS/egress concernés, ou "aucune écriture">
VALIDATION:  <test ciblé + commande exacte>
STOP_CONDITION:         <preuve qui termine la tâche>
```

Règles : pas de manifeste sans `FORBIDDEN_CONTEXT` ni `STOP_CONDITION`.
Un manifeste qui exige de lire `STATE.md` ou `fr.ts` entier est mal découpé.
