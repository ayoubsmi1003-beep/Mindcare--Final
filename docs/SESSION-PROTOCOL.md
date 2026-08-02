# SESSION-PROTOCOL.md
**Comment démarrer et terminer une session Claude Code sans brûler ton quota.**
v1 — 2026-08-02

> Tu as **8 sessions** avant le 6 août. Chaque session mal démarrée en coûte une demie.
> Ce protocole existe pour une seule raison : **la session peut mourir à tout moment.**
> Tout doit être reprenable par un modèle qui n'a aucun souvenir.

---

## 1. LES TROIS RÔLES D'UNE SESSION

```
SESSION PRINCIPALE = CHEF DE CHANTIER
  ├── lit : CLAUDE.md + STATE.md + DOC-AUTHORITY.md   (~3k tokens, c'est tout)
  ├── ne lit JAMAIS : 04-DESIGN-SYSTEM.md, le code source
  ├── ne code JAMAIS elle-même
  └── délègue → lit un verdict de 5 lignes → décide → délègue

SOUS-AGENT = OUVRIER
  ├── contexte NEUF, il ne voit rien de la conversation
  ├── il lit LUI-MÊME son document de domaine
  ├── il travaille, il vérifie, il rend ≤ 15 lignes
  └── son contexte meurt avec lui — tu ne le paies pas deux fois

SCRIBE = MÉMOIRE
  └── écrit STATE.md après chaque vert. Pas à la fin. Après chaque vert.
```

**Le gain :** une migration écrite + testée coûte ~25k tokens de raisonnement.
Rendue au chef de chantier comme `✅ 004 appliquée · 3 policies · T2 vert`, elle en coûte 30.

---

## 2. DÉMARRAGE — LES 6 LIGNES, COPIER-COLLER

À coller **texto** au premier message de chaque nouvelle session :

```
Lis dans cet ordre, rien d'autre : CLAUDE.md, DOC-AUTHORITY.md, STATE.md.
Ne lis aucun fichier de docs/ ni aucun fichier source.
Tâche du jour = la ligne « Prochaine tâche » de STATE.md.
Délègue le travail au sous-agent indiqué. Tu ne codes pas toi-même.
Plan mode d'abord : montre-moi le plan en ≤ 20 lignes, attends mon accord.
Après chaque checkpoint vert : /handoff.
```

⚠️ **Ne colle jamais de code, de log, ou de diff dans la session principale.**
Donne un chemin de fichier. Le sous-agent le lira lui-même.

---

## 3. FIN DE SESSION — `/handoff`

Une session ne se termine pas parce que tu es fatigué. Elle se termine sur un **vert**, avec :

```
1. commit fait, message conventionnel
2. STATE.md à jour (scribe)
3. « Prochaine tâche » écrite en une phrase actionnable
4. Toute décision prise en cours → reportée dans DOC-AUTHORITY.md §3
```

**Si la session meurt sans handoff**, la suivante commence par :
```
git log --oneline -5 && git status --short && cat STATE.md
```
et ne fait rien d'autre avant d'avoir reconstruit l'état.

---

## 4. LES SEPT GESTES QUI ÉCONOMISENT LE PLUS

| # | Geste | Pourquoi |
|---|---|---|
| 1 | **Plan mode d'abord, toujours** | Corriger un plan = 500 tokens. Corriger du code = 20 000. |
| 2 | **Un chemin, pas un contenu** | `src/app/patients/page.tsx` coûte 8 tokens. Son contenu, 3 000. |
| 3 | **Une tâche = une session** | Un contexte à la tâche 14 raisonne moins bien qu'à la tâche 1. |
| 4 | **Verdict ≤ 15 lignes** | Un sous-agent bavard annule tout le bénéfice. |
| 5 | **Checkpoint = script, pas prose** | `bash scripts/checkpoint-j1a.sh` → vert/rouge. Zéro interprétation. |
| 6 | **Jamais de log brut collé** | Un log de build = 5k tokens de bruit. Résume en une ligne. |
| 7 | **Refuser l'élargissement** | « Tant qu'on y est… » est la cause n°1 de session perdue. |

---

## 5. LES QUATRE SIGNAUX D'ARRÊT

Arrête la session immédiatement si :

1. **Le même test échoue trois fois de suite.** Le problème n'est pas là où tu cherches. `/handoff`, note l'hypothèse, reprends à froid.
2. **Tu réexpliques une règle déjà écrite.** Elle manque dans `CLAUDE.md` ou dans le prompt de l'agent. Écris-la, puis reprends.
3. **Un sous-agent te rend plus de 30 lignes.** Son prompt est trop vague. Resserre-le.
4. **Tu es tenté d'ajouter une fonctionnalité non listée.** Note-la dans STATE.md « Semaine 2 ». N'y touche pas.

---

## 6. RÉPARTITION DES MODÈLES — la règle qui tient ton quota

| Agent | Modèle | Raison |
|---|---|---|
| `db-migrator` | **opus** | Une RLS fausse expose un dossier psychiatrique. Irréversible. |
| `security-reviewer` | **opus** | Le coût d'une faille est infini. |
| `feature-builder` | **sonnet** | Volume. CRUD, formulaires, pages. Risque faible. |
| `ui-builder` | **sonnet** | Applique des jetons existants. Aucune décision. |
| `jarvis-tooler` | **sonnet** | Le contrat est déjà écrit dans `03-JARVIS-TOOLS.md`. |
| `checkpoint-runner` | **haiku** | Lance un script, lit vert ou rouge. |
| `scribe` | **haiku** | Réécrit un fichier de 40 lignes. |

**Opus ne touche que le schéma et la revue de sécurité.** Deux sessions sur huit.
C'est ce ratio qui te fait tenir jusqu'au 6 août.

---

*Ce fichier ne change pas pendant le sprint. Si tu veux le changer, tu as un problème de plan, pas de protocole.*
