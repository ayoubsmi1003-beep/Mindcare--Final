"use client";
import {useEffect,useState} from "react";
import {AppShell} from "@/components/AppShell";
import {useSessionEcran} from "@/components/useSessionEcran";
import {getProfil,getCabinet,updateDocumentOrderNumber,type ProfilPraticienne,type Cabinet} from "@/services/cabinet";
import {documentsEditor as t} from "@/i18n/documents-editor";
import {Squelette,BlocErreur} from "@/components/ui";
import {fr} from "@/i18n/fr";
export default function ParametresDocumentsPage(){
 const {utilisateur,deconnecter}=useSessionEcran();
 const [profile,setProfile]=useState<ProfilPraticienne|null>(null),[cabinet,setCabinet]=useState<Cabinet|null>(null),[order,setOrder]=useState(""),[message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
 useEffect(()=>{void getProfil().then(r=>{if(r.ok&&r.data){setProfile(r.data);setOrder(r.data.orderNumber??"");}else if(!r.ok)setError(r.error.message);});void getCabinet().then(r=>{if(r.ok)setCabinet(r.data);else setError(r.error.message);});},[]);
 if(utilisateur===undefined)return <Squelette lignes={4}/>;
 if(utilisateur===null)return <BlocErreur message={fr.erreurs["non-authentifie"]}/>;
 return <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter} titre={t.controlledIdentity} sousTitre={t.identityReadOnly}>
 <section className="doc2-panel max-w-form"><p>{t.identityReadOnly}</p>{error?<p role="alert">{error}</p>:null}{message?<p role="status">{message}</p>:null}
 <p>{profile?.title} {profile?.fullName}</p><p>{profile?.specialityFr}</p><p dir="rtl">{profile?.fullNameAr}</p><p dir="rtl">{profile?.specialityAr}</p><p>{t.phone} {profile?.phone}</p><p>{cabinet?.name} · {cabinet?.address} · {cabinet?.phone}</p>
 <form onSubmit={e=>{e.preventDefault();setBusy(true);setError(null);setMessage(null);void updateDocumentOrderNumber(order).then(r=>{setBusy(false);if(r.ok)setMessage(t.orderSaved);else setError(r.error.message);});}}><label>{t.orderNumber}<input required maxLength={64} value={order} onChange={e=>setOrder(e.target.value)}/></label><button type="submit" disabled={busy||!order.trim()}>{busy?t.saving:t.save}</button></form></section></AppShell>;
}
