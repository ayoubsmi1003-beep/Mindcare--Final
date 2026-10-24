import {unfinishedNativeRequest} from '../helpers/alexa-unfinished-request';
import { expect, it, vi } from 'vitest';
import { constrainCompoundDeclaration, constrainCountDeclaration, countContractHints, frenchPatientCompoundContract, frenchPatientCountContract, frenchReadArgumentBindings, frenchRequestAdmission, requestedReadTool } from '@/shared/alexa/request-contract';
import type { RequestPart } from '@/shared/alexa/agent';
import { runAgentLoop as runNativeLoop } from '@/server/alexa/agent-loop';
import type { LocalCompletion, LocalTextOptions } from '@/server/alexa/local-model-protocol';

it.each([
  ['Quelles charges sont enregistrées ce mois ?', 'query_finance', { financeMode: 'charges' }],
  ['Quel est le chiffre d’affaires de ce mois ?', 'query_finance', { financeMode: 'overview' }],
  ['Quel est le nom du cabinet ?', 'query_app', { applicationView: 'cabinet' }],
  ['Quel est le profil du praticien ?', 'query_app', { applicationView: 'practitioner' }],
  ['Quels certificats médicaux ont été émis pour le patient sélectionné ?', 'query_documents', { documentKind: 'certificat_medical', documentStatus: 'issued' }],
  ['Que dit le DSM-5 sur les épisodes dépressifs ?', 'search_knowledge', {}],
  ['Lis les notes de la dernière consultation du patient sélectionné.', 'get_patient_context', { patientSection: 'notes' }],
  ['Quels diagnostics sont enregistrés pour le patient sélectionné ?', 'get_patient_context', { patientSection: 'diagnoses' }],
  ['Quelles échelles ont été remplies pour le patient sélectionné ?', 'get_patient_context', { patientSection: 'scales' }],
  ['Quel traitement est enregistré pour le patient sélectionné ?', 'get_patient_context', { patientSection: 'treatments' }],
  ['Combien de consultations terminées a ce patient ?', 'query_consultations', { consultationMode: 'count' }],
])('admits the clear French read capability for: %s', (text, tool, constraints) => {
  expect(frenchRequestAdmission(text, false)).toMatchObject({ tools: [tool], ...constraints });
});

it('keeps financial ambiguity and mixed domains open for native interpretation', () => {
  expect(frenchRequestAdmission('Pourquoi les charges électriques s’attirent-elles ?', true).tools).toEqual(['answer_general']);
  expect(frenchRequestAdmission('Compare les revenus et les rendez-vous de demain.', false).tools).toBeUndefined();
});

it.each([
  ['Montre les rendez-vous de demain', 'query_agenda'],
  ['Identifie les patients avec un dossier administratif incomplet', 'query_patients'],
  ['Résume les champs manquants du dossier patient', 'query_patients'],
  ['Prépare la liste des corrections pour ma revue', 'query_patients'],
  ['Quels certificats médicaux ont été émis ?', 'query_documents'],
  ['Lis les notes signées de la consultation', 'get_patient_context'],
  ['Donne les recettes encaissées ce mois', 'query_finance'],
  ['Que dit Taylor sur le traitement ?', 'search_knowledge'],
])('binds an explicit requested output to its authorized read gate: %s', (goal, expected) => {
  expect(requestedReadTool(goal, goal)).toBe(expected);
});

const input = { text: '', conversationId: 'read-scope', clientTurnId: '11111111-1111-4111-8111-111111111111', appContext: { patientId: '22222222-2222-4222-8222-222222222222', page: '/patients/22222222-2222-4222-8222-222222222222' } };
const call = (id: string, name: string, args: Record<string, unknown>): LocalCompletion => ({ kind: 'calls', calls: [{ id, name, args }], message: { role: 'assistant', content: null }, tokensIn: 1, tokensOut: 1 });
async function exposedReadSchema(text: string, tool: string) {
  const options: LocalTextOptions[] = [];
  let step = 0;
  await runAgentLoop({ ...input, text }, { actor: 'read-scope', execute: vi.fn(), infer: async (_messages, current) => {
    options.push(current);
    if (step++ === 0) return call('declare', 'declare_request', { parts: [{ id: 'p', goal: text, tool, conditions: [], dependsOn: [] }] });
    throw Error('Capture only');
  } }, new AbortController().signal);
  return options[1]?.tools?.find(candidate => candidate.function.name === tool)?.function.parameters;
}

it.each([
  ['Quelles charges sont enregistrées ce mois ?', 'query_finance', 'mode', ['charges']],
  ['Quel est le nom du cabinet ?', 'query_app', 'view', ['cabinet']],
  ['Quels certificats médicaux ont été émis ?', 'query_documents', 'kind', ['certificat_medical']],
  ['Quels certificats médicaux ont été émis ?', 'query_documents', 'status', ['issued']],
  ['Lis les notes de la dernière consultation du patient sélectionné.', 'get_patient_context', 'section', ['notes']],
  ['Combien de consultations terminées a ce patient ?', 'query_consultations', 'mode', ['count']],
])('narrows %s to the user-requested %s values before native dispatch', async (text, tool, key, values) => {
  const schema = await exposedReadSchema(text, tool);
  if(tool==='get_patient_context'){
    expect(schema?.properties).not.toHaveProperty(key);
    expect(frenchReadArgumentBindings(frenchRequestAdmission(text,false),tool)).toMatchObject({[key]:values[0]});
  }else expect((schema?.properties as Record<string, { enum?: string[] }> | undefined)?.[key]?.enum).toEqual(values);
});

it('binds compound patient filters to the active population and rejects a model-expanded population', () => {
  const contract = frenchPatientCompoundContract('Trouve les patients adultes avec un solde restant positif et sans consultation terminée depuis 90 jours.')!;
  const part: RequestPart = { id: 'p', goal: contract.text, tools: ['query_patients'], conditions: contract.conditions, dependsOn: [], status: 'pending', resultRefs: [] };
  expect(constrainCompoundDeclaration([part], contract)[0]?.population).toBe('active');
  expect(() => constrainCompoundDeclaration([{ ...part, population: 'all' }], contract)).toThrow('PatientPopulationMismatch');
});

it('turns the French active-patient default into an explicit population filter', () => {
  const contract = frenchPatientCountContract('Combien de patients actifs avons-nous ?')!;
  const base: RequestPart = { id: 'p', goal: contract.clauses[0]!, tools: ['query_patients'], conditions: [], dependsOn: [], status: 'pending', resultRefs: [] };
  for (const alias of ['active', 'population:active']) {
    const part = { ...base, unsupportedConditions: [alias] };
    const constrained = constrainCountDeclaration([part], contract)[0]!;
    expect(constrained.population).toBe('active');
    expect(constrained.unsupportedConditions).toBeUndefined();
  }
  expect(() => constrainCountDeclaration([{ ...base, population: 'all' }], contract)).toThrow('PatientPopulationMismatch');
});

it.each([
  ['Combien de dossiers actifs sont sans numéro de carte nationale ?', 'identity_card:missing'],
  ['Quel est le nombre de patients dont le numéro d’identité est vide ?', 'identity_card:missing'],
  ['Au total, combien de fiches actives n’ont aucun numéro de carte d’identité ?', 'identity_card:missing'],
  ['Compte les dossiers actifs sans numéro de carte nationale.', 'identity_card:missing'],
  ['Donne uniquement le nombre de patients sans pièce d’identité renseignée.', 'identity_card:missing'],
  ['Quel est le total des patients actifs auxquels il manque le numéro de carte d’identité ?', 'identity_card:missing'],
  ['Sur tous les patients actifs, combien sont sans numéro d’identification nationale ?', 'identity_card:missing'],
  ['Compte les patients actifs avec un numéro de document d’identité nul ou vide.', 'identity_card:missing'],
])('normalizes an explicit French identity-number absence into its typed filter: %s', (text, expected) => {
  const contract = frenchPatientCountContract(text);
  expect(contract).not.toBeNull();
  expect(countContractHints(contract!)[0]?.conditions).toEqual([expected]);
});

it('maps only a known model synonym to the explicit identity filter and leaves email unsupported', () => {
  const contract = frenchPatientCountContract('Combien de patients sont sans numéro de carte nationale ?')!;
  const base: RequestPart = { id: 'p', goal: contract.clauses[0]!, tools: ['query_patients'], conditions: [], dependsOn: [], status: 'pending', resultRefs: [] };
  for (const alias of ['no_national_card_number', 'identity:empty', 'identity_card:null']) {
    const normalized = constrainCountDeclaration([{ ...base, unsupportedConditions: [alias] }], contract)[0]!;
    expect(normalized.conditions).toEqual([{ field: 'identity_card', op: 'missing', value: null }]);
    expect(normalized.unsupportedConditions).toBeUndefined();
  }
  const email = frenchPatientCountContract('Combien de patients sont sans email ?')!;
  expect(constrainCountDeclaration([{ ...base, goal: email.clauses[0]! }], email)[0]?.unsupportedConditions).toContain('email');
});

it.each([
  ['Je voudrais seulement le nombre total des patients actifs.', []],
  ['Quelle est la taille de la patientèle active ?', []],
  ['Donne le total des patients actifs qui n’ont pas encore dix-huit ans.', ['age:lt:18']],
  ['Compte les patients actifs âgés de moins de 18 ans, sans inclure les âges inconnus.', ['age:lt:18']],
  ['Combien de patients actifs n’ont pas atteint leur dix-huitième anniversaire ?', ['age:lt:18']],
  ['Compte les dossiers actifs avec une date de naissance absente.', ['birth_date:missing']],
  ['Compte les patients de moins de zéro an.', ['age:lt:0']],
])('preserves one count and its explicit conditions: %s', (text, conditions) => {
  const contract = frenchPatientCountContract(text);
  expect(contract?.clauses).toHaveLength(1);
  expect(countContractHints(contract!)[0]?.conditions).toEqual(conditions);
});

it('keeps an explicitly active population when the doctor says all active patients', () => {
  const text = 'Sur tous les patients actifs, combien sont sans numéro d’identification nationale ?';
  const contract = frenchPatientCountContract(text)!;
  const part: RequestPart = { id: 'active', goal: text, tools: ['query_patients'], conditions: [{ field: 'identity_card', op: 'missing', value: null }], dependsOn: [], status: 'pending', resultRefs: [] };
  expect(constrainCountDeclaration([part], contract)[0]?.population).toBe('active');
  expect(() => constrainCountDeclaration([{ ...part, population: 'all' }], contract)).toThrow('PatientPopulationMismatch');
});

it.each([
  ['Quel est le nom du cabinet ?', 'query_app'],
  ['Montre les rendez-vous de demain.', 'query_agenda'],
  ['Quels diagnostics sont enregistrés pour le patient sélectionné ?', 'get_patient_context'],
  ['Quel est le téléphone du patient sélectionné ?', 'get_patient_context'],
  ['Quelles charges sont enregistrées ce mois ?', 'query_finance'],
])('keeps simple read metadata free of invented patient predicates: %s', async (text, tool) => {
  let schema: Record<string, unknown> | undefined;
  await runAgentLoop({ ...input, text, conversationId: crypto.randomUUID() }, { actor: 'read-metadata', execute: vi.fn(), infer: async (_messages, options) => {
    schema = options.tools?.find(candidate => candidate.function.name === 'declare_request')?.function.parameters;
    throw Error('Capture only');
  } }, new AbortController().signal);
  const fields = (schema?.properties as { parts?: { items?: { properties?: Record<string, unknown> } } } | undefined)?.parts?.items?.properties;
  expect(fields?.tool).toMatchObject({ enum: [tool] });
  expect(fields?.conditions).toMatchObject({ maxItems: 0 });
  expect(fields?.unsupportedConditions).toBeDefined();
});

it('retries an invented missing-phone predicate before reading the recorded phone', async () => {
  let step = 0;
  const text = 'Quel est le téléphone du patient sélectionné ?';
  const execute = vi.fn(async (tool: { id: string }) => ({ callId: tool.id, status: 'ok' as const, complete: true, text: '0550000000', evidence: [], conditionKeys: [] }));
  const result = await runAgentLoop({ ...input, text, conversationId: crypto.randomUUID() }, { actor: 'read-metadata', execute, infer: async () => {
    if (step++ < 2) return call('d' + step, 'declare_request', { parts: [{ id: 'p', goal: text, tool: 'get_patient_context', conditions: step === 1 ? ['phone:missing'] : [], dependsOn: [] }] });
    return call('q', 'get_patient_context', { partIds: ['p'], section: 'profile' });
  } }, new AbortController().signal);
  expect(result.status).toBe('completed');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(result.parts[0]?.conditions).toEqual([]);
});

it('keeps an explicit cabinet read on its gate when metadata asks an unnecessary question', async () => {
  let step = 0;
  const text = 'Quel est le nom du cabinet ?';
  const execute = vi.fn(async (tool: { id: string }) => ({ callId: tool.id, status: 'ok' as const, complete: true, text: 'Cabinet synthétique', evidence: [], conditionKeys: [] }));
  const result = await runAgentLoop({ ...input, text, conversationId: crypto.randomUUID() }, { actor: 'read-metadata', execute, infer: async () => {
    if (step++ < 2) return call('d' + step, 'declare_request', { parts: [{ id: 'p', goal: text, tool: step === 1 ? 'ask_doctor' : 'query_app', conditions: [], dependsOn: [] }] });
    return call('q', 'query_app', { partIds: ['p'], view: 'cabinet' });
  } }, new AbortController().signal);
  expect(result.status).toBe('completed');
  expect(execute).toHaveBeenCalledTimes(1);
});

it('retains material population filters and unsupported fields on mixed requests', async () => {
  let schema: Record<string, unknown> | undefined;
  await runAgentLoop({ ...input, text: 'Montre les rendez-vous de demain des patients mineurs.', conversationId: crypto.randomUUID() }, { actor: 'read-metadata', execute: vi.fn(), infer: async (_messages, options) => {
    schema = options.tools?.find(candidate => candidate.function.name === 'declare_request')?.function.parameters;
    throw Error('Capture only');
  } }, new AbortController().signal);
  const fields = (schema?.properties as { parts?: { items?: { properties?: Record<string, unknown> } } } | undefined)?.parts?.items?.properties;
  expect(fields?.conditions).not.toMatchObject({ maxItems: 0 });
  expect(fields?.unsupportedConditions).toBeDefined();
});

it('lets the admitted gate report missing patient identity without reading a guessed chart', async () => {
  let step = 0;
  const text = 'Lis les notes du patient.';
  const execute = vi.fn(async (tool: { id: string }) => ({ callId: tool.id, status: 'needs_input' as const, complete: false, text: 'Quel patient souhaitez-vous sélectionner ?', evidence: [], conditionKeys: [] }));
  const result = await runAgentLoop({ ...input, text, conversationId: crypto.randomUUID(), appContext: { patientId: null, page: '/jarvis' } }, { actor: 'read-metadata', execute, infer: async () => step++ === 0
    ? call('d', 'declare_request', { parts: [{ id: 'p', goal: text, tool: 'get_patient_context', conditions: [], dependsOn: [] }] })
    : call('q', 'get_patient_context', { partIds: ['p'], section: 'notes' })
  }, new AbortController().signal);
  expect(result.status).toBe('needs_input');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(result.patientId).toBeNull();
});

it('blocks a model-only clarification after a fully scoped cabinet declaration', async () => {
  let step = 0;
  const text = 'Quel est le nom du cabinet ?';
  const execute = vi.fn(async (tool: { id: string }) => ({ callId: tool.id, status: 'ok' as const, complete: true, text: 'Cabinet synthétique', evidence: [], conditionKeys: [] }));
  const result = await runAgentLoop({ ...input, text, conversationId: crypto.randomUUID() }, { actor: 'read-metadata', execute, infer: async () => {
    if (step++ === 0) return call('d', 'declare_request', { parts: [{ id: 'p', goal: text, tool: 'query_app', conditions: [], dependsOn: [] }] });
    if (step === 2) return call('unnecessary', 'ask_doctor', { partIds: ['p'], question: 'Quel cabinet ?' });
    return call('q', 'query_app', { partIds: ['p'], view: 'cabinet' });
  } }, new AbortController().signal);
  expect(result.status).toBe('completed');
  expect(execute).toHaveBeenCalledTimes(1);
});

it.each([
  ['Quelles charges sont enregistrées ce mois ?', 'query_finance', ['state', 'patientId', 'patientName', 'reusePrevious', 'revision']],
  ['Quel est le chiffre d’affaires de ce mois ?', 'query_finance', ['state', 'patientId', 'patientName', 'offset', 'reusePrevious', 'revision']],
  ['Liste les consultations de ce patient.', 'query_consultations', ['view', 'consultationId', 'textOffset', 'revision', 'reusePrevious']],
  ['Combien de consultations terminées a ce patient ?', 'query_consultations', ['view', 'consultationId', 'textOffset', 'revision', 'reusePrevious']],
  ['Lis les notes de travail enregistrées de ce patient.', 'get_patient_context', ['count']],
])('exposes only compatible arguments for a known read shape: %s', async (text, tool, omitted) => {
  const schema = await exposedReadSchema(text, tool);
  for (const field of omitted) expect(Object.hasOwn(schema?.properties as object, field)).toBe(false);
});

it('keeps detailed consultation reads and patient-specific financial views available', async () => {
  const details = await exposedReadSchema('Donne les détails de la consultation 33333333-3333-4333-8333-333333333333.', 'query_consultations');
  expect(Object.hasOwn(details?.properties as object, 'view')).toBe(true);
  expect(frenchRequestAdmission('Quel est le chiffre d’affaires pour le patient sélectionné ?', false).financeMode).toBeUndefined();
});

it('recovers once from a plain answer before native declaration without trusting its facts', async () => {
  let step = 0;
  const text = 'Lis les notes du patient sélectionné.';
  const execute = vi.fn(async (tool: { id: string }) => ({ callId: tool.id, status: 'ok' as const, complete: true, text: 'Texte vérifié de la note', evidence: [], conditionKeys: [] }));
  const result = await runAgentLoop({ ...input, text, conversationId: crypto.randomUUID() }, { actor: 'read-metadata', execute, infer: async () => {
    if (step++ === 0) return { kind: 'answer', text: 'Fait inventé non vérifié', tokensIn: 1, tokensOut: 1 };
    if (step === 2) return call('d', 'declare_request', { parts: [{ id: 'p', goal: text, tool: 'get_patient_context', conditions: [], dependsOn: [] }] });
    return call('q', 'get_patient_context', { partIds: ['p'], section: 'notes' });
  } }, new AbortController().signal);
  expect(result.status).toBe('completed');
  expect(execute).toHaveBeenCalledTimes(1);
  expect(result.sentences.join(' ')).not.toContain('Fait inventé');
});

it('bounds recovery when the model never declares the requested read', async () => {
  const infer = vi.fn(async () => ({ kind: 'answer' as const, text: 'Non vérifié', tokensIn: 1, tokensOut: 1 }));
  const execute = vi.fn();
  const result = await runAgentLoop({ ...input, text: 'Lis les notes du patient sélectionné.', conversationId: crypto.randomUUID() }, { actor: 'read-metadata', execute, infer }, new AbortController().signal);
  expect(result.status).toBe('failed');
  expect(infer).toHaveBeenCalledTimes(2);
  expect(execute).not.toHaveBeenCalled();
});


it.each([
 'Prépare un brouillon de certificat de bonne santé mentale pour ce patient, à vérifier avant toute émission.',
 'Peux-tu me préparer un brouillon de justification modifiable pour ce patient ?',
 'Propose un rendez-vous demain pour ce patient.',
 'Prépare pour ma revue un brouillon de certificat médical.',
])('does not hide preparation tools behind an exclusive read gate: %s', text => {
  expect(frenchRequestAdmission(text, false).tools).toEqual(['prepare_action']);
  expect(frenchRequestAdmission(text, false).profileOnly).toBe(false);
});
it('keeps displaying prepared documents a read operation', () => {
  expect(frenchRequestAdmission('Affiche les brouillons de certificats déjà préparés.', false).tools).toEqual(['query_documents']);
});

it.each([
 ['Résume le cas du patient sélectionné.', 'summary'],
 ['Quels diagnostics sont enregistrés pour le patient sélectionné ?', 'diagnoses'],
 ['Quel traitement est enregistré pour le patient sélectionné ?', 'treatments'],
 ['Quelles échelles ont été remplies pour le patient sélectionné ?', 'scales'],
])('does not offer note-only arguments for %s',async(text,section)=>{
 const schema=await exposedReadSchema(text,'get_patient_context');
 expect(frenchReadArgumentBindings(frenchRequestAdmission(text,false),'get_patient_context')).toMatchObject({section});
 for(const field of ['consultationId','area','query','from','to','status','offset','textOffset','maxCharacters','revision','reusePrevious'])expect(schema?.properties).not.toHaveProperty(field);
});
it('dispatches a bound summary once without requiring the model to repeat grounded slots',async()=>{
 const text='Résume le cas du patient sélectionné.';
 const execute=vi.fn(async(c:{id:string})=>({callId:c.id,status:'ok' as const,complete:true,text:'Le patient rapporte des difficultés familiales.',evidence:[],conditionKeys:[]}));
 let step=0;
 await runAgentLoop({...input,text},{actor:'read-scope',execute,infer:async()=>step++===0?call('d','declare_request',{parts:[{id:'p',goal:text,tool:'get_patient_context',conditions:[],dependsOn:[]}]}):call('r','get_patient_context',{partIds:['p']})},new AbortController().signal);
 expect(execute).toHaveBeenCalledTimes(1);
 expect(execute.mock.calls[0]?.[0]).toMatchObject({name:'get_patient_context',args:{partIds:['p'],section:'summary'}});
});

// Keep native admission assertions independent of fresh deterministic shortcuts.
const runAgentLoop=(...args:Parameters<typeof runNativeLoop>)=>runNativeLoop(unfinishedNativeRequest(args[0],args[1].actor),args[1],args[2]);
