# Provenance des artefacts desktop — contrôle en lecture seule

**Observé le 2026-11-06.** Aucun fichier privé de configuration, secret, journal opérationnel ou contenu patient n'a été ouvert. Ces observations ne prouvent pas quel processus est actif, quelle base il utilise, ni que la provenance déclarée dans un manifeste correspond intégralement au code exécuté.

| Élément | Installation sous Program Files | Paquet `dist/doctor-next/win-unpacked` |
|---|---|---|
| Présence | `C:\Program Files\MindCare OS` existe | `C:\MindCare\alexa-v8-final\dist\doctor-next\win-unpacked` existe |
| Archive Electron | `resources/app.asar`, 253 035 octets | `resources/app.asar`, 254 853 octets |
| SHA-256 de l'archive, début observé | `D9A5645E1E35D97DCF49693F6F53DA719D90909994…` | `D97998846D4BDA5174FC4FB5ED40FD108574BB9116…` |
| Manifeste serveur | `resources/serveur/alexa-build.json` | `resources/serveur/alexa-build.json` |
| Commit déclaré | `93bf18559f2f68033eb2c39c5548277fc51a6767` | même commit déclaré |
| Build ID déclaré | `RHqoqPUy2tHipV3FwdROM` | `4REMp6aNEWbdV6FVq3HJm` |
| Empreinte de sources déclarée | `0d253276542b3e86798446cf522f6076d7e9f91f9483e24367938da360eb5f6f` | `8bfb39cd33d286696bd9be8babc47ae92078181141b1209c1e10250d003525a4` |
| Champ `native` du manifeste | `true` | `true` |

Le checkout audité a HEAD `b4bd811` et des modifications non commises ; il ne peut pas être assimilé à ces artefacts sur la seule base de leur nom. Les tailles et empreintes diffèrent entre les deux archives, et les manifestes diffèrent également par build ID et empreinte des sources déclarées. `native: true` décrit le manifeste du build ; il ne prouve pas que la branche native est activée par la configuration effective ou que le modèle démarre correctement.

L'installation contient les dossiers `alexa`, `cabinet`, `pgsql`, `serveur`, `snapshot` et `voix`; leur présence ne prouve pas intégrité, compatibilité ou état d'utilisation. Le paquet `dist` contient `initdb.exe`, `pg_ctl.exe` et `psql.exe`. Docker n'était pas joignable lors de `docker info` (pipe moteur absent). Aucune base ni service n'a été démarré ; l'existence des binaires ne constitue pas une autorisation de modifier la base réelle.

Le binaire `dist/doctor-next/win-unpacked/resources/pgsql/bin/postgres.exe --version` a répondu **PostgreSQL 16.15**. Cela identifie uniquement ce binaire de paquet, pas une instance en cours ni la version utilisée par l'installation sous Program Files. `scripts/lib/alexa-package-integrity.mjs` construit une preuve contenant commit, empreinte de sources et build ID, et vérifie leur correspondance lors de son contrôle ; ce contrôle complet n'a pas été exécuté sur ces deux artefacts dans cette session.

**À vérifier ultérieurement :** identité du processus et du binaire réellement lancés, empreintes intégrales des composants pertinents, correspondance source/build, état des migrations et configuration effective sous une forme expurgée, données de référence synthétiques et fonctionnement après démarrage. Le user devra choisir l'artefact de livraison si plusieurs versions restent candidates.
