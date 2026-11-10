# 18 — C202 : 200 questions nouvelles, en français seulement

Code évalué : `3180fc5` (inchangé). Pipeline réel (`runAlexa`, portes SQL sous RLS, MiniCPM 1B, recherche réelle), réseau externe bloqué, bases **synthétiques**. Aucune revue clinique.
Cette campagne remplace C201 sur un point : **français uniquement**, pas de darija (la consigne précédente est rétablie ; C201 reste dans `17-…` comme référence séparée).
C200 (193/200 base vérifiée, 197/200 `post1`) et C201 (88/200) restent intacts et séparés.
Outillage : `tests/eval/alexa-clinical-conversational/v3/` ; oracles et réponses privés dans `.eval-out/alexa-c202/` (ignoré par git).

## Ce qui a été testé
- **200 questions nouvelles**, même répartition que C200 (patients 55, contexte 45, agenda 30, finance et activité 25, livres 35, variation 10), toutes en français, en 13 formulations (direct, conversationnel, court, familier, ordre des mots, fautes de frappe, sujet implicite, pronoms, suites, période seule, autre patient, formel, synonymes).
- **Pas de ressemblance avec C200 ni C201** : le constructeur de cas refuse toute question identique ou à 70 % de mots communs (indice de Jaccard) avec l'une des 430 questions précédentes (30 questions de la réserve de C201 comprises). Une quarantaine de questions ont dû être réécrites avant le gel.
- **35 questions de livres entièrement nouvelles**, sans aucun nom d'ouvrage (le constructeur le refuse), sur 35 passages approuvés différents de C200 et de C201 : 13 DSM-5 (personnalités histrionique, évitante, narcissique, schizoïde, dépendante, paranoïaque ; kleptomanie ; pyromanie ; crainte excessive d'avoir une maladie ; troubles de l'adaptation ; douleurs génito-pelviennes ; tabac ; narcolepsie), 11 Maudsley, 11 Stahl.
  Chaque question a été écrite après lecture du passage approuvé qui y répond ; l'oracle relit ce passage en base et vérifie qu'il contient tous les faits décisifs.
- **Critère livres, sans indulgence** : PASS = un passage est **affiché**, mot pour mot dans un chunk approuvé, ce chunk et **le texte affiché** contiennent tous les faits décisifs, bonne page. Retrouver le passage sans l'afficher, ou afficher un passage qui ne répond pas, échoue.

## Résultats : 110 PASS / 90 FAIL / 0 BLOCKED (`main1`, plus `np2` pour trois cas : voir « Défaut du protocole »)
| Domaine | PASS | FAIL |
|---|---:|---:|
| Patients (55) | 35 | 20 |
| Contexte (45) | 26 | 19 |
| Agenda (30) | 18 | 12 |
| Finance / activité (25) | 12 | 13 |
| **Livres (35)** | **14** | **21** |
| Variation (10) | 5 | 5 |
| **Total** | **110 (55 %)** | **90** |

Par formulation (tours) : court 79 % · ordre des mots 75 % · suites 70 % · direct 66 % · formel 58 % · pronoms 57 % · fautes de frappe 50 % · sujet implicite 1/2 · conversationnel 43 % · période seule 36 % · familier 29 % · autre patient 29 % · **synonymes 27 %**.
Latence par tour : médiane 1,0 s, p95 249 s, pire 349 s (les tours lents sont ceux où le modèle est appelé).
Livres : 14/35 répondues par le bon passage ; 72 passages affichés, 72 mot pour mot (100 %), page de la citation concordante 72/72. Les passages affichés sont fidèles ; c'est le choix du passage qui échoue.

## Pourquoi 98 tours échouent (un tour = une cause principale)
| Cause | Tours |
|---|---:|
| Formulation française non comprise : repli sur le modèle (30 à 350 s, souvent « pas de réponse fiable ») | 59 |
| Cadre déterministe qui lit mal l'intention, la période ou le patient (mauvaise donnée ou mauvais dossier) | 18 |
| **Livres : aucun passage affiché, texte écrit par le modèle** | 10 |
| **Livres : un passage est affiché mais il ne répond pas** | 11 |

Sur les 77 tours d'échec hors livres : **49 se terminent par un refus visible** (« pas de réponse fiable », limite de tour, « quel patient ? ») et **28 donnent une réponse fausse ou à côté, sans signal** (par exemple le nombre de consultations de tout le cabinet à la place de celui du patient, une autre période, un autre patient).
Les 2 **lectures inter-patients** observées (« je voudrais plutôt savoir combien de séances a eues {patient} » et « pour {patient} et non pour celui-ci : résume son dossier », avec un autre patient à l'écran) donnent une réponse sur le patient de l'écran : c'est le risque d'identité à traiter en premier.

### Livres : ce que montre la campagne
- **10 cas sans passage affiché** : **4 reçoivent un texte rédigé par le modèle**, plausible, faux et non sourcé (histrionique, évitante, narcolepsie, lurasidone ; l'évitante devient « une personne qui refuse de répondre », la narcolepsie « une insuffisance d'hormones… ») ; **6 reçoivent un refus** (dépendante : question « quelle information administrative ? » ; opiacés, anorexie, hyponatrémie, inhibiteurs de la cholinestérase, paroxétine : « pas de réponse fiable » ou limite de tour). Dans les 10 cas, le passage qui répond existe dans les livres approuvés : il n'est ni retrouvé ni montré. **Un texte inventé n'est jamais une réponse acceptable.**
- **11 cas avec un mauvais passage** : le sujet est cité, la réponse n'y est pas (« Diagnostic différentiel » de la personnalité paranoïaque au lieu des critères ; le modèle alternatif de la personnalité narcissique au lieu de la section principale ; équivalences de doses, bilan pré-lithium, ECT, mirtazapine, akathisie).
- Les 14 sujets qui réussissent (schizoïde, kleptomanie, pyromanie, douleurs génito-pelviennes, boulimie, valproate, mémantine, lurasidone-doses, modafinil, venlafaxine, clonazépam, naltrexone, clozapine, zolpidem) sont ceux dont les mots de la question figurent presque tels quels dans le passage.

## Défaut du protocole (corrigé à part, les deux résultats sont conservés)
La vérité terrain de « Patient suivant » est calculée au lancement ; la campagne a duré des heures et a franchi 10 h, heure du seul rendez-vous « du jour » de la base de test : le « prochain patient » a changé en cours de route.
`W090`, `W091`, `W092` ont été **rejoués avec une vérité terrain recalculée juste avant** (`np2`) : `W090` et `W091` PASS, `W092` FAIL (vrai échec : « C'est quoi le prochain dossier à ouvrir ? » → repli sur le modèle). Le total ci-dessus utilise le rejeu ; sans lui : 108/200.
À corriger dans l'outil : calculer cette vérité terrain au moment de chaque tour, pas au lancement.

## Comparaison (séparée, non additive)
| Campagne | Langue | Cas | PASS |
|---|---|---:|---:|
| C200 (questions écrites avant les correctifs, puis corrigées) | français | 200 | 193 base / 197 `post1` |
| C201 (nouvelles, avec darija) | français (161 tours) | 200 | 88 (français : 63 % des tours) |
| **C202 (nouvelles, français seulement)** | français | 200 | **110 (55 %)** |
Le français de C201 et celui de C202 se ressemblent (63 % des tours contre 57 %) : la perte par rapport à C200 vient de la généralisation, pas du darija.

## Plus petits correctifs recommandés (non faits)
1. **Livres, sécurité** : ne jamais afficher un texte du modèle pour une question de connaissance ; si aucun passage n'est retenu, dire « aucun passage trouvé » (4 textes inventés sur 10 cas sans passage).
2. **Livres, choix du passage** : préférer la section de critères / caractéristiques d'un trouble à son « diagnostic différentiel » ou à son « modèle alternatif » quand la question demande de définir ou de reconnaître ; traiter les passages de tableau (équivalences de doses) et les listes de prescription (21 cas).
3. **Synonymes et familier** (27 % et 29 %) : compléter le vocabulaire des cadres (« passages », « apparition », « molécules », « ordonnance », « prescrit », « consigné », « papiers », « topo », « tour d'horizon », « état des lieux ») ; quand la formulation n'est pas reconnue, répondre vite par une reformulation au lieu d'attendre 1 à 5 minutes le modèle.
4. **Autre patient que celui de l'écran** : un nom cité dans la phrase doit gagner sur le patient de l'écran (2 lectures inter-patients, 5 échecs sur 7 cas).
5. **Période seule** : suites du type « Et aujourd'hui ? », « Même chose pour… », « Et celle qui précède ? » (7 échecs sur 11).

## Limites
Le modèle 1B est lent et non déterministe ; l'oracle des livres exige des mots exacts du passage (une réponse correcte autrement formulée serait refusée) ; pas de revue clinique ; la vérité terrain « Patient suivant » est sensible à l'heure (voir ci-dessus).

## Suite : correctifs « livres » (après la campagne ; la campagne ci-dessus reste le résultat mesuré sur `3180fc5`)
Causes trouvées en traçant où le passage vérifié se perd, puis corrigées par classe (aucune question codée en dur) :
1. **Texte du modèle pour une question de livre** : une question psychiatrique hors de la liste fermée de sujets (personnalité, phobie, narcolepsie, lurasidone…) était admise comme « question publique générale » et rédigée par le modèle. `CLINICAL_STEMS` (racines psychiatriques et pharmacologiques) l'envoie aux livres et interdit au modèle d'y répondre. Une question à pronom possessif (« son TDAH ») reste celle du patient.
2. **ET lexical vide** : un seul mot parasite (« permettent », « retenir », « évoquent ») vide la recherche. Un second essai retire les seuls mots de remplissage, jamais un mot médical.
3. **Le bon passage trouvé mais écarté** : une question de critères ou de description cherche aussi « <sujet> critères diagnostiques » (les chunks du DSM s'ouvrent par « <Trouble> — critères diagnostiques — »), et le chunk de cette rubrique, trouvé par les mots et pertinent, passe en tête.
4. **Trouvé et non affiché** : seuls 3 passages sur les 5 retenus étaient montrés ; tous le sont maintenant (le budget de preuves borne déjà le total).
Résultats après correctifs (labels `books4`, `booksfix`, `books-reg`, séparés) : **C202 livres 23/35** (14 avant), **C201 livres 20/35** (19), **C200 complète 200/200** (non-régression ; le syndrome sérotoninergique C189 réussit maintenant). Tests unitaires Alexa et connaissance : 4 607 réussis, 1 échec préexistant (+ `knowledge-stahl-chunker`, fichiers absents du worktree).
**Reste 12 cas de C202** : 11 sur des livres anglais (Maudsley, Stahl), où une question française doit retrouver un passage anglais : la recherche par mots exige des équivalents anglais exacts (« bilan » → « workup », « sismothérapie » → « ECT », pluriels comme « doses »), et la recherche vectorielle française→anglaise ne ramène pas ces passages. Prochain levier : élargir le glossaire français-anglais gouverné (`terminologie-bilingue.ts`) et gérer le singulier/pluriel des requêtes anglaises.
