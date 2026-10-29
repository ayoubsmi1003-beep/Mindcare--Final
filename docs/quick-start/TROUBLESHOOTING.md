# Dépannage — MindCare OS deux postes

> Avant toute action : ne désinstallez pas, ne supprimez pas `%ProgramData%\MindCare`,
> ne modifiez pas un fichier de configuration et ne lancez pas de SQL.
> Ces gestes peuvent détruire des données patients.

## Tableau des symptômes

| Symptôme exact | Cause probable | Action |
|---|---|---|
| « Recherche du cabinet MindCare… » figé, sans compteur | Processus bloqué au démarrage | Fermer la fenêtre, relancer MindCare. Si cela se reproduit, ouvrir les journaux et contacter le support. |
| « Cabinet MindCare introuvable sur le réseau local » sur le PC accueil | PC médecin éteint ; multicast/broadcast filtré ; réseau invité ; AP isolation ; pare-feu | Vérifier que le PC médecin est allumé et MindCare ouvert. Vérifier le même réseau. Utiliser « Le cabinet n'apparaît pas ? » → nom du PC médecin. Si le réseau est « Public » ou « invité », demander au support. |
| « Connexion interrompue. Vérifiez l'invitation et réessayez. » | Code expiré (5 min) ou déjà utilisé | Générer un nouveau code sur le PC médecin. |
| « Ce poste a été révoqué par le médecin » | Révocation volontaire | Nouveau code sur le PC médecin, puis reconnecter le poste. |
| « L'autorisation de ce poste doit être renouvelée » | Fichier de confiance illisible ou scellé par un autre compte Windows | Nouvelle invitation. Aucune donnée patient n'est supprimée. |
| « Le service du cabinet ne répond pas sur ce PC » (PC médecin) | Service arrêté, port occupé, migration incomplète | « Ouvrir les journaux », puis support. Ne pas réinstaller à l'aveugle. |
| « Windows a refusé la configuration » | Dossier d'installation modifiable par un utilisateur ordinaire | Installer dans `C:\Program Files\MindCare OS`. |
| Le PC médecin a été remplacé | Nouveau certificat : la reconnexion automatique est impossible, c'est voulu | Sur le PC accueil : « Reconnecter ce poste », puis nouvelle invitation. |
| Le réseau Windows est classé « Public » | Le pare-feu du cabinet n'ouvre que les profils Domaine/Privé | Support : passer ce réseau en « Privé » (réseau de confiance). Ne pas désactiver le pare-feu. |
| « Sauvegarde non configurée » | Le support n'a pas encore initialisé les secrets de maintenance | Contacter le support avant toute mise à jour. |
| Les deux PC sont sur un Wi-Fi « invité » | Le routeur isole les clients (AP isolation) | Utiliser le réseau principal du cabinet ou un câble Ethernet. |

## Ce que le support peut lire

- `%ProgramData%\MindCare\logs\clinic-task.log` (service du cabinet).
- `%APPDATA%\MindCare\` (journaux du poste, lisibles par l'utilisateur).
- Le rapport de diagnostic exporté depuis **Paramètres → Cabinet & postes**.
- Le statut de la tâche `MindCare-Clinic-Server` et des règles du groupe
  `MindCare OS Clinique`.

## Ce que personne ne doit faire

- Supprimer `%ProgramData%\MindCare\data` ou `backups`.
- Changer le port 43118, 43117 ou 54333.
- Ouvrir PostgreSQL au réseau local.
- Réutiliser un code d'invitation.
- Copier `clinic-trust.json` d'un PC à l'autre : il est scellé par DPAPI et ne se
  déchiffre pas ailleurs.
