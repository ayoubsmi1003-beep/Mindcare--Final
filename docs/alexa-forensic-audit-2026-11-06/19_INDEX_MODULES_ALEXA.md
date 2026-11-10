# Index mécanique des modules Alexa, connaissance et voix

Index statique des déclarations `export` directes, généré à partir du code source. Il peut manquer les exports indirects, classes anonymes ou déclarations sur plusieurs lignes. Une déclaration ne prouve ni appel effectif ni disponibilité en production. Compléter par les traces et tests des audits thématiques.

## `src/server/alexa`

- `src/server/alexa/action-proposal.ts` : `ProposalResult`:19, `explicitAlgerianClockTime`:50, `deterministicActionRequest`:75, `prepareIssuedDocumentPrint`:95, `prepareActionProposal`:144
- `src/server/alexa/agenda-adapter.ts` : `readAgendaDay`:17, `readAgenda`:31
- `src/server/alexa/agent-continuation.ts` : `agentContinuationKinds`:4, `AgentContinuationKind`:5, `AgentContinuationBinding`:7, `AgentContinuationCursor`:14, `StoredAgentContinuation`:23, `describePendingAgentCursor`:53, `createAgentContinuation`:105, `validateAgentContinuation`:124, `resolveAgentContinuation`:144, `agentContinuationText`:157
- `src/server/alexa/agent-loop.ts` : `AGENT_LIMITS`:23, `AgentTask`:34, `clearAgentTask`:36, `savedAgentTask`:37, `restoreAgentTask`:46, `AgentToolResultObservation`:67, `summarizeAgentToolResultObservation`:72, `AgentLoopDependencies`:90, `AgentOutcome`:94, `runAgentLoop`:820
- `src/server/alexa/agent-period.ts` : `explicitAgendaClockWindow`:7, `resolveAgentPeriod`:33, `explicitAgentPeriod`:41
- `src/server/alexa/agent-tools.ts` : `isolatePreviousClinicalConsultation`:41, `agentExecutor`:129
- `src/server/alexa/answer-presentation.ts` : `presentAgentResults`:47
- `src/server/alexa/application-reads.ts` : `readApplication`:14, `readFinanceView`:60, `readAppointment`:111
- `src/server/alexa/case-summary.ts` : `SummaryItem`:9, `buildConsultationNoteDetails`:18, `buildStructuredSummaryNarrative`:48, `buildCaseSummary`:77, `SUMMARY_PROMPT_VERSION`:99, `SUMMARY_PROMPT_HASH`:100
- `src/server/alexa/case-synthesis.ts` : `CASE_SYNTHESIS_VERSION`:6, `CASE_SYNTHESIS_HASH`:7, `CaseSource`:19, `CaseItem`:25, `ScaleAdministrationLite`:30, `ScaleDefinitionLite`:41, `CaseSynthesis`:53, `CaseSynthesisInput`:60, `buildCaseSynthesis`:316
- `src/server/alexa/clinical-context.ts` : `ClinicalContextErrorCode`:5, `ClinicalContextError`:7, `buildClinicalContext`:12, `readClinicalSourceRevision`:78
- `src/server/alexa/clinical-coverage.ts` : `clinicalSectionComplete`:4, `clinicalSummaryComplete`:18
- `src/server/alexa/clinical-narrative.ts` : `NARRATIVE_VERSION`:13, `NARRATIVE_HASH`:14, `CASE_NARRATIVE_VERSION`:15, `CASE_NARRATIVE_HASH`:16, `NarrativeSource`:22, `ClinicalNarrative`:23, `sessionAnswerSchemaFor`:57, `consultationNotesSnapshot`:153, `consultationNotesDigest`:156, `relativeClinicalDate`:159, `requestsClinicalDate`:165, `consultationNarrativeSources`:169, `clinicalNarrativeReferences`:183, `validateClinicalNarrative`:305, `synthesizeClinicalNarrative`:488, `extractRecurringClinicalTheme`:525, `extractStructuredClinicalProgression`:561, `summarizeClinicalCaseContext`:969, `summarizeClinicalContext`:1007, `summarizeClinicalConsultations`:1038
- `src/server/alexa/clinical-write-validation.ts` : `TreatmentTargetResolution`:41, `MedicationCatalogIdentity`:46, `hasExactMedicationCatalogIdentity`:49, `resolveTreatmentTarget`:62, `groundTreatmentChanges`:112, `StopTreatmentReason`:131, `groundStopReason`:139, `groundDraftFieldChanges`:146
- `src/server/alexa/consultation-reads.ts` : `readConsultation`:13
- `src/server/alexa/conversation-state.ts` : `TurnLease`:4, `parseWorkingReference`:20, `referenceForPersistence`:25, `ConversationState`:31, `conversationState`:106, `resolveListedReference`:109
- `src/server/alexa/db.ts` : `alexaDb`:6
- `src/server/alexa/document-draft-update.ts` : `mergeDraftVariableChanges`:8
- `src/server/alexa/document-draft.ts` : `DocumentDraftResolution`:69, `resolveDocumentDraftInputs`:158
- `src/server/alexa/document-excerpt.ts` : `documentText`:3, `issuedDocumentText`:9, `documentExcerpt`:16
- `src/server/alexa/document-page.ts` : `documentPage`:5
- `src/server/alexa/general-reference.ts` : `findVerifiedPublicFact`:181, `publicFactAnswerMatches`:187
- `src/server/alexa/internal-message.ts` : `InternalMessagePatient`:11, `InternalMessageDecision`:18, `prepareInternalMessage`:44
- `src/server/alexa/knowledge-adapter.ts` : `EditionPreuve`:29, `PagePreuve`:40, `PreuveAlexa`:47, `identiteDePreuve`:90, `preuveAffichable`:104, `isIssuedKnowledgeResult`:133, `DependancesReadKnowledge`:143, `dependancesReadKnowledge`:245, `readKnowledge`:270
- `src/server/alexa/knowledge-envelope.ts` : `ALEXA_KNOWLEDGE_TRANSFORM`:4, `KnowledgeTask`:5, `KnowledgeFocus`:6, `knowledgeMessages`:10, `isIssuedKnowledgeEnvelope`:27
- `src/server/alexa/knowledge-evidence-content.ts` : `headingOnlyEvidence`:5, `bibliographyEvidence`:15, `indexEvidence`:21, `indexRequested`:22, `bibliographyRequested`:23, `bibliographyTextEvidence`:25, `unboundTableEvidence`:38, `copiedEnglishProse`:40, `knowledgeComparisonRequested`:47, `requestedMedicationNames`:53, `medicationSpanGrounded`:58, `medicationNumericQuoteGrounded`:65, `issuedQuoteChoices`:75
- `src/server/alexa/knowledge-query.ts` : `KnowledgeQueryPlan`:123, `isKnowledgeLocationQuestion`:174, `planKnowledgeQuery`:182, `matchesSectionFocus`:447, `matchesLeafHint`:449, `requetePourLivreRequis`:456, `matchesRequestedBook`:461
- `src/server/alexa/knowledge-response.ts` : `KnowledgeResult`:10, `mentionsKnowledgeBookTitle`:18, `knowledgeExcerptForSpeech`:23, `knowledgeSource`:35, `citationDePreuve`:53, `knowledgeResponseEvents`:64
- `src/server/alexa/knowledge-synthesis.ts` : `synthesizeKnowledge`:74
- `src/server/alexa/local-model-assets.ts` : `localAssetLayout`:5, `assertLocalAssetAccess`:18, `readLocalAssetAccess`:33, `verifyLocalAssetAccess`:44
- `src/server/alexa/local-model-protocol.ts` : `NativeCall`:5, `LocalTool`:6, `LocalMessage`:7, `LocalTextOptions`:11, `localModelTimeoutMs`:17, `localModelFailureCode`:23, `buildLocalRequest`:44, `LocalCompletion`:69, `parseLocalCompletion`:71, `parseLocalAnswer`:95, `fitLocalOutputTokens`:102
- `src/server/alexa/local-model-slot.ts` : `LocalModelSlot`:2
- `src/server/alexa/local-model-timing.ts` : `measureLocalModelPhase`:3
- `src/server/alexa/local-model.ts` : `LOCAL_MODEL_PIN`:18, `localModelThreadCountFor`:35, `localSemanticQualified`:55, `allocateLoopbackPort`:64, `releaseLocalModel`:103, `inferLocalText`:187, `inferLocalCompletion`:190, `inferLocalSemantic`:193
- `src/server/alexa/local-response.ts` : `localDisplay`:10, `contextSources`:17, `localResponse`:27
- `src/server/alexa/local-semantic-planner.ts` : `LocalSemanticPlan`:5, `planLocalSemantic`:6
- `src/server/alexa/message-draft.ts` : `readMessageDraft`:7
- `src/server/alexa/model-gateway.ts` : `AlexaInferenceResult`:20, `qualifyAlexaModels`:24, `getAlexaModelPolicy`:28, `inferAlexa`:46, `AlexaGeneralInferenceResult`:140, `isFrenchQuotedInstructionPolicyQuestion`:150, `isValidFrenchGeneralAnswer`:187, `canAnswerGeneralAlexa`:195, `inferNativeGeneralAlexa`:196, `inferGeneralAlexa`:237
- `src/server/alexa/model-policy.ts` : `ALEXA_CONVERSATION_MODEL`:9, `ALEXA_DIRECT_MODEL`:11, `ALEXA_STT_MODEL`:14, `ALEXA_TTS_MODEL`:15, `ALEXA_TTS_VOICE`:16, `ALEXA_LIVE_MODEL`:17, `ALEXA_PRIMARY_MODEL`:20, `ALEXA_GEMINI_FREE_MODEL`:21, `ALEXA_GROQ_FREE_MODEL`:23, `ALEXA_PROVIDER_POLICY`:24, `isAlexaPrimaryModelId`:30, `isFreeAlexaModelId`:34, `normaliseAlexaModel`:40
- `src/server/alexa/note-excerpts.ts` : `NoteExcerpt`:4, `consultationExcerpts`:21
- `src/server/alexa/note-pages.ts` : `notePageResult`:12
- `src/server/alexa/orchestrator.ts` : `OrchestratorDependencies`:65, `knowledgeFollowupQuestion`:138, `isKnowledgeFollowup`:146, `runAlexa`:295
- `src/server/alexa/patient-finance.ts` : `PatientFinance`:9, `readPatientFinance`:11, `patientFinanceSentence`:29
- `src/server/alexa/patient-mention.ts` : aucune déclaration directe détectée
- `src/server/alexa/patient-records.ts` : `readPatientRecords`:14
- `src/server/alexa/patient-resolver.ts` : `PatientResolution`:5, `resolvePatient`:86
- `src/server/alexa/patient-search.ts` : `ListedPatient`:7, `PatientSearchResult`:8, `PatientFilter`:11, `PatientPageResult`:14, `readPatientPage`:18, `readPatientList`:37
- `src/server/alexa/privacy-boundary.ts` : `ALEXA_CLINICAL_TRANSFORM`:6, `ALEXA_CLINICAL_PROMPT`:7, `SafeClinicalPayloadSchema`:16, `SafeClinicalPayload`:21, `SafeClinicalResult`:22, `isIssuedSafeClinicalPayload`:35, `createSafeClinicalPayload`:80, `safeClinicalMessages`:129, `isSafeClinicalEnvelope`:137
- `src/server/alexa/profile-answer.ts` : `patientProfileSchema`:5, `profileNeedsClarification`:32, `profileAnswer`:33
- `src/server/alexa/qualification-error.ts` : `AlexaQualificationPhase`:3, `AlexaQualificationError`:6
- `src/server/alexa/receipts-adapter.ts` : `readDailyReceipts`:13
- `src/server/alexa/request-plan.ts` : aucune déclaration directe détectée
- `src/server/alexa/response-validator.ts` : `AlexaAnswerSchema`:6, `AlexaAnswer`:8, `ValidatedAlexaAnswer`:9, `validateAlexaResponse`:20
- `src/server/alexa/semantic-planner.ts` : `PublicQuestionAdmission`:10, `isIssuedPublicQuestion`:12, `SemanticPlan`:15, `understandPublicTurn`:20
- `src/server/alexa/sentence-stream.ts` : `SentenceStream`:2
- `src/server/alexa/session-summary.ts` : `SessionSummaryError`:17, `SessionEvaluation`:42, `buildSessionScaleFindings`:54, `generateSessionSummary`:227
- `src/server/alexa/tool-executor.ts` : `ClinicalReadArguments`:4, `executeRead`:7

## `src/shared/alexa`

- `src/shared/alexa/action-authorization.ts` : `alexaActionsAuthorizedByExplicitCommand`:24
- `src/shared/alexa/agenda-plan.ts` : `agendaIdentityText`:8, `nativeAgendaStatusContract`:15, `agendaSelection`:37, `isGlobalWhoAgenda`:58
- `src/shared/alexa/agent.ts` : `ALEXA_AGENT_LANGUAGE`:6, `ALEXA_NATIVE_BUDGET`:8, `ALEXA_NATIVE_DEADLINE_MS`:9, `applicationQuerySchema`:11, `timelineQuerySchema`:12, `timelineCursorSchema`:13, `conditionSchema`:15, `SupportedCondition`:25, `conditionKey`:26, `queryPeriodSchema`:27, `consultationPeriodSchema`:28, `constraintLedgerSchema`:29, `partSchema`:30, `PartStatus`:36, `RequestPart`:37, `validateLedger`:38, `compactDeclarationSchema`:45, `parseDeclaration`:46, `metricSchema`:68, `patientMetricConditions`:69, `patientListContinuation`:71, `queryPatientsSchema`:72, `cabinetFinanceModes`:83, `actionArgumentKeys`:95, `agentSchemas`:96, `AgentToolName`:142, `AgentCall`:143, `AgentResult`:144, `AgentTerminal`:147, `AgentReadError`:148
- `src/shared/alexa/answer-links.ts` : `answerLinkSchema`:9, `AlexaAnswerLink`:10, `AlexaAnswerBlock`:11, `validAnswerLinks`:12, `answerLinkPath`:22, `appendLinkedAnswerLine`:27
- `src/shared/alexa/clinical.ts` : `SESSION_NARRATIVE_VERSION`:5, `consultationCursorSchema`:9, `clinicalNoteSchema`:10, `clinicalConsultationSchema`:15, `clinicalTreatmentSchema`:27, `clinicalContextSchema`:31, `ClinicalContext`:47, `ClinicalConsultation`:48, `ClinicalTreatment`:49, `ConsultationCursor`:50, `ClinicalContextRequest`:51
- `src/shared/alexa/history.ts` : `readAlexaHistory`:9
- `src/shared/alexa/knowledge-answer.ts` : `knowledgeAnswerSchema`:4, `knowledgeAnswerJsonSchema`:15, `IssuedQuoteChoices`:16, `indexedKnowledgeAnswerSchema`:18, `resolveIndexedKnowledgeAnswer`:34, `LlmOutputContract`:38
- `src/shared/alexa/medications.ts` : `medicationNames`:2, `isMedicationName`:8, `mentionsMedication`:12
- `src/shared/alexa/note-query.ts` : `noteSearchRequested`:4, `documentBodySearchRequested`:5, `noteQueryGrounded`:13, `noteCursorSchema`:21, `noteQuerySchema`:22, `noteReadQuerySchema`:23, `noteContinuation`:24
- `src/shared/alexa/patient-mention.ts` : `PatientMention`:49, `parsePatientMention`:51, `patientMention`:205
- `src/shared/alexa/patient-query-contract.ts` : `PatientQueryContract`:7, `patientQueryPeriod`:19, `patientQueryContract`:45
- `src/shared/alexa/public-question.ts` : `isBoundedPublicQuestion`:29
- `src/shared/alexa/questions.ts` : `splitAlexaQuestions`:2
- `src/shared/alexa/request-contract.ts` : `isFrenchAlexaCapabilityQuestion`:6, `isFrenchClarificationCapabilityQuestion`:10, `isFrenchMissingInformationPolicyQuestion`:14, `hasExplicitClockRestriction`:21, `frenchFinanceRecordState`:25, `explicitFrenchDayRange`:33, `explicitFrenchDateRange`:52, `explicitFrenchMonthRange`:89, `explicitFrenchSingleMonthRange`:99, `explicitFrenchCurrentMonthRange`:115, `explicitFrenchComparedMonthRanges`:122, `FrenchCountContract`:135, `explicitCombinedPatientPopulationCount`:137, `frenchPatientCountContract`:169, `patientConditionMentions`:211, `patientConditionsGrounded`:213, `explicitPatientConditions`:261, `explicitPatientCountFilterGroups`:262, `countContractParts`:270, `requestedPopulation`:271, `constrainCountDeclaration`:294, `FrenchReadTool`:314, `FrenchReadTarget`:315, `FrenchRequestAdmission`:316, `isFrenchNamedLatestConsultationComparison`:330, `isClinicalKnowledgeQuestion`:337, `frenchRequestAdmission`:512, `countContractHints`:545, `FrenchCompoundContract`:547, `frenchPatientCompoundContract`:549, `compoundContractHints`:557, `compoundContractParts`:558, `constrainCompoundDeclaration`:559, `frenchRequestedOutputs`:566, `constrainRequestedOutputs`:634, `requestedReadTool`:645, `requestedCountRead`:656, `isAdministrativeReview`:657, `frenchReadArgumentBindings`:663
- `src/shared/alexa/request-plan.ts` : `AlexaIntent`:6, `AlexaLanguage`:7, `ClinicalFocus`:8, `WorkingReference`:9, `RequestPlan`:29, `requestsCurrentVisitConcern`:42, `requestedConsultationCount`:48, `requestsOldestConsultations`:57, `requestsPatientScope`:146, `requestsCabinetWideScope`:154, `withoutCabinetWideScope`:158, `requestsNextPatient`:163, `planRequest`:277
- `src/shared/alexa/semantic-request.ts` : `semanticRequestSchema`:4, `SemanticRequest`:15, `EvidenceOrigin`:16, `SourceStep`:17, `SourcePlan`:18, `buildSourcePlan`:20, `SourceResult`:37, `sourceAnswerSchema`:39, `SourceAnswer`:42, `ValidationResult`:43, `sourcePlanSchema`:45, `patientResolutionSchema`:54, `sourceResultSchema`:59, `privacyAdmissionSchema`:63, `validationResultSchema`:65
- `src/shared/alexa/session-details.ts` : `sessionDetailsSchema`:3, `SessionDetails`:9, `measureChanges`:10, `emptySessionDetails`:17
- `src/shared/alexa/turn.ts` : `turnInput`:3, `TurnInput`:11, `alexaNavigationSchema`:12, `AlexaNavigation`:18, `alexaProposalSchema`:19, `AlexaProposal`:20, `alexaNavigationPath`:21, `AlexaSource`:29, `validAlexaSources`:38, `AlexaEvent`:39
- `src/shared/alexa/voice-loop.ts` : `TrameVoix`:3, `ResultatTourVoix`:4, `TourVoix`:5, `PhaseVoixLocale`:6, `PortsVoixLocale`:7, `creerBoucleVoixLocale`:19

## `src/server/knowledge`

- `src/server/knowledge/citations.ts` : `CitationReconnue`:36, `VerdictCitation`:46, `MotifRejet`:50, `normaliserForme`:62, `nomCourt`:82, `normaliserBalayage`:139, `PreuveMinimale`:151, `verifierCitations`:160
- `src/server/knowledge/decoupage.ts` : `CHUNKER_VERSION`:27, `NORMALISATION_CHUNK`:30, `LIMITE_PARAGRAPHE`:37, `SousSectionSource`:40, `SectionSource`:46, `DocumentSource`:53, `ChunkDecoupe`:62, `decouperDocument`:89, `texteIndexable`:119, `normaliserTexte`:127, `hacherTexte`:132
- `src/server/knowledge/editions.ts` : `EditionOuvrage`:29, `EDITIONS`:46, `normaliserTitre`:79, `editionDe`:93
- `src/server/knowledge/embeddings-local.ts` : `NOM_FICHIERS_MODELE`:25, `RECETTE_GELEE`:32, `DossiersModeles`:46, `resoudreDossierModele`:57, `extraireEmpreintes`:76, `verifierEmpreintesParFlux`:107, `verifierEmpreintes`:138, `configLocaleDepuisRecette`:162, `formaterVecteurPg`:213, `decouperLots`:229, `TRONCATURE_MAX`:243, `TAILLE_LOT_INFERENCE`:246, `EncodageLocal`:249, `TokenizerLocalMinimal`:255, `SessionOnnxMinimale`:261, `ConstructeurTenseur`:268, `OrtMinimal`:273, `OptionsSessionLocale`:278, `FabriqueSession`:284, `encoderLot`:293, `normaliserL2`:336, `inferenceDepuisSession`:357, `SessionLocalePrete`:421, `FournisseurRequete`:427, `vecteurRequeteDepuisFournisseur`:439, `chargerSessionLocale`:454
- `src/server/knowledge/embeddings-secondaires.ts` : `DIMENSION_VECTEUR_SECONDAIRE`:23, `RECETTE_SECONDAIRE_GELEE`:26, `RECETTE_SECONDAIRE_768_GELEE`:37, `RECETTES_SECONDAIRES_GELEES`:52, `SlugRecetteSecondaire`:57, `recetteSecondaireGelee`:60, `TRONCATURE_SECONDAIRE`:67, `EncodageSecondaire`:70, `TokenizerSecondaire`:75, `SessionSecondaire`:80, `ConstructeurTenseurSecondaire`:86, `OrtSecondaire`:90, `configSecondaireDepuisRecette`:98, `extraireEmpreintesSecondaires`:142, `encoderLotSecondaire`:163, `inferenceSecondaireDepuisSession`:201, `vecteurRequeteSecondaire`:270, `ResultatSecondaire`:287
- `src/server/knowledge/embeddings.ts` : `EmbeddingProvider`:33, `RecetteEmbedding`:60, `CodeEchecEmbedding`:72, `ResultatEmbedding`:74, `TransportEmbedding`:83, `FournisseurC4Externe`:88, `DIMENSION_VECTEUR_PROD`:163, `ConfigFournisseurLocal`:166, `InferenceLocale`:179, `validerConfigLocale`:184, `FournisseurLocalOnnx`:206, `FournisseurLocalIndisponible`:278, `passerelleEmbedding`:303, `recetteCompatible`:367
- `src/server/knowledge/expansion.ts` : `MARQUEURS_AVERTISSEMENT`:37, `RelationExpansion`:50, `Expansion`:53, `selectionnerExpansion`:77, `appliquerPlafondDur`:120
- `src/server/knowledge/fusion-rang.ts` : `K_RRF`:28, `OptionsFusionRang`:30, `fusionnerParRang`:70
- `src/server/knowledge/gouvernance.ts` : `MotifGouvernance`:29, `estRecuperable`:40, `motifBlocage`:49, `STATUTS_NON_RECUPERABLES`:61, `attestationDepuisPorte`:88
- `src/server/knowledge/ingestion.ts` : `ProvenanceIngestion`:28, `RevueIngestion`:36, `DossierIngestion`:46, `MotifRejetIngestion`:62, `VerdictIngestion`:72, `validerSource`:86
- `src/server/knowledge/pages.ts` : `LocalisationPage`:29, `localiserExtrait`:57, `retirerMarqueursPageAffichage`:84, `localisationDeLOuvrage`:93, `formaterLocalisation`:108, `CartePages`:121, `carteDepuisJson`:128, `localiserDepuisUnite`:146, `SourceCitation`:168, `ligneCitation`:204, `citationDepuisExtrait`:227
- `src/server/knowledge/parallele.ts` : `mapLimite`:24
- `src/server/knowledge/preuve.ts` : `SEUIL_PERTINENCE`:22, `SEUIL_FAIBLESSE`:25, `construirePreuve`:32, `qualifier`:63, `cloturerPourJarvis`:90
- `src/server/knowledge/recherche.ts` : `LIMITES`:27, `CandidatBrut`:41, `CandidatFusionne`:60, `fusionnerCandidats`:92, `appliquerBudgetOctets`:158, `versCandidat`:178, `orchestrerRecherche`:206
- `src/server/knowledge/rerank-cross-encoder.ts` : `RERANK_CROSS_ENCODER_NOM`:31, `RERANK_CROSS_ENCODER_VERSION`:34, `TRONCATURE_PAIRE_MAX`:37, `EncodagePaires`:40, `TokenizerPairesMinimal`:46, `SessionCrossEncoderMinimale`:52, `ConstructeurTenseurCrossEncoder`:59, `OrtCrossEncoderMinimal`:64, `ScoreurCrossEncoder`:69, `encoderPaires`:81, `noterPairesDepuisSession`:142, `reordonnerParLogits`:199, `creerRerankerCrossEncoder`:220
- `src/server/knowledge/rerank-secondaire-production.ts` : `ENV_DOSSIER_RERANK_SECONDAIRE`:42, `CHEMIN_RECETTE_RERANK_SECONDAIRE`:45, `SLUG_RERANK_SECONDAIRE`:48, `CANDIDATS_RERANK`:58, `TRONCATURE_RERANK_SECONDAIRE`:59, `SEUIL_RERANK_INUTILE`:60, `StatutRerankSecondaire`:62, `RecetteRerankSecondaire`:117, `lireRecetteRerankSecondaire`:123, `rerankerSecondaireProduction`:194, `reinitialiserRerankSecondaireProduction`:214, `statutRerankSecondaire`:219
- `src/server/knowledge/rerank.ts` : `RERANK_VERSION`:30, `CandidatRange`:33, `RerankerLocal`:47, `RerankerLocalAsync`:63, `reranker`:76, `CalibrationFusion`:111, `CALIBRATION_COURANTE`:125, `CALIBRATION_A3`:139, `rerankerCalibre`:152, `HeuristiqueBaseline`:170, `jetoniser`:282
- `src/server/knowledge/stockage.ts` : `TABLES`:45, `PORTES`:53, `DIMENSION_VECTEUR_SECONDAIRE`:71, `INDEX_HNSW_SQL`:78, `INDEX_UNICITE_SQL`:87, `GARDE_LIGNEE_SQL`:99, `COLONNES_CHUNK`:103, `COLONNES_LIGNEE`:119, `COLONNES_ATTESTATION_SQL`:133, `FILTRE_AUTORITE_SQL`:148, `AppelPorte`:158, `porteLexicale`:170, `porteVectorielle`:188, `porteVectorielleV2`:209, `sqlPorteLexicalePropose`:240, `sqlPorteVectoriellePropose`:263, `sqlPorteVVectorielleV2Propose`:287, `LignePorte`:315, `normaliserHorodatage`:344, `validerLignePorte`:351, `lignePorteRecuperable`:430
- `src/server/knowledge/terminologie-bilingue.ts` : `VERSION_TERMINOLOGIE`:70, `TERMINOLOGIE_BILINGUE_ACTIVE`:76, `OrigineRealisation`:86, `CorrespondanceTerminologie`:88, `CORRESPONDANCES`:119, `META_MOTS_LIVRE`:469, `MOTS_OUTILS_QUESTION`:482, `ALIASES_PLANIFICATEUR_FR_EN`:513, `PlanBilingue`:530, `PLAN_BILINGUE_VIDE`:546, `planifierExpansionBilingue`:596, `rubriquesDeOrigine`:713, `conceptsReconnus`:723, `jetonsDeForme`:736, `rubricExiste`:741
- `src/server/knowledge/types.ts` : `SourceId`:24, `ChunkId`:27, `Langue`:33, `StatutSource`:40, `AttestationSource`:61, `Provenance`:75, `RetrievedEvidence`:96, `IssueRecherche`:120, `ResultatRecherche`:122
- `src/server/knowledge/vecteur-production.ts` : `ENV_DOSSIER_MODELE`:46, `CHEMIN_RECETTE`:49, `FnVecteurRequete`:52, `StatutVecteur`:55, `DependancesChargeurVecteur`:62, `ChargeurVecteur`:75, `creerChargeurVecteur`:85, `chargeurVecteurProduction`:185, `vecteurRequeteProduction`:191, `reinitialiserVecteurProduction`:196
- `src/server/knowledge/vecteur-secondaire-production.ts` : `ENV_DOSSIER_SECONDAIRE`:44, `ENV_RECETTE_SECONDAIRE`:47, `SLUG_RECETTE_SECONDAIRE_DEFAUT`:50, `CHEMINS_RECETTE_SECONDAIRE`:53, `CHEMIN_RECETTE_SECONDAIRE`:59, `SLUG_MODELE_SECONDAIRE`:62, `FnVecteurSecondaire`:64, `StatutVecteurSecondaire`:66, `DependancesChargeurSecondaire`:71, `ChargeurSecondaire`:85, `creerChargeurSecondaire`:94, `chargeurSecondaireProduction`:201, `vecteurRequeteSecondaireProduction`:207, `reinitialiserVecteurSecondaireProduction`:212

## `src/server/voice`

- `src/server/voice/chemins.ts` : `EnvironnementVoix`:3, `CheminsVoix`:16, `resoudreCheminsVoix`:42
- `src/server/voice/corps.ts` : `lireCorpsVoix`:2
- `src/server/voice/live-tools.ts` : `ContexteLive`:4, `patientFictif`:18, `lireOutilLive`:41, `OUTILS_LIVE`:124
- `src/server/voice/modeles.ts` : `ModeleVocal`:11, `ModeleFichier`:22, `ModeleDossier`:29, `MODELES_VOIX`:38, `NomModeleVocal`:81, `verifierFichierModele`:95, `verifierDossierModele`:115, `verifierFichierModeleSync`:139
- `src/server/voice/protocole.ts` : `EntreeVoix`:12, `validerEntreeVoix`:13, `ReponseVoix`:20, `CanalVoixNative`:22
- `src/server/voice/runtime.ts` : `preparerVoixNative`:194, `demanderVoixNative`:219, `arreterVoixNative`:246, `StatutVoixNative`:255, `statutVoixNative`:266
- `src/server/voice/session.ts` : `empreinteSessionVoix`:11, `sessionVoix`:15, `voixLocaleConfiguree`:22
- `src/server/voice/wake-runtime.ts` : `preparerReveil`:174, `demanderReveil`:250, `arreterReveil`:273, `reveilActif`:278
