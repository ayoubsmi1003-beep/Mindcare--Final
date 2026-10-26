"use client";
import {Suspense} from "react";
import {useSearchParams} from "next/navigation";
import {AppShell} from "@/components/AppShell";
import {useSessionEcran} from "@/components/useSessionEcran";
import {Squelette,BlocErreur} from "@/components/ui";
import {DocumentWorkspace} from "@/components/documents/DocumentWorkspace";
import {documentsEditor as t} from "@/i18n/documents-editor";
import {fr} from "@/i18n/fr";
function DocumentsContent(){
 const {utilisateur,deconnecter}=useSessionEcran();
 const params=useSearchParams();
 const route={patientId:params.get("patient"),initialDocumentId:params.get("document"),initialDraftId:params.get("draft"),initialPrint:params.get("print")==="1"};
 if(utilisateur===undefined)return <main className="p-8"><Squelette lignes={4}/></main>;
 if(utilisateur===null)return <main className="p-8"><BlocErreur message={fr.erreurs["non-authentifie"]}/></main>;
 const workspaceKey=[route.patientId,route.initialDocumentId,route.initialDraftId,params.get("printAttemptId")].join(":");
 return <AppShell role={utilisateur.role} nomComplet={utilisateur.fullName} onDeconnexion={deconnecter} titre={t.title} sousTitre={t.subtitle}><DocumentWorkspace key={workspaceKey} {...route}/></AppShell>;
}
export default function DocumentsPage(){
 return <Suspense fallback={<main className="p-8"><Squelette lignes={4}/></main>}><DocumentsContent/></Suspense>;
}
