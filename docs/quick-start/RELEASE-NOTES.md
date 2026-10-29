# MindCare OS — Notes de version

## Version

Voir `manifests/release-manifest.json` (version, date, empreintes).

## Ce qui change dans cette version

- **Confiance du poste d'accueil scellée par DPAPI** : `clinic-trust.json` n'est plus
  un JSON en clair. Le jeton de poste est chiffré par DPAPI de portée utilisateur via
  `safeStorage` d'Electron ; un fichier copié vers un autre compte Windows ne se
  déchiffre pas. Un ancien fichier en clair est migré au premier lancement.
- **Porte serveur sur les routes d'IA** : `/api/alexa/*` et `/api/jarvis/*` refusent
  désormais un compte `assistant` (403) au lieu de seulement masquer Alexa dans
  l'interface. La décision de rôle est lue en base ; les données cliniques restent
  protégées par les portes SQL et la RLS.
- **Mise à niveau vérifiée de la base** : la base du cabinet est passée de la
  migration `159_booking_time_preference` à `194_alexa_consultation_scale_read`
  après sauvegarde, restauration clone et comparaison des comptages.
- **Documentation** : démarrage rapide FR/AR, dépannage, sauvegarde/restauration.

## Données préservées

- **1 559 patients** avant et après la mise à niveau (le chiffre de 1 558 cité
  initialement correspond probablement à un dossier synthétique ou à un arrondi ;
  aucun dossier n'a été supprimé).
- 5 profils, 0 patient en attente.
- Sauvegarde pré-mise à jour : 244 897 518 octets, SHA-256
  `5E5CEEDBB3FA793F102FD457FF71B8E8075F62FD5B56787481E7E81331E2E56B`.
- Les identifiants des comptes médecin et accueil n'ont pas été modifiés.

## Vérifications exécutées

- Tests unitaires des modules de confiance scellée et de la porte IA.
- Test de stabilité de la fenêtre Electron.
- Restauration réelle du dump dans une base clone et comparaison des comptages.
- Application des 38 migrations au clone puis à la production, avec vérification des
  comptages avant/après.
- Build de l'application et vérification du paquet (`scripts/verifier-paquet.mjs`).
- Lancement de l'application décompressée (`win-unpacked`) et capture de l'écran de
  connexion.

## Limites connues

- L'installateur n'est **pas signé** (`forceCodeSigning: false`). Windows peut
  afficher un avertissement SmartScreen.
- La sauvegarde nocturne automatique n'est pas encore activée ; le support déclenche
  et vérifie la sauvegarde avant mise à jour.
- Le code d'appairage fait 24 caractères (144 bits) : sûr, mais long à recopier.
  Il est à usage unique et expire en 5 minutes.
- La qualification sur deux vraies machines (redémarrage Windows, changement d'adresse
  DHCP, coupure câble, réseau invité, pare-feu) reste à consigner dans
  `QUALIFICATION-DEUX-PC.md`.
- Aucune signature de code, aucun test sur VM Windows propre dans cette livraison.
