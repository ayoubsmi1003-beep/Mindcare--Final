import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {FormulaireTraitement} from '@/components/traitements/FormulaireTraitement';
import {MedicationRows} from '@/components/documents/MedicationRows';
import type {DocumentContent} from '@/shared/documents/types';
function Harness(){
 const [content,setContent]=useState<DocumentContent>({type:'doc',content:[{type:'medication',attrs:{rowId:'synthetic-row',designation:'',posology:'',frequency:'',source:'free-text'}}]});
 return location.search.includes('treatment')?<FormulaireTraitement ouvert patientId="d2000000-0000-4000-8000-000000000001" consultationId={null} traitement={null} onFermer={()=>undefined} onSaved={()=>undefined}/>:<MedicationRows content={content} onChange={setContent}/>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
