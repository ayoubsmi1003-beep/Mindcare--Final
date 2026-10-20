import {requestedConsultationCount,requestsOldestConsultations} from "./request-plan";
import {parsePatientMention} from "./patient-mention";
import type {RequestPart,SupportedCondition} from './agent';
const fold=(value:string)=>value.normalize('NFKD').replace(/\p{M}/gu,'').replace(/[’‘]/gu,"'").toLocaleLowerCase();
const frenchMonths=['janvier','fevrier','mars','avril','mai','juin','juillet','aout','septembre','octobre','novembre','decembre'] as const;
/** Closed full-month ranges only; missing years and cross-year ambiguity stay on the model path. */
export function explicitFrenchMonthRange(text:string):{from:string;to:string}|null{
 const plain=fold(text),month=frenchMonths.join('|'),pattern=new RegExp(`(?:\\bentre\\s+|\\bde\\s+|d')(${month})\\s+(?:a|et|jusqu(?:a|au)?)\\s+(${month})\\s+((?:19|20)\\d{2})\\b`,'gu');
 const matches=[...plain.matchAll(pattern)];
 if(matches.length!==1||[...plain.matchAll(/\b(?:19|20)\d{2}\b/gu)].length!==1)return null;
 const match=matches[0]!,start=frenchMonths.indexOf(match[1] as typeof frenchMonths[number]),end=frenchMonths.indexOf(match[2] as typeof frenchMonths[number]),year=Number(match[3]);
 if(start<0||end<start)return null;
 const from=`${year}-${String(start+1).padStart(2,'0')}-01T00:00:00+01:00`,nextMonth=end===11?{year:year+1,month:1}:{year,month:end+2};
 return {from,to:`${nextMonth.year}-${String(nextMonth.month).padStart(2,'0')}-01T00:00:00+01:00`};
}
export interface FrenchCountContract {clauses:readonly string[];}
function closedMetricFragment(text:string,field?:SupportedCondition['field']):boolean{
 const header='compte comptes comptez combien nombre total effectif patients patient dossiers dossier patientele actif actifs active actives tous toutes tout toute la le les de du des sont est';
 const prefix='puis separement les le la de du des actifs active actives sont combien n ont pas sans eu et';
 const words=field==='identity_card'?prefix+' numero numeros d identite carte cartes piece pieces nationale nationales national':field==='age'?prefix+' moins dix huit 18 ans enfant enfants mineur mineurs':field==='no_completed_months'?prefix+' aucune aucun consultation consultations terminee terminees termine termines close closes dans six 6 dernier derniers mois depuis':header;
 const allowed=new Set(words.split(' '));
 return (fold(text).match(/[\p{L}\p{N}]+/gu)??[]).every(word=>allowed.has(word));
}
function separateMetricClauses(text:string):readonly string[]|null|undefined{
 const plain=fold(text);
 if(!/\b(?:separement|chaque nombre)\b/u.test(plain))return undefined;
 if(! /\b(?:patients?|patientele)\b/u.test(plain)||/\b(?:agenda|rendez[- ]vous|finance|prepar\w*|modifi\w*|ouvre|lis)\b/u.test(plain))return null;
 const fragments=text.split(/[.,?;]|\bet\s+(?=(?:les|des|ces)\s+actifs?\b|n['’]ont\b|ont\s+moins)/iu).map(s=>s.trim()).filter(Boolean);
 const clauses:string[]=[];const seen=new Set<string>();
 for(const fragment of fragments){
  const p=fold(fragment),conditions=explicitConditions(fragment)??[];
  if(!conditions.length&&/^parmi (?:les|ces) actifs$|^donne chaque nombre separement$/u.test(p))continue;
  if(!clauses.length&&!conditions.length&&/\b(?:actifs?|actives?)\b/u.test(p)&&/\b(?:patients?|patientele)\b/u.test(p)&&closedMetricFragment(fragment)){clauses.push(fragment);continue;}
  if(conditions.length!==1)return null;
  const c=conditions[0]!,metric=key(c);
  if((c.field==='age'&&/\bpas\b/u.test(p))||/\bpas\s+(?:sans|aucun\w*)\b/u.test(p))return null;
  if(!['["identity_card","missing",null]','["age","lt",18]','["no_completed_months","eq",6]'].includes(metric)||seen.has(metric)||!closedMetricFragment(fragment,c.field))return null;
  seen.add(metric);clauses.push(fragment);
 }
 return clauses.length===4&&seen.size===3?clauses:null;
}
/** An output constraint only: it never chooses a gate, queries records or invents an answer. */
export function frenchPatientCountContract(text:string):FrenchCountContract|null {
 const enumerated=enumeratedPatientMetricClauses(text);if(enumerated!==undefined)return enumerated?{clauses:enumerated}:null;
 const separate=separateMetricClauses(text);if(separate!==undefined)return separate?{clauses:separate}:null;
 const plain=fold(text),combien=[...text.matchAll(/\bcombien\b/giu)],starts=(combien.length?combien:[...text.matchAll(/\b(?:nombre(?:\s+total)?|total|effectif|d[ée]compte|taille(?=\s+de\s+la\s+patient[èe]le)|compte(?:r|z)?(?=\s+(?:tous|toutes|les?|des?|patients?|dossiers?|fiches?)))/giu)]).map(m=>m.index);
 const presentation=[...plain.matchAll(/\b(?:donne|affiche|montre)\w*/gu)],singleLeadingPresentation=presentation.length===1&&presentation[0]!.index===0&&presentation[0]!.index<starts[0]!;
 if(!starts.length||! /\b(?:patients?|dossiers?|fiches?|patientele)\b/u.test(plain)||/\b(?:lis|lire|expliqu\w*|resum\w*|detaill\w*|compar\w*|list\w*|lesquels|lesquelles|prepar\w*|cre[er]\w*|modifi\w*|annul\w*|ouvre\w*)\b|\b(?:leurs?|les)\s+noms?\b/u.test(plain)||(presentation.length>0&&!singleLeadingPresentation))return null;
 const identityDocumentField=/\b(?:numero\s+(?:de\s+)?|piece\s+|carte\s+|document\s+)d[' ]?identite\b|\bcarte nationale\b|\bcni\b/u.test(plain);
 const savedDocumentIntent=/\bdocuments?\b/u.test(plain)&&!identityDocumentField;
 if(/\b(?:et|puis|aussi)\s+(?:quels?|quelles?|qui|comment|pourquoi|est-ce)\b|\b(?:rendez-vous|agenda|recettes?|revenus?|charges?)\b|(?:combien|compte(?:r|z)?|nombre(?:\s+total)?|total)\s+(?:(?:de|du|des|ses|les|toutes|tous)\s+)*consult\w*\b/u.test(plain)||savedDocumentIntent)return null;
 // A single interrogative with comma-separated categories may mean several outputs.
 // Leave that ambiguous form to native interpretation instead of forcing one output.
 if(starts.length===1&&text.slice(starts[0]).includes(',')&&!/^[^,]+,\s*(?:sans inclure|en excluant|hors)\b[^,]*$/iu.test(text.slice(starts[0])))return null;
 const clauses=starts.length===1?[text.trim()]:starts.map((at,i)=>text.slice(at,starts[i+1]??text.length).replace(/[,;\s]+(?:et\s*)?$/iu,'').trim());
 return clauses.length<=12?{clauses}:null;
}
/** Recognize a closed list of patient metrics following one explicit count verb. */
function enumeratedPatientMetricClauses(text:string):readonly string[]|undefined{
 const prefix=text.match(/^\s*(?:pour\s+le\s+cabinet\s*,\s*)?(?:compte(?:r|z)?|d[ée]nombre(?:r|z)?|calcule(?:r|z)?|donne(?:r|z)?\s+(?:le|les)?|donne(?:r|z)?\s+(?:quatre\s+)?chiffres?\s*:\s*|indique(?:r|z)?\s+(?:s[ée]par[ée]ment\s+)?le\s+nombre\s+d[’']|fais\s+(?:un\s+)?bilan\s+en\s+quatre\s+points?\s*:\s*|quels?\s+sont\s+les\s+quatre\s+nombres?\s+correspondants?\s+aux?|je\s+veux\s+(?:le\s+)?total\s+(?:de|des))(?:\s+|(?=actifs?\b))/iu);
 if(!prefix)return undefined;
 const tail=text.slice(prefix[0].length),clauses=tail.split(/[,;]|\b(?:et|puis)\b/iu).map(clause=>clause.trim().replace(/^[,;\s]+|[,;\s?.!]+$/gu,'')).filter(Boolean);
 if(clauses.length<2||clauses.length>7)return undefined;
 if(/\b(?:agenda|rendez[- ]?vous|rdv|recettes?|revenus?|charges?|documents?|emails?|courriels?)\b/u.test(fold(tail)))return undefined;
 const metricFor=(clause:string):string|null=>{
  const plain=fold(clause),conditions=explicitConditions(clause)??[];
  if(!conditions.length&&(/\b(?:patients?|dossiers?)\s+actifs?\b|\beffectif\s+actif\b|^actifs?$\b/u.test(plain))&&! /\b(?:sans|aucun\w*|pas|manquant\w*)\b/u.test(plain))return 'active';
  if(conditions.length!==1)return null;
  const condition=conditions[0]!;
  if(condition.field==='identity_card'&&condition.op==='missing')return 'missing_identity_card';
  if(condition.field==='phone'&&condition.op==='missing')return 'missing_phone';
  if(condition.field==='age'&&condition.op==='lt'&&condition.value===18)return 'children';
  if(condition.field==='birth_date'&&condition.op==='missing')return 'unknown_age';
  if(condition.field==='no_completed_months'&&condition.op==='eq'&&condition.value===6)return 'not_seen_6m';
  if(condition.field==='completed_consultations'&&condition.op==='eq'&&condition.value===0)return 'never_seen';
  return null;
 };
 const metrics=clauses.map(metricFor);
 if(metrics.some(metric=>!metric)||new Set(metrics).size!==metrics.length||! /\b(?:patients?|dossiers?)\b/u.test(fold(tail)))return undefined;
 return clauses;
}
const key=(c:SupportedCondition)=>JSON.stringify([c.field,c.op,c.value]);
const mentions:Record<SupportedCondition['field'],RegExp>={phone:/\b(?:telephones?|portables?|mobiles?)\b/u,identity_card:/\b(?:identite|identification nationale|cni|carte nationale|carte d[' ]?identite|piece d[' ]?identite|document d[' ]?identite|numero national)\b/u,birth_date:/\b(?:naissance|age)\b/u,sex:/\bsexe\b/u,age:/\b(?:age|ages?|ans?|anniversaires?|adultes?|majeurs?|enfants?|mineurs?)\b/u,completed_consultations:/\b(?:consult\w*|seances?|vus?|recus?|visites?|suivis?)\b/u,outstanding_balance:/\b(?:soldes?|impayes?|dettes?|encaisse\w*|paiements?)\b/u,no_completed_days:/\b(?:consult\w*|seances?|assiste\w*|vus?|recus?|visites?|suivis?)\b/u,no_completed_months:/\b(?:consult\w*|seances?|assiste\w*|vus?|recus?|visites?|suivis?)\b/u,administrative_incomplete:/\b(?:administrati\w*|dossiers?)\b/u};
/** Predicate admission is independent of a model-generated goal or cited database value. */
export function patientConditionsGrounded(conditions:readonly SupportedCondition[],text:string):boolean {
  const plain=fold(text),missing=/\bsans\b|\baucun\w*\b|\bpas\b|\bmanquant\w*\b|\bmanque\w*\b|\bnuls?\b|\babsences?\b|\babsent\w*\b|\binconnu\w*\b|\bnon\s+(?:renseigne\w*|enregistre\w*)\b|\bvides?\b/u.test(plain);
 const numeric=['age','completed_consultations','outstanding_balance'] as const;
 for(const field of numeric){let min=Number.NEGATIVE_INFINITY,max=Number.POSITIVE_INFINITY;for(const c of conditions.filter(item=>item.field===field&&typeof item.value==='number')){const n=c.value as number;if(c.op==='gte')min=Math.max(min,n);if(c.op==='gt')min=Math.max(min,n+1);if(c.op==='lt')max=Math.min(max,n-1);if(c.op==='eq'){min=Math.max(min,n);max=Math.min(max,n);}}if(min>max)return false;}
 const explicit=explicitConditions(text)??[];
 return conditions.every(condition=>{
  if(!mentions[condition.field].test(plain)||(condition.op==='missing'&&!missing))return false;
  const matching=explicit.filter(c=>c.field===condition.field);if(matching.length)return matching.some(c=>key(c)===key(condition));
  return true;
 });
}
/** Conservative checks for the explicit count vocabulary already in the capability contract. */
function explicitConditions(text:string):SupportedCondition[]|null {
 const numbers:Record<string,string>={zero:'0',un:'1',une:'1',deux:'2',trois:'3',quatre:'4',cinq:'5',six:'6',sept:'7',huit:'8',neuf:'9',dix:'10',onze:'11',douze:'12',treize:'13',quatorze:'14',quinze:'15',seize:'16','dix-sept':'17','dix-huit':'18','dix-huitieme':'18','dix-neuf':'19',vingt:'20'};
  const value=fold(text).replace(/\b(?:dix[- ]huitieme|dix[- ](?:sept|huit|neuf)|zero|un|une|deux|trois|quatre|cinq|six|sept|huit|neuf|dix|onze|douze|treize|quatorze|quinze|seize|vingt)\b/gu,word=>numbers[word.replace(/ /gu,'-')]!),conditions:SupportedCondition[]=[],missing=/\bsans\b|\baucun\w*\b|\bpas\b|\bmanquant\w*\b|\bmanque\w*\b|\bnuls?\b|\babsences?\b|\babsent\w*\b|\bnon\s+(?:renseigne\w*|enregistre\w*)\b|\bvides?\b/u.test(value);
 const add=(field:SupportedCondition['field'],op:SupportedCondition['op'],n:SupportedCondition['value'])=>{const condition={field,op,value:n};if(!conditions.some(existing=>key(existing)===key(condition)))conditions.push(condition);};
 if(missing&&/\b(?:identite|identification nationale|cni|carte nationale|carte d[' ]?identite|piece d[' ]?identite|document d[' ]?identite|numero national)\b/u.test(value))add('identity_card','missing',null);
 if(missing&&/\btelephones?\b/u.test(value))add('phone','missing',null);
 if((missing&&/\bnaissance\b/u.test(value))||/\bage\s+(?:est\s+)?(?:inconnu|non renseigne|manquant)/u.test(value))add('birth_date','missing',null);
 if(missing&&/\bsexe\b/u.test(value))add('sex','missing',null);
 if(/\b(?:enfants?|mineurs?)\b|moins de\s*18\s*ans|pas encore\s*18\s*ans|pas atteint\s+(?:leur\s+)?18\s+anniversaire/u.test(value))add('age','lt',18);
 else if(/\b(?:adultes?|majeurs?)\b|(?:au moins\s+18\s+ans?|18\s+ans?\s+ou\s+plus)/u.test(value))add('age','gte',18);
 for(const match of value.matchAll(/\b(moins de|au moins|plus de)\s*(\d+)\s*ans?\b/gu)){const age=Number(match[2]);if(age<=120)add('age',match[1]==='moins de'?'lt':match[1]==='au moins'?'gte':'gt',age);}
  if(missing&&/\b(?:consult\w*|visites?|suivis?)\b/u.test(value)&&/(?:six|6)\s+(?:derniers?\s+)?mois/u.test(value))add('no_completed_months','eq',6);
 const recent=/\b(?:aucune?|sans|pas de)\s+(?:consultations?|seances?|visites?)\s+(?:(?:termine|cloture|complete|clos|acheve)\w*\s+)?(?:depuis|dans les|au cours des)\s+(\d+)\s+(?:derniers\s+)?jours/gu;
 for(const m of value.matchAll(recent))if(Number(m[1])>0&&Number(m[1])<=3650)add('no_completed_days','eq',Number(m[1]));
 const minimum=/(?:au moins|au minimum|minimum(?: de)?|>=)\s*(\d+)\s+(?:consultations?|seances?)\s+(?:termine|cloture|complete|clos|acheve)\w*/gu;
 for(const m of value.matchAll(minimum))if(Number(m[1])<=1000000)add('completed_consultations','gte',Number(m[1]));
 const noDebt=/\b(?:sans|aucun\w*|pas de|pas d')\s*(?:impayes?|dettes?|soldes?)\b/u.test(value);
 if(!noDebt&&/\b(?:solde(?: restant)?|reste a payer|impayes?|dettes?|montant a encaisser)\s+(?:strictement )?positi\w*|\bsolde\s*(?:restant\s*)?>\s*0\b|\bsolde impaye\b|\bdes impayes\b|\bsolde du superieur a 0\b/u.test(value))add('outstanding_balance','gt',0);
 if(/\bjamais\b/u.test(value)&&/\b(?:consult\w*|vus?|recus?)\b/u.test(value))add('completed_consultations','eq',0);
 return conditions.length?conditions:null;
}
export function countContractParts(contract:FrenchCountContract):RequestPart[]{return contract.clauses.map((goal,i)=>({id:'requested_'+(i+1),goal:goal.slice(0,300),tools:['query_patients'],population:requestedPopulation(goal),conditions:explicitConditions(goal)??[],dependsOn:[],status:'pending',resultRefs:[]}));}
function requestedPopulation(text:string):NonNullable<RequestPart['population']>{
 const plain=fold(text);
 if(/\b(?:inactifs?|archives?)\b/u.test(plain))return 'archived';
 if(/\b(?:actifs?|actives?)\b/u.test(plain))return 'active';
 if(/\b(?:tous les patients|toutes les patientes|tous les dossiers|toute la patientele|ensemble des patients)\b/u.test(plain))return 'all';
 return 'active';
}
function populationAlias(text:string):NonNullable<RequestPart['population']>|null{
 const value=fold(text).replace(/^population\s*:\s*/u,'').trim();
 if(['active','actif','actifs','active','actives'].includes(value))return 'active';
 if(['archived','archive','archives','inactif','inactifs','inactive','inactives'].includes(value))return 'archived';
 if(['all','tous','toutes'].includes(value))return 'all';
 return null;
}
function bindPatientPopulation(part:RequestPart,text:string):RequestPart{
 const population=requestedPopulation(text);
 if(part.population&&part.population!==population)throw Error('PatientPopulationMismatch');
 const unsupportedConditions:string[]=[];
 for(const condition of part.unsupportedConditions??[]){const alias=populationAlias(condition);if(alias){if(alias!==population)throw Error('PatientPopulationMismatch');continue;}unsupportedConditions.push(condition);}
 return {...part,population,...(unsupportedConditions.length?{unsupportedConditions}:{unsupportedConditions:undefined})};
}
export function constrainCountDeclaration(parts:RequestPart[],contract:FrenchCountContract):RequestPart[]{
 let normalized=parts;
 if(contract.clauses.length===1&&parts.length>1){
  const signatures=new Set(parts.map(p=>JSON.stringify([p.tools,p.population??'active',p.literalQuery??null,p.conditions.map(key).sort(),p.unsupportedConditions??[]])));
  if(signatures.size===1&&parts.every(p=>p.tools?.length===1&&p.tools[0]==='query_patients'&&!p.dependsOn.length))normalized=[parts[0]!];
 }
 if(normalized.length!==contract.clauses.length)throw Error('RequestedCountOutputsMismatch');
 return normalized.map((rawPart,i)=>{
  const clause=contract.clauses[i]!,plain=fold(clause);
  let part=bindPatientPopulation(rawPart,clause);
  if(part.tools?.length!==1||part.tools[0]!=='query_patients')throw Error('PatientCountToolMismatch');
  const unsupported=/\b(?:e-?mails?|courriels?)\b|adresse\s+electronique/u.test(plain)?['email']:[];
  const expected=explicitConditions(clause);
  const expectedIdentity=expected?.find(condition=>condition.field==='identity_card'&&condition.op==='missing');
  if(expectedIdentity&&part.unsupportedConditions?.length){const conditions=[...part.conditions],remaining:string[]=[];for(const candidate of part.unsupportedConditions){const alias=fold(candidate).replace(/[\s_-]+/gu,'');if(['identity:empty','identity:missing','identity:missing:null','identitycard:null','identitycard:missing:null','noidentitycard','noidentitycardnumber','nonationalcardnumber','nonationalid','nonationalidnumber','nationalidmissing','missingnationalid','missingnationalidnumber','missingidentitycard'].includes(alias)){if(!conditions.some(condition=>key(condition)===key(expectedIdentity)))conditions.push(expectedIdentity);}else remaining.push(candidate);}part={...part,conditions,...(remaining.length?{unsupportedConditions:remaining}:{unsupportedConditions:undefined})};}
  if(!unsupported.length&&((expected&&!expected.every(condition=>part.conditions.some(provided=>key(provided)===key(condition))))||!patientConditionsGrounded(part.conditions,clause)))throw Error('CountConditionsMismatch');
  return {...part,goal:clause.slice(0,300),...(unsupported.length?{unsupportedConditions:[...new Set([...(part.unsupportedConditions??[]),...unsupported])]}:{})};
 });
}

export type FrenchReadTool='query_agenda'|'query_patients'|'query_consultations'|'get_patient_context'|'query_documents'|'query_finance'|'query_app'|'search_knowledge'|'prepare_action'|'navigate';
export interface FrenchReadTarget {tool:FrenchReadTool;navigationTarget?:'patient'|'patients'|'agenda'|'dashboard'|'documents'|'finances'|'parametres'|'jarvis';consultationCount?:number;messageKind?:'rappel_rendez_vous'|'document_pret';applicationView?:'cabinet'|'practitioner'|'notifications'|'system'|'message_draft';financeMode?:'charges'|'overview';patientSection?:'summary'|'history'|'treatments'|'profile'|'diagnoses'|'scales'|'current'|'notes';consultationMode?:'count'|'list';consultationStatus?:'all'|'open'|'closed'|'unsigned';unboundedPeriod?:boolean;from?:string;to?:string;noteArea?:'working'|'subjective'|'objective'|'assessment'|'plan'|'amendment'|'structured';noteQuery?:string;diagnosisState?:'all'|'active'|'resolved';diagnosisRole?:'all'|'primary'|'secondary';treatmentState?:'all'|'active'|'paused'|'stopped';documentKind?:'bonne_sante_mentale'|'suivi_medical'|'certificat_medical'|'justification'|'ordonnance';documentStatus?:'issued'|'draft';documentAllKinds?:boolean;}
export type FrenchRequestAdmission=Omit<FrenchReadTarget,'tool'>&{tools?:readonly string[];profileOnly:boolean;preparationAction?:'create_editable_document_draft'|'create_appointment';preparationDocumentType?:'bonne_sante_mentale'|'suivi_medical'|'certificat_medical'|'justification'};
const patientAnchor=(plain:string,text:string)=>/\b(?:patients?|dossiers?|personnes?|selectionn\w*|son|sa|ses)\b/u.test(plain)||/\b[A-ZÀ-Ö][a-zà-ö]+\s+[A-ZÀ-Ö][a-zà-ö]+\b/u.test(text);
/** Positive French phrases map to existing, audited read gates; this never grants write authority. */
function messageDraftTarget(text:string):'rappel_rendez_vous'|'document_pret'|undefined{
 const plain=fold(text);
 if(!/\b(?:prepare\w*|redige\w*|brouillon)\b/u.test(plain)||! /\b(?:message|sms|rappel)\b/u.test(plain))return;
 return /\brendez[- ]vous|\brdv\b/u.test(plain)?'rappel_rendez_vous':/\bdocument\b/u.test(plain)&&/\bpret|disponib|mise a disposition/u.test(plain)?'document_pret':undefined;
}
function frenchReadTargets(text:string):FrenchReadTarget[]{
 const plain=fold(text),anchor=patientAnchor(plain,text),targets:FrenchReadTarget[]=[];
 const messageKind=messageDraftTarget(text);if(messageKind)return [{tool:'query_app',applicationView:'message_draft',messageKind}];
 const add=(target:FrenchReadTarget)=>{if(!targets.some(existing=>existing.tool===target.tool&&existing.applicationView===target.applicationView&&existing.financeMode===target.financeMode&&existing.patientSection===target.patientSection&&existing.consultationMode===target.consultationMode&&existing.documentKind===target.documentKind&&existing.documentStatus===target.documentStatus))targets.push(target);};
 const mention=parsePatientMention(text);
 if(/^(?:alexa[, :]+)?(?:(?:peux[- ]tu|tu peux)\s+)?(?:ouvre|ouvrir|va|aller)\b/u.test(plain)){
  const destination=/\b(?:parametres|reglages)\b/u.test(plain)?'parametres':/\b(?:finances|comptabilite)\b/u.test(plain)?'finances':/\bdocuments\b/u.test(plain)?'documents':/\b(?:jarvis|alexa)\b/u.test(plain.replace(/^alexa[, :]+/u,''))?'jarvis':/\bagenda\b/u.test(plain)?'agenda':/\b(?:tableau de bord|dashboard)\b/u.test(plain)?'dashboard':/\bliste des patients\b/u.test(plain)?'patients':undefined;
  if(destination&&mention.status!=='named'&&!/\b(?:patient|patiente|son|sa|ses|ce dossier)\b/u.test(plain))return [{tool:'navigate',navigationTarget:destination}];
 }
 const periodText=mention.status==='named'?plain.replace(fold(mention.name),''):plain;
 const monthRange=explicitFrenchMonthRange(periodText);
 const unboundedPeriod=!/(?<![\p{L}\p{N}_-])(?:19|20)\d{2}(?![\p{L}\p{N}_-])|(?<![\p{L}\p{N}_-])\d{1,4}[-/]\d{1,2}[-/]\d{1,4}(?![\p{L}\p{N}_-])|\ble\s+\d{1,2}\b|\b(?:depuis|entre|avant|apres|jusqu\w*|pendant|derni\w*|preced\w*|prochain\w*|mois|semaines?|annees?|jours?|janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre|aujourd.hui|hier|demain|dates?|periode)\b/u.test(periodText);
 const knowledge=/\b(?:dsm(?:\s*[- ]?5)?|cim(?:\s*[- ]?11)?|icd(?:\s*[- ]?11)?|taylor|maudsley|selon (?:la|le|les) (?:reference|livre|ouvrage|manuel)|dans (?:le|les) livres?)\b/u.test(plain);
 if(knowledge)add({tool:'search_knowledge'});
 if(/\b(?:agenda|rendez[- ]?vous|rdv)\b/u.test(plain)&&/\b(?:montre|affich|liste|donne|combien|nombre|prochain|demain|aujourd.hui|semaine|mois|jour|agenda|rendez[- ]?vous|rdv)\b/u.test(plain))add({tool:'query_agenda'});
 const summaryStyle=/\b(?:resum\w*|synthes\w*|en bref|theme recurrent|motif recurrent|element recurrent)\b/u.test(plain)&&!/\b(?:mot pour mot|texte integral|citation exacte|recopie)\b/u.test(plain);
 const notes=/\b(?:notes?|subjecti(?:f|fs|ve|ves)|objecti(?:f|fs|ve|ves)|conduites? a tenir|texte integral|soap|amendements?|rectificatifs?)\b/u.test(plain)||(/\bevaluations?\b/u.test(plain)&&/\bconsult\w*/u.test(plain)&&!/psychometri/u.test(plain));
 const areas=[['working',/\b(?:travail|brut|brute|bruts|brutes)\b/u],['subjective',/\bsubjecti(?:f|fs|ve|ves)\b/u],['objective',/\bobjecti(?:f|fs|ve|ves)\b/u],['assessment',/\bevaluations?\b/u],['plan',/\bconduites? a tenir\b/u],['amendment',/\b(?:amendements?|rectificatifs?)\b/u],['structured',/\bstructurees?\b/u]] as const;
 const requestedAreas=areas.filter(([,pattern])=>pattern.test(plain)).map(([area])=>area);
 const summaryRequested=summaryStyle&&(anchor||notes||/\b(?:consult\w*|seances?|cas)\b/u.test(plain))&&!knowledge&&requestedAreas.length===0;
 const noteArea=requestedAreas.length===1?requestedAreas[0]:undefined;
 const queryMatch=text.match(/(?:\bmot|\bexpression|\bphrase|\bcode|\br[eé]f[eé]rence|\br[eé]p[èe]re)\s+[«“"]?(.+?)[»”"]?(?=\s+dans\b|$)/iu);
 const noteQuery=queryMatch?.[1]?.replace(/[»”"?.!]+$/u,'').trim();
 const document=/\b(?:documents?|brouillons?|certificats?|ordonnances?|justificatifs?)\b/u.test(plain);
 if(document&&!knowledge){
  const documentKind:FrenchReadTarget['documentKind']=/\bcertificats?\s+m(?:edical|edicaux)\b/u.test(plain)?'certificat_medical':/\bordonnances?\b/u.test(plain)?'ordonnance':/\bjustificatifs?\b/u.test(plain)?'justification':/\bsuivi medical\b/u.test(plain)?'suivi_medical':/\bbonne sante mentale\b/u.test(plain)?'bonne_sante_mentale':undefined;
  const documentStatus:FrenchReadTarget['documentStatus']=/\b(?:emis|delivre|signes?)\b/u.test(plain)?'issued':/\b(?:brouillons?|non signes?)\b/u.test(plain)?'draft':undefined;
  add({tool:'query_documents',unboundedPeriod,documentAllKinds:!documentKind,...(documentKind?{documentKind}:{}),...(documentStatus?{documentStatus}:{})});
 }
 const consultationText=notes&&noteQuery?plain.replace(fold(noteQuery),''):plain;
 const requestedConsultationStatus=/\b(?:termine\w*|clos\w*|cloture\w*|acheve\w*|ferme\w*)\b/u.test(consultationText)?'closed' as const:/\b(?:ouvert\w*|en cours)\b/u.test(consultationText)?'open' as const:undefined;
 const consultation=/\b(?:consult\w*|seances?)\b/u.test(plain);
 if(consultation&&!notes&&!knowledge&&!summaryRequested){
  const detail=/\b(?:details?|duree|analys\w*)\b/u.test(plain);
  const consultationMode:FrenchReadTarget['consultationMode']=detail?undefined:/\b(?:liste\w*|historique)\b/u.test(plain)?'list':/\b(?:combien|nombre|total|compte|comptabilise)\b/u.test(plain)?'count':'list';
  const consultationStatus:FrenchReadTarget['consultationStatus']=detail?undefined:/\b(?:non signe\w*|sans signature)\b/u.test(plain)?'unsigned':requestedConsultationStatus??'all';
  add({tool:'query_consultations',unboundedPeriod,...(consultationMode?{consultationMode}:{}),...(consultationStatus?{consultationStatus}:{})});
 }
 const financeCore=/\b(?:chiffre d.affaires|recettes?|revenus?|depenses?|impayes?|soldes?|resultat net|paiements?|encaissements?|indicateurs? financiers?|synthese de caisse|bilan financier)\b/u.test(plain);
 const financialCharges=/\bcharges?\b/u.test(plain)&&/\b(?:enregistr\w*|depenses?|du mois|de ce mois|ce mois|cette periode|total|repartition|financ\w*|factures?)\b/u.test(plain)&&! /\belectriqu\w*|electrostat\w*\b/u.test(plain);
 if((financeCore||financialCharges)&&!knowledge){const financeMode:FrenchReadTarget['financeMode']=anchor?undefined:/\b(?:charges?|depenses?)\b/u.test(plain)?'charges':/\b(?:chiffre d.affaires|resultat net|bilan financier|recettes?|revenus?|indicateurs? financiers?|synthese de caisse)\b/u.test(plain)?'overview':undefined;add({tool:'query_finance',...(financeMode?{financeMode}:{})});}
 if(/\bnotifications?\b/u.test(plain))add({tool:'query_app',applicationView:'notifications'});
 if(/\b(?:etat|statut|environnement|heure|date)\b/u.test(plain)&&/\b(?:systeme|serveur|deploiement|cabinet)\b/u.test(plain))add({tool:'query_app',applicationView:'system'});
 const specificOffice=targets.some(t=>t.tool==='query_app'&&['notifications','system'].includes(t.applicationView??''));
 const cabinetView=!specificOffice&&/\b(?:cabinet|clinique)\b/u.test(plain)?'cabinet' as const:undefined;
 const practitionerView=!specificOffice&&/\b(?:praticien\w*|medecin|docteur|mon profil professionnel)\b/u.test(plain)?'practitioner' as const:undefined;
 if(cabinetView||practitionerView){const applicationView=cabinetView&&practitionerView?undefined:cabinetView??practitionerView;add({tool:'query_app',...(applicationView?{applicationView}:{})});}
 if(anchor||notes||summaryRequested){
  const patientSection:FrenchReadTarget['patientSection']=summaryRequested?'summary':notes?'notes':/\bdiagnosti\w*\b/u.test(plain)?'diagnoses':/\b(?:echelles?|scores?)\b/u.test(plain)?'scales':/\b(?:traitements?|medicaments?|prescriptions?)\b/u.test(plain)?'treatments':/\b(?:seance en cours|consultation en cours|actuellement en consultation)\b/u.test(plain)?'current':/\bhistorique\b/u.test(plain)?'history':/\b(?:resume|synthese) clinique\b/u.test(plain)?'summary':/\b(?:e[- ]?mail|courriel|adresse electronique|telephones?|coordonnees?|adresses?|naissance|ages?|sexe|identite|identite nationale|identification nationale|carte nationale|cni|cin|situation familiale|contact d.urgence|numero national|numero (?:de (?:carte|piece) d.identite|d.identite|de dossier)|profil|administrati\w*)\b/u.test(plain)?'profile':undefined;
  const diagnosisStates=[...(/\bactif\w*\b/u.test(plain)?['active' as const]:[]),...(/\bresolu\w*\b/u.test(plain)?['resolved' as const]:[])];
  const diagnosisRoles=[...(/\bprincipa(?:l|le|ux|les)\b/u.test(plain)?['primary' as const]:[]),...(/\bsecondair\w*\b/u.test(plain)?['secondary' as const]:[])];
  const treatmentStates=[...(/\bactif\w*\b/u.test(plain)?['active' as const]:[]),...(/\b(?:pause|suspendu\w*)\b/u.test(plain)?['paused' as const]:[]),...(/\barrete\w*\b/u.test(plain)?['stopped' as const]:[])];
  if(patientSection)add({tool:'get_patient_context',patientSection,unboundedPeriod,...(patientSection==='summary'&&monthRange?monthRange:{}),...(['summary','history'].includes(patientSection)&&!requestsOldestConsultations(text)&&requestedConsultationCount(text)!==null?{consultationCount:requestedConsultationCount(text)!}:{}),...(patientSection==='diagnoses'&&diagnosisStates.length===1?{diagnosisState:diagnosisStates[0]}:{}),...(patientSection==='diagnoses'&&diagnosisRoles.length===1?{diagnosisRole:diagnosisRoles[0]}:{}),...(patientSection==='treatments'&&treatmentStates.length===1?{treatmentState:treatmentStates[0]}:{}),...(patientSection==='notes'&&requestedConsultationStatus?{consultationStatus:requestedConsultationStatus}:{}),...(patientSection==='notes'&&noteArea?{noteArea}:{}),...(patientSection==='notes'&&noteQuery?{noteQuery}:{})});
 }
 const patientQuery=/\b(?:patients|dossiers|patientele)\b/u.test(plain)&&(/\b(?:combien|nombre|total|compt\w*|liste\w*|lesquels|lesquelles|trouve\w*|recherch\w*|identifi\w*|actifs?|inactifs?|archives?|mineurs?|adultes?|enfants?|sans|aucun\w*|manquant\w*|impayes?|soldes?|dettes?)\b/u.test(plain));
 if(patientQuery)add({tool:'query_patients'});
 return targets;
}
/** A requested draft/proposal is an outcome, never authority to execute the business action. */
function preparationTarget(text:string):Pick<FrenchRequestAdmission,'preparationAction'|'preparationDocumentType'>|null{
 const plain=fold(text);
 if(!/^(?:(?:s.il te plait|svp),?\s+)?(?:(?:peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|pourriez[- ]vous|tu peux|vous pouvez|je voudrais|j.aimerais)\s+(?:(?:me|nous)\s+)?)?(?:prepare\w*|propose\w*)\b/u.test(plain)||/\b(?:ne|pas|aucun|annule|supprime|signe|emets|delivre)\b/u.test(plain))return null;
 if(/\b(?:rendez[- ]vous|rdv)\b/u.test(plain))return {preparationAction:'create_appointment'};
 if(!/\b(?:brouillons?|certificats?|justifications?|justificatifs?|suivi medical)\b/u.test(plain))return null;
 const preparationDocumentType=/\bbonne sante mentale\b/u.test(plain)?'bonne_sante_mentale':/\bsuivi medical\b/u.test(plain)?'suivi_medical':/\bcertificat medical\b/u.test(plain)?'certificat_medical':/\bjustificati(?:on|f)\b/u.test(plain)?'justification':undefined;
 return {preparationAction:'create_editable_document_draft',...(preparationDocumentType?{preparationDocumentType}:{})};
}

/** Positive vocabulary narrows only a single supported domain; mixed requests retain the full native interpretation path. */
export function frenchRequestAdmission(text:string,publicAllowed:boolean):FrenchRequestAdmission{
 if(frenchRequestedOutputs(text))return {profileOnly:false};
 const messageKind=messageDraftTarget(text);if(messageKind&&!frenchRequestedOutputs(text))return {tools:['query_app'],profileOnly:false,applicationView:'message_draft',messageKind};
 const plain=fold(text),write=/\b(?:creer|cree|ajouter|ajoute|ajoutez|enregistrer|enregistrez|modifier|modifie|modifiez|annuler|annule|annulez|supprimer|supprime|supprimez|signer|signe|signez|encaisser|encaissez|deplacer|deplace|deplacez|preparer|prepare|preparez|proposer|propose|proposez)\b/u.test(plain);
 if(write){const preparation=preparationTarget(text);return preparation?{tools:['prepare_action'],profileOnly:false,...preparation}:{profileOnly:false};}
 const clinical=/\b(?:notes?|historique|consult\w*|seances?|diagnosti\w*|traitements?|echelles?|symptom\w*|analyse\w*|ordonn\w*|certificats?|medic\w*|prescri\w*|therap\w*|stress|sommeil|risques?|humeur|sante|dsm|cim|icd|taylor|maudsley)\b/u.test(plain);
 const finance=/\b(?:chiffre d.affaires|recettes?|revenus?|depenses?|impayes?|soldes?|resultat net|paiements?|encaissements?)\b/u.test(plain);
 if(clinical&&finance)return {profileOnly:false};
 const targets=frenchReadTargets(text),domains=[...new Set(targets.map(target=>target.tool))];
 if(domains.length===1){const scopes=targets.filter(target=>target.tool===domains[0]);const common=Object.fromEntries(['messageKind','navigationTarget','consultationCount','applicationView','financeMode','patientSection','consultationMode','consultationStatus','unboundedPeriod','from','to','noteArea','noteQuery','diagnosisState','diagnosisRole','treatmentState','documentKind','documentStatus','documentAllKinds'].flatMap(key=>{const values=new Set(scopes.map(target=>target[key as keyof FrenchReadTarget]).filter(value=>value!==undefined));return values.size===1?[[key,[...values][0]]]:[]}));return {tools:domains,profileOnly:scopes.length===1&&scopes[0]?.tool==='get_patient_context'&&scopes[0].patientSection==='profile',...common};}
 const appReference=/\b(?:mindcare|alexa|application|logiciel|systeme|serveur|notifications?|messages?|factures?|recus?|frais|caisse|mois|semaine|periode|aujourd.hui|hier|demain|mon|ma|mes|notre|nos|ceci|cela|ca)\b/u.test(plain);
 if(publicAllowed&&!targets.length&&!appReference&&/^(?:pourquoi\b|comment fonctionne\w*\b|qu.est-ce que\b|explique(?:-moi)?\b)/u.test(plain)&&!/[;\n]/u.test(plain))return {tools:['answer_general'],profileOnly:false};
 return {profileOnly:false};
}
/** Lexical hints contain requested slots only, never inferred records, values or dispatch authority. */
export function countContractHints(contract:FrenchCountContract){return contract.clauses.map(goal=>({goal,conditions:explicitConditions(goal)?.map(c=>c.field+':'+c.op+(c.value===null?'':':'+c.value))??[]}));}

export interface FrenchCompoundContract {text:string;conditions:SupportedCondition[];count:boolean;sort?:'outstanding_desc';}
/** Only an explicit conjunctive patient-set request is constrained; domain execution stays model-selected and gated. */
export function frenchPatientCompoundContract(text:string):FrenchCompoundContract|null{
 const plain=fold(text),conditions=explicitConditions(text)??[];
 if(!/\bpatients?\b/u.test(plain)||! /\b(?:trouve|cherch\w*|recherch\w*|liste\w*|affich\w*|montre\w*)\b/u.test(plain)||conditions.length<2)return null;
 if(/\b(?:ou|rendez-vous|rdv|agenda|dsm|taylor|maudsley|cabinet|email|courriel|archiv\w*|inacti\w*)\b|adresse electronique|chiffre d.affaires/u.test(plain))return null;
 const sort=/\b(?:soldes?|dettes?|impayes?)\s+(?:decroiss\w*|du plus (?:grand|eleve))\b|\bdu plus gros solde au plus petit\b/u.test(plain)?'outstanding_desc' as const:undefined;
 return {text,conditions,count:/\b(?:compt\w*|combien|nombre|total)\b/u.test(plain),...(sort?{sort}:{})};
}
export function compoundContractHints(contract:FrenchCompoundContract){return (contract.count?['count','list']:['list']).map(id=>({id,goal:id==='count'?(contract.text.match(/\b(?:compt\w*|combien|nombre|total)\b[^.!?]*/iu)?.[0]??contract.text):contract.text,tool:'query_patients',conditions:contract.conditions.map(c=>c.field+':'+c.op+(c.value===null?'':':'+c.value))}));}
export function compoundContractParts(contract:FrenchCompoundContract):RequestPart[]{return (contract.count?['count','list']:['list']).map(id=>({id,goal:contract.text.slice(0,300),tools:['query_patients'],conditions:contract.conditions,dependsOn:[],status:'pending',resultRefs:[]}));}
export function constrainCompoundDeclaration(parts:RequestPart[],contract:FrenchCompoundContract):RequestPart[]{
 const scoped=parts.map(part=>bindPatientPopulation(part,contract.text));
 if(scoped.length!==(contract.count?2:1)||scoped.some(p=>p.tools?.length!==1||p.tools[0]!=='query_patients'||p.dependsOn.length||!contract.conditions.every(c=>p.conditions.some(actual=>key(actual)===key(c)))||!patientConditionsGrounded(p.conditions,contract.text)))throw Error('CompoundOutputsOrConditionsMismatch');
 const unresolved=[...new Set(scoped.flatMap(p=>p.unsupportedConditions??[]))];return unresolved.length?scoped.map(p=>({...p,unsupportedConditions:unresolved})):scoped;
}

/** Counts explicit coordinated application requests only; it grants no domain authority or business action. */
export function frenchRequestedOutputs(text:string):string[]|null{
 if(!frenchReadTargets(text).length&&!preparationTarget(text))return null;
 const markers=[...text.matchAll(/(?:^|[,;]\s*|\b(?:et|puis)\s+)((?:affich|montr|trouv|cherch|recherch|identifi|r[ée]sum|pr[ée]par|compt|donn|lis|lire|ouvr|compar|expliqu|cr[ée]|ajout|enregistr|modifi|annul|supprim|sign|encaiss|d[ée]pla|r[ée]dig|r[èe]gl)\p{L}*)\b/giu)];
 if(markers.length>=2&&markers.length<=12&&markers[0]!.index===0)return markers.map((match,index)=>text.slice(match.index+match[0].length-match[1]!.length,markers[index+1]?.index??text.length).replace(/[\s,;]+$/u,'').trim());
 const sharedVerb=text.match(/^\s*(?:alexa[, :]\s*)?((?:affich|montr|trouv|cherch|recherch|identifi|r[ée]sum|pr[ée]par|compt|donn|lis|lire|ouvr|compar|expliqu|cr[ée]|ajout|enregistr|modifi|annul|supprim|sign|encaiss|d[ée]pla|r[èe]dig)\p{L}*)\s+/iu);
 if(sharedVerb){
  const commaItems=text.slice(sharedVerb[0].length).replace(/[?؟!.]+$/u,'').split(/\s*,\s*/u).filter(Boolean),items=commaItems.flatMap(item=>{
   const coordinated=item.split(/\s+et\s+/iu),left=coordinated.length===2?parsePatientMention(coordinated[0]!):{status:'none' as const},right=coordinated.length===2?parsePatientMention(coordinated[1]!):{status:'none' as const};
   return left.status==='named'&&right.status==='named'&&left.name!==right.name?coordinated:[item];
  }),names=items.map(item=>{const mention=parsePatientMention(item);return mention.status==='named'?fold(mention.name):null;});
  if(items.length>=2&&items.length<=8&&names.every((name):name is string=>!!name)&&new Set(names).size===names.length){
   const ending=text.match(/[?؟!.]+\s*$/u)?.[0]??'',goals=items.map((item,index)=>`${sharedVerb[1]} ${item.trim()}${index===items.length-1?ending:''}`);
   if(goals.every(goal=>requestedReadTool(goal,text)))return goals;
  }
 }
 const separators=[...text.matchAll(/\s+\b(?:et|puis)\s+(?=(?:combien|quel(?:le|s|les)?|qui|comment|pourquoi|où|quand)\b)/giu)];
 if(!separators.length||separators.length>5)return null;
 const clauses:string[]=[];let start=0;
 for(const separator of separators){clauses.push(text.slice(start,separator.index).trim().replace(/[\s,;]+$/u,''));start=separator.index+separator[0].length;}
 clauses.push(text.slice(start).trim());
 const mention=parsePatientMention(text),patientName=mention.status==='named'?mention.name:null,patientPrefix=patientName?`Pour ${patientName}, `:'';
 const goals=clauses.map((goal,index)=>{
  const cleaned=goal.replace(/[?!.]+$/u,'').trim();
  const withPatient=patientPrefix&&patientName&&!fold(cleaned).includes(fold(patientName))?patientPrefix+cleaned:cleaned;
  return withPatient+(index===clauses.length-1?(goal.match(/[\u00a0\u202f ]?[?？]$/u)?.[0]??''):'');
 });
 if(goals.length<2||goals.some(goal=>!goal||!requestedReadTool(goal,text)))return null;
 return goals;
}
export function constrainRequestedOutputs(parts:RequestPart[],outputs:readonly string[]):RequestPart[]{
 const norm=(s:string)=>fold(s).replace(/[.!?]+$/gu,'').trim();
 if(parts.length!==outputs.length||outputs.some(goal=>parts.filter(p=>norm(p.goal)===norm(goal)).length!==1))throw Error('RequestedOutputsMismatch');
 const original=outputs.join(' ');
 const constrained=parts.map(part=>{const goal=outputs.find(goal=>norm(goal)===norm(part.goal))!,hint=requestedReadTool(goal,original);if(hint&&(part.tools?.length!==1||part.tools[0]!==hint))throw Error('RequestedReadToolMismatch');const count=frenchPatientCountContract(goal);return count?constrainCountDeclaration([part],count)[0]!:{...part,goal};});
 const agenda=constrained.find(p=>requestedReadTool(p.goal,original)==='query_agenda');
 const ordered=agenda?[agenda,...constrained.filter(p=>p!==agenda)]:constrained;
 return ordered.map(part=>isAdministrativeReview(part.goal,original)?{...part,conditions:[...part.conditions.filter(c=>c.field!=='administrative_incomplete'),{field:'administrative_incomplete' as const,op:'eq' as const,value:true}],dependsOn:[...new Set([...part.dependsOn,...(agenda?[agenda.id]:[])])]}:part);
}

/** Positive read purposes only. Administrative review produces a checklist, never an unsupported record mutation. */
export function requestedReadTool(goal:string,original:string):FrenchReadTool|undefined{
 const plain=fold(goal);
 if(isAdministrativeReview(goal,original)||(/\b(?:champs? manquants?|corrections?)\b/u.test(plain)&&/\b(?:dossiers?|patient\w*|revue)\b/u.test(plain)&&!/\b(?:modifi\w*|enregistr\w*|corrige\w*|sauvegard\w*)\b/u.test(plain)))return 'query_patients';
 if(messageDraftTarget(goal))return 'query_app';
 if(preparationTarget(goal))return 'prepare_action';
 const goalDomains=[...new Set(frenchReadTargets(goal).map(target=>target.tool))];
 if(goalDomains.length===1)return goalDomains[0];
 if(!goalDomains.length){const wholeDomains=[...new Set(frenchReadTargets(original).map(target=>target.tool))];if(wholeDomains.length===1)return wholeDomains[0];}
 if(requestedCountRead(goal)){if(/\bpatients?\b/u.test(plain))return 'query_patients';if(/\bconsult\w*\b/u.test(plain))return 'query_consultations';}
 return undefined;
}
export function requestedCountRead(goal:string):boolean{return /^(?:compt\w*|combien|nombre|total)\b/u.test(fold(goal))&&!/\b(?:liste\w*|affich\w*|montr\w*|lesquels|lesquelles)\b/u.test(fold(goal));}
export function isAdministrativeReview(goal:string,original:string):boolean{
 const plain=fold(goal),whole=fold(original);
 return /administrati\w*[^.!?]*incomplet|incomplet[^.!?]*administrati/u.test(whole)&&!/\b(?:modifi\w*|enregistr\w*|corrige\w*|sauvegard\w*)\b/u.test(plain)&&/administrati|champs? manquant|correction\w*[^.!?]*revue/u.test(plain);
}

/** Values grounded in the requested read, shared by native schemas and validated dispatch. */
export function frenchReadArgumentBindings(scope:FrenchRequestAdmission,tool:string):Record<string,string|number>{
 const values:Record<string,string|number>={};
 if(tool==='navigate'&&scope.navigationTarget)values['target']=scope.navigationTarget;
 if(tool==='prepare_action'){if(scope.preparationAction)values['action']=scope.preparationAction;if(scope.preparationDocumentType)values['documentType']=scope.preparationDocumentType;}
 if(tool==='get_patient_context'&&scope.patientSection){values['section']=scope.patientSection;if(scope.consultationCount!==undefined)values['count']=scope.consultationCount;if(scope.diagnosisState)values['diagnosisState']=scope.diagnosisState;if(scope.diagnosisRole)values['diagnosisRole']=scope.diagnosisRole;if(scope.treatmentState)values['treatmentState']=scope.treatmentState;if(scope.patientSection==='summary'&&scope.from&&scope.to){values['from']=scope.from;values['to']=scope.to;}if(scope.patientSection==='notes'){if(scope.noteArea)values['area']=scope.noteArea;else if(scope.noteQuery)values['area']='all';if(scope.noteQuery)values['query']=scope.noteQuery;if(scope.consultationStatus)values['status']=scope.consultationStatus;}}
 if(tool==='query_consultations'){if(scope.consultationMode)values['mode']=scope.consultationMode;if(scope.consultationStatus)values['status']=scope.consultationStatus;}
 if(tool==='query_finance'&&scope.financeMode)values['mode']=scope.financeMode;
 if(tool==='query_app'&&scope.applicationView){values['view']=scope.applicationView;if(scope.messageKind)values['motif']=scope.messageKind;}
 if(tool==='query_documents'){if(scope.documentKind)values['kind']=scope.documentKind;if(scope.documentStatus)values['status']=scope.documentStatus;}
 return values;
}
