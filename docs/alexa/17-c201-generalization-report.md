# 17 — C201 : campagne de généralisation (200 questions nouvelles + 30 de réserve)

Code évalué : `3180fc5` (inchangé pendant toute la campagne). Pipeline réel (`runAlexa`, portes SQL sous RLS, MiniCPM 1B, recherche réelle), réseau externe bloqué, bases **synthétiques** seulement.
Les résultats de C200 (193/200 base vérifiée, 197/200 `post1`) restent séparés et intacts. Aucune revue clinique.
Outillage : `tests/eval/alexa-clinical-conversational/v2/` (cas, vérité terrain SQL, évaluateur, rapport masqué) et `tests/integration/alexa-c201.live.test.ts`. Les oracles privés restent dans `.eval-out/alexa-c201/` (ignoré par git).

## Ce qui a été testé
200 cas **nouveaux** (aucune phrase de C200 reprise : le constructeur de cas le refuse), même répartition que C200 : patients 55, contexte 45, agenda 30, finance et activité 25, livres 35, variation 10 ;
23 formulations tagguées (français courant, formel, familier, court, mots dans un autre ordre, fautes de frappe, sujet implicite, pronoms, suites qui ne changent que la période, autre patient que celui à l'écran) et **Darija en écriture arabe (18 tours), en lettres latines (29) et mélangée au français (22)**,
**à votre demande explicite de cette session** (la consigne précédente « français seulement » est donc levée pour cette campagne).
Livres : 35 questions sur des sujets absents de C200, chacune écrite après lecture du passage approuvé qui y répond (14 DSM-5, 11 Maudsley, 10 Stahl) ; le passage source de chaque question est vérifié en base et enregistré dans l'oracle.
Un PASS livre exige : passage affiché mot pour mot dans un chunk approuvé, **chunk et texte affiché contenant tous les faits décisifs** (un passage qui mentionne le sujet sans répondre échoue), bonne page.

## Résultats — 200 cas (`main1`, plus `np2` pour trois cas : voir « Défauts du protocole »)
| | PASS | FAIL | BLOCKED |
|---|---:|---:|---:|
| **Total** | **88** | **112** | **0** |
| Patients (55) | 28 | 27 | 0 |
| Contexte (45) | 16 | 29 | 0 |
| Agenda (30) | 13 | 17 | 0 |
| Finance / activité (25) | 9 | 16 | 0 |
| Livres (35) | 19 | 16 | 0 |
| Variation (10) | 3 | 7 | 0 |

Par langue (tours) : **français 101/161 (63 %)** · Darija latin 2/29 (7 %) · Darija arabe 0/18 (0 %) · mélange 4/22 (18 %).
Par formulation (tours) : sujet implicite 3/3 · synonymes 7/9 · ordre des mots 9/12 · formel 9/14 · court 19/32 · familier 12/27 · période seule 4/9 · autre patient 3/7 · fautes de frappe 2/6 · suites 4/10 · conversationnel 13/37 · direct 20/52 · **pronoms 2/12**.
Latence par tour : médiane 6,6 s, p95 313 s, pire 442 s (les tours lents sont ceux où le modèle 1B est appelé).
Livres : 19/35 questions répondues par le bon passage ; 57 passages affichés, 56 mot pour mot (98 %) ; la page citée concorde avec le marqueur du chunk dans 56/56 cas vérifiables.

## Réserve (30 reformulations inédites, lancée une fois, après la sauvegarde des résultats principaux, rien n'a été ajusté dessus) : 11 PASS / 19 FAIL
Français 14/28, Darija 0/5 ; livres 2/6. Même profil que l'ensemble principal : la généralisation à de nouvelles formulations est faible, ce n'est pas un effet de mémorisation de C200 en sens inverse.

## Causes des 123 tours en échec (112 cas), par étape du pipeline (un tour = une cause principale)
| Cause | Tours | Exemples |
|---|---:|---|
| **Reconnaissance d'intention : Darija non comprise** (repli sur le modèle, minutes, aucune réponse utile) | 63 | « Chhal men consultation… », « شحال من مريض عندي غدا », « Chkoun l patient jay » |
| **Reconnaissance d'intention : formulation française non comprise** (repli sur le modèle, 30 à 300 s, « pas de réponse fiable » ou limite de tour) | 30 | « Même question pour hier », « Pareil… », « Visites ? », « rentrées d'argent de septembre », « chiffre d'affaires de l'année en cours », « Qui est passé hier ? » |
| **Un cadre déterministe lit mal l'intention ou la période (donne une mauvaise donnée)** | 9 | « est venu la dernière fois quand » → nombre de consultations ; « Depuis combien de temps on le suit » → nombre ; « réglées » → rendez-vous ; « le plus chargé ce mois-ci » → un seul jour ; « cette semaine » non fixée |
| **Résolution de contexte** (mauvais patient, patient à l'écran ignoré, clarification absente) | 5 | question formelle longue sur « ce patient » → « Quel patient souhaitez-vous utiliser ? » alors que le patient est à l'écran ; « Patient suivant » (après le rejeu, V091 et V092 relèvent du repli sur le modèle, voir ci-dessus) |
| **Livres : aucun passage affiché, texte écrit par le modèle** | 11 | prévalence du mutisme, bupropion, varénicline, TDAH de l'adulte, brexanolone… |
| **Livres : mauvais passage retenu** (le sujet est cité, la réponse n'y est pas) | 4 | prégabaline, atomoxétine, surveillance de la calcémie, schéma de sevrage alcoolique |
| Livres : passage non mot pour mot | 1 | maladies à prions |

### Constats graves
1. **Contenu clinique inventé par le modèle** : sur des questions de livres sans passage retrouvé, une phrase rédigée par le MiniCPM remplace la réponse (« Les critères sont des traits de comportement… la méfiance, la solitude et la distrust » pour la personnalité antisociale ; « La prévalence … est faible » sans source). C'est le risque le plus sérieux de la campagne : un texte plausible, faux, sans source.
2. **Deux lectures dangereuses restent possibles** : 2 « lectures inter-patients » (« Chouf li {patient} » et un équivalent arabe, avec un patient à l'écran : le dossier lu est celui d'un autre). Ce sont des tours en Darija, donc le chemin hérité ou le modèle a décidé du patient.
3. Sur les 123 tours en échec, **87 (71 %) se terminent par un refus visible** (« pas de réponse fiable », limite de tour, « non établi », « quel patient ? »), souvent après 1 à 5 minutes d'attente ; **16 sont des questions de livres** ; **26 donnent une réponse, mais fausse ou à côté** (donnée d'une autre intention ou d'une autre période, ou texte du modèle) : ce sont les plus dangereux, parce que rien ne les signale.

## Défauts du protocole (déclarés, et corrigés à part)
- **Horloge des cas « Patient suivant »** : la vérité terrain a été calculée avant minuit et les cas joués après (`V090–V092`). Le premier a échoué pour cette seule raison. Les trois cas ont été **rejoués avec une horloge fraîche** (`np2`) : `V090` PASS, `V091` et `V092` FAIL (vrais échecs). Les deux résultats sont conservés ; le total ci-dessus utilise le rejeu.
  Le script exécute désormais l'horloge contrôlée (`prepare-clock.mjs`, rendez-vous synthétique de 23 h 50 dans le fixture) mais une campagne qui franchit minuit doit rejouer ces cas : à faire par le script, noté.
- **Questions ambiguës de ma part** : `V001` (« qui est ce patient » se lit aussi comme une question d'identité) et `V061` (« depuis combien de temps on le suit » : une durée, pas forcément une date). Comptées FAIL (critères non modifiés) ; elles ne doivent pas être lues comme des erreurs certaines d'Alexa.
- Aucun cas BLOCKED : toutes les vérités terrain ont été établies (230 tours, 0 bloqué, 0 non vérifié).

## Plus petits correctifs recommandés (non faits, selon vos consignes ; à implémenter avec tests ciblés)
1. **Livres (priorité 1, sécurité)** : si aucun passage n'est retrouvé, ne jamais afficher un texte rédigé par le modèle pour une question de connaissance ; répondre « aucun passage trouvé » (gabarit). Puis sélection : traiter `no-passage-presented` (11) comme premier chantier de retrieval (la plupart des sujets sont des chunks courts de Maudsley/Stahl).
2. **Cadres déterministes** : faire gagner « dernière fois / quand » sur « combien » ; « depuis combien de temps » → date de première venue ; synonymes d'argent (« rentrées », « chiffre d'affaires de l'année en cours », « réglées ») ; suites de période qui ne répètent pas la question (« même question », « pareil pour », « et pour … précédente ») ; pronoms dans les phrases longues et formelles (garder le patient à l'écran).
3. **Repli sur le modèle** : un repli qui coûte 100 à 300 s pour rendre « pas de réponse fiable » devrait être borné (délai court) ; sur un mot inconnu, mieux vaut une phrase de reformulation immédiate.
4. **Darija** : 63 des 69 tours en Darija échouent. Décision de produit à prendre : soit hors périmètre (le dire explicitement à la médecin), soit un petit lexique fermé de Darija vers la phrase française canonique, branché sur les mêmes cadres. Les 2 lectures inter-patients en Darija doivent être traitées en tout cas.

## Limites
Un seul passage par cas ; le modèle 1B est lent et non déterministe ; l'oracle des livres est fondé sur des faits mot à mot vérifiés (un passage correct mais formulé autrement serait refusé) ; pas de revue clinique ;
les cas en Darija supposent que la question a un sens clair pour un médecin algérien : leur vérité terrain est SQL, leur formulation n'est pas validée par un locuteur.
