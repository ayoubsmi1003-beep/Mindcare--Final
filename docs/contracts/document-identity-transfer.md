# Identité des documents : transfert contrôlé

L’identité est stockée dans `app.profiles` et `app.cabinets`, puis copiée dans le snapshot d’émission. Elle ne provient pas de localStorage. Le premier provisionnement (084) ne renseigne ni les spécialités ni le nom arabe ; 131 verrouille ensuite ces champs dans les paramètres ordinaires. Deux bases distinctes peuvent donc avoir des identités différentes sans perte dans React. La différence exacte de l’installation existante n’a pas été vérifiée ici.

La migration 225 ajoute une porte **administrative seulement**, `provision_document_identity(uuid,uuid,jsonb)`. Elle verrouille les cibles, exige une identité complète, conserve toutes les valeurs non vides et refuse chaque conflit. Elle ne déplace aucun compte, document ou patient. Les portes ordinaires restent verrouillées. Les mises à niveau ne doivent ni reprovisionner les comptes ni restaurer un snapshot sur une base existante.

## Opération ultérieure, non exécutée dans cette mission

Après validation de la source et de la cible par l’administrateur, fournir localement les variables PGHOST, PGPORT, PGDATABASE, PGUSER et PGPASSWORD, sans les imprimer. Aucun `.env` n’est chargé par l’outil. Le répertoire `%ProgramData%\MindCare\private` doit déjà exister avec ses ACL protégées ; aucun dossier de Downloads ou du dépôt n’est accepté.

`node scripts/transfer-document-identity.mjs export <fichier-privé> <profil-UUID> <cabinet-UUID>` exporte seulement l’identité professionnelle explicitement sélectionnée. Le fichier doit être nouveau et nommé `document-identity.json` (ou `document-identity-<suffixe>.json`) ; une identité incomplète est refusée. Après inspection locale, l’export peut recevoir les deux libellés approuvés de la référence dans `identity.practitioner.document_footer.facebook_label` et `instagram_label`. L’adresse configurée reste dans `identity.cabinet.address`, séparée par un retour à la ligne pour ses deux lignes. Aucune valeur personnelle n’est livrée dans les sources.

Sur la cible administrative explicitement configurée : `node scripts/transfer-document-identity.mjs import <fichier-privé> <profil-UUID> <cabinet-UUID>`. Les UUID doivent correspondre exactement au fichier ; aucune correspondance par nom ou remplacement automatique n’est permis. Un conflit nécessite une décision locale ; il ne déclenche aucune écriture partielle. La complétude et le rendu doivent ensuite être vérifiés avant émission. Ce transfert ne modifie jamais les snapshots historiques.

## Catalogue de référence

La migration 224 contient uniquement le catalogue de référence non clinique : 15 661 lignes source, 15 645 désignations canoniques distinctes. Elle est produite par `node scripts/prepare-medication-reference.mjs`, sans lecture de configuration, connexion, build ni snapshot. Son import passe uniquement par l’application contrôlée des nouvelles migrations, après sauvegarde/validation du futur paquet. Les conflits d’empreinte conservent les UUID et valeurs existants. Aucun import n’a été exécuté sur le cabinet pendant cette mission.

## Identité de la référence explicitement approuvée

`resources/documents/cabinet-letterhead.json` centralise uniquement l’identité professionnelle publique confirmée le 14 novembre 2026 : médecin, coordonnées et les deux libellés sociaux. Aucun patient, secret ou identifiant de base n’y figure. Le libellé « Pychiaterie » reprend littéralement l’image fournie. Les composants ne contiennent aucune identité personnelle en dur.

Pour préparer ultérieurement cette identité : `node scripts/transfer-document-identity.mjs reference <fichier-privé> <profil-UUID> <cabinet-UUID>`. Cette commande ne se connecte à aucune base. L’import reste une opération administrative explicite, conserve les valeurs existantes et refuse les conflits ; la préparation et l’import ne sont pas exécutés sur l’installation actuelle dans cette mission. Le moteur d’émission continue de lire l’identité configurée en base et de la figer, sans repli qui masquerait une identité incomplète.
