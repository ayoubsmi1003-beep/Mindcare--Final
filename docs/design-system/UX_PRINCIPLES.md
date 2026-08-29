# UX_PRINCIPLES — MindCare V2

## 1. Dix principes (soumis à CLAUDE.md)

1. **Workflow > interface.** Réduire charge cognitive doc → focus soin, pas l'inverse.
2. **Un écran = une question.** Dashboard : quoi faire maintenant ; Fiche : comprendre patient en <5s.
3. **Progressive disclosure.** 6 onglets fiche, un call workspace puis lazy ; rien de non demandé ne charge.
4. **Honnêteté radicale.** Vide explique pourquoi vide + comment remplir, pas illustration.
5. **Confirmation seulement irréversible.** Signer note, annuler RDV, émettre doc, action Jarvis — pas fixer tarif/créer patient.
6. **Une écriture = transaction.** Atomicité Postgres, audit même tx, pas promesse JS.
7. **Dégradation calme.** Offline = bandeau attention, lecture reste, écritures bloqué avec raison, pas vide+erreur simultanés.
8. **Répétabilité.** 5 états déclenchables à la demande, mesurés (100/400/500ms).
9. **Accessibilité sous stress.** Contraste, 36/44 cibles, clavier complet, réduit motion.
10. **Sans donnée fictive.** Fixtures `is_synthetic` en tx checkpoint uniquement, jamais seed livré.

## 2. Contract 5 états (`05-UX-CONTRACT`)

```
CHARGEMENT → squelette forme contenu, répond <100ms, >10s → ERREUR délai
VIDE → phrase ink-500 + action brand si existe (ex: "Aucun dossier… Créer")
ERREUR → 3 phrases: quoi passé / quoi préservé / quoi faire + [Réessayer]; remplace contenu; sans code PGRST
HORS LIGNE → bandeau permanent attention, lecture inchangée, écritures bloquées
CONTENU → donnée là
```

Règle exclusive : `erreur` et `vide` jamais simultanés.

```tsx
const SessionEcran = ({etat}) => {
  if (etat.offline) return <BandeauHorsLigne><ContenuLectureSeule/><BlocageRaison/></Bandeau>
  if (etat.loading) return <SqueletteForme/>
  if (etat.error) return <BannerError troisPhrases onRetry/>
  if (etat.empty) return <EtatVide phrase action/>
  return <Contenu/>
}
```

## 3. Verbes d'action (FR intégral, via `i18n/fr.ts`)

`Enregistrer · Signer la note · Démarrer la séance · Terminer · Générer le certificat · Confirmer · Fixer le tarif · Créer le dossier` (jamais `Soumettre/OK/Valider` seul).

## 4. Contenu clinique ne bouge pas (05 §8)

Valeur affichée change sec, pas de fade. Montant ne s'anime pas, carte confirmation non animée.

## 5. Test avant vert

1. Déclenche 5 états à la demande oui/non
2. Erreur remplace contenu
3. <100ms squelette
4. Aucune attente infinie
5. FR sans code/excuse
6. Irréversible confirme
