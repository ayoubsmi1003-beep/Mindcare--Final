# M08 — Dossier de signature Taylor 2021 (Maudsley Prescribing Guidelines)

> À signer par la praticienne, une case par décision, avec identité + date.
> Aucun agent ne peut cocher. Tant qu'une case est vide, Taylor reste
> `FROZEN / PENDING_APPROVAL` et aucune promotion n'est exécutée.
> Référence : `M08-HUMAN-DECISION-GATE.md` (formulaire), `docs/00-DECISIONS.md`
> § M08 HUMAN DECISION GATE, paquet canonique
> `knowledge/canonical-v2/maudsley-prescribing-guidelines-2021-taylor-14e/sha256-14072b5bf1a74cd5aa754d7fbbfb8a9fd146cd77a49996676c5b5094c16cd9d0/`.

État vérifié du paquet (qa-report.json, gate7-qa-freeze-v1) : 978 pages
(886 vérifiées, 14 incertaines), 7 861 unités, 275 tables (248 vérifiées),
1 954 dossiers de dose, 0 erreur critique, 113/113 tests golden, 118 xrefs
non résolues, **6 253 items en revue manuelle requise**. Staging DB :
7 859 chunks `inactive`, source `reviewed`, version = sha canonique
(aucune activation, aucune mise en service).

Ce que la signature N'AUTORISE PAS : activation d'autres livres, libération
des preuves médicamenteuses (G7 distinct, ADR-040), mise en production
clinique sans la vérification de promotion qui suit.

---

## D1 — Instrument d'approbation

**Question.** L'approbation vaut-elle par ligne source seule, dossier
lisible seul, ou les deux ?
**Preuves.** Précédent DSM-5 : acte source-row (`statut→active` +
`approved_at/by` + revue + échéance), chargeur fail-closed. Les portes
ne lisent que la ligne.
**Recommandation : C — les deux.** La ligne est l'autorité machine, le
dossier est ce que vous relisez dans 2 ans.
**Conséquence.** Sans ligne : rien ne s'active. Sans dossier : activation
techniquement valide mais inauditable par un humain.
**Coût.** ~30 min (un fichier + une ligne horodatée).
**Décision : [ ] A [ ] B [ ] C — Signataire : ________ Date : ________**

## D2 — Admission de l'anglais

**Question.** Admettre Taylor `en` ? Si oui, élargir les contraintes ou
tables EN isolées ?
**Preuves.** Triple blocage prouvé (CHECK 092 ×2, union `Langue`,
`validerLignePorte`). ADR-038 avait tranché l'élargissement additif mais
sa migration 100 a été supprimée : à re-trancher.
**Recommandation : A — élargissement additif** (CHECK + union TS +
validateur ; fr/ar/darija inchangés).
**Conséquence.** B duplique porte/chargeur/gate pour un livre. C rend
Taylor impromouvable définitivement.
**Coût.** Une migration 0NN additive + 3 alignements TS ; pas de refonte.
**Décision : [ ] A [ ] B [ ] C — Signataire : ________ Date : ________**

## D3 — Atterrissage de la provenance

**Question.** UNE architecture pour unités/pages/tables à l'interrogation :
A. étendre 092 / B. projection 0NN / C. jointure canonique à la réponse.
**Preuves.** 092 ne peut pas porter ce grain (prouvé). 100–107 absents des
migrations déployables (D7).
**Recommandation : B — projection 0NN** (lignes unit+span ; la plus fidèle ;
amortie sur les 5 livres restants).
**Conséquence.** A est plus rapide mais casse la liaison de revue au grain
record. C exige une preuve de parité d'autorité non écrite.
**Coût.** Le plus élevé des trois (migration + projection chargeur + format
de citation) ; c'est le prix de la fidélité des doses.
**Décision : [ ] A [ ] B [ ] C — Signataire : ________ Date : ________**

## D4 — Contrat de chunking

**Question.** Chunker + version : v1 / v1.1 / nouveau contrat versionné
suivant les unités.
**Preuves.** v1/v1.1 déchiquettent unités et perdent pages + liaison de
revue (prouvé) ; v2 est DSM-5-only ; le staging actuel
(`taylor-units-v1-proposed`, 7 859 chunks inactifs) est PROPOSÉ, non approuvé.
**Recommandation : C — nouveau contrat versionné suivant les unités.**
**Conséquence.** A/B = revue au grain record perdue au chunking ; C exige
amendement de recette + suite de déterminisme (dans le prolongement de
taylor-d2).
**Coût.** Amendement + preuve ; sans lui, D6 est invérifiable.
**Décision : [ ] A [ ] B [ ] C — Signataire : ________ Date : ________**

## D5 — Suite golden EN

**Question.** Autorité, périmètre (miroir v2 ou suite séparée), seuils
(wrong-dose 0 % repris), cross-encoder requis ou non.
**Preuves.** Schéma v2 + seuils ADR-037 + harnais lecture-seule existent ;
zéro cas EN aujourd'hui.
**Recommandation : suite EN séparée, miroir de la structure v2**
(~10–15 cas : doses citées, codes, no-answer EN, cross-lingue), wrong-dose
0 %, harnais existant réutilisé.
**Conséquence.** Sans suite EN : aucune allégation d'évaluation EN (interdit).
**Coût.** Faible (pattern M10 éprouvé : fixtures + rubric + rescore 0-appel).
**Décision (périmètre + seuils) : ________________ — Signataire : ________ Date : ________**

## D6 — Gouvernance de la revue (~6,2k items)

**Question.** Sign-off par item / par classe + échantillonnage / par source ;
identité du relecteur ; persistance ; re-revue/quarantaine.
**Preuves.** File = listes d'IDs pré-chunk (doses, contre-indications,
interactions, monitoring, seuils, tables, algorithmes, segments, pages,
traits d'union, conflits) ; aucun état de revue modélisé en base.
**Recommandation : sign-off par classe + échantillonnage déclaré**
(les 6 253 items un par un sont infaisables ; échantillon déclaré +
re-revue des classes dose/contre-indication à 100 % : 1 954 + 148).
**Conséquence.** Échantillon non déclaré = approbation invalide (interdit).
**Coût.** Votre temps de relecture sur ~2,1k items critiques + échantillon ;
outillage workflow minimal à prévoir.
**Décision : ________________ — Signataire : ________ Date : ________**

## D7 — Relation au workstream 100–107

**Question.** A. converger / B. réutiliser le modèle uniquement /
C. diverger formellement.
**Preuves.** 100–107 absents des migrations déployables ; présents comme
spec ; restauration interdite sans ADR.
**Recommandation : B — réutiliser le modèle uniquement.** Ni restauration
sauvage (A), ni divergence aveugle (C) : le modèle de lots/sorties est repris,
les migrations sont réécrites propres en 0NN.
**Conséquence.** A restaure du supprimé ; C réinvente.
**Coût.** Nul à la signature ; discipline d'exécution ensuite.
**Décision : [ ] A [ ] B [ ] C — Signataire : ________ Date : ________**

## D8 — « Approval by context »

**Question.** A. accepté par règle formelle / B. explicitement répudié.
**Preuves.** Contradiction interne au dépôt (revendication vs déni de
signature) ; la Constitution exige actes signés et preuve non supposée.
**Recommandation : B — répudié.** Seul l'instrument D1 vaut approbation ;
aucun contexte (chat, commentaire, ancien rapport) ne vaut signature.
**Conséquence.** A rouvrirait chaque décision à l'interprétation.
**Coût.** Une phrase ci-dessous.
**Décision : [ ] A [ ] B — Signataire : ________ Date : ________**

---

## Après signature : exécution (agents, dans l'ordre)

1. Migration(s) 0NN selon D2+D3 (+ D4 si nouveau contrat).
2. Projection chargeur + citation selon D3 (+ amendement recette/déterminisme D4).
3. Revue D6 (outillage + relecture), golden EN D5.
4. Vérification de promotion (gate H) : parité, déterminisme, rescore 0-appel.
5. Promotion = acte D1 (ligne + dossier), puis seulement : activation.

Renvoyez ce fichier avec les 8 cases cochées + identité + dates, ou une
photo lisible des pages signées. Sans les 8 : rien ne bouge.
