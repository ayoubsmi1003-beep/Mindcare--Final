# 05 — UX CONTRACT
**Les états obligatoires de chaque écran, et la langue qui va avec.**
v1 — 2026-08-09 · complète `04-DESIGN-SYSTEM.md` · s'applique aux 6 sessions

> Ce document existe à cause d'une capture d'écran : `/finance` affichait
> **une erreur et un état vide en même temps**. Le message disait qu'une erreur
> s'était produite ; la liste en dessous disait qu'il n'y avait rien à encaisser.
> Les deux ne peuvent pas être vrais.
>
> **Un écran est dans exactement un état à la fois.** C'est tout ce que dit ce fichier,
> et c'est ce qui manquait.

---

## 1. LES CINQ ÉTATS — exclusifs, jamais superposés

```
CHARGEMENT   la donnée arrive              → squelette, jamais un spinner nu
VIDE         la donnée est arrivée, il n'y en a pas
ERREUR       la donnée n'est pas arrivée   → REMPLACE le contenu, ne s'ajoute pas
HORS LIGNE   la base est injoignable       → distinct de ERREUR
CONTENU      la donnée est là
```

**La règle qui manquait :** `erreur` et `vide` ne coexistent jamais. Si la requête a
échoué, on ne sait pas s'il y a des données — donc on n'affiche pas « aucune donnée ».

**Contrôle de checkpoint.** Pour chaque écran, les cinq états doivent être
**reproductibles à la demande** : couper le réseau, forcer une erreur, vider la table.
Un état qu'on ne sait pas déclencher est un état qu'on n'a pas écrit.

---

## 2. CHARGEMENT — le squelette, pas le spinner

Un spinner dit « attends ». Un squelette dit « voilà la forme de ce qui arrive ».
Le second est plus court à vivre, à durée identique.

```
[ ] L'écran répond en moins de 100 ms, même si la donnée arrive après
[ ] Le squelette a la FORME du contenu réel — même nombre de lignes, mêmes largeurs
[ ] Aucun décalage de mise en page quand la donnée remplace le squelette
[ ] Au-delà de 10 s : bascule en ERREUR avec le mot « délai », jamais un spinner infini
```

🔴 **Le spinner sans fin est interdit.** C'est le défaut constaté sur « Analyse en
cours… », qui tournait indéfiniment sans jamais dire que la clé n'était pas lue.
Toute attente a une fin, et cette fin est écrite.

---

## 3. VIDE — une phrase, une action

Jamais d'illustration (§9.8 du design system). Une phrase en `--ink-500`, une action
en teal quand elle existe.

| Écran | Phrase | Action |
|---|---|---|
| Patients | Aucun dossier ne correspond à cette recherche. | Créer un dossier |
| Agenda (jour) | Aucun rendez-vous aujourd'hui. | Nouveau rendez-vous |
| Salle d'attente | Personne n'attend pour le moment. | — |
| Finances (jour) | Aucun encaissement aujourd'hui. Les tarifs fixés en fin de séance apparaissent ici. | — |
| Documents | Aucun document émis pour ce patient. | Générer un certificat |
| Jarvis | — | — (le panneau vide dit ce qu'il sait faire) |
| Tableau de bord · consultation | Aucune consultation en cours. | Démarrer une séance |

> Une phrase d'état vide **explique pourquoi c'est vide**, pas seulement que c'est vide.
> « Aucun encaissement aujourd'hui » ne suffit pas ; « les tarifs fixés en fin de séance
> apparaissent ici » lui apprend comment ça se remplit.

---

## 4. ERREUR — trois phrases, dans cet ordre

```
1. CE QUI S'EST PASSÉ      en français, sans jargon, sans code
2. CE QUI A ÉTÉ PRÉSERVÉ   « aucune donnée n'a été modifiée » / « vos modifications
                             sont conservées localement »
3. QUOI FAIRE              une action, une seule
```

**Exemple conforme :**
```
Impossible d'enregistrer la note. La connexion à la base a été interrompue.
Vos modifications sont conservées localement.          [ Réessayer ]
```

**Interdits, sans exception :**
```
✗ « Une erreur inattendue s'est produite »   ← n'informe de rien
✗ « Oups ! »                                  ← un cabinet médical n'est pas une application de loisir
✗ un code technique visible (PGRST116, 42501)
✗ une excuse (« désolé »)
✗ un état vide affiché en dessous
```

> ⚠️ Le message doit être honnête **et** sans donnée patient. Le détail technique va
> dans le journal serveur (avec sa cause, V1.1), pas à l'écran. Et le journal ne porte
> jamais de nom (I5).

---

## 5. HORS LIGNE — un état à part entière

Le cabinet a du Wi-Fi qui tombe. Ce n'est pas une erreur, c'est une condition de
fonctionnement.

```
[ ] Bandeau permanent, calme, --attention-bg : « Connexion perdue. Reconnexion… »
[ ] La lecture déjà chargée reste affichée et LISIBLE
[ ] Toute écriture est bloquée avec la raison, jamais silencieusement perdue
[ ] Retour en ligne : le bandeau disparaît, aucune notification triomphale
```

---

## 6. LA CONFIRMATION — quand elle est obligatoire

| Action | Confirmation |
|---|---|
| Signer une note | **oui** — c'est irréversible (ADR-004) |
| Annuler un rendez-vous | **oui** |
| Émettre un certificat | **oui** — aperçu A4 avant émission |
| Toute action Jarvis en écriture | **oui** — carte, 400 ms (L2) |
| Fixer un tarif | non — corrigeable |
| Créer / modifier un patient | non — corrigeable |

**La règle :** on confirme ce qui ne se défait pas. Confirmer ce qui se corrige
apprend à cliquer sans lire, et détruit la valeur des confirmations qui comptent.

---

## 7. LA LANGUE — verbes d'action, jamais de jargon

**Le bouton nomme ce qu'il fait, et le message reprend le même verbe.**
`Signer la note` → *« Note signée. »* Toujours le même mot du début à la fin.

```
✅ Enregistrer · Signer la note · Démarrer la séance · Terminer la séance
   Générer le certificat · Confirmer · Fixer le tarif · Créer le dossier
✗ Soumettre · OK · Valider (seul) · Envoyer (sans objet)
```

**Aucune chaîne en dur.** Tout passe par le fichier de traduction (ADR-008), même
un message d'erreur, même un état vide.

---

## 8. CE QUI NE BOUGE JAMAIS — rappel du §8.3

Une donnée clinique affichée ne fait pas de fondu à la mise à jour : **elle change**.
Un montant ne s'anime pas. Le contenu d'une carte de confirmation ne s'anime pas.
Un aperçu de document ne s'anime pas.

> Une valeur qui s'anime pendant qu'on la lit est une valeur qu'on lit mal.

---

## 9. LE TEST, AVANT DE DÉCLARER UN ÉCRAN TERMINÉ

```
1. Je sais déclencher les 5 états à la demande            oui / non
2. L'erreur remplace le contenu, elle ne s'y ajoute pas    oui / non
3. L'écran répond en moins de 100 ms                       chronométré
4. Aucune attente n'est infinie                            vérifié
5. Chaque phrase est en français, sans code, sans excuse   relu
6. Ce qui est irréversible demande une confirmation        vérifié
```

Six oui, ou l'écran n'est pas terminé.
