const fold=value=>String(value??'').normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('fr').trim();
const wordCount=value=>(String(value??'').match(/[\p{L}\p{M}\p{N}]+(?:[’'-][\p{L}\p{M}\p{N}]+)*/gu)??[]).length;
const sentenceCount=value=>(String(value??'').match(/[.!?]+(?=\s|$)/gu)??[]).length|| (String(value??'').trim()?1:0);

export function hasLocalModelEvidence(events){
 return events.some(event=>event.kind==='inference'||event.type==='sentence'&&event.sources?.some(source=>source.type==='query'&&(source.provenance?.gate==='local_model'||source.provenance?.gate==='local_public_fact'&&typeof source.provenance.model==='string')));
}

/** Mechanical checks for the five general French LLM cases and conversational format cases. */
export function assessFrenchGeneralAnswer(intent,answer,{usedLocalInference=false,usedVerifiedPublicReference=false,readCount=0}={}){
 const text=String(answer??'').trim(),plain=fold(text),failures=[];
 const localRequired=['explain_condensation','explain_autumn_leaf_color','explain_cloud_color','explain_thermal_conduction','compare_mass_weight'].includes(intent);
 if(!text)failures.push('empty-answer');
 if(localRequired&&!usedLocalInference&&!usedVerifiedPublicReference)failures.push('local-model-not-used');
 if(readCount!==0)failures.push('unexpected-cabinet-read');
 if(text.includes('\n')||/^\s*[-*•\d]+[.)-]?\s/mu.test(text))failures.push('answer-not-one-paragraph');
 if(sentenceCount(text)>4||wordCount(text)>100)failures.push('answer-too-long');
 if(/\b(?:the|and|with|because|causing|creating|engines?|systems?|stability|motion|stationary|orbiting|without|through|high|low|sound|while)\b/u.test(plain))failures.push('answer-not-french');
 const has=pattern=>pattern.test(plain);
 let concepts=true;
 switch(intent){
  case 'general_greeting': concepts=has(/\b(?:aider|assister|cabinet|patients?|rendez[- ]vous|consultations?)\b/u);break;
  case 'explain_day_night_rotation': concepts=has(/\bterre\b/u)&&has(/\b(?:tourne|rotation|rotat\w*)\b/u)&&has(/\bsoleil\b/u)&&has(/\b(?:jour|nuit)\b/u);break;
  case 'explain_missing_information_behavior':
   concepts=has(/\b(?:manque|absente?|inconnue?|non renseigne|pas disponible|pas fourni)\b/u)&&has(/\b(?:precis\w*|verifi\w*|source)\b/u)&&has(/\b(?:devin\w*|invent\w*|suppos\w*|affirm\w*)\b/u);
   if(sentenceCount(text)!==2)failures.push('requested-sentence-count');break;
  case 'compare_sound_pitch': concepts=has(/\baigu\w*\b/u)&&has(/\bgrave\w*\b/u)&&has(/\b(?:frequence|vibration|plus elevee|plus haute)\b/u);break;
  case 'explain_ice_buoyancy': concepts=has(/\bglace\b/u)&&has(/\beau\b/u)&&has(/\b(?:densite|dense)\b/u)&&has(/\bflott\w*\b/u);break;
  case 'explain_condensation': concepts=has(/\b(?:buee|vapeur)\b/u)&&has(/\beau\b/u)&&has(/\b(?:refroid\w*|condens\w*)\b/u);break;
  case 'explain_autumn_leaf_color': concepts=has(/\bfeuilles?\b/u)&&has(/\b(?:couleur|roug\w*|jaun\w*)\b/u)&&has(/\b(?:chlorophylle|pigment\w*)\b/u);break;
  case 'explain_cloud_color': concepts=has(/\bnuages?\b/u)&&has(/\bblanc(?:he)?s?\b/u)&&has(/\b(?:lumiere|gouttelettes?|cristaux|diffus\w*)\b/u);break;
  case 'explain_thermal_conduction': concepts=has(/\bmetal\b/u)&&has(/\bbois\b/u)&&has(/\bchaleur\b/u)&&has(/\b(?:conduit|conduct\w*|transmet|transfere|circule)\b/u);break;
  case 'compare_mass_weight': concepts=has(/\bmasse\b/u)&&has(/\bpoids\b/u)&&has(/\b(?:matiere|quantite)\b/u)&&has(/\b(?:gravite|force)\b/u);break;
  case 'thanks': concepts=has(/\b(?:plaisir|en prie|disposition|merci)\b/u)&&wordCount(text)<=24;break;
  case 'clarification_conversation': concepts=has(/\b(?:oui|bien sur|je peux)\b/u)&&has(/\b(?:precis\w*|question)\b/u)&&has(/\bambigu\w*\b/u);break;
  case 'capabilities': concepts=['patients?','rendez[- ]vous|agenda','financ|paiement|encaissement','consultations?|notes','documents?'].filter(pattern=>new RegExp('\\b(?:'+pattern+')\\b','u').test(plain)).length>=3;break;
  default: return ['unsupported-answer-oracle'];
 }
 if(!concepts)failures.push('explanation-concept-missing');
 return failures;
}
