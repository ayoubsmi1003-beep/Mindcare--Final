import { afterAll, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { synthesizeClinicalNarrative } from "@/server/alexa/clinical-narrative";
import * as localModel from "@/server/alexa/local-model";
import { releaseLocalModel } from "@/server/alexa/local-model";
const live = process.env.MINDCARE_ALEXA_NARRATIVE_LIVE === "1";
const results: unknown[]=[];
// Only these hardcoded synthetic cases are recorded; never enable raw production logging.
const modelOutputs: string[]=[];
if(live){const original=localModel.inferLocalText;vi.spyOn(localModel,"inferLocalText").mockImplementation(async(...args)=>{const raw=await original(...args);modelOutputs.push(raw);return raw;});}
afterAll(async()=>{ await releaseLocalModel(); const output=process.env.MINDCARE_ALEXA_NARRATIVE_REPORT;if(live&&output)writeFileSync(output,JSON.stringify({synthetic:true,results},null,2)); });
const cases=[
 {name:"family, mood and recorded dose change",sources:[{id:"s1",text:"Le patient rapporte une humeur triste et des conflits fréquents avec ses parents."},{id:"s2",text:"Le contact reste préservé, le discours est organisé."},{id:"s3",text:"La dose du traitement TEST a été augmentée de 50 mg à 100 mg lors de cette séance. Un point sur les conflits familiaux est prévu au prochain rendez-vous."}],checks:[/trist|humeur/iu,/famil|parent/iu,/50\s*mg.*100\s*mg/u]},
 {name:"negative finding and tentative diagnosis stay qualified",sources:[{id:"s1",text:"Le patient ne rapporte pas d’idées suicidaires. Le sommeil reste perturbé."},{id:"s2",text:"L’hypothèse d’un trouble anxieux reste à explorer. Un agenda du sommeil a été proposé par la médecin."}],checks:[/sommeil/iu,/hypothese|hypothèse|explor/iu]},
 {name:"multi-session progression without field/date recitation",sources:[{id:"s1",text:"Première séance : le patient rapporte des tensions avec son père et un endormissement difficile."},{id:"s2",text:"Deuxième séance : les tensions avec son père persistent. Le patient rapporte un endormissement plus facile."},{id:"s3",text:"Dernière séance : le patient rapporte une diminution des tensions familiales. La médecin a prévu de poursuivre le suivi."}],checks:[/famil|pere|père/iu,/sommeil|endorm/iu,/suivi/iu]},
];
for(const c of cases)it.runIf(live)("real installed MiniCPM — "+c.name,async()=>{ const started=Date.now();const r=await synthesizeClinicalNarrative(c.sources,AbortSignal.timeout(180000));results.push({name:c.name,ms:Date.now()-started,...r,sources:c.sources,modelOutput:modelOutputs.at(-1)});expect(r.generated).toBe(true);expect(r.complete).toBe(true);expect(r.text).not.toMatch(/\n|Subjectif\s*:|Objectif\s*:|Plan\s*:/iu);expect(r.text.split(/\s+/u).length).toBeLessThanOrEqual(150);for(const check of c.checks)expect(r.text).toMatch(check); },190000);
