# Qualification deux PC — procédure de réception

À exécuter **une fois**, sur les deux vraies machines, avant de considérer le
cabinet comme prêt. Chaque étape se termine par un résultat observable. Si le
résultat attendu n'apparaît pas, la ligne correspondante du tableau §6 dit quoi
faire — ne pas improviser une réinstallation.

Notation : **PASS** (observé), **FAIL** (observé, contraire), **NOT RUN**
(non exécuté). Un « ça a l'air de marcher » n'est pas un PASS.

---

## 1. Préparation

| Élément | Attendu |
|---|---|
| Les deux PC | Même réseau local, même box, aucun des deux en « réseau invité » |
| Compte Windows | Un compte par PC, **administrateur** le temps de l'installation |
| Le paquet | `MindCare Setup <version>.exe`, **le même fichier** sur les deux PC (même empreinte SHA-256) |
| PC A | C'est le PC médecin : il garde la base, il doit rester allumé pendant les heures d'ouverture |
| Internet | Inutile. Le retirer volontairement fait partie des tests (§5) |

> Le rôle n'est **pas** porté par l'installateur : c'est le choix fait au premier
> lancement sur PC A, puis le compte utilisateur qui décide de ce que chacun voit.

---

## 2. PC A — PC médecin

1. Fermer MindCare s'il tourne. Lancer le Setup, accepter l'autorisation Windows.
2. Ouvrir **MindCare OS**.
   - Attendu : **« Recherche du cabinet MindCare… »**, puis **« Recherche 1 sur
     3… »** avec un indicateur qui tourne, puis — sur un cabinet neuf — le
     message **« Cabinet MindCare introuvable sur le réseau local »** et le
     bouton **« Utiliser ce PC comme PC médecin »**.
   - ⚠️ « Introuvable » est **normal ici** : aucun cabinet n'existe encore. Ce
     qui compte, c'est que le bouton d'hôte apparaisse après quelques secondes.
   - Ce n'est pas un blocage : l'écran avance tout seul. S'il reste sur
     « Recherche… » plus de 10 s **sans compteur**, c'est un FAIL (§6, ligne A).
3. Cliquer **« Utiliser ce PC comme PC médecin »** → confirmer dans la boîte de
   dialogue (« Ce PC va héberger la base du cabinet »).
   - Attendu : une autorisation Windows, puis **« Préparation du cabinet sur ce
     PC… »**. La première préparation peut prendre plusieurs minutes.
   - **Ne pas fermer** pendant cette étape.
4. Attendu ensuite : l'écran de **connexion** du cabinet apparaît, dans la même
   fenêtre. (Pas de fenêtre blanche, pas de fenêtre invisible.)
5. Se connecter avec le compte de la praticienne ; créer le compte d'accueil si
   le cabinet est neuf (**Paramètres → Cabinet & postes**).
6. Vérifier que les dossiers existants sont là (**Patients**). Aucune donnée ne
   doit avoir été déplacée ni supprimée par l'installation.

**PASS A** si : l'application s'ouvre, la praticienne voit ses dossiers, et la
base n'a pas été recréée.

---

## 3. PC B — poste d'accueil

1. Lancer **le même** Setup, accepter l'autorisation Windows.
2. Ouvrir **MindCare OS**.
   - Attendu : **« Recherche du cabinet MindCare… »**, puis
     **« Cabinet MindCare trouvé. Connectez ce poste avec une invitation du PC
     médecin. »**
   - Si le message est **« Cabinet MindCare introuvable sur le réseau local »**,
     voir §6, ligne B — c'est réparable sans réinstaller.
3. Sur PC A : **Paramètres → Cabinet & postes → Connecter un autre poste**
   (ou menu **MindCare → Connecter un autre poste**).
   - Un code de 24 caractères s'affiche, par groupes de quatre, valable 5 minutes.
   - La boîte indique aussi **« Nom de ce PC : … »** — c'est ce nom qu'on saisit
     si la découverte automatique échoue.
4. Sur PC B : saisir le code → **« Connecter ce poste »**.
   - Attendu : une autorisation Windows (une seule fois), puis
     **« Connexion au cabinet MindCare… »**, puis l'écran de connexion.
5. Se connecter avec le **compte d'accueil** (rôle `assistant`).
   - Attendu : le **tableau de bord d'accueil** (salle d'attente, retards,
     à encaisser, demandes). Pas d'onglets cliniques, pas de finances.

**PASS B** si : le poste se connecte sans qu'on ait saisi une adresse IP, un
certificat ou une empreinte.

---

## 4. Ce qui doit tenir tout seul ensuite

À exécuter dans cet ordre, sans rien reconfigurer :

| # | Geste | Attendu |
|---|---|---|
| 4.1 | Fermer puis rouvrir MindCare sur PC B | Retour direct à l'application (ou après un court « Connexion… »), **aucun code redemandé** |
| 4.2 | Redémarrer Windows sur PC B | Idem 4.1, sans intervention |
| 4.3 | Redémarrer Windows sur PC A, puis ouvrir MindCare sur PC A | Le cabinet revient ; PC B se reconnecte seul |
| 4.4 | Couper le Wi-Fi de PC B 30 s, le remettre | Bandeau **« Connexion au cabinet interrompue. Reconnexion… »**, puis retour seul |
| 4.5 | Couper le Wi-Fi de PC A 30 s | PC A continue de fonctionner en local ; PC B attend, puis revient |
| 4.6 | Redémarrer la box (les adresses changent) | Les deux postes se rejoignent seuls, sous ~45 s |
| 4.7 | Révoquer PC B (**Paramètres → Cabinet & postes**), puis le relancer | PC B affiche **« Ce poste a été révoqué par le médecin… »** et demande une nouvelle invitation |
| 4.8 | Débrancher Internet (câble WAN de la box) | Découverte, connexion, dossiers et agenda fonctionnent toujours |

**PASS 4** si les huit lignes passent sans qu'on touche à une IP, un fichier ou
un terminal.

---

## 5. Cloisonnement des rôles

Sur PC B, connecté en **accueil** :

| # | Vérification | Attendu |
|---|---|---|
| 5.1 | Fiche patient | Onglets **Vue d'ensemble, Rendez-vous, Documents** seulement — pas d'Historique, pas de Clinique, pas de Traitements |
| 5.2 | Barre latérale | Patients et Agenda seulement |
| 5.3 | Saisir `/finances` dans la barre d'adresse | Aucun montant affiché |
| 5.4 | Prendre un rendez-vous | Enregistré, visible immédiatement sur PC A |

**PASS 5** si aucune donnée clinique ni financière n'est atteignable depuis PC B.

---

## 6. Si quelque chose ne va pas

| # | Symptôme exact à l'écran | Cause probable | Action |
|---|---|---|---|
| A | « Recherche du cabinet MindCare… » figé, **sans compteur** | Processus bloqué au démarrage | Fermer la fenêtre, relancer. Si cela se reproduit : §7 |
| B | « Cabinet MindCare introuvable sur le réseau local » sur PC B | Multicast/broadcast filtrés par la box, ou PC A éteint | Vérifier que PC A est allumé et MindCare ouvert. Sinon : **« Le cabinet n'apparaît pas ? »** → saisir le **nom du PC médecin** (affiché sur PC A dans la boîte d'invitation) → **« Se connecter à ce PC »** |
| C | « Le service du cabinet ne répond pas sur ce PC » (PC A) | Le service a refusé de démarrer | **« Ouvrir les journaux »**, puis §7. Ne pas réinstaller à l'aveugle : le journal dit la cause |
| D | « Connexion interrompue. Vérifiez l'invitation et réessayez. » | Code expiré (5 min) ou déjà utilisé | Générer un nouveau code sur PC A |
| E | « Ce poste a été révoqué par le médecin » | Révocation volontaire | Nouveau code sur PC A |
| F | « L'autorisation de ce poste doit être renouvelée » | Fichier de confiance illisible | Nouvelle invitation (le poste se réapparie sans perte de données) |
| G | Le PC médecin a été **remplacé** | Nouveau certificat : aucune reconnexion automatique n'est possible (c'est voulu) | Sur PC B : **« Reconnecter ce poste »** puis nouvelle invitation |
| H | « Windows a refusé la configuration » | Dossier d'installation modifiable par un utilisateur ordinaire | Installer dans `C:\Program Files\MindCare OS` |

Rien de tout cela ne supprime de données patient. Les seules actions
destructrices du produit sont la révocation d'un poste et la désinstallation,
et aucune ne touche `%ProgramData%\MindCare`.

---

## 7. Diagnostic (à faire une fois, en administrateur)

Ouvrir **PowerShell en tant qu'administrateur** sur le PC concerné, puis :

```powershell
Get-ScheduledTask -TaskName 'MindCare-Clinic-Server' |
  Select-Object State, @{n='Dernier résultat';e={(Get-ScheduledTaskInfo 'MindCare-Clinic-Server').LastTaskResult}}

Get-Content "$env:ProgramData\MindCare\logs\clinic-task.log" -Tail 40

Get-NetTCPConnection -State Listen |
  Where-Object { $_.LocalPort -in 43117,43118,54333 } |
  Select-Object LocalPort, LocalAddress, OwningProcess

Get-NetFirewallRule -Group 'MindCare OS Clinique' |
  Select-Object DisplayName, Enabled, Direction, Action, Profile
```

Ce qu'il faut y lire :

- `Dernier résultat = 0` et `State = Running` : le service tourne.
- `Dernier résultat ≠ 0` : le service a échoué **avant** de servir ; les 40
  dernières lignes de `clinic-task.log` donnent le code (`STARTUP_REFUSED`,
  `BACKEND_UNEXPECTED_EXIT`, `HTTPS_START_FAILED`…).
- Aucune ligne sur 43118 : le proxy n'a pas démarré.
- Règle pare-feu `MindCare cabinet HTTPS` absente ou désactivée : relancer le
  Setup (il rejoue la configuration de l'hôte et recrée les deux règles).

---

## 8. À consigner

| Étape | Résultat | Preuve (heure, capture) |
|---|---|---|
| 2 — PC A s'ouvre sur la connexion | | |
| 3 — appairage PC B | | |
| 4.1 à 4.8 | | |
| 5.1 à 5.4 | | |

Tant que ce tableau n'est pas rempli, la mention « production-ready » ne doit pas
être employée : les tests unitaires et le paquet ne remplacent pas deux machines
réelles.
