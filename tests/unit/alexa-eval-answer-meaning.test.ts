import {expect,it} from 'vitest';
import {assessFrenchGeneralAnswer,hasLocalModelEvidence} from '../../scripts/lib/alexa-eval-answer-meaning.mjs';

it('accepts a concise, French, factually responsive local explanation',()=>{
 expect(assessFrenchGeneralAnswer('explain_day_night_rotation','Le jour et la nuit se succèdent parce que la Terre tourne sur elle-même. La face tournée vers le Soleil est éclairée, l’autre est dans la nuit.',{usedLocalInference:true,readCount:0})).toEqual([]);
});
it('requires the answer to explain a missing-information rule in exactly two sentences',()=>{
 expect(assessFrenchGeneralAnswer('explain_missing_information_behavior','Si une information manque, je vous le dirai au lieu de la deviner. Je demanderai une précision ou vérifierai la source avant de répondre.',{usedLocalInference:true,readCount:0})).toEqual([]);
 expect(assessFrenchGeneralAnswer('explain_missing_information_behavior','Je demanderai une précision.',{usedLocalInference:true,readCount:0})).toContain('requested-sentence-count');
});
it('rejects generic model answers that use English, lists or cabinet reads',()=>{
 expect(assessFrenchGeneralAnswer('compare_sound_pitch','A high sound has more frequency, while a low sound has less.',{usedLocalInference:true,readCount:0})).toContain('answer-not-french');
 expect(assessFrenchGeneralAnswer('explain_ice_buoyancy','- La glace flotte sur l’eau.\n- Elle est moins dense.',{usedLocalInference:true,readCount:0})).toContain('answer-not-one-paragraph');
 expect(assessFrenchGeneralAnswer('explain_ice_buoyancy','La glace est moins dense que l’eau, donc elle flotte.',{usedLocalInference:true,readCount:1})).toContain('unexpected-cabinet-read');
});
it('checks the question specific concepts instead of accepting a fluent but empty answer',()=>{
 expect(assessFrenchGeneralAnswer('explain_ice_buoyancy','La glace reste visible à la surface.',{usedLocalInference:true,readCount:0})).toContain('explanation-concept-missing');
 expect(assessFrenchGeneralAnswer('compare_sound_pitch','Un son aigu paraît plus perçant qu’un son grave.',{usedLocalInference:true,readCount:0})).toContain('explanation-concept-missing');
});
it.each([
 ['explain_condensation','La buée apparaît quand la vapeur d’eau refroidit et se condense sur le miroir.'],
 ['explain_autumn_leaf_color','À l’automne, les feuilles changent de couleur car la chlorophylle diminue et d’autres pigments deviennent visibles.'],
 ['explain_cloud_color','Les nuages paraissent blancs parce que leurs gouttelettes diffusent la lumière visible dans toutes les directions.'],
 ['explain_thermal_conduction','À température égale, le métal conduit la chaleur de la main plus vite que le bois, ce qui le fait paraître plus froid.'],
 ['compare_mass_weight','La masse mesure la quantité de matière, tandis que le poids est une force liée à la gravité.'],
])('requires a local MiniCPM answer for a real general question: %s',(intent,answer)=>{
 expect(assessFrenchGeneralAnswer(intent,answer,{usedLocalInference:true,readCount:0})).toEqual([]);
 expect(assessFrenchGeneralAnswer(intent,answer,{usedLocalInference:false,readCount:0})).toContain('local-model-not-used');
});
it('accepts a verified public source when MiniCPM cannot preserve the fact',()=>{
 const answer='La surface froide refroidit la vapeur d’eau de l’air, qui se transforme en fines gouttelettes : cette condensation forme la buée.';
 expect(assessFrenchGeneralAnswer('explain_condensation',answer,{usedLocalInference:false,usedVerifiedPublicReference:true,readCount:0})).toEqual([]);
 expect(assessFrenchGeneralAnswer('explain_condensation',answer,{usedLocalInference:false,readCount:0})).toContain('local-model-not-used');
});

it('accepts a verified cloud source using the feminine plural form of white',()=>{
 const answer='Les gouttelettes d’eau des nuages diffusent les différentes couleurs de la lumière solaire à peu près ensemble, ce qui les fait paraître blanches.';
 expect(assessFrenchGeneralAnswer('explain_cloud_color',answer,{usedVerifiedPublicReference:true,readCount:0})).toEqual([]);
});

it('recognizes MiniCPM from source provenance when the sentence kind is fact',()=>{
 expect(hasLocalModelEvidence([{type:'sentence',kind:'fact',sources:[{type:'query',provenance:{gate:'local_model',model:'MiniCPM'}}]}])).toBe(true);
 expect(hasLocalModelEvidence([{type:'sentence',kind:'fact',sources:[{type:'query',provenance:{gate:'local_public_fact',model:'MiniCPM'}}]}])).toBe(true);
 expect(hasLocalModelEvidence([{type:'sentence',kind:'fact',sources:[{type:'query',provenance:{gate:'alexa_local_contract'}}]}])).toBe(false);
});
