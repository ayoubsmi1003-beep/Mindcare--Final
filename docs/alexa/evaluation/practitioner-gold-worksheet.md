# Practitioner gold worksheet

**Every reference answer below is NOT CLINICALLY APPROVED.** I drafted them in my own words from the passages in the cabinet's books, on 2026-11-07. I'm not a clinician, and Dr. Larbi hasn't reviewed them. Until that review, results that depend on them stay "agent-reviewed".

| Group | Cases | Status |
|---|---|---|
| Reference answer drafted from the source | 31 | **NOT CLINICALLY APPROVED** |
| No reference answer: the passage wasn't found or read | 6 | **NOT CLINICALLY APPROVED**, needs Dr. Larbi |
| Alexa must abstain, because no book holds the answer | 3 | Automatic expected outcome |

## How to read this

- **Questions** are copied exactly from `tests/eval/knowledge.books-v4-2026-10-28.json` and `tests/eval/alexa-transform/v1/`.
- **Reference answers** are short summaries so the book's text isn't reproduced here. Please check them against the book, not against this page.
- **Page numbers:**
  - DSM-5 and Maudsley pages are the printed pages recorded in the corpus.
  - **Stahl pages (up to 2375) are positions in the source file, not necessarily printed pages.** Search by drug and section heading if a number looks wrong.
- **"Alexa found it"** is what retrieval returned on 2026-11-07. Since the references change, Alexa lists passages and doesn't write the answer.
- **Blank reference answers** are deliberate. I didn't fill them from memory.

## Findings to look at first

1. **Lithium targets differ between the books** (TAY-LITHIUM-CIBLE, STH-LITH-TESTS). Alexa shows the passages and doesn't reconcile them.
2. **Clozapine thresholds are US and UK rules** (TAY-CLOZAPINE-HEMA). The rule that applies in Algeria isn't in the books.
3. **Alexa doesn't reach the management passages for** serotonin syndrome, antidepressant discontinuation, acute agitation and neuroleptic malignant syndrome. These matter clinically and are retrieval failures.
4. **Some chunks seem to carry the wrong heading** (STH-OLANZ-METAB, A-S08). Fixing that means re-ingesting the corpus, which is out of scope without your approval.

## Cases

### G01 · DSM-MDD-SEUIL

- **Question:** Combien de symptômes faut-il présenter pour un épisode dépressif caractérisé, et sur quelle durée ?
- **Reference answer:** Au moins cinq symptômes sur une même période de 2 semaines, dont au moins l’humeur dépressive ou la perte d’intérêt ou de plaisir. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Section II › Troubles dépressifs › Trouble dépressif caractérisé › Critères diagnostiques, p. 200
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** Other criteria of the same list weren't summarized.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G02 · DSM-PANIC-DUREE

- **Question:** Quels sont les critères de durée du trouble panique ?
- **Reference answer:** Au moins une attaque suivie d’au moins un mois de crainte persistante d’autres attaques ou de changement de comportement inadapté (critère B). **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles anxieux › Trouble panique › Critères diagnostiques, p. 260
- **Directly supported:** Direct
- **Alexa found it:** Yes, second in the list
- **To review:** Alexa lists the descriptive section (p. 261) before the criteria.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G03 · DSM-MANIE-DUREE

- **Question:** Quelle est la durée minimale d'un épisode maniaque selon le DSM-5 ?
- **Reference answer:** Au moins une semaine, ou toute durée si une hospitalisation est nécessaire. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles bipolaires et apparentés › Épisode maniaque › Critères diagnostiques, p. 158
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G04 · DSM-GAD

- **Question:** Combien de symptômes et quelle durée pour le trouble d'anxiété généralisée ?
- **Reference answer:** Au moins 6 mois d’anxiété et de soucis excessifs, avec au moins trois symptômes sur six ; un seul suffit chez l’enfant. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles anxieux › Anxiété généralisée, p. 277
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G05 · DSM-AGORAPHOBIE

- **Question:** Le DSM-5 sépare-t-il le trouble panique de l'agoraphobie ?
- **Reference answer:** Oui selon les passages lus : l’agoraphobie a ses propres critères, et les deux diagnostics sont retenus quand les critères de chacun sont remplis. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles anxieux › Agoraphobie, p. 272 (critères), p. 275 (diagnostic différentiel)
- **Directly supported:** Partial: inferred from the criteria
- **Alexa found it:** No: Alexa's passages are from Trouble panique
- **To review:** No sentence read states the separation outright. Please confirm the wording.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G06 · DSM-PTSD

- **Question:** Quels sont les groupes de symptômes du trouble de stress post-traumatique ?
- **Reference answer:** *None. Not established from the passages read.* **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles liés à des traumatismes › Trouble stress post-traumatique. Criteria page not located; description from p. 354
- **Directly supported:** Not established
- **Alexa found it:** No: Alexa's passages mention the groups without listing them
- **To review:** I found no chunk listing the groups, and I won't write them from memory. Please give the page.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G07 · DSM-TDPM

- **Question:** Quels sont les critères du trouble dysphorique prémenstruel ?
- **Reference answer:** Sur la majorité des cycles, au moins cinq symptômes la semaine avant les règles, s’améliorant ensuite, dont au moins un parmi labilité émotionnelle, irritabilité, humeur dépressive ou anxiété marquées. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles dépressifs › Trouble dysphorique prémenstruel › Critères diagnostiques, p. 212
- **Directly supported:** Direct, partial coverage
- **Alexa found it:** Yes
- **To review:** Criteria after B weren't read. A page heading sits in the middle of the extracted sentence.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G08 · DSM-BIPOLAIRE-I-II

- **Question:** Quels critères distinguent le trouble bipolaire I du trouble bipolaire II ?
- **Reference answer:** Le type I exige au moins un épisode maniaque. Le type II exige un épisode hypomaniaque et un épisode dépressif caractérisé, actuels ou passés. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles bipolaires › Type I, Critères, p. 160 ; Type II, Critères, p. 167
- **Directly supported:** Direct, partial coverage
- **Alexa found it:** Partly: type I found, type II not; first result is cyclothymia
- **To review:** The exclusion of any manic episode in type II wasn't read. Please confirm.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G09 · DSM-SUBSTANCE

- **Question:** Combien de critères et sur quelle période pour le trouble lié à l'usage d'une substance ?
- **Reference answer:** Pour chaque substance lue : au moins deux manifestations sur 12 mois. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles liés à une substance › sédatifs p. 712 ; alcool p. 643 ; cannabis p. 664
- **Directly supported:** Direct, per substance
- **Alexa found it:** Partly: sedatives only
- **To review:** The question is generic, and the passages are specific to one substance each.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G10 · DSM-TOC

- **Question:** Quels sont les critères du trouble obsessionnel-compulsif ?
- **Reference answer:** Présence d’obsessions, de compulsions ou des deux, chacune définie par deux éléments. **NOT CLINICALLY APPROVED**
- **Source:** DSM-5, édition française 2015 › Troubles obsessionnels-compulsifs et apparentés › Trouble obsessionnel-compulsif, p. 301
- **Directly supported:** Direct, partial coverage
- **Alexa found it:** Yes
- **To review:** Later criteria weren't summarized.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G11 · TAY-LITHIUM-CIBLE

- **Question:** Quelle est la cible de lithémie recommandée par Maudsley ?
- **Reference answer:** Adulte, trouble bipolaire : 0,60 à 0,80 mmol/L ; 0,40 à 0,60 si bonne réponse et mauvaise tolérance ; 0,80 à 1,00 si réponse insuffisante et bonne tolérance. Sujet âgé : le plus souvent 0,40 à 0,60. Épisode aigu : 1,0 à 1,2. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 2 › Optimising lithium treatment, p. 297 ; épisode aigu, p. 279
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** **Conflict:** Stahl gives 1.0 to 1.5 mEq/L (acute) and 0.6 to 1.2 mEq/L (chronic), p. 1211. Which should the practice use?
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G12 · TAY-OLANZAPINE-METAB

- **Question:** Quels effets métaboliques de l'olanzapine sont décrits ?
- **Reference answer:** Effets métaboliques importants, dont la prise de poids. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 2 › Olanzapine, p. 271. Aussi : Prescriber's Guide (Stahl), 7e éd. › Olanzapine › Notable Side Effects, p. 1624 (diabète, dyslipidémie)
- **Directly supported:** Direct, brief
- **Alexa found it:** Yes
- **To review:** Maudsley's passage here is one sentence. A fuller section may exist elsewhere.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G13 · TAY-CLOZAPINE-HEMA

- **Question:** Quelle surveillance hématologique pour la clozapine ?
- **Reference answer:** Surveillance obligatoire. Les fréquences et les seuils varient selon les pays : arrêt sous 1000/mm³ de neutrophiles selon la FDA, sous 1500/mm³ selon le Royaume-Uni. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 1 › Risk of clozapine-induced neutropenia and agranulocytosis, p. 237
- **Directly supported:** Direct, partial coverage
- **Alexa found it:** Yes
- **To review:** **Limit:** the actual schedule wasn't read, and these are US and UK rules. Which rule applies in Algeria?
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G14 · TAY-SEROTONIN

- **Question:** Que faire en cas de syndrome sérotoninergique ?
- **Reference answer:** *None. Not established from the passages read.* **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 3, p. 337, causes only; Table 3.7, p. 338. Management page not located
- **Directly supported:** Not established
- **Alexa found it:** No: passages cover causes, not management
- **To review:** Please give the page. I won't write a management plan from memory.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G15 · TAY-DISCONTINUATION

- **Question:** Comment arrêter un antidépresseur pour éviter un syndrome d'arrêt ?
- **Reference answer:** *None. Not established from the passages read.* **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 3, section not located (Table 3.7, p. 338, is about swapping and stopping)
- **Directly supported:** Not established
- **Alexa found it:** No: passages are unrelated (p. 528, p. 111)
- **To review:** A real retrieval failure. Please give the page.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G16 · TAY-RISPERIDONE-DOSE

- **Question:** Quelle est la dose initiale de la rispéridone dans la schizophrénie ?
- **Reference answer:** Adulte, psychose, hors urgence : 1 mg par jour par voie orale, en deux prises. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Risperidone › Dosing and Use › Dosage Forms, p. 1986
- **Directly supported:** Direct, from another book
- **Alexa found it:** No: the dataset expects Maudsley, whose passages found give no starting dose
- **To review:** The dataset's expected source may be wrong. Should it become Stahl?
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G17 · TAY-CLOZAPINE-TITRATION

- **Question:** Comment titrer la clozapine chez un patient schizophrène ?
- **Reference answer:** Individualiser selon la tolérance : commencer à 12,5 mg, puis 25 mg, puis 50 mg si la dose précédente est bien tolérée (sédation, fréquence cardiaque, tension), de préférence en deux prises par jour. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 1 › Re-starting clozapine, p. 207
- **Directly supported:** Partial: from the re-starting section
- **Alexa found it:** Yes
- **To review:** **Check:** this passage concerns restarting after a gap. The first-titration schedule may differ.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G18 · TAY-LITHIUM-RENAL

- **Question:** Quelles précautions rénales avec le lithium ?
- **Reference answer:** Surveiller régulièrement la fonction rénale. Un taux au-dessus de 0,8 mmol/L est associé à plus de toxicité rénale. Les effets peuvent être irréversibles après plus de 15 ans. Éviter la déshydratation et les AINS. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 2 › Adverse effects, p. 250 ; Chapter 13, p. 892
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G19 · TAY-AGITATION

- **Question:** Quelle est la prise en charge de l'agitation aiguë ?
- **Reference answer:** *None. Not established from the passages read.* **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 1 › Rapid tranquillisation summary, around p. 63, not summarized here
- **Directly supported:** Not established
- **Alexa found it:** No: a bibliography entry and a Stahl loxapine note
- **To review:** The likely section exists but Alexa doesn't reach it. Please confirm it's the right one.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G20 · TAY-QT

- **Question:** Quels sont les effets cardiaques des antipsychotiques sur le QT ?
- **Reference answer:** Certains antipsychotiques bloquent des canaux potassiques cardiaques et allongent le QT, facteur de risque de torsade de pointes, parfois mortelle. La plupart sont associés à plus de morts subites cardiaques dans des études cas-témoins. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 1 › ECG changes – QT prolongation, p. 141 ; Quantifying risk, p. 143
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G21 · ABS-PRIX

- **Question:** Quel est le prix du lithium en Algérie ?
- **Reference answer:** Alexa must say it has no source, and give no figure. *Automatic expected outcome.*
- **Source:** No source: the books don't hold this
- **Directly supported:** Expected abstention
- **Alexa found it:** Yes: no evidence returned
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G22 · ABS-MENU

- **Question:** Quel est le menu de la cantine de l'hôpital ?
- **Reference answer:** Alexa must say it has no source, and give no figure. *Automatic expected outcome.*
- **Source:** No source: the books don't hold this
- **Directly supported:** Expected abstention
- **Alexa found it:** Yes: no evidence returned
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G23 · STH-CLOZ-MOA

- **Question:** Quel est le mécanisme d'action de la clozapine au niveau des récepteurs ?
- **Reference answer:** Blocage des récepteurs D2 et 5HT2A ; des actions sur 5HT2C et 5HT1A et d’autres récepteurs peuvent contribuer. Le mécanisme d’efficacité chez les patients résistants reste inconnu. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Clozapine › Therapeutics › How the Drug Works, p. 558
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G24 · STH-LAMO-MOA

- **Question:** Quel est le mécanisme d'action de la lamotrigine sur les canaux sodiques ?
- **Reference answer:** Blocage dépendant de l’usage des canaux sodiques voltage-dépendants, sur la conformation ouverte, à un site de la sous-unité alpha. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Lamotrigine › Therapeutics › How the Drug Works, p. 1126
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G25 · STH-LITH-MOA

- **Question:** Quel est le mécanisme d'action du lithium sur les messagers intracellulaires ?
- **Reference answer:** Mécanisme inconnu et complexe. Il pourrait modifier la signalisation par les seconds messagers et inhibe l’inositol monophosphatase. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Lithium › Therapeutics › How the Drug Works, p. 1209. Aussi : Maudsley Prescribing Guidelines, 14e éd. › Chapter 2 › Mechanism of action, p. 247
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** Maudsley also stresses the uncertainty. No conflict seen.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G26 · STH-SERT-DOSE

- **Question:** Quelle est la posologie de la sertraline dans la dépression ?
- **Reference answer:** Début à 50 mg par jour, habituellement 50 à 200 mg par jour en une prise, maximum généralement 200 mg. Attendre en général quelques semaines avant d’augmenter, ou par paliers hebdomadaires de 50 mg. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Sertraline › Dosing and Use, p. 2073
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G27 · STH-VALP-DOSE

- **Question:** Quelle est la posologie du valproate dans la manie aiguë ?
- **Reference answer:** Adulte : début à 1000 mg par jour, augmentation rapide, maximum généralement 60 mg/kg par jour. Une charge orale de 20 à 30 mg/kg par jour peut raccourcir le délai d’action, surtout en hospitalisation. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Valproate › Dosing and Use, p. 2375
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** **Check:** this passage doesn't cover women of childbearing age. Should the answer carry a warning?
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G28 · STH-LAMO-RASH

- **Question:** Quels sont les effets indésirables graves de la lamotrigine ?
- **Reference answer:** Éruption cutanée grave, rare, risque peut-être plus élevé en pédiatrie. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Lamotrigine › Side Effects › Life-Threatening or Dangerous Side Effects, p. 1130
- **Directly supported:** Direct, possibly incomplete
- **Alexa found it:** Yes
- **To review:** The passage read holds one line. The section may list more.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G29 · STH-OLANZ-METAB

- **Question:** Quels sont les effets indésirables notables de l'olanzapine ?
- **Reference answer:** Risque probablement accru de diabète et de dyslipidémie ; également sensations vertigineuses, sédation, sécheresse buccale, constipation, prise de poids. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Olanzapine › Side Effects, p. 1624
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** **Defect:** common effects sit under a chunk labelled Life-Threatening. The label may be wrong.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G30 · STH-CLOZ-PREC

- **Question:** Quelles précautions d'emploi avec la clozapine ?
- **Reference answer:** Surveiller le transit. Éviter l’association aux agents neutropéniants. Myocardite dans les 6 premières semaines, cardiomyopathie plus tardive. Prudence : glaucome, hypertrophie prostatique, hypotension, dérégulation thermique, chutes. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Clozapine › Dosing and Use › Other Warnings/Precautions, p. 578
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** The passage starts mid-list. Earlier items may be missing.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G31 · STH-ARIP-MOA

- **Question:** Comment agit l'aripiprazole ?
- **Reference answer:** Agonisme partiel des récepteurs dopaminergiques D2. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Aripiprazole › Therapeutics › How the Drug Works, p. 175
- **Directly supported:** Direct, partial coverage
- **Alexa found it:** Yes
- **To review:** The rest of the mechanism wasn't read.
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G32 · STH-HALO-EPS

- **Question:** Quels sont les effets indésirables notables de l'halopéridol ?
- **Reference answer:** Akathisie, parkinsonisme, dyskinésie et dystonie tardives, galactorrhée, aménorrhée ; aussi sensations vertigineuses, sédation, sécheresse buccale, constipation, rétention urinaire, vision floue. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Haloperidol › Side Effects › Notable Side Effects, p. 1029
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G33 · STH-LITH-TESTS

- **Question:** Quelle surveillance pour le lithium ?
- **Reference answer:** Avant : fonction rénale et thyroïdienne, ECG après 50 ans, poids et IMC. Ensuite : lithémie à la vallée (environ 12 h après la dernière prise), toutes les 1 à 2 semaines jusqu’à la cible, puis tous les 2 à 3 mois les 6 premiers mois. Fonction rénale 1 à 2 fois par an. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Lithium › Therapeutics › Tests, p. 1211
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** **Conflict:** target levels differ from Maudsley (see TAY-LITHIUM-CIBLE).
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G34 · ABS-STAHL-PRIX

- **Question:** Quel est le prix de la clozapine en Algérie ?
- **Reference answer:** Alexa must say it has no source, and give no figure. *Automatic expected outcome.*
- **Source:** No source: the books don't hold this
- **Directly supported:** Expected abstention
- **Alexa found it:** Yes: no evidence returned
- **Dataset:** `knowledge.books-v4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G35 · A-S03 (set 4)

- **Question:** La fluoxétine pendant la grossesse ?
- **Reference answer:** Pas d’étude contrôlée. Généralement déconseillée, surtout au premier trimestre, mais la poursuite peut être nécessaire. Peser le risque du traitement contre celui de l’absence de traitement. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Fluoxetine › Special Populations › Pregnancy, p. 899
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **To review:** US labelling context.
- **Dataset:** `fr-en-answers-holdout-4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G36 · A-S08 (set 4)

- **Question:** L'escitalopram chez le sujet âgé ?
- **Reference answer:** Risque de SIADH plus élevé et hyponatrémie rare, surtout chez le sujet âgé. Risque de suicidalité réduit par rapport au placebo après 65 ans. **NOT CLINICALLY APPROVED**
- **Source:** Prescriber's Guide (Stahl), 7e éd. › Escitalopram › Special Populations, p. 800 ; Side Effects, p. 794
- **Directly supported:** Partial
- **Alexa found it:** Partly
- **To review:** **Defect:** the passage is labelled Children and Adolescents. "10 mg/day" appears near this text, but I can't tell if it applies to the elderly, so it's left out. Please check.
- **Dataset:** `fr-en-answers-holdout-4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G37 · A-M01 (set 4)

- **Question:** Que faire en cas de dyskinésie tardive ?
- **Reference answer:** *None. Not established from the passages read.* **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 1 › Treatment of tardive dyskinesia, from p. 117
- **Directly supported:** Not established
- **Alexa found it:** Partly: section found, only its opening sentence shown
- **To review:** Treatment content wasn't read. Please read from p. 117.
- **Dataset:** `fr-en-answers-holdout-4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G38 · A-M03 (set 4)

- **Question:** Que faire devant une dépression résistante ?
- **Reference answer:** Les stratégies recommandées comprennent l’augmentation (résumé NICE). Le détail n’a pas été lu. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 3 › Official guidance, p. 306 ; Management of treatment-resistant depression, p. 317 to 321
- **Directly supported:** Partial
- **Alexa found it:** Partly
- **To review:** Only one fragment was read. Please confirm the section.
- **Dataset:** `fr-en-answers-holdout-4`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G39 · A-M01 (set 5)

- **Question:** Comment traiter un syndrome malin des neuroleptiques ?
- **Reference answer:** *None. Not established from the passages read.* **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd., section not located
- **Directly supported:** Not established
- **Alexa found it:** No: no evidence returned
- **To review:** A real retrieval failure on an emergency topic. Please give the page.
- **Dataset:** `fr-en-answers-holdout-5`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

### G40 · A-M03 (set 5)

- **Question:** Comment gérer une hyponatrémie sous antidépresseur ?
- **Reference answer:** Forme légère : restriction hydrique possible ; augmenter les apports sodés est peu pratique. Si les symptômes persistent, arrêter l’antidépresseur. **NOT CLINICALLY APPROVED**
- **Source:** Maudsley Prescribing Guidelines, 14e éd. › Chapter 3 › Treatment, p. 394
- **Directly supported:** Direct
- **Alexa found it:** Yes
- **Dataset:** `fr-en-answers-holdout-5`
- **Dr. Larbi:** ☐ Correct ☐ Partly correct ☐ Incorrect. Correct source and page: ______ Comment: ______

