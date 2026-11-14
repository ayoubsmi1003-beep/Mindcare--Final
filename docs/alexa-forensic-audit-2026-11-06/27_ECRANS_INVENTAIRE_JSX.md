# Écrans : inventaire syntaxique JSX

Extraction des éléments et gestionnaires JSX directs par analyse TypeScript de chaque `page.tsx`. Une présence n’établit ni visibilité pour un rôle, ni fonctionnement, ni contenu des composants imbriqués ; les conditions et les gestionnaires indirects restent à analyser manuellement. Les numéros de ligne sont ceux du code observé.

## `/agenda/[id]`

Source : `src/app/agenda/[id]/page.tsx`.

Composants JSX directs : `AppShell` (386) ; `BandeauHorsLigne` (403) ; `BarreActions` (606, 647, 674) ; `BlocErreur` (408, 429) ; `Bouton` (486, 497, 508, 607, 610, 648, 651, 679, 688, 703, 706) ; `Carte` (533) ; `ChampAgenda` (540, 541, 542, 546, 547, 548, 549, 553, 554) ; `ChampSelection` (586) ; `ChampTexte` (572, 579, 640) ; `ChampZoneTexte` (599) ; `EtatVide` (410) ; `LienBouton` (412, 715) ; `Statut` (401).

Gestionnaires déclarés sur les éléments JSX :

- ligne 389 : `AppShell` → `onDeconnexion`
- ligne 470 : `button` → `onClick`
- ligne 489 : `Bouton` → `onClick`
- ligne 500 : `Bouton` → `onClick`
- ligne 511 : `Bouton` → `onClick`
- ligne 566 : `form` → `onSubmit`
- ligne 576 : `ChampTexte` → `onChange`
- ligne 583 : `ChampTexte` → `onChange`
- ligne 589 : `ChampSelection` → `onChange`
- ligne 602 : `ChampZoneTexte` → `onChange`
- ligne 612 : `Bouton` → `onClick`
- ligne 629 : `form` → `onSubmit`
- ligne 643 : `ChampTexte` → `onChange`
- ligne 653 : `Bouton` → `onClick`
- ligne 679 : `Bouton` → `onClick`
- ligne 688 : `Bouton` → `onClick`
- ligne 703 : `Bouton` → `onClick`
- ligne 706 : `Bouton` → `onClick`

## `/agenda/nouveau`

Source : `src/app/agenda/nouveau/page.tsx`.

Composants JSX directs : `AppShell` (281) ; `BandeauHorsLigne` (288) ; `BarreActions` (492) ; `BlocErreur` (289) ; `Bouton` (306, 314, 366, 392, 434, 493) ; `ChampSelection` (448, 472) ; `ChampTexte` (328, 338, 348, 359, 455, 462) ; `ChampZoneTexte` (485) ; `LienBouton` (496).

Gestionnaires déclarés sur les éléments JSX :

- ligne 284 : `AppShell` → `onDeconnexion`
- ligne 292 : `form` → `onSubmit`
- ligne 310 : `Bouton` → `onClick`
- ligne 318 : `Bouton` → `onClick`
- ligne 331 : `ChampTexte` → `onChange`
- ligne 341 : `ChampTexte` → `onChange`
- ligne 351 : `ChampTexte` → `onChange`
- ligne 363 : `ChampTexte` → `onChange`
- ligne 366 : `Bouton` → `onClick`
- ligne 381 : `input` → `onChange`
- ligne 382 : `input` → `onKeyDown`
- ligne 392 : `Bouton` → `onClick`
- ligne 409 : `button` → `onClick`
- ligne 436 : `Bouton` → `onClick`
- ligne 451 : `ChampSelection` → `onChange`
- ligne 459 : `ChampTexte` → `onChange`
- ligne 466 : `ChampTexte` → `onChange`
- ligne 475 : `ChampSelection` → `onChange`
- ligne 488 : `ChampZoneTexte` → `onChange`

## `/agenda`

Source : `src/app/agenda/page.tsx`.

Composants JSX directs : `AppShell` (262) ; `BandeauHorsLigne` (222, 327) ; `BlocErreur` (223, 328) ; `BoutonPeriode` (291, 295, 299, 306, 314) ; `GrilleSemaine` (397) ; `LienBouton` (225, 267) ; `Link` (358) ; `Squelette` (238, 239, 332) ; `Statut` (379).

Gestionnaires déclarés sur les éléments JSX :

- ligne 265 : `AppShell` → `onDeconnexion`
- ligne 292 : `BoutonPeriode` → `onClick`
- ligne 296 : `BoutonPeriode` → `onClick`
- ligne 300 : `BoutonPeriode` → `onClick`
- ligne 307 : `BoutonPeriode` → `onClick`
- ligne 315 : `BoutonPeriode` → `onClick`
- ligne 433 : `button` → `onClick`

## `/connexion`

Source : `src/app/connexion/page.tsx`.

Composants JSX directs : `FondShaderVert` (90) ; `FormulaireConnexion` (98) ; `MarqueMindCare` (92).

Gestionnaires déclarés sur les éléments JSX :

- ligne 87 : `main` → `onPointerMove`
- ligne 88 : `main` → `onPointerLeave`
- ligne 99 : `FormulaireConnexion` → `onSubmit`

## `/consultation/[id]`

Source : `src/app/consultation/[id]/page.tsx`.

Composants JSX directs : `AppShell` (1621) ; `Badge` (1549) ; `BandeauHorsLigne` (1270, 1644) ; `BandeauPatient` (1343) ; `BarreActions` (1581) ; `BarreConsultation` (1715) ; `BlocErreur` (1271, 1288, 1323, 1690, 1780) ; `Bouton` (1274, 1290, 1325, 1340, 1531, 1582, 1585, 1692, 1782) ; `BoutonDictee` (1361, 1486) ; `Carte` (1546) ; `CarteAnalyseSeance` (1427) ; `CarteResumeCas` (1797) ; `Champ` (1417) ; `ChampTexte` (1567) ; `ChampZoneTexte` (1500, 1574) ; `ChronoSeance` (1664) ; `CockpitHeader` (1651) ; `CompteReboursVerrou` (1346) ; `EtatVide` (1303, 1337, 1539) ; `FocusSeance` (1460) ; `IndicateurEnregistrement` (1399, 1492) ; `LienBouton` (1306, 1639, 1671) ; `MesuresSeance` (1455) ; `NotesStructurees` (1356) ; `Onglets` (1702) ; `PanneauHistorique` (1773) ; `PanneauInfo` (314, 1518, 1679) ; `PanneauOnglet` (1755, 1772, 1778, 1824) ; `PanneauRendezVous` (1816) ; `PanneauTraitements` (1808) ; `PointDeSituation` (1804) ; `RailContexte` (1604) ; `SectionDocumentsPatient` (1825) ; `SectionEchelles` (1439) ; `SectionPliable` (1478, 1526) ; `Squelette` (1262, 1295, 1331, 1785) ; `TarifInline` (1732).

Gestionnaires déclarés sur les éléments JSX :

- ligne 1274 : `Bouton` → `onClick`
- ligne 1290 : `Bouton` → `onClick`
- ligne 1325 : `Bouton` → `onClick`
- ligne 1340 : `Bouton` → `onClick`
- ligne 1358 : `NotesStructurees` → `onChanger`
- ligne 1433 : `CarteAnalyseSeance` → `onAnalyser`
- ligne 1434 : `CarteAnalyseSeance` → `onAnnuler`
- ligne 1445 : `SectionEchelles` → `onInserer`
- ligne 1446 : `SectionEchelles` → `onEchelleEnregistree`
- ligne 1457 : `MesuresSeance` → `onMesurer`
- ligne 1463 : `FocusSeance` → `onChanger`
- ligne 1468 : `FocusSeance` → `onLibre`
- ligne 1472 : `FocusSeance` → `onAppliquer`
- ligne 1503 : `ChampZoneTexte` → `onChange`
- ligne 1531 : `Bouton` → `onClick`
- ligne 1571 : `ChampTexte` → `onChange`
- ligne 1577 : `ChampZoneTexte` → `onChange`
- ligne 1582 : `Bouton` → `onClick`
- ligne 1587 : `Bouton` → `onClick`
- ligne 1606 : `RailContexte` → `onBasculer`
- ligne 1609 : `RailContexte` → `onCharger`
- ligne 1610 : `RailContexte` → `onReessayer`
- ligne 1624 : `AppShell` → `onDeconnexion`
- ligne 1692 : `Bouton` → `onClick`
- ligne 1705 : `Onglets` → `onChanger`
- ligne 1730 : `BarreConsultation` → `onVoirEchelles`
- ligne 1732 : `TarifInline` → `onEtatTarif`
- ligne 1782 : `Bouton` → `onClick`
- ligne 1799 : `CarteResumeCas` → `onEtatChange`
- ligne 1800 : `CarteResumeCas` → `onOuvrirSource`
- ligne 1801 : `CarteResumeCas` → `onGenerer`
- ligne 1813 : `PanneauTraitements` → `onRefresh`

## `/documents`

Source : `src/app/documents/page.tsx`.

Composants JSX directs : `AppShell` (19) ; `BlocErreur` (17) ; `DocumentsContent` (22) ; `DocumentWorkspace` (19) ; `Squelette` (16, 22) ; `Suspense` (22).

Gestionnaires déclarés sur les éléments JSX :

- ligne 19 : `AppShell` → `onDeconnexion`

## `/finances`

Source : `src/app/finances/page.tsx`.

Composants JSX directs : `AppShell` (272) ; `BandeauHorsLigne` (255, 287) ; `BlocErreur` (256) ; `CompositionV8` (439) ; `CourbesTypes` (422) ; `EvolutionV8` (435) ; `Icone` (505) ; `LienBouton` (258) ; `ModaleCharge` (374) ; `PanneauAttention` (448) ; `PanneauEtat` (323, 339, 360) ; `PanneauFinance` (416, 429, 438, 447) ; `PoulsV8` (408) ; `SelecteurPeriode` (276) ; `Squelette` (245) ; `TableauCharges` (341) ; `TableauSeances` (362) ; `TuilesEtRangees` (330).

Gestionnaires déclarés sur les éléments JSX :

- ligne 275 : `AppShell` → `onDeconnexion`
- ligne 276 : `SelecteurPeriode` → `onChange`
- ligne 306 : `button` → `onClick`
- ligne 325 : `PanneauEtat` → `onReessayer`
- ligne 339 : `PanneauEtat` → `onReessayer`
- ligne 343 : `TableauCharges` → `onAjouter`
- ligne 347 : `TableauCharges` → `onModifier`
- ligne 351 : `TableauCharges` → `onDesactiver`
- ligne 360 : `PanneauEtat` → `onReessayer`
- ligne 364 : `TableauSeances` → `onRecu`
- ligne 365 : `TableauSeances` → `onRelancer`
- ligne 378 : `ModaleCharge` → `onAnnuler`
- ligne 379 : `ModaleCharge` → `onEnregistrer`

## `/jarvis`

Source : `src/app/jarvis/page.tsx`.

Composants JSX directs : `AppShell` (108, 117) ; `BandeauHorsLigne` (97, 153) ; `BlocErreur` (98) ; `CarteConfirmation` (226) ; `FilJarvis` (204) ; `HeroAlexaLune` (176) ; `Icone` (147) ; `LienBouton` (100) ; `PastillesAlexaLune` (186) ; `SaisieAlexaLune` (179, 209) ; `Squelette` (90, 109, 204).

Gestionnaires déclarés sur les éléments JSX :

- ligne 108 : `AppShell` → `onDeconnexion`
- ligne 120 : `AppShell` → `onDeconnexion`
- ligne 141 : `button` → `onClick`
- ligne 181 : `SaisieAlexaLune` → `onEnvoyer`
- ligne 182 : `SaisieAlexaLune` → `onChangerSaisie`
- ligne 183 : `SaisieAlexaLune` → `onInterrompre`
- ligne 186 : `PastillesAlexaLune` → `onChoisir`
- ligne 211 : `SaisieAlexaLune` → `onEnvoyer`
- ligne 212 : `SaisieAlexaLune` → `onChangerSaisie`
- ligne 213 : `SaisieAlexaLune` → `onInterrompre`
- ligne 229 : `CarteConfirmation` → `onConfirmer`
- ligne 230 : `CarteConfirmation` → `onAnnuler`

## `/messages`

Source : `src/app/messages/page.tsx`.

Composants JSX directs : `AppShell` (303) ; `BadgeCanal` (364) ; `BadgeHandoff` (365) ; `BandeauHorsLigne` (152, 311) ; `BlocErreur` (153, 329) ; `Bouton` (316, 332, 369, 388, 397, 414, 427, 456, 482, 503, 532, 541, 550) ; `BulleMessage` (385) ; `ChampZoneTexte` (448) ; `EtatVide` (338, 360, 380) ; `LienBouton` (155) ; `LigneConversation` (343) ; `Link` (522, 559) ; `Section` (475, 495, 530) ; `Squelette` (164, 165).

Gestionnaires déclarés sur les éléments JSX :

- ligne 306 : `AppShell` → `onDeconnexion`
- ligne 321 : `Bouton` → `onClick`
- ligne 332 : `Bouton` → `onClick`
- ligne 346 : `LigneConversation` → `onChoisir`
- ligne 374 : `Bouton` → `onClick`
- ligne 393 : `Bouton` → `onClick`
- ligne 402 : `Bouton` → `onClick`
- ligne 419 : `Bouton` → `onClick`
- ligne 432 : `Bouton` → `onClick`
- ligne 451 : `ChampZoneTexte` → `onChange`
- ligne 461 : `Bouton` → `onClick`
- ligne 487 : `Bouton` → `onClick`
- ligne 508 : `Bouton` → `onClick`
- ligne 537 : `Bouton` → `onClick`
- ligne 546 : `Bouton` → `onClick`
- ligne 555 : `Bouton` → `onClick`

## `/observabilite`

Source : `src/app/observabilite/page.tsx`.

Composants JSX directs : `AppShell` (69, 91) ; `BlocErreur` (39, 59, 77) ; `Bouton` (61) ; `LienBouton` (41, 80) ; `PanneauObservabilite` (99) ; `Squelette` (50, 51).

Gestionnaires déclarés sur les éléments JSX :

- ligne 61 : `Bouton` → `onClick`
- ligne 72 : `AppShell` → `onDeconnexion`
- ligne 94 : `AppShell` → `onDeconnexion`

## `/`

Source : `src/app/page.tsx`.

Composants JSX directs : aucun.

Gestionnaires déclarés sur les éléments JSX :

Aucun détecté.

## `/parametres/cabinet`

Source : `src/app/parametres/cabinet/page.tsx`.

Composants JSX directs : `AppShell` (195, 204) ; `BlocErreur` (165, 185, 280) ; `Bouton` (187, 271, 322, 325, 330, 345, 360) ; `ChampTexte` (237, 243, 250) ; `LienBouton` (167) ; `PanneauInfo` (196, 277, 294) ; `Section` (218, 287) ; `Squelette` (176, 177, 223, 292).

Gestionnaires déclarés sur les éléments JSX :

- ligne 187 : `Bouton` → `onClick`
- ligne 195 : `AppShell` → `onDeconnexion`
- ligne 207 : `AppShell` → `onDeconnexion`
- ligne 240 : `ChampTexte` → `onChange`
- ligne 246 : `ChampTexte` → `onChange`
- ligne 253 : `ChampTexte` → `onChange`
- ligne 263 : `input` → `onChange`
- ligne 271 : `Bouton` → `onClick`
- ligne 322 : `Bouton` → `onClick`
- ligne 325 : `Bouton` → `onClick`
- ligne 334 : `Bouton` → `onClick`
- ligne 345 : `Bouton` → `onClick`
- ligne 360 : `Bouton` → `onClick`

## `/parametres/documents`

Source : `src/app/parametres/documents/page.tsx`.

Composants JSX directs : `AppShell` (15) ; `BlocErreur` (14) ; `Squelette` (13).

Gestionnaires déclarés sur les éléments JSX :

- ligne 15 : `AppShell` → `onDeconnexion`
- ligne 18 : `form` → `onSubmit`
- ligne 18 : `input` → `onChange`

## `/parametres`

Source : `src/app/parametres/page.tsx`.

Composants JSX directs : `Link` (20, 31).

Gestionnaires déclarés sur les éléments JSX :

Aucun détecté.

## `/patients/[id]`

Source : `src/app/patients/[id]/page.tsx`.

Composants JSX directs : `AppShell` (555) ; `BandeauAujourdhui` (446) ; `BandeauHorsLigne` (383, 576) ; `BlocErreur` (386, 582) ; `CarteIdentite` (510) ; `CarteProchaineEcheance` (506) ; `CarteResumeCas` (469) ; `ChronologiePatient` (514) ; `EnTeteCollant` (435) ; `EtatClinique` (486) ; `EtatVide` (393) ; `FormulaireModification` (398) ; `HistoriqueSeances` (501) ; `Onglets` (449) ; `PanneauClinique` (517) ; `PanneauOnglet` (458) ; `PanneauRendezVous` (543) ; `PanneauTraitements` (525) ; `PatientProfilClinique` (474) ; `PointDeSituation` (476) ; `RetourListe` (393) ; `SectionDepuisDerniere` (477) ; `SectionDocumentsPatient` (546) ; `Squelette` (377, 389).

Gestionnaires déclarés sur les éléments JSX :

- ligne 400 : `FormulaireModification` → `onEnregistre`
- ligne 401 : `FormulaireModification` → `onAnnuler`
- ligne 438 : `EnTeteCollant` → `onJarvis`
- ligne 443 : `EnTeteCollant` → `onModifier`
- ligne 452 : `Onglets` → `onChanger`
- ligne 471 : `CarteResumeCas` → `onEtatChange`
- ligne 472 : `CarteResumeCas` → `onGenerer`
- ligne 473 : `CarteResumeCas` → `onOuvrirSource`
- ligne 474 : `PatientProfilClinique` → `onOuvrirClinique`
- ligne 489 : `EtatClinique` → `onMisAJour`
- ligne 520 : `PanneauClinique` → `onMisAJour`
- ligne 529 : `PanneauTraitements` → `onRefresh`
- ligne 558 : `AppShell` → `onDeconnexion`

## `/patients/nouveau`

Source : `src/app/patients/nouveau/page.tsx`.

Composants JSX directs : `AppShell` (198) ; `BandeauHorsLigne` (207) ; `BlocErreur` (213) ; `FormulaireCreation` (218) ; `PanneauSimilaires` (227) ; `Squelette` (190).

Gestionnaires déclarés sur les éléments JSX :

- ligne 201 : `AppShell` → `onDeconnexion`
- ligne 222 : `FormulaireCreation` → `onCree`
- ligne 223 : `FormulaireCreation` → `onSaisie`

## `/patients`

Source : `src/app/patients/page.tsx`.

Composants JSX directs : `AppShell` (283) ; `ChampRecherche` (312) ; `EnTeteAnnuaire` (366) ; `EtatVide` (340) ; `LienBouton` (292) ; `LignePatient` (369) ; `Squelette` (272, 332).

Gestionnaires déclarés sur les éléments JSX :

- ligne 262 : `button` → `onClick`
- ligne 286 : `AppShell` → `onDeconnexion`
- ligne 304 : `form` → `onSubmit`
- ligne 315 : `ChampRecherche` → `onChange`
- ligne 323 : `button` → `onClick`
- ligne 382 : `button` → `onClick`
- ligne 398 : `button` → `onClick`

## `/premiere-configuration`

Source : `src/app/premiere-configuration/page.tsx`.

Composants JSX directs : `FormulairePremierLancement` (120) ; `LienBouton` (115) ; `MarqueMindCare` (89, 99, 110) ; `MotifFeuilles` (94).

Gestionnaires déclarés sur les éléments JSX :

- ligne 121 : `FormulairePremierLancement` → `onSubmit`

## `/statistiques`

Source : `src/app/statistiques/page.tsx`.

Composants JSX directs : `ActiviteDansLeTemps` (257) ; `AppShell` (169) ; `BandeauHorsLigne` (159, 190) ; `BlocErreur` (160) ; `BlocVide` (195) ; `Chargement` (192) ; `Contenu` (216) ; `ContinuiteSoins` (327) ; `DelaisSuivi` (379) ; `DiagnosticsDocumentes` (348) ; `DiagnosticsStock` (330) ; `DrawerAnalyse` (221) ; `DureesSeances` (324) ; `EchellesCliniques` (336) ; `Icone` (440) ; `LienBouton` (162) ; `LigneEncaisse` (186) ; `Methode` (414) ; `MomentsJournee` (299) ; `NouveauxEtRetours` (283) ; `PyramidePanel` (310) ; `QualiteDossier` (359) ; `RythmeSemaine` (291) ; `SelecteurPeriodeAnalyse` (181) ; `Squelette` (151, 491, 495, 498) ; `StatutsRendezVous` (268) ; `Synthese` (248) ; `SyntheseSecondaire` (410) ; `Traitements` (390) ; `TypesConsultation` (313).

Gestionnaires déclarés sur les éléments JSX :

- ligne 172 : `AppShell` → `onDeconnexion`
- ligne 183 : `SelecteurPeriodeAnalyse` → `onChange`
- ligne 207 : `button` → `onClick`
- ligne 225 : `DrawerAnalyse` → `onFermer`
- ligne 252 : `Synthese` → `onOuvrir`
- ligne 262 : `ActiviteDansLeTemps` → `onPoint`
- ligne 270 : `StatutsRendezVous` → `onStatut`
- ligne 286 : `NouveauxEtRetours` → `onNouveaux`
- ligne 287 : `NouveauxEtRetours` → `onRetours`
- ligne 293 : `RythmeSemaine` → `onJour`
- ligne 301 : `MomentsJournee` → `onHeure`
- ligne 315 : `TypesConsultation` → `onType`
- ligne 338 : `EchellesCliniques` → `onMesure`
- ligne 350 : `DiagnosticsDocumentes` → `onDiagnostic`
- ligne 362 : `QualiteDossier` → `onNotes`
- ligne 369 : `QualiteDossier` → `onRdv`
- ligne 381 : `DelaisSuivi` → `onDelai`
- ligne 393 : `Traitements` → `onActifs`
- ligne 400 : `Traitements` → `onChangements`

## `/tableauDeBord`

Source : `src/app/tableauDeBord/page.tsx`.

Composants JSX directs : `AppShell` (136, 154) ; `BandeauHorsLigne` (79, 118) ; `BlocErreur` (80, 119) ; `Bouton` (123) ; `CockpitReception` (168) ; `LienBouton` (84, 143) ; `Squelette` (94, 95) ; `TableauDeBordPraticienne` (148).

Gestionnaires déclarés sur les éléments JSX :

- ligne 123 : `Bouton` → `onClick`
- ligne 139 : `AppShell` → `onDeconnexion`
- ligne 157 : `AppShell` → `onDeconnexion`

## `/traitements`

Source : `src/app/traitements/page.tsx`.

Composants JSX directs : `AppShell` (33) ; `BlocErreur` (24) ; `ChargeTraitements` (39) ; `LienBouton` (26) ; `Squelette` (16).

Gestionnaires déclarés sur les éléments JSX :

- ligne 36 : `AppShell` → `onDeconnexion`
