# Index des écrans — inventaire mécanique des composants

Généré par lecture statique des fichiers `page.tsx`. La recherche par expression régulière peut inclure des types TypeScript ; les imports sont directs : ils ne prouvent ni visibilité pour chaque rôle, ni fonctionnement, ni exhaustivité des composants imbriqués. Les fichiers sources restent l’autorité.

## `/agenda/[id]`

Source : `src/app/agenda/[id]/page.tsx`.

Candidats JSX ou types (à vérifier) : `AgendaEntry`, `AppShell`, `BandeauHorsLigne`, `BarreActions`, `BlocErreur`, `Bouton`, `Carte`, `ChampAgenda`, `ChampSelection`, `ChampTexte`, `ChampZoneTexte`, `ConsultationKind`, `EtatVide`, `IssueAppel`, `LienBouton`, `Statut`.

Services importés directement : `@/services/appointments`, `@/services/consultations`.

Modules UI importés directement : `@/components/AgendaPieces`, `@/components/AppShell`, `@/components/ui`, `@/components/useSessionEcran`.

## `/agenda/nouveau`

Source : `src/app/agenda/nouveau/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BandeauHorsLigne`, `BarreActions`, `BlocErreur`, `Bouton`, `ChampSelection`, `ChampTexte`, `ChampZoneTexte`, `ConsultationKind`, `LienBouton`, `PatientListItem`.

Services importés directement : `@/services/appointments`, `@/services/patients`, `@/services/practitioners`.

Modules UI importés directement : `@/components/AgendaPieces`, `@/components/AppShell`, `@/components/ui`, `@/components/useSessionEcran`.

## `/agenda`

Source : `src/app/agenda/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BandeauHorsLigne`, `BlocErreur`, `BoutonPeriode`, `Date`, `GrilleSemaine`, `LienBouton`, `Link`, `Squelette`, `Statut`, `Vue`.

Services importés directement : `@/services/appointments`.

Modules UI importés directement : `@/components/AgendaPieces`, `@/components/AppShell`, `@/components/GrilleSemaine`, `@/components/ui`, `@/components/useSessionEcran`.

## `/connexion`

Source : `src/app/connexion/page.tsx`.

Candidats JSX ou types (à vérifier) : `FondShaderVert`, `FormulaireConnexion`, `HTMLElement`, `MarqueMindCare`.

Services importés directement : `@/services/auth`, `@/services/onboarding`.

Modules UI importés directement : `@/components/FormulaireConnexion`, `@/components/connexion/FondShaderVert`, `@/components/ui/Icones`.

## `/consultation/[id]`

Source : `src/app/consultation/[id]/page.tsx`.

Candidats JSX ou types (à vérifier) : `AbortController`, `AnalyseSeance`, `AppShell`, `Badge`, `BandeauHorsLigne`, `BandeauPatient`, `BarreActions`, `BarreConsultation`, `BlocErreur`, `Bouton`, `BoutonDictee`, `Carte`, `CarteAnalyseSeance`, `CarteResumeCas`, `Champ`, `ChampSoap`, `ChampTexte`, `ChampZoneTexte`, `ChronoSeance`, `CibleDictee`, `CockpitHeader`, `CompteReboursVerrou`, `Consultation`, `EtatEnregistrement`, `EtatVide`, `FocusSeance`, `HTMLTextAreaElement`, `IndicateurEnregistrement`, `LienBouton`, `MesuresSeance`, `NotesStructurees`, `Onglets`, `PanneauHistorique`, `PanneauInfo`, `PanneauOnglet`, `PanneauRendezVous`, `PanneauTraitements`, `PatientWorkspace`, `PointDeSituation`, `Promise`, `RailContexte`, `Record`, `ResumeEtat`, `ReturnType`, `SectionDocumentsPatient`, `SectionEchelles`, `SectionPliable`, `SessionDetails`, `Squelette`, `TarifInline`.

Services importés directement : `@/services/apres-seance`, `@/services/consultations`, `@/services/insertion-dictee`, `@/services/jarvis`, `@/services/patients`, `@/services/resume-cas`, `@/services/scales`.

Modules UI importés directement : `@/components/AgendaPieces`, `@/components/AppShell`, `@/components/consultation/CarteAnalyseSeance`, `@/components/consultation/DicteeChamp`, `@/components/consultation/PanneauHistorique`, `@/components/consultation/cockpit/BandeauPatient`, `@/components/consultation/cockpit/BarreConsultation`, `@/components/consultation/cockpit/CockpitHeader`, `@/components/consultation/cockpit/FocusSeance`, `@/components/consultation/cockpit/MesuresSeance`, `@/components/consultation/cockpit/NotesStructurees`, `@/components/consultation/cockpit/RailContexte`, `@/components/consultation/cockpit/SectionEchelles`, `@/components/consultation/cockpit/TarifInline`, `@/components/consultation/cockpit/modele-cockpit`, `@/components/documents/SectionDocumentsPatient`, `@/components/patients/CarteResumeCas`, `@/components/patients/PanneauRendezVous`, `@/components/patients/PanneauTraitements`, `@/components/patients/SectionsDeterministes`, `@/components/ui`, `@/components/useSessionEcran`.

## `/documents`

Source : `src/app/documents/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BlocErreur`, `DocumentWorkspace`, `DocumentsContent`, `Squelette`, `Suspense`.

Services importés directement : aucun repéré.

Modules UI importés directement : `@/components/AppShell`, `@/components/documents/DocumentWorkspace`, `@/components/ui`, `@/components/useSessionEcran`.

## `/finances`

Source : `src/app/finances/page.tsx`.

Candidats JSX ou types (à vérifier) : `ApercuCaisse`, `AppShell`, `BandeauHorsLigne`, `BlocErreur`, `CompositionV8`, `CourbesTypes`, `EtatDonnees`, `EvolutionV8`, `Icone`, `LienBouton`, `LigneCharge`, `ListeCharges`, `ListeSeances`, `ModaleCharge`, `Onglet`, `PanneauAttention`, `PanneauEtat`, `PanneauFinance`, `Periode`, `PoulsV8`, `SelecteurPeriode`, `Squelette`, `Suspense`, `TableauCharges`, `TableauSeances`, `TuilesEtRangees`.

Services importés directement : `@/services/finance-cash`.

Modules UI importés directement : `@/components/AppShell`, `@/components/finance/EtatPanneau`, `@/components/finance/PanneauAttention`, `@/components/finance/PanneauxV8`, `@/components/finance/SelecteurPeriode`, `@/components/finance/TableauCharges`, `@/components/finance/TableauSeances`, `@/components/ui`, `@/components/ui/Icones`, `@/components/useSessionEcran`.

## `/jarvis`

Source : `src/app/jarvis/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BandeauHorsLigne`, `BlocErreur`, `CarteConfirmation`, `EtatConversationPublique`, `FilJarvis`, `HeroAlexaLune`, `Icone`, `LienBouton`, `PastillesAlexaLune`, `SaisieAlexaLune`, `Squelette`.

Services importés directement : `@/services/conversation`.

Modules UI importés directement : `@/components/AlexaLune`, `@/components/AppShell`, `@/components/CarteConfirmation`, `@/components/FilJarvis`, `@/components/SaisieAlexaLune`, `@/components/ui`, `@/components/ui/Icones`, `@/components/useSessionEcran`.

## `/messages`

Source : `src/app/messages/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BadgeCanal`, `BadgeHandoff`, `BandeauHorsLigne`, `BlocErreur`, `Bouton`, `BulleMessage`, `ChampZoneTexte`, `EtatVide`, `FiltreMessages`, `LienBouton`, `LigneConversation`, `Link`, `RoutageConversation`, `Section`, `Squelette`.

Services importés directement : `@/services/communication/appariement`, `@/services/communication/communication-service`, `@/services/communication/connexions`, `@/services/communication/consentement`, `@/services/communication/envoi`, `@/services/communication/types`.

Modules UI importés directement : `@/components/AppShell`, `@/components/MessagesPieces`, `@/components/ui`, `@/components/ui/Champs`, `@/components/useSessionEcran`.

## `/observabilite`

Source : `src/app/observabilite/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BlocErreur`, `Bouton`, `LienBouton`, `PanneauObservabilite`, `Squelette`.

Services importés directement : aucun repéré.

Modules UI importés directement : `@/components/AppShell`, `@/components/observabilite/PanneauObservabilite`, `@/components/ui`, `@/components/ui/Bouton`, `@/components/useSessionEcran`.

## `/`

Source : `src/app/page.tsx`.

Candidats JSX ou types (à vérifier) : aucun repéré.

Services importés directement : aucun repéré.

Modules UI importés directement : aucun repéré.

## `/parametres/cabinet`

Source : `src/app/parametres/cabinet/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BlocErreur`, `Bouton`, `ChampTexte`, `CompteAccueil`, `InvitationCabinet`, `LienBouton`, `PanneauInfo`, `Section`, `Squelette`.

Services importés directement : `@/services/cabinet-collaboration`, `@/services/cabinet-postes`.

Modules UI importés directement : `@/components/AppShell`, `@/components/ui`, `@/components/useSessionEcran`.

## `/parametres/documents`

Source : `src/app/parametres/documents/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BlocErreur`, `Cabinet`, `ProfilPraticienne`, `Squelette`.

Services importés directement : `@/services/cabinet`.

Modules UI importés directement : `@/components/AppShell`, `@/components/ui`, `@/components/useSessionEcran`.

## `/parametres`

Source : `src/app/parametres/page.tsx`.

Candidats JSX ou types (à vérifier) : `Link`.

Services importés directement : aucun repéré.

Modules UI importés directement : aucun repéré.

## `/patients/[id]`

Source : `src/app/patients/[id]/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BandeauAujourdhui`, `BandeauHorsLigne`, `BlocErreur`, `CarteIdentite`, `CarteProchaineEcheance`, `CarteResumeCas`, `ChronologiePatient`, `CleOnglet`, `CurrentUser`, `EnTeteCollant`, `EtatClinique`, `EtatVide`, `FormulaireModification`, `HistoriqueSeances`, `Onglets`, `PanneauClinique`, `PanneauOnglet`, `PanneauRendezVous`, `PanneauTraitements`, `Patient`, `PatientProfilClinique`, `PatientWorkspace`, `PointDeSituation`, `ResumeEtat`, `RetourListe`, `SectionDepuisDerniere`, `SectionDocumentsPatient`, `Squelette`.

Services importés directement : `@/services/auth`, `@/services/authz`, `@/services/consultations`, `@/services/conversation`, `@/services/patient-actif`, `@/services/patients`, `@/services/resume-cas`.

Modules UI importés directement : `@/components/AppShell`, `@/components/documents/SectionDocumentsPatient`, `@/components/patients/BandeauAujourdhui`, `@/components/patients/CarteIdentite`, `@/components/patients/CarteResumeCas`, `@/components/patients/ChronologiePatient`, `@/components/patients/EnTeteCollant`, `@/components/patients/EnTetePatient`, `@/components/patients/FormulaireModification`, `@/components/patients/HistoriqueSeances`, `@/components/patients/PanneauClinique`, `@/components/patients/PanneauRendezVous`, `@/components/patients/PanneauTraitements`, `@/components/patients/PatientProfilClinique`, `@/components/patients/SectionsDeterministes`, `@/components/ui`.

## `/patients/nouveau`

Source : `src/app/patients/nouveau/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BandeauHorsLigne`, `BlocErreur`, `CurrentUser`, `FormulaireCreation`, `PanneauSimilaires`, `Squelette`.

Services importés directement : `@/services/auth`, `@/services/authz`, `@/services/conversation`, `@/services/patients`, `@/services/practitioners`.

Modules UI importés directement : `@/components/AppShell`, `@/components/patients/FormulaireCreation`, `@/components/patients/PanneauSimilaires`, `@/components/ui`.

## `/patients`

Source : `src/app/patients/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `ChampRecherche`, `CurrentUser`, `EnTeteAnnuaire`, `EtatVide`, `LienBouton`, `LignePatient`, `Page`, `PatientListItem`, `Squelette`.

Services importés directement : `@/services/auth`, `@/services/authz`, `@/services/conversation`, `@/services/patients`, `@/services/result`.

Modules UI importés directement : `@/components/AppShell`, `@/components/patients/LignePatient`, `@/components/ui`.

## `/premiere-configuration`

Source : `src/app/premiere-configuration/page.tsx`.

Candidats JSX ou types (à vérifier) : `EtatGarde`, `FormulairePremierLancement`, `LienBouton`, `MarqueMindCare`, `MotifFeuilles`.

Services importés directement : `@/services/onboarding`.

Modules UI importés directement : `@/components/FormulairePremierLancement`, `@/components/ui/Bouton`, `@/components/ui/Icones`.

## `/statistiques`

Source : `src/app/statistiques/page.tsx`.

Candidats JSX ou types (à vérifier) : `ActiviteDansLeTemps`, `AppShell`, `BandeauHorsLigne`, `BlocErreur`, `BlocVide`, `Chargement`, `Contenu`, `ContinuiteSoins`, `DelaisSuivi`, `DemandeDetail`, `DiagnosticsDocumentes`, `DiagnosticsStock`, `DrawerAnalyse`, `DureesSeances`, `EchellesCliniques`, `EtatAnalyse`, `Icone`, `LienBouton`, `LigneEncaisse`, `Methode`, `MomentsJournee`, `NouveauxEtRetours`, `PeriodeAnalyse`, `PyramidePanel`, `QualiteDossier`, `RythmeSemaine`, `SelecteurPeriodeAnalyse`, `Squelette`, `StatutsRendezVous`, `Suspense`, `Synthese`, `SyntheseSecondaire`, `Traitements`, `TypesConsultation`.

Services importés directement : `@/services/analyse`, `@/services/finance-calendrier`, `@/services/finance-cash`.

Modules UI importés directement : `@/components/AppShell`, `@/components/analyse/DrawerAnalyse`, `@/components/analyse/Methode`, `@/components/analyse/PanneauxActivite`, `@/components/analyse/PanneauxCliniques`, `@/components/analyse/PanneauxSupplementaires`, `@/components/analyse/SelecteurPeriodeAnalyse`, `@/components/analyse/Synthese`, `@/components/ui`, `@/components/ui/Icones`, `@/components/useSessionEcran`.

## `/tableauDeBord`

Source : `src/app/tableauDeBord/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BandeauHorsLigne`, `BlocErreur`, `Bouton`, `CockpitReception`, `LienBouton`, `Squelette`, `TableauDeBordPraticienne`.

Services importés directement : aucun repéré.

Modules UI importés directement : `@/components/AppShell`, `@/components/reception/CockpitReception`, `@/components/tableauDeBord/TableauDeBordPraticienne`, `@/components/ui`, `@/components/useSessionEcran`.

## `/traitements`

Source : `src/app/traitements/page.tsx`.

Candidats JSX ou types (à vérifier) : `AppShell`, `BlocErreur`, `ChargeTraitements`, `LienBouton`, `Squelette`.

Services importés directement : aucun repéré.

Modules UI importés directement : `@/components/AppShell`, `@/components/traitements/ChargeTraitements`, `@/components/ui`, `@/components/useSessionEcran`.

