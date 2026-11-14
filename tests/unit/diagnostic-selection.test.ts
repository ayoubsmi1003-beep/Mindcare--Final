import {describe, expect, it} from 'vitest';
import {diagnosticSelection, addDiagnostic} from '@/components/patients/diagnostic-selection';
import type {Diagnostic} from '@/services/patients';

const historical: Diagnostic = {id:'historical', label:'Historique synthétique', isPrimary:true, resolvedAt:'2026-01-01', onsetDate:'2025-01-01', code:null, codeSystem:'ICD-10'};
const active = {...historical,id:'active',resolvedAt:null};
describe('sélection diagnostique explicite',()=>{
 it('refuse un choix absent ou inconnu',()=>{expect(diagnosticSelection('patient','',[])).toBeNull();expect(diagnosticSelection('patient','inconnu',[])).toBeNull();});
 it('dérive les métadonnées et garde une date clinique inconnue',()=>{expect(diagnosticSelection('patient','F41.1',[historical])).toEqual({patientId:'patient',label:'Trouble anxieux généralisé',codeSystem:'ICD-10',code:'F41.1',isPrimary:true,onsetDate:null});});
 it('conserve la règle secondaire lorsqu’un principal actif existe',()=>{expect(diagnosticSelection('patient','F41.1',[active])?.isPrimary).toBe(false);});
 it('ne dégrade que les principaux actifs, sans réécrire l’historique',()=>{const added={...active,id:'new'};const result=addDiagnostic([historical,active],added);expect(result.find(d=>d.id==='historical')).toBe(historical);expect(result.find(d=>d.id==='active')?.isPrimary).toBe(false);expect(result.find(d=>d.id==='new')).toBe(added);});
});
