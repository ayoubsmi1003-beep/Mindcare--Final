"use client";
import {useEffect,useState} from "react";
import {AppShell} from "@/components/AppShell";
import {useSessionEcran} from "@/components/useSessionEcran";
import {Squelette,BlocErreur} from "@/components/ui";
import {DocumentWorkspace} from "@/components/documents/DocumentWorkspace";
import {documentsEditor as t} from "@/i18n/documents-editor";
import {fr} from "@/i18n/fr";
export default function DocumentsPage(){
 const {utilisateur,deconnecter}=useSessionEcran();
 const [route,setRoute]=useState<{patientId:string|null;initialDocumentId:string|null}|null>(null);
 useEffect(()=>{const params=new URLSearchParams(window.location.search);setRoute({patientId:params.get("patient"),initialDocumentId:params.get("document")});},[]);
 if(utilisateur===undefined||!route)return <main className="p-8"><Squelette lignes={4}/></main>;
 if(utilisateur===null)return <main className="p-8"><BlocErreur message={fr.erreurs["non-authentifie"]}/></main>;
 return <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter} titre={t.title} sousTitre={t.subtitle}><DocumentWorkspace {...route}/></AppShell>;
}
