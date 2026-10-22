# Déploiement MindCare — une application, un cabinet

Le même `MindCare Setup <version>.exe` est installé sur le PC médecin et les autres postes. Le rôle appartient au compte authentifié, pas à l'installateur ni au PC. Une assistante peut aussi se connecter sur le PC médecin avec ses propres droits.

Le PC médecin héberge un service PostgreSQL 16 en boucle locale, une tâche Windows indépendante qui lance le backend Next et son transport HTTPS, et l'application Electron. Les autres postes exécutent la même application; ils ne provisionnent aucune base. Le backend et les portes PostgreSQL/RLS restent les autorités. Aucun mécanisme de synchronisation de base n'existe : le second poste lit et écrit par l'API du cabinet.

## Première utilisation

Sur un cabinet neuf, ouvrir MindCare sur le PC médecin, puis choisir **Utiliser ce PC comme PC médecin**. L'application demande l'autorisation Windows et prépare automatiquement les services, le certificat et le pare-feu. La création du premier compte utilise l'écran existant de première configuration; aucun compte ni mot de passe universel n'est livré.

Le compte de l'accueil n'est pas créé par l'installateur. Sur une base de cabinet, les comptes de démonstration sont supprimés à l'initialisation : ouvrir **Paramètres → Cabinet & postes** sur le PC médecin, puis créer le compte de l'accueil (identifiant, nom, mot de passe). Ce compte porte le rôle `assistant` : identité, contact, rendez-vous, salle d'attente et paiements autorisés, jamais une note clinique.

Sur un autre poste, ouvrir la même application. Elle trouve automatiquement le cabinet. Pour la première connexion seulement, ouvrir **Paramètres → Cabinet & postes → Connecter un autre poste** sur le PC médecin : un code à huit caractères s'affiche. Le saisir dans l'autre application.

- Le code vaut **une seule fois** et expire après cinq minutes. Il est détruit dès qu'un poste l'utilise, et après cinq tentatives invalides.
- Le poste reçoit à cette occasion un **jeton de poste**, distinct du compte utilisateur, qui autorise la machine elle-même. Il est conservé chiffré par Windows (DPAPI) et joint à chaque requête.
- L'autorisation Windows demandée sur le poste d'accueil installe la confiance dans le certificat. C'est la seule élévation de privilèges du parcours d'appairage, et elle n'a lieu qu'une fois par poste.

Ensuite, l'écran de connexion habituel apparaît. Aucun utilisateur ne copie une adresse, un certificat ou une empreinte.

Le choix PC médecin est explicite: l'absence d'un hôte ne prouve pas qu'il s'agit d'un nouveau cabinet. Une application déjà associée ne propose jamais de créer une autre base pendant une panne. En présence de plusieurs cabinets, l'invitation identifie celui voulu; aucun choix arbitraire n'est fait.

Les comptes supplémentaires doivent exister dans le cabinet. Cette version gère un compte d'accueil par cabinet; la désactivation ferme immédiatement ses sessions.

## Démarrage et reprise

Windows démarre `mindcare-postgres` automatiquement. La tâche `MindCare-Clinic-Server` démarre au démarrage Windows et à l'ouverture de session, avec reprise après arrêt anormal. Elle vérifie les binaires, le cluster et l'intégralité des migrations avant de publier le service. Fermer la fenêtre Electron ne coupe pas le backend partagé.

Electron recherche le service local, vérifie l'identité déjà associée, le certificat exact et la santé HTTPS, puis charge l'application. Après connexion, `auth.verify_login`, les sessions opaques httpOnly et le profil de l'utilisateur déterminent l'interface; toutes les requêtes passent encore par les portes serveur/RLS existantes.

Lors d'une interruption, la fenêtre de travail est masquée par **Connexion au cabinet interrompue. Reconnexion…**. Les sondes et la redécouverte continuent sans créer de base, changer de cabinet ou rejouer d'écriture. Au retour du service, la fenêtre existante réapparaît avec sa session et ses saisies. Une requête métier qui avait échoué reste à relancer explicitement; aucune écriture incertaine n'est répétée automatiquement.

Si le nom réseau du PC médecin ne se résout plus après un changement d'adresse, le poste d'accueil redécouvre l'adresse courante et la rejoint sans toucher au certificat épinglé : le certificat, son nom et son SAN restent vérifiés. Aucun réglage réseau n'est demandé à l'utilisateur.

L'internet n'intervient dans aucune étape de découverte, de confiance, de connexion ou d'accès aux données. Les fonctions cloud restent indépendantes. Une coupure du réseau local ou l'arrêt du PC médecin rend le cabinet indisponible pour toute écriture jusqu'à son retour : les données déjà affichées restent lisibles, signalées comme non vérifiées, et le poste d'accueil ne valide jamais une opération qu'il n'a pas pu faire confirmer.

## Temps réel, messagerie et alerte

Le poste d'accueil reçoit les changements autorisés (agenda, arrivées, tarifs, encaissements, notifications) par un flux SSE authentifié, avec reprise exacte après coupure. Un sondage de secours continue si le flux tombe. Aucun événement n'est publié avant le COMMIT de la transaction correspondante.

La messagerie interne médecin ↔ accueil est un canal texte séparé des messages patients (WhatsApp/Facebook). Elle reste dans le cabinet. Un message n'est déclaré « remis » que lorsque l'autre poste l'a lu, et « lu » que lorsque son panneau a été ouvert.

Le bouton **Appeler la secrétaire** déclenche une alerte courte : notification Windows native et clignotement de la barre des tâches même fenêtre réduite, plus un carillon local. L'écran du médecin distingue « envoyé », « notification affichée » et « la secrétaire a répondu ». Il ne prétend jamais qu'un son a été entendu : seul l'accusé de l'accueil engage quelqu'un.

Un poste peut être révoqué à tout moment depuis **Paramètres → Cabinet & postes**. La révocation prend effet à la requête suivante du poste concerné, sans attendre l'expiration de sa session.

## Transport et sécurité

Découverte UDP IPv4 locale, service `mindcare-clinic-v1`, multicast à TTL 1 et broadcasts des interfaces privées, avec réponses unicast à une requête aléatoire. L'annonce contient uniquement un identifiant d'installation persistant et l'origine HTTPS. Elle ne constitue jamais une preuve de confiance et ne contient ni dossier, ni compte, ni secret.

L'invitation contient 144 bits aléatoires. Un échange AES-256-GCM authentifié lie le certificat public, l'identité, l'origine, le défi du client et le jeton du poste. Les paquets sont bornés, la réponse ne vaut que pour la requête courante, l'invitation est à usage unique et limitée à cinq minutes. L'invitation n'accorde aucun accès clinique: les comptes et les sessions restent obligatoires.

Le certificat est généré sur le PC médecin. Sa clé privée et sa phrase de passe DPAPI restent dans le dossier privé protégé par ACL SYSTEM/Administrateurs. La confiance publique est installée par l'application via l'autorisation Windows. Le certificat épinglé doit aussi passer la validation normale Chromium/Windows; aucun `callback(0)`, `rejectUnauthorized:false` ou contournement d'erreur TLS n'est utilisé. Un changement de certificat échoue fermé et nécessite une reprise contrôlée.

Le proxy HTTPS a un unique upstream en boucle locale, impose Host/Origin, élimine les en-têtes de forwarding fournis par le client et conserve le streaming/SSE. Le premier provisionnement de compte est refusé depuis un autre PC. Les routes d'administration des postes (invitation, liste, révocation) ne sont joignables que depuis la machine hôte. Les règles pare-feu autorisent seulement le programme MindCare et le sous-réseau local, sans demander de modifier le profil réseau Windows. PostgreSQL ne s'ouvre jamais au LAN.

## Installation et données

L'installateur ne contient aucun `base.dump` ni snapshot patient. Les binaires et le backend sont présents dans le paquet commun; seuls les postes explicitement choisis comme hôte les exécutent. Sur une base neuve, les migrations existantes sont appliquées, les fixtures sont retirées par les scripts/portes existants, puis l'environnement passe en `self-hosted`. Une initialisation interrompue laisse un marqueur bloquant; la tâche ne sert jamais une base partiellement initialisée. Le support doit reprendre ce cas sans supprimer de cluster existant.

Une mise à jour conserve `%ProgramData%\MindCare`, met à jour la tâche du même hôte et son certificat existant, et ne restaure aucune base. Un poste appairé avant l'ajout du jeton de poste doit être réappairé une fois. Une désinstallation préserve les données et les sauvegardes. Aucune migration déjà appliquée n'a été modifiée.

## Limites de qualification

Les tests logiciels et les sondes natives isolées ne remplacent pas l'installation propre, le redémarrage Windows, la résolution du nom du PC sur le vrai LAN, les deux comptes réels, le partage opérationnel sur deux PC, une coupure internet réelle et la reprise sur ces deux machines. Le rapport de livraison donne les preuves exécutées et les portes restant NOT RUN. Ne pas qualifier cette version de production-ready avant cette réception.
