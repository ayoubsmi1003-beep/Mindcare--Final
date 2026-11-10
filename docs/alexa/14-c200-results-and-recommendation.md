# 14 — Alexa C200 : résultats et recommandation (livrables C et E)

Branche `claude/alexa-clinical-conversational-ai-97e2d6`, pipeline réel (`runAlexa`, vraies portes SQL sous RLS, vrai MiniCPM 1B, retrieval réel, réseau externe bloqué,
tour limité à 600 s), bases **synthétiques** uniquement. Français uniquement. Aucune revue clinique : les attentes ne sont **pas** approuvées par un clinicien.
Chaque couche est rapportée à part ; aucun chiffre d'une couche ne remplace celui d'une autre.

## 1. Campagne C200 (nouvelle) — exécution finale `final3`, 200 cas, code final

| Domaine | Cas | PASS | FAIL | NOT VERIFIED | BLOCKED |
|---|---:|---:|---:|---:|---:|
| Patients | 55 | 55 | 0 | 0 | 0 |
| Identité / contexte | 45 | 45 | 0 | 0 | 0 |
| Agenda | 30 | 30 | 0 | 0 | 0 |
| Finance / activité | 25 | 23 | 2 | 0 | 0 |
| Livres | 35 | 30 | 5 | 0 | 0 |
| Variation de formulation | 10 | 10 | 0 | 0 | 0 |
| **Total** | **200** | **193** | **7** | **0** | **0** |

- **Identité** : 100 % des tours (patients 55/55, contexte 93/93 tours). Aucune contamination entre patients détectée par l'évaluateur ; homonymes et noms proches : la question « lequel ? » est posée, jamais une devinette.
- **Réponse réelle** (un texte écrit, la bonne donnée) : 193/200 cas. **Présentation RAG** : 35/35 cas affichent au moins un passage ; **fidélité de source** : 91/91 passages affichés sont mot pour mot dans un chunk approuvé, avec page vérifiée pour 34/35 cas.
- **Agenda / finance** : correction des chiffres vérifiée contre l'oracle SQL (Africa/Algiers, semaines lundi→dimanche, base de caisse).
- **Performance** (par tour, PC lent) : p50 0,1 s, p95 2,4 s, maximum 87 s (passages de livres avec recherche vectorielle). Avant : résumé de dossier ≈ 500 s ; finance du jour/semaine 120–450 s via le modèle.

### Les sept échecs restants (tous documentés, aucun masqué)
| Cas | Question | Cause |
|---|---|---|
| C156 | critères de la dépression majeure | le chunk des critères (≈ 7 800 car.) est écarté par la fusion et le budget ; des passages voisins sont montrés |
| C170 | critères du bipolaire de type II | idem : « diagnostic différentiel » et « caractéristiques » au lieu des critères |
| C186 | arrêter une benzodiazépine sans sevrage | passages pertinents de la section, mais pas les faits attendus |
| C188 | effets métaboliques des antipsychotiques et surveillance | question composée ; une page d'étiquette ne correspond pas au chunk |
| C189 | syndrome sérotoninergique | passages voisins, pas la définition |
| C151 | comparer les consultations de ce mois et du mois dernier | la porte statistique compare à une fenêtre de même durée, pas au mois civil |
| C144 | combien de séances payées ce mois-ci | aucune lecture ne compte les séances payées ; la réponse actuelle (consultations enregistrées) répond à côté |

## 2. Historique des exécutions (rien n'est effacé)
| Exécution | Code | Évaluateur | Résultat |
|---|---|---|---|
| `full3` (premier passage complet) | avant les correctifs de finance/livres | preuve v1 | 153 PASS / 40 FAIL / reste non exécuté |
| `final` | idem + évaluateur v1 | preuve v1 | 152 PASS / 48 FAIL (livres 1/35, finance 13/25) |
| `final2` | cadres finance + preuve v2 | preuve v2 | 191 PASS / 9 FAIL |
| `final3` | + nom du patient suivant, correctifs de la revue de sécurité | preuve v2 | **193 PASS / 7 FAIL** |

Base de départ (code d'origine, mesurée au début) : écran consultation « Quel patient ? », questions d'agenda renvoyant des passages de livres après 300 s+, critères de dépression hors sujet.

**Correction de l'évaluateur, à lire avant d'interpréter les livres.** Les 1/35 de `final` venaient d'un défaut de **mon outil de preuve**, pas d'Alexa : une seule paire de mots (limite 60 chunks) et des mots rendus voisins par l'élimination des mots courts ;
la page de la première étiquette était comparée à tous les passages. La v2 exige trois paires de mots réellement voisines et compare la page de l'étiquette de la section du passage. Le test « mot pour mot » reste exact et la pertinence (faits attendus) n'a pas été assouplie.
Les deux jeux de résultats sont conservés (`results-final.jsonl`, `results-final2.jsonl`, `results-final3.jsonl`) et décrits dans `v1/README.md`.

## 3. Autres couches (séparées)
- **Typage** : `tsc --noEmit` = 0 erreur.
- **Tests unitaires Alexa** (`tests/unit/alexa*`) : 4 562 réussis, 1 échec préexistant (`alexa-v8-adversarial-manifest` : exige des fichiers privés figés absents du worktree).
  **Suite unitaire complète** : 6 701 réussis, 4 échecs d'environnement préexistants (`alexa-v8-adversarial-manifest`, `knowledge-stahl-chunker` — fichiers gitignorés absents, `lecture-auto`, `voice-bundle-inventory`), sans lien avec ces changements.
- **Campagne historique de 300 cas** : **non rejouée — BLOCKED** (ses fichiers privés sont absents du worktree). Elle reste une référence de régression intacte ; ses résultats (`09-final-evaluation-report.md`) ne sont pas mélangés à ceux de C200.
- **Intégration** : le pilote C200 *est* le test d'intégration (pipeline réel). **E2E navigateur** : non exécuté. **Revue clinique** : aucune.
- **Revue de sécurité adversariale** (agent `security-reviewer`, diff complet) : quatre constats, tous corrigés et couverts par un test.
  1. (haut) un nom absent de la base (« Résumé de Lina Kaci ») était réécrit en « le patient sélectionné » et lisait le dossier déjà ouvert → plus aucun cadre : l'ancienne route demande.
  2. commentaire trompeur corrigé. 3. (moyen) l'horloge des périodes était en UTC : « hier », « le mois dernier » faux entre 00 h et 01 h à Alger → l'horodatage est désormais celui d'Africa/Algiers (`algiersTimestamp`).
  4. question « lequel ? » sans choix (0 correspondance, résultat tronqué) → traitée comme absente.
  Réserve connue, non corrigée (règle 9 : pas de nouvelle porte) : le contexte de consultation lit `get_consultation` (notes brutes) à chaque tour pour obtenir le patient et écrit une ligne d'audit « fiche » à chaque tour.

## 4. Exemples
Réussis : « Il prend quoi comme traitement ? » sur l'écran consultation (patient dérivé par le serveur) ; « Patient suivant. » → « <Nom> · 10:00 : attendu », patient retenu ;
« Combien le cabinet a-t-il encaissé cette semaine ? » → montant exact de la porte en < 1 s ; « Comment diagnostique-t-on un TOC ? » → passages mot pour mot du DSM-5, avec section et page ; un prénom partagé par plusieurs patients → « Plusieurs patients correspondent… Lequel ? ».
Échoués : voir §1 (critères de la dépression majeure : des passages voisins sont montrés, pas la liste des critères).

## 5. Recommandation (non, ce n'est pas une déclaration de mise en production)
- **La médecin peut-elle commencer ?** Pour un **essai encadré, sur données synthétiques ou avec un contrôle systématique des réponses**, oui : identité, contexte, agenda, finance du cabinet et résumés sont fiables sur 200 cas vérifiés par SQL. Pas avant une revue clinique des attentes et un essai sur son poste, avec sa base.
- **Fiable** : identification du patient (100 % des tours testés), contexte d'écran, « patient suivant », agenda, finance de caisse, résumés sans modèle, passages de livres mot pour mot.
- **À améliorer** : classement des passages de critères diagnostiques (dépression majeure, bipolaire II, syndrome sérotoninergique), questions de livres composées, séances payées, comparaison au mois civil, lecture partielle des dossiers de plus de ~100 consultations (dite honnêtement).
- **Risques d'identité / d'intégrité** : la vérification d'un nom passe toujours par la recherche de patients ; les points de vigilance restants sont (a) la lecture de `get_consultation` à chaque tour (sur-lecture et bruit d'audit), (b) un nom inconnu écrit en minuscules avec un pronom (« son traitement, lina kaci ») est lu comme le patient à l'écran (les noms capitalisés inconnus ne le sont plus), (c) aucun test navigateur du flux de bout en bout.
- **Prochaine tâche** : un essai clinique encadré avec relecture de 50 réponses par la médecin, puis le classement des critères diagnostiques (chunk long prioritaire quand la question demande des « critères »).
