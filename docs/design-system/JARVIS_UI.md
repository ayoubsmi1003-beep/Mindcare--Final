# JARVIS_UI — Couche d'intelligence ambiante (V2)

> Jarvis propose, humain confirme, base journalise. L'IA assistante, jamais dominante.

## 1. Principe — ambient, pas chatbot demi-écran

Jarvis n'est pas un panneau géant occupant 50%. Il est :
- **Inline suggestions** dans fiche/agenda (contextuel)
- **Command bar** `⌘K` — palette
- **Panneau latéral 380px** — secondaire, fermable, partage store avec `/jarvis` plein écran
- **Orbe voix 8 états** — idle/listening/thinking/working/ready/proposed/awaiting/failed/unavailable

`PanneauJarvis.tsx:41` `LARGEUR_PANNEAU 380px max 100vw z 50 glass-panel blur 20`.

## 2. Emplacements PC

- **Lanceur** `fixed bottom-6 right-6 pill card lift3` : `Orbe 32` + bouton `Ouvrir Jarvis ⌘K` (séparés, pas button-in-button invalide).
- **Panel** `fixed inset-y-0 right-0 border-l rule glass` — header `card 24+fermer`, contexte patient `ai-50/100`, erreur `attention-bg`, fil `overflow-y p4`, footer `SaisieJarvis`.
- **BootVoix** lifecycle voix sans rendu, vit dans `AppShell` (dure app, pas écran).
- **Assistante** : pas de `PanneauJarvis` ni `BootVoix` (I12) — pas de contexte clinique.

## 3. États visuels (10)

| État | Visuel | Composant |
|---|---|---|
| idle | orb static `grad-orb` | `OrbeVoix taille 24/32` |
| listening | orb pulse outer `glow-ai` + anneau |  |
| thinking | trois points anim `respire` | `FilJarvis` bulle Jarvis |
| working | barre indéterminée `sunken` + "Jarvis travaille..." | header |
| ready | orb glow calme |  |
| proposed | **CarteConfirmation** flottante `absolute inset-x-3 bottom-3 z10 lift3 glow-ai` | `CarteConfirmation.tsx` |
| awaiting confirmation | carte + jauge 400ms avant confirm | `confirmed_at` écrit avant exec |
| completed | bulle verte `positive-bg` + tick, toast |  |
| failed | bandeau `critical-bg` + retry |  |
| unavailable/offline | `attention-bg` + "IA indisponible — navigation reste" |  |

## 4. Carte de confirmation (règle 7)

- Flotte **au-dessus** du fil, pas bulle parmi autres.
- Contenu : outil + args pseudonymisés (`PATIENT_001`) + impact + source (`sources` payload).
- Boutons `Confirmer 600 action` + `Annuler` — `scale-[0.98]` active, `400ms` attente anti double-click.
- Contrainte base `confirmed_at NOT NULL` si `executed` — UI ne peut outrepasser.
- Allowlist 7 outils `063_jarvis_capacites.sql` — hors liste = jamais affiché.

## 5. Bulle modèle (design)

- Humain droite `bulle-humain-max 85%` `bg-action-600 text-white` 14 400.
- Jarvis gauche `bulle-jarvis-max 92%` `bg-card border-rule lift1` opaque (jamais verre), `text-ink-900`.
- Contexte patient au-dessus fil `ai-50 12 500` + `patients 16` icône + croix retirer.
- Erreur nommée au-dessus fil `attention-bg attention-ink` + croix dismiss.

## 6. Command palette

- `RechercheEclair` 460px, `filters`, `Recent Transactions` style reference — adaptée MindCare : patients, RDV, actions Jarvis.

## 7. Accessibilité

- `Esc` ferme panel sauf `proposed` (bloque).
- `aria-label titre Jarvis`, `role status` contexte, `role alert` erreur, `role dialog` carte.
- Focus sur orbe et dans saisie conserve `tab`.

## 8. Motion

- Orb spring `0.34,1.56,0.64,1` seul autorisé.
- Panel slide 380 out, voile 240.
- Bulle apparition 160 soft, pas bounce.

## 9. Anti-patterns

- Pas de gradient texte, pas de glowing border partout, pas de chatbot pleine largeur par défaut.
- Pas d'écriture sans carte ni hors allowlist.
- Pas d'élévation permission (hérite `owner/practitioner/assistant`).
