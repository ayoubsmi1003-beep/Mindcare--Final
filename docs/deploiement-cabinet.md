# Déploiement MindCare — une application, un cabinet

Le même `MindCare Setup <version>.exe` est installé sur le PC médecin et les autres postes. Le rôle appartient au compte authentifié, pas à l'installateur ni au PC. Une assistante peut aussi se connecter sur le PC médecin avec ses propres droits.

Le PC médecin héberge un service PostgreSQL 16 en boucle locale, une tâche Windows indépendante qui lance le backend Next et son transport HTTPS, et l'application Electron. Les autres postes exécutent la même application; ils ne provisionnent aucune base. Le backend et les portes PostgreSQL/RLS restent les autorités. Aucun mécanisme de synchronisation n'existe.

## Première utilisation

Sur un cabinet neuf, ouvrir MindCare sur le PC médecin, puis choisir **Utiliser ce PC comme PC médecin**. L'application demande l'autorisation Windows et prépare automatiquement les services, le certificat et le pare-feu. La création du premier compte utilise l'écran existant de première configuration; aucun compte ni mot de passe universel n'est livré.

Sur un autre poste, ouvrir la même application. Elle trouve automatiquement le cabinet. Pour la première connexion seulement, utiliser **MindCare → Connecter un autre poste** sur le PC médecin, puis saisir l'invitation générée dans l'autre application. Cette invitation aléatoire expire après cinq minutes; elle établit la confiance dans le certificat. L'autorisation Windows installe cette confiance automatiquement. Ensuite, l'écran de connexion habituel apparaît. Aucun utilisateur ne copie une adresse, un certificat ou une empreinte.

Le choix PC médecin est explicite: l'absence d'un hôte ne prouve pas qu'il s'agit d'un nouveau cabinet. Une application déjà associée ne propose jamais de créer une autre base pendant une panne. En présence de plusieurs cabinets, l'invitation identifie celui voulu; aucun choix arbitraire n'est fait.

Les comptes supplémentaires doivent exister dans le cabinet. Cette version conserve le provisionnement des comptes existant; elle n'ajoute pas une nouvelle gestion du personnel.

## Démarrage et reprise

Windows démarre `mindcare-postgres` automatiquement. La tâche `MindCare-Clinic-Server` démarre au démarrage Windows et à l'ouverture de session, avec reprise après arrêt anormal. Elle vérifie les binaires, le cluster et l'intégralité des migrations avant de publier le service. Fermer la fenêtre Electron ne coupe pas le backend partagé.

Electron recherche le service local, vérifie l'identité déjà associée, le certificat exact et la santé HTTPS, puis charge l'application. Après connexion, `auth.verify_password`, les sessions opaques httpOnly et le profil de l'utilisateur déterminent l'interface; toutes les requêtes passent encore par les portes serveur/RLS existantes.

Lors d'une interruption, la fenêtre de travail est masquée par **Connexion au cabinet interrompue. Reconnexion…**. Les sondes et la redécouverte continuent sans créer de base, changer de cabinet ou rejouer d'écriture. Au retour du service, la fenêtre existante réapparaît avec sa session et ses saisies. Une requête métier qui avait échoué reste à relancer explicitement; aucune écriture incertaine n'est répétée automatiquement.

L'internet n'intervient dans aucune étape de découverte, de confiance, de connexion ou d'accès aux données. Les fonctions cloud restent indépendantes. Une coupure du réseau local ou l'arrêt du PC médecin rend le cabinet indisponible jusqu'à son retour.

## Transport et sécurité

Découverte UDP IPv4 locale, service `mindcare-clinic-v1`, multicast à TTL 1 et broadcasts des interfaces privées, avec réponses unicast à une requête aléatoire. L'annonce contient uniquement un identifiant d'installation persistant et l'origine HTTPS. Elle ne constitue jamais une preuve de confiance et ne contient ni dossier, ni compte, ni secret.

L'invitation contient 144 bits aléatoires. Un échange AES-256-GCM authentifié lie le certificat public, l'identité, l'origine et le défi du client. Les paquets sont bornés, la réponse ne vaut que pour la requête courante et les invitations sont limitées à cinq minutes. L'invitation n'accorde aucun accès clinique: les comptes et les sessions restent obligatoires.

Le certificat est généré sur le PC médecin. Sa clé privée et sa phrase de passe DPAPI restent dans le dossier privé protégé par ACL SYSTEM/Administrateurs. La confiance publique est installée par l'application via l'autorisation Windows. Le certificat épinglé doit aussi passer la validation normale Chromium/Windows; aucun `callback(0)`, `rejectUnauthorized:false` ou contournement d'erreur TLS n'est utilisé. Un changement de certificat échoue fermé et nécessite une reprise contrôlée.

Le proxy HTTPS a un unique upstream en boucle locale, impose Host/Origin, élimine les en-têtes de forwarding fournis par le client et conserve le streaming/SSE. Le premier provisionnement de compte est refusé depuis un autre PC. Les règles pare-feu autorisent seulement le programme MindCare et le sous-réseau local, sans demander de modifier le profil réseau Windows. PostgreSQL ne s'ouvre jamais au LAN.

## Installation et données

L'installateur ne contient aucun `base.dump` ni snapshot patient. Les binaires et le backend sont présents dans le paquet commun; seuls les postes explicitement choisis comme hôte les exécutent. Sur une base neuve, les migrations existantes sont appliquées, les fixtures sont retirées par les scripts/portes existants, puis l'environnement passe en `self-hosted`. Une initialisation interrompue laisse un marqueur bloquant; la tâche ne sert jamais une base partiellement initialisée. Le support doit reprendre ce cas sans supprimer de cluster existant.

Une mise à jour conserve `%ProgramData%\MindCare`, met à jour la tâche du même hôte et son certificat existant, et ne restaure aucune base. Une désinstallation préserve les données et les sauvegardes. Aucune migration déjà appliquée n'a été modifiée.

## Limites de qualification

Les tests logiciels et les sondes natives isolées ne remplacent pas l'installation propre, le redémarrage Windows, la résolution du nom du PC sur le vrai LAN, les deux comptes réels, le partage opérationnel sur deux PC, une coupure internet réelle et la reprise sur ces deux machines. Le rapport de livraison donne les preuves exécutées et les portes restant NOT RUN. Ne pas qualifier cette version de production-ready avant cette réception.
