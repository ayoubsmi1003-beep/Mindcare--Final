---
target: consultation cockpit 1920
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 3
timestamp: 2026-09-17T12-53-38Z
slug: src-app-consultation-id-page-tsx
---
# Critique — cockpit consultation (1920, dossier frais + rail peuplé)

Method: dual-agent (A design review · B detector). B: `detect.mjs` exit 0, 0 findings
on `consultation/[id]/page.tsx` + `cockpit/*` + `BlocTarif.tsx`. Browser overlay skipped
(no live server in assessment scope; geometry already covered by E2E `aucun-controle-hors-cadre`).

## Design Health Score — 22/40 Acceptable (confirme le 6/10)

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | Timer vit, sauvegarde reste floue |
| 2 | Match System / Real World | 3 | Vocabulaire clinique français clair |
| 3 | User Control and Freedom | 2 | Aucune annulation pour focus appliqué |
| 4 | Consistency and Standards | 3 | Boutons cohérents, chips diffèrent |
| 5 | Error Prevention | 3 | Garde signature discrète |
| 6 | Recognition Rather Than Recall | 2 | Squelettes exigent connaissance préalable |
| 7 | Flexibility and Efficiency | 1 | Aucun raccourci, dictée peu visible |
| 8 | Aesthetic and Minimalist Design | 3 | 1920 aéré, rail chargé |
| 9 | Error Recovery | 2 | Échec autosave invisible en rédaction |
| 10 | Help and Documentation | 1 | Aucun guidage intégré |

## Design Specificity Verdict

Authored-for-psychiatry : chips Focus, Brouillon vs note signée, gate tarif.
Interchangeable SaaS : dossier vide = doubles squelettes + CTA dupliqué + cartes
génériques. Le rail peuplé (chronologie, séance précédente) restaure la spécificité.

## Overall Impression

Dimensions et structure bonnes à 1920 (confirmé). L'écran échoue à la première
impression sur dossier vide et à la hiérarchie des gestes : deux CTA identiques,
deux primaires concurrents (Enregistrer vs Signer), sélection de chips pâle, et
l'orbe qui chevauche le texte du rail. Plus grande opportunité : un vide qui
accueille au lieu de charger, et un seul geste principal visible à la fois.

## What's Working

- Chips Focus : `Bouton enfonce` → `aria-pressed` réel, état en texte.
- `BarreConsultation` sticky, puces texte + ✓/○, jamais couleur seule.
- Contexte lazy par CTA explicite, sans lecture clinique surprise.

## Priority Issues

- **[P1] Double CTA + doubles squelettes à vide.** Dossier frais déjà vide : deux
  « Charger le contexte patient » + deux squelettes muets. Fix : un seul CTA
  (colonne), message d'attente explicite côté rail. Cmd : distill.
- **[P1] Enregistrer vs Signer : deux primaires.** Hésitation au pic de charge.
  Fix : `Enregistrer` discret, `Signer` seul principal, ancrage barre. Cmd : clarify.
- **[P1] Sélection chips pâle.** Rereads en séance. Fix : bordure `action-600`
  épaissie + préfixe check, `aria-pressed` conservé, jetons seuls. Cmd : bolder.
- **[P2] Rail dense sans priorité.** Trois cartes empilées en peuplé. Fix : Séance
  précédente d'abord, Évolution repliée par défaut, paddings unifiés. Cmd : layout.
- **[P2] Orbe sur texte + nom patient deux fois** (synthèse capture : pastille verte
  sur « Aide à la décision », nom en en-tête coquille ET cockpit). Fix : garde
  anti-chevauchement orbe/carte ; CockpitHeader porte le contexte séance
  (type·date·chrono), la coquille garde l'identité. Cmd : layout.

## Persona Red Flags

- Alex (praticienne en séance) : `Inscrire dans Subjectif` en 2 temps, micro
  « Dictée » peu visible, hésitation Enregistrer/Signer.
- Sam (clavier/lecteur) : squelettes sans statut live ; `Replier le contexte` /
  `Fil de séance` doivent exposer `aria-expanded` ; timer non annoncé poliment.

## Minor Observations

- Timer tabulaire mais minuscule. `Inscrire` grisé sans raison visible à vide.
- `Aide à la décision` vide sans alternative. Troncations brutes
  (`Amine Belka...`). Orbe sans label.

## Questions to Consider

- Si le Focus n'est jamais appliqué, pourquoi survivre à la signature ?
- Le cockpit vide doit-il montrer des squelettes ou une promesse d'accueil ?
