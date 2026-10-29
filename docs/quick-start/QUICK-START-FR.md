# MindCare OS — Démarrage rapide (PC médecin + PC accueil)

> Version concernée : voir `manifests/release-manifest.json`.
> Interface : français. Les deux PC doivent être sur le **même réseau du cabinet**,
> pas sur un réseau « invité ».

## Ce qu'il faut

- Deux PC **Windows 10 ou 11, 64 bits**.
- Le **même** fichier `MindCare Setup <version>.exe` sur les deux PC.
- Un compte Windows **administrateur** pour l'installation (une seule fois par PC).
- Le PC médecin doit rester allumé pendant les heures d'ouverture.

## PC médecin — première installation

1. Double-cliquez sur `MindCare Setup <version>.exe` et acceptez l'autorisation Windows.
2. Ouvrez **MindCare OS**.
3. Choisissez **« Utiliser ce PC comme PC médecin »**, puis confirmez.
4. Laissez **« Préparation du cabinet sur ce PC… »** se terminer. La première fois peut
   prendre plusieurs minutes. **Ne fermez pas** MindCare pendant cette étape.
5. Connectez-vous avec le compte du médecin.
6. Vérifiez que vos dossiers sont là : **Patients**.

Le PC médecin héberge la base du cabinet. Aucun autre PC ne crée de base.

## PC accueil — première installation

1. Installez **le même** fichier, puis ouvrez **MindCare OS**.
2. Attendez **« Cabinet MindCare trouvé »**.
3. Sur le **PC médecin** : **Paramètres → Cabinet & postes → Connecter un autre poste**.
   Un code de 24 caractères s'affiche, valable **5 minutes**.
4. Sur le **PC accueil** : saisissez le code, puis **« Connecter ce poste »**.
   Acceptez l'autorisation Windows : elle installe la confiance dans le certificat du
   cabinet. Cette autorisation n'a lieu qu'une fois.
5. Connectez-vous avec le **compte d'accueil**.

Le code est à **usage unique**. S'il est perdu ou expiré, générez-en un nouveau sur le
PC médecin. Ne le notez pas dans un fichier partagé.

## Ensuite, à chaque démarrage

Ouvrez simplement **MindCare OS**. Le poste retrouve le cabinet et se reconnecte seul.

- Si le PC médecin est éteint, l'accueil affiche **« Connexion interrompue. Reconnexion… »**
  et réessaie en arrière-plan. Aucune donnée n'est perdue.
- Un changement d'adresse du routeur ne demande **pas** un nouvel appairage.
- Le PC médecin reste utilisable même si l'accueil est éteint.

## Si le cabinet n'apparaît pas

1. Vérifiez que le PC médecin est **allumé** et que MindCare y est ouvert.
2. Vérifiez que les deux PC sont sur le **même réseau** (pas « invité »).
3. Sur l'écran d'appairage, cliquez **« Le cabinet n'apparaît pas ? »**, saisissez le
   **nom du PC médecin** (affiché dans la boîte d'invitation), puis
   **« Se connecter à ce PC »**.
4. Si Windows classe le réseau en **« Public »**, demandez au support de le passer en
   **« Privé »** pour ce réseau de cabinet. Ne désactivez jamais le pare-feu.

## Sauvegarde

- Le dossier des sauvegardes est `%ProgramData%\MindCare\backups`. Il est protégé
  (SYSTEM + Administrateurs). **Ne le supprimez jamais.**
- Une sauvegarde vérifiée est prise par le support **avant chaque mise à jour**.
- La sauvegarde nocturne automatique n'est pas encore activée dans cette version :
  le support la déclenche et vérifie la restauration. Voir
  `BACKUP-AND-RESTORE.md`.

## Support

Contact du cabinet : **____________________** (à compléter par le cabinet).

Ne modifiez jamais un fichier de configuration, ne lancez pas de commande SQL et ne
désinstallez pas le PC médecin pour « réparer » une connexion. Les journaux et le
diagnostic suffisent au support.
