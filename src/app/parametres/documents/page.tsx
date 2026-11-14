"use client";
import {useEffect,useState} from "react";
import {AppShell} from "@/components/AppShell";
import {useSessionEcran} from "@/components/useSessionEcran";
import {getProfil,getCabinet,updateDocumentOrderNumber,type ProfilPraticienne,type Cabinet} from "@/services/cabinet";
import {documentsEditor as t} from "@/i18n/documents-editor";
import {Squelette,BlocErreur} from "@/components/ui";
import {fr} from "@/i18n/fr";
import {catalogueIdentite as identityMessages} from "@/i18n/catalogue-identite";
export default function ParametresDocumentsPage(){
 const {utilisateur,deconnecter}=useSessionEcran();
 const [profile,setProfile]=useState<ProfilPraticienne|null>(null),[cabinet,setCabinet]=useState<Cabinet|null>(null),[order,setOrder]=useState(""),[message,setMessage]=useState<string|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
 useEffect(()=>{if(!utilisateur)return;let active=true;setLoaded(false);void Promise.all([getProfil(),getCabinet()]).then(([p,c])=>{if(!active)return;if(!p.ok){setError(p.error.message);return;}if(!c.ok){setError(c.error.message);return;}if(!p.data||!c.data){setError(identityMessages.identityAbsent);return;}setError(null);setProfile(p.data);setCabinet(c.data);setOrder(p.data.orderNumber??"");setLoaded(true);if(!p.data.fullNameAr||!p.data.specialityFr||!p.data.specialityAr||!p.data.orderNumber||!p.data.phone||!c.data.address)setError(identityMessages.identityAbsent);});return()=>{active=false;};},[utilisateur]);
 if(utilisateur===undefined)return <Squelette lignes={4}/>;
 if(utilisateur===null)return <BlocErreur message={fr.erreurs["non-authentifie"]}/>;
 return <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter} titre={t.controlledIdentity} sousTitre={t.identityReadOnly}>
 <section className="doc2-panel max-w-form"><p>{t.identityReadOnly}</p>{error?<p role="alert">{error}</p>:null}{message?<p role="status">{message}</p>:null}
 <p>{profile?.title} {profile?.fullName}</p><p>{profile?.specialityFr}</p><p dir="rtl">{profile?.fullNameAr}</p><p dir="rtl">{profile?.specialityAr}</p><p>{t.phone} {profile?.phone}</p><p>{cabinet?.name} · {cabinet?.address} · {cabinet?.phone}</p>
 <form onSubmit={e=>{e.preventDefault();if(!loaded)return;setBusy(true);setError(null);setMessage(null);void updateDocumentOrderNumber(order).then(r=>{setBusy(false);if(r.ok)setMessage(t.orderSaved);else setError(r.error.message);});}}><label>{t.orderNumber}<input disabled={!loaded||busy} required maxLength={64} value={order} onChange={e=>setOrder(e.target.value)}/></label><button type="submit" disabled={busy||!loaded||!order.trim()}>{busy?t.saving:t.save}</button></form></section></AppShell>;
}
