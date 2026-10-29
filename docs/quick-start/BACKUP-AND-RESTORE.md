# Sauvegarde et restauration — MindCare OS

## Emplacement

- Dossier : `%ProgramData%\MindCare\backups`.
- ACL : SYSTEM + Administrateurs. Les utilisateurs ordinaires ne peuvent pas le lire.
- Ne jamais le placer dans le dossier d'installation : une mise à jour ou une
  désinstallation ne doit pas l'emporter.

## Ce que contient une sauvegarde

- Un dump PostgreSQL au format personnalisé (`pg_dump -Fc`), pris **base en ligne**
  mais avec un instantané cohérent.
- Le script `scripts/sauvegarde.mjs` peut chiffrer le dump en AES-256-GCM à partir
  d'une phrase de passe fournie par l'environnement, puis le restaurer dans une base
  jetable et comparer les comptages. Une sauvegarde n'est déclarée valide que si elle
  a été relue.
- Le dump pré-mise à jour pris par le support est stocké dans le dossier protégé.
  Il doit être déplacé vers un support chiffré (BitLocker ou archive chiffrée) selon
  la procédure du cabinet.

## Avant une mise à jour

1. Le support arrête le service `MindCare-Clinic-Server` (la base reste en ligne).
2. Il prend un dump `pre-upgrade-<horodatage>.dump`.
3. Il restaure ce dump dans une base **clone jetable**, compte les lignes et vérifie
   que le nombre de patients et de profils est identique.
4. Il applique les migrations manquantes au clone, revérifie les comptages, puis
   applique à la production.
5. En cas d'échec, la production n'est pas modifiée ; le dump reste la référence.
   Aucune restauration automatique n'est faite sans décision humaine.

Cette procédure a été exécutée le **2026-10-28** : dump de 244 897 518 octets,
SHA-256 `5E5CEEDBB3FA793F102FD457FF71B8E8075F62FD5B56787481E7E81331E2E56B`,
restauration clone avec **1 559 patients** identiques, puis application de 38
migrations (`159_alexa_turn_lifecycle` → `194_alexa_consultation_scale_read`).

## Restauration (support uniquement)

1. Arrêter `MindCare-Clinic-Server` et vérifier qu'aucun client n'écrit.
2. Créer une base de restauration distincte ; ne jamais écraser la base de production
   sans sauvegarde préalable.
3. `pg_restore --exit-on-error` avec les rôles et privilèges d'origine.
4. Comparer les comptages (`app.patients`, `app.profiles`, `app.appointments`,
   `app.consultations`, `app.payments`, `app.documents`, `auth.users`).
5. Basculer la configuration vers la base restaurée, redémarrer le service, vérifier
   `GET /api/health`, puis la connexion médecin et accueil.
6. Conserver l'ancienne base et le dump jusqu'à validation écrite.

## Limites de cette version

- La sauvegarde **nocturne automatique** n'est pas encore activée. Le support la
  déclenche et vérifie la restauration.
- Le dump pré-mise à jour n'est pas chiffré par le script de sauvegarde standard ;
  il est protégé par l'ACL du dossier. Le support doit l'exporter vers un support
  chiffré pour la conservation hors site.
- Aucune sauvegarde ne remplace une copie hors site. Une panne du disque du PC médecin
  détruit à la fois la base et les sauvegardes locales si elles n'ont pas été exportées.
