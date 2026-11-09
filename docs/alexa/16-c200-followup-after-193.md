# 16 — Alexa C200 : suite après la base vérifiée 193/200

La base vérifiée reste **`5567c9b` (tag local `alexa-c200-193of200-20261109`) : 193 PASS / 7 FAIL**, décrite dans `14-c200-results-and-recommendation.md`. Ce document ne la remplace pas :
il rapporte les changements faits **après** elle, avec leurs propres résultats. Rien n'est poussé ni fusionné.

## Changements
| Sujet | Cause trouvée | Correction (par classe, aucune question codée en dur) |
|---|---|---|
| Critères de la dépression majeure (C156) | le focus de section n'était reconnu que pour « trouble dépressif caractérisé » | le nom du manuel (`frenchManualTerms`) sert aussi à reconnaître le focus : « dépression majeure », « trouble dépressif majeur »… mènent à la section du manuel, feuille « critères diagnostiques » |
| Critères du bipolaire de type II (C170) | le chunk des critères (10 267 car.) dépassait de 267 car. le plafond de 10 000 | plafond de passage entier 10 400 (`LIMITES.BUDGET_OCTETS`, `MAX_REFERENCE_CHARS`) ; focus « trouble bipolaire de type I / II » (hors comparaison des deux types, qui garde ses deux requêtes) |
| Syndrome sérotoninergique (C189) | « Qu'est-ce que » laissait le mot « qu » : la variante anglaise était refusée ; la preuve par les mots d'un autre livre perdait contre un voisin dense (échelles différentes) | « qu » est un mot d'échafaudage ; un passage trouvé par les mots, au-dessus du seuil de pertinence, remplace le dernier d'un même livre sans ratio contre un score dense. **Reste FAIL** (voir limites) |
| Arrêt d'une benzodiazépine (C186) | « benzodiazépine » (même mot FR/EN), « sans » : la variante anglaise était refusée | alias des mots identiques à l'accent près ; variante « withdrawal » sans le nom « syndrome » |
| Effets métaboliques des antipsychotiques (C188) | « surveiller », « antipsychotique » sans équivalent ; **défaut de l'évaluateur** : la citation était jugée contre un chunk jumeau (le même texte « Monitoring after starting… » existe dans chaque monographie Stahl) | alias ajoutés ; l'évaluateur choisit le chunk dont le marqueur de page concorde avec l'étiquette |
| Comparaison de deux mois (C151) | la porte statistique compare à une fenêtre de même durée, pas au mois civil | « …ce mois par rapport au mois dernier » : deux lectures de la même porte (`get_analysis_overview`), chaque mois sur ses propres jours, écart de séances affiché ; aucune porte ni migration nouvelle |
| Séances payées (C144) | la question était lue comme un comptage de rendez-vous | lue comme de l'argent : la porte financière donne « Paiements encaissés de la période » (sa propre définition) |
| Contexte de consultation (réserve de la revue de sécurité) | `get_consultation` (notes brutes) lu et audité à **chaque** tour | un patient vérifié est gardé 10 min par acteur + conversation + consultation (500 entrées max) ; un échec n'est jamais gardé ; chaque lecture suivante repasse par `get_patient` sous les droits de l'appelant |

### Deuxième réserve (nom inconnu en minuscules + pronom) : examinée, non modifiée
« son traitement, lina kaci » avec un patient à l'écran : la recherche ne trouve personne, et sans majuscule rien ne distingue un nom inexistant d'un mot de vocabulaire que les listes ignorent.
Refuser aussi ces cas ferait demander « quel patient ? » pour des questions banales (« quels changements récents a-t-il ? »). Atténuation déjà en place : toute réponse nomme le patient lu (« Pour <Nom>, … »), donc une erreur se voit.
Les noms avec majuscule inconnus, eux, ne lisent plus jamais le dossier ouvert (corrigé avant 5567c9b).

## Résultats de ces changements (séparés de la base 193)
- **C200 complète `post1`** : **197 PASS / 1 FAIL / 0 non vérifié / 2 BLOCKED**. Patients 55/55, agenda 30/30, finance 25/25, variation 10/10, livres 34/35, contexte 43/45 + 2 BLOCKED.
  - FAIL : C189 (syndrome sérotoninergique).
  - BLOCKED : C099 et C100 (« Patient suivant »). L'oracle lit `dashboard_today` à l'instant réel : la base fixture n'a qu'un rendez-vous à 10 h aujourd'hui, et il est passé. Ces deux cas étaient PASS avant 10 h (`final3`) ; rien n'est compté comme réussi.
  - Les livres : 87/87 passages mot pour mot dans un chunk approuvé.
- Typage `tsc --noEmit` : 0 erreur.
- Tests unitaires Alexa + connaissance : **4 600 réussis, 1 échec préexistant** (`alexa-v8-adversarial-manifest`, fichiers privés absents) + `knowledge-stahl-chunker` (fichiers gitignorés absents du worktree, ne se charge pas).
- Tests ajoutés : focus des maladies (5 formulations + comparaison), « qu'est-ce que », « withdrawal », paiements de séances, comparaison de mois (gabarit, exécuteur à deux lectures, lecture simple inchangée), cache de contexte (4 cas).

## Limites restantes
- **C189** : « Qu'est-ce que le syndrome sérotoninergique ? » affiche des passages DSM qui le citent en passant (différentiel du syndrome malin des neuroleptiques) et des voisins denses hors sujet ; les sections de Maudsley « Serotonin syndrome – symptoms » sont des tableaux dont le corps ne contient pas les mots, donc non trouvées par la porte lexicale. Un classement qui préférerait le titre de section n'a pas été retenu : il promouvait une entrée d'index.
- **Porte statistique** : sur cette base synthétique et ce PC, elle dépasse parfois le délai de 15 s (réponse honnête « La lecture a dépassé le délai autorisé », jamais un chiffre faux) ; relancer le cas seul la fait réussir en ≈ 3 s. À mesurer sur le poste réel.
- La comparaison de mois compte le mois en cours jusqu'à aujourd'hui (dit dans la réponse) contre le dernier mois entier.
