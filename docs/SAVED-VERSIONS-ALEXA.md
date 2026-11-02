# Alexa V8/V9 — versions sauvegardées

Ce fichier fige les points de reprise. Il ne remplace ni les rapports de campagne
ni les preuves : il indique quel code correspond à quelle mesure.

## Dernière campagne complète

- Campagne : `adversarial-51e367b0-13c0-41d5-b10b-ed8758f4333b`
- Résultat : **129 PASS / 83 FAIL / 88 NOT_VERIFIED** sur 300.
- Base d'action : `alexa_eval_v9_actions_20261031`, écritures réelles puis rollback.
- Réponses capturées : `.eval-out/alexa-v8-upgrade/adversarial-51e367b0-13c0-41d5-b10b-ed8758f4333b.answers.jsonl`.

## Points de sauvegarde Git

| Tag | Commit | Contenu |
|---|---|---|
| `alexa-v8-129plus-20261102` | `92759d1` | Application sauvegardée après la campagne 129, avec le premier lot de corrections ciblées vérifiées depuis cette campagne. |
| `alexa-v8-current-20261102` | voir `git rev-parse alexa-v8-current-20261102` | Version courante de l'application, avec le lot suivant de corrections ciblées (abstention sur les faits invérifiables, comptes `tous statuts confondus`, comparaison de deux visites, etc.). Ce lot n'a pas encore été remesuré sur les 300 cas. |

La campagne 129 a été exécutée sur l'arbre de travail non commité de l'époque.
Le commit `92759d1` est la première sauvegarde source de cet état ; il contient
déjà les corrections ciblées appliquées juste après. Le bundle runtime exact de
la campagne reste dans
`.eval-out/alexa-v8-upgrade/runtime-bundles/51e367b0-13c0-41d5-b10b-ed8758f4333b/`.

## Archives transférables

- Dépôt complet (historique + tags) :
  `C:\MindCare\alexa-v8-129plus-20261102.bundle`
- Dépôt complet avec la version courante :
  `C:\MindCare\alexa-v8-current-20261102.bundle`
- Rapports et preuves (docs/reports, état de reprise, rapports de campagne) :
  `C:\MindCare\alexa-v8-129plus-evidence-20261102.tar.gz`

## Restauration dans une autre session

```powershell
git clone C:\MindCare\alexa-v8-current-20261102.bundle mindcare-alexa
cd mindcare-alexa
git checkout alexa-v8-current-20261102
pnpm install
```

Pour la sauvegarde 129+ :

```powershell
git checkout alexa-v8-129plus-20261102
```

Ne jamais copier `.env`, les secrets, ni les données du cabinet dans une archive
ou un dépôt. Les bases d'évaluation restent synthétiques et jetables.
