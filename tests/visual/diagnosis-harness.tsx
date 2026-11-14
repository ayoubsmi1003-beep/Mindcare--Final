import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CarteDiagnostics} from '@/components/patients/CarteDiagnostics';
function Harness(){
 const [patient,setPatient]=useState('d2000000-0000-4000-8000-000000000001');
 return <><button onClick={()=>setPatient('d2000000-0000-4000-8000-000000000002')}>Changer le patient synthétique</button><CarteDiagnostics patientId={patient} diagnostics={[]}/></>;
}
createRoot(document.getElementById('root')!).render(<Harness/>);
