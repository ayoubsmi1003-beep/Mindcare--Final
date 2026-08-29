# DESIGN_PHILOSOPHY — MindCare OS V2

## 1. Positionnement

**Quiet Intelligence → Vibrant Instrument (restreint).**

Le premier rendait le système invisible; le second le rend reconnaissable sans l'alourdir. La différence tient à une discipline, pas à un volume de couleur.

> « Un instrument professionnel magnifiquement conçu » — pas « un joli dashboard santé ».

Émotions cibles : calme · premium · clinique · humain · fiable · précis · intelligent · sophistiqué · discrètement technologique · chaleureux · assuré.
Rejets : bon marché, générique, corporate hôpital, gaming, cyberpunk, sur-décoré, stérile, template.

## 2. Le modèle à six niveaux (non négociable)

Tout pixel appartient à un niveau. Aucun élément ne saute de niveau.

| Niveau | Rôle | Exemple | Poids visuel |
|---|---|---|---|
| **L1 Environment** | Fondation neutre ultra-raffinée | `layer-ambient #F1F8F6` + `atmosphere` triple wash 8/5/4% | 70–80% surface |
| **L2 Structure** | Surfaces + bordures + élévation subtile | `card #FFF`, `sunken #F2F5F4`, `rule #E4EAE8`, `lift1-2` | 10–15% |
| **L3 Information** | Typographie porte la hiérarchie | Inter 400/500/600/700/800, 14–30px, tabular-nums | porte 70% hiérarchie |
| **L4 Sémantique** | Couleur = sens | attention-ink, critical, positive, kind accent 3px | 5–10% |
| **L5 Marque** | Identité + orientation | brand-600 #2A7A70, grad-auth rail, grad-brand hero | 5–10% |
| **L6 Moments vibrants** | Rare wow-factor | grad-orb, grad-tile-brand, illustration empty, effet IA | <5%, exceptionnel |

**Règle d'or :** L1 doit rester lisiblement neutre à 2m. Si L5/L6 domine L1-L3, le système a échoué.

## 3. Trois principes fondateurs

**1. La typographie d'abord.** L'espace et la graisse créent la hiérarchie ; la couleur la confirme. Un titre plus gras, pas plus coloré.

**2. La couleur hiérarchise, elle ne décore pas.** Primaire dominant, secondaire soutenant, sémantique réservée, IA distinctive contrôlée, le reste neutre. Si tout est coloré, rien n'est important.

**3. Chaque composant a une raison d'exister.** Passer le test « retirer 30% » : si retirer améliore, l'élément n'aurait jamais dû exister. Charts, icônes, illustrations doivent répondre à une question ou disparaître.

## 4. Anti-slop MindCare (interdit)

- Neon/glass partout, orbes décoratifs, glowing borders, blobs flottants, gradient text, purple AI cliché, ombres lourdes, 4 tuiles égales saturées, chart décoratif, animation perpétuelle, Dribbble hero.
- Inter 600+ partout (fatigue lecture clinique).
- Gradient derrière dose/posologie/montant/score (contrast drift sur dégradé).
- Icône par carte par réflexe (information architecture > décoration).
- Illustration dans le dossier clinique actif (réservée empty/onboarding).

## 5. Relation à la technique

- Donnée identifiante ne quitte jamais la machine (`_shared/external-call.ts` pseudonymisé).
- Écriture = fonction Postgres RPC (perimètre·verrou·transition·écriture·trace).
- RLS decide, front n'est jamais frontière.
- Lecture dossier = porte `search_patients`/`get_patient` qui journalise.
- Jarvis propose, humain confirme (`confirmed_at`), base journalise.

La beauté ne peut jamais contourner ces invariants.

## 6. Qualité bar

Chaque surface doit répondre : composition utile ? hiérarchie <2s ? typo délibérée ? respiration ? densité sans foule ? couleur signifiante ? profondeur sans ombre lourde ? cohérence produit ? reconnaissable sans logo ? réduit le travail ? désirable 8h par psychiatre ? implémentable en tokens ?
