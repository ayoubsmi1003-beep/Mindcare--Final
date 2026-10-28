import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DbPort } from "@/services/db/port";
import type { ClientSql } from "@/server/jarvis/client-sql";
import type { AlexaProposal, TurnInput } from "@/shared/alexa/turn";
import { capaciteEcriture } from "@/services/jarvis-ecritures";
import { agendaSelection } from "@/shared/alexa/agenda-plan";
import { alexaActions } from "@/i18n/alexa-actions";
import { documentLabels } from "@/i18n/documents-editor";
import type { DocumentKind } from "@/shared/documents/types";
import { readAgendaDay } from "./agenda-adapter";
import { resolvePatient } from "./patient-resolver";
import { parsePatientMention } from "./patient-mention";
import { resolveDocumentDraftInputs } from "./document-draft";
import { prepareInternalMessage } from "./internal-message";
import { buildClinicalContext } from "./clinical-context";
import { frenchRequestAdmission } from "@/shared/alexa/request-contract";

export type ProposalResult =
  | { state: "ready"; proposal: AlexaProposal; patientId: string | null }
  | { state: "print"; patientId: string; documentId: string; label: string }
  | { state: "missing"; slot: "patient" | "date" | "content" | "operation"; message?: string }
  | { state: "unavailable" };
type PrintProposalResult = Extract<ProposalResult, { state: "print" } | { state: "missing" } | { state: "unavailable" }>;

function normalized(text: string): string {
  return text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
}

/** Remove only a polite frame and an explicit patient prefix, never action details. */
function commandView(text: string): string {
  return text
    .replace(/^(?:alexa|assistant)[, :]+/u, "")
    .replace(/^(?:(?:pour|concernant)\s+)?(?:patiente?\s+)?[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*){1,2}\s*,\s*/u, "")
    .replace(/^(?:(?:s.il te plait|s.il vous plait|svp),?\s*)?(?:(?:peux[- ]tu|pourrais[- ]tu|pouvez[- ]vous|pourriez[- ]vous|tu peux|vous pouvez|je voudrais|j.aimerais|je souhaite|je veux)\s+(?:(?:me|nous)\s+|(?:que\s+)?(?:tu|vous)\s+)?)/u, "")
    .trim();
}

const negatedDocumentCommand = /^(?:ne\s+)?(?:prepare|preparer|preparez|creer|cree|redige|rediger|genere|generer|generez)\b[\s\S]*\b(?:pas|jamais|plus|aucun|aucune)\b/u;

function requestedDocumentKind(text: string): DocumentKind | null {
  if (/\bbonne sante(?: mentale)?\b/u.test(text)) return "bonne_sante_mentale";
  if (/\bsuivi medical\b/u.test(text)) return "suivi_medical";
  if (/\bcertificat medical\b/u.test(text)) return "certificat_medical";
  if (/\bjustificati(?:on|f)\b/u.test(text)) return "justification";
  if (/\bordonn?ances?\b/u.test(text)) return "ordonnance";
  return null;
}

export function explicitAlgerianClockTime(text:string):string|null{
  const times=[...normalized(text).matchAll(/\b((?:[01]?\d)|2[0-3])\s*(?::\s*([0-5]\d)|h(?:eure?s?)?(?:\s*([0-5]\d))?)\b/gu)];
  if(times.length!==1)return null;
  const hour=String(Number(times[0]![1])).padStart(2,"0"),minute=times[0]![2]??times[0]![3]??"00";
  return `${hour}:${minute}`;
}

/** Message opérationnel : le texte après « dire que », « disant » ou « : ». */
function requestedInternalMessage(text: string): string | null {
  const patterns = [
    /(?:message|mot)\s*(?:a la secretaire|a l'accueil|a la reception)?\s*(?:pour (?:lui )?dire|disant|:)\s*(.{3,1000})$/u,
    /(?:dis|dire|previens|prevenir)\s+(?:a la secretaire|a l'accueil|a la reception)\s+(?:que\s+)?(.{3,1000})$/u,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return match[1]!.trim();
  }
  return null;
}

/**
 * Les demandes explicites ci-dessous restent disponibles sans modèle local.
 * Le modèle conserve les paraphrases et les demandes composées ; ce chemin
 * déterministe ne fait que rendre les gestes déjà authorisés atteignables.
 */
export function deterministicActionRequest(text: string, selectedDocumentId?:string|null): boolean {
  const plain = normalized(text);
  const command = plain;
  if (negatedDocumentCommand.test(plain)) return false;
  const admission=frenchRequestAdmission(text,false,undefined,selectedDocumentId);
  if(admission.tools?.length===1&&admission.tools[0]==="query_documents"&&admission.documentKind==="ordonnance")return false;
  const document = /^(?:prepare|preparer|preparez|creer|cree|redige|rediger|genere|generer|generez)\b/u.test(command)
    && requestedDocumentKind(plain) !== null;
  const message = /\b(?:envoie|envoyer|transmets|transmettre|dis|dire|previens|prevenir)\b/u.test(plain)
    && /\b(?:secretaire|accueil|reception)\b/u.test(plain);
  const print = admission.preparationAction==="print_issued_document";
  const price = /^(?:fixe|fixer|mets|mettre|change|changer|modifie|modifier)\b/u.test(command) && /\b(?:tarif|prix)\b/u.test(plain);
  const payment = /^(?:encaisse|encaisser)\b/u.test(command) && /\b(?:paiement|consultation|seance)\b/u.test(plain);
  const arrival = ["mark_patient_arrived"].includes(admission.preparationAction??'');
  const appointment = ["create_appointment","reschedule_appointment","cancel_appointment"].includes(admission.preparationAction??'');
  const close = admission.preparationAction==="close_consultation";
  return document || message || print || price || payment || arrival || appointment || close;
}

/** Re-read the patient-scoped list and select one already-issued document only. */
export async function prepareIssuedDocumentPrint(
  db: Pick<DbPort, "rpc">,
  patientId: string,
  kind: DocumentKind|null,
  signal: AbortSignal,
  selectedDocumentId?:string,
  expectedRevision?:string,
): Promise<PrintProposalResult> {
  let listed;
  try { listed = await db.rpc<unknown>("list_patient_documents", { p_patient_id: patientId }); }
  catch { return { state: "unavailable" }; }
  signal.throwIfAborted();
  if (!listed.ok) return { state: "unavailable" };
  const rows = z.object({
    document_id: z.uuid(), doc_type: z.string(), doc_number: z.string().min(1),
    status: z.string().optional(),
  }).passthrough();
  const issued = listed.data.flatMap((row) => {
    const parsed = rows.safeParse(row);
    return parsed.success && (parsed.data.status ?? "issued") === "issued" ? [parsed.data] : [];
  });
  if(selectedDocumentId){
    const document=issued.find(row=>row.document_id===selectedDocumentId);
    if(!document||kind&&document.doc_type!==kind)return {state:"missing",slot:"content",message:alexaActions.printNoDocument("document sélectionné")};
    const documentKind=z.enum(["bonne_sante_mentale","suivi_medical","certificat_medical","justification","ordonnance"]).safeParse(document.doc_type);
    if(!documentKind.success)return {state:"missing",slot:"content",message:alexaActions.printNoDocument("document sélectionné")};
    let current;
    try{current=await db.rpc<unknown>("get_document",{p_id:selectedDocumentId});}
    catch{return {state:"unavailable"};}
    signal.throwIfAborted();
    if(!current.ok)return {state:"unavailable"};
    const currentRows=z.object({document_id:z.uuid(),patient_id:z.uuid(),doc_type:z.string(),doc_number:z.string().min(1),content_hash:z.string().nullable().optional()}).passthrough();
    const matches=current.data.flatMap(row=>{const parsed=currentRows.safeParse(row);return parsed.success?[parsed.data]:[];});
    const verified=matches.length===1?matches[0]:undefined;
    if(!verified||verified.document_id!==selectedDocumentId||verified.patient_id!==patientId||verified.doc_type!==document.doc_type||verified.doc_number!==document.doc_number||(expectedRevision!==undefined&&(verified.content_hash??"")!==expectedRevision)){
      return {state:"missing",slot:"content",message:"Le document sélectionné a changé ou n’appartient plus à ce dossier. Actualisez sa sélection avant l’impression."};
    }
    return {state:"print",patientId,documentId:verified.document_id,label:`${documentLabels[documentKind.data]} ${verified.doc_number}`};
  }
  if(!kind)return {state:"missing",slot:"content",message:alexaActions.printNoDocument("document")};
  const documents=issued.filter(document=>document.doc_type===kind);
  const label=documentLabels[kind].toLowerCase();
  if (documents.length === 0) return { state: "missing", slot: "content", message: alexaActions.printNoDocument(label) };
  if (documents.length > 1) return { state: "missing", slot: "content", message: alexaActions.printMultiple(label) };
  const document = documents[0]!;
  return { state: "print", patientId, documentId: document.document_id, label: `${documentLabels[kind]} ${document.doc_number}` };
}

/** Compile explicit bounded action arguments. Never executes, confirms or grants authority. */
export async function prepareActionProposal(
  input: TurnInput,
  db: Pick<DbPort, "rpc">,
  client: ClientSql,
  signal: AbortSignal,
): Promise<ProposalResult> {
  const text = normalized(input.text);
  const command = commandView(text);
  if (negatedDocumentCommand.test(text)) return { state: "missing", slot: "operation" };
  const kind = requestedDocumentKind(text);
  const messageBody = requestedInternalMessage(text);
  const admission=frenchRequestAdmission(text,false,undefined,input.appContext.documentId);
  const admittedAction=admission.preparationAction;
  const directActions=["set_consultation_price","record_payment_collected","create_editable_document_draft","close_consultation","send_internal_message","create_appointment","reschedule_appointment","cancel_appointment","mark_patient_arrived","print_issued_document"];
  // Only literal imperatives are shortcuts. Quoted notes/help are not commands.
  let tool: string | null = directActions.includes(admittedAction??'') ? admittedAction!
    : /^(?:fixe|fixer|mets|mettre|change|changer|modifie|modifier)\b/u.test(command) && /\b(?:tarif|prix)\b/u.test(text) ? "set_consultation_price"
    : /^(?:encaisse|encaisser)\b/u.test(command) ? "record_payment_collected"
    : kind !== null && /^(?:prepare|preparer|preparez|creer|cree|redige|rediger|genere|generer|generez)\b/u.test(command) ? "create_editable_document_draft"
    : /^(?:clore|cloture|ferme|fermer|termine|terminer)\b/u.test(command) && /\b(?:consultation|seance)\b/u.test(text) ? "close_consultation"
    : messageBody !== null ? "send_internal_message"
    : /^(?:prepare|preparer|cree|creer)\b/u.test(command) && /\bbrouillon\b/u.test(text) ? "create_document_draft"
    : /^(?:prepare|preparer|preparez|planifie|planifier|cree|creer|prends|prendre)\b/u.test(command) && /\b(?:rendez[- ]vous|rdv)\b/u.test(text) ? "create_appointment"
    : /^(?:decale|decaler|deplace|deplacer|reporte|reporter)\b/u.test(command) && /\b(?:rendez[- ]vous|rdv)\b/u.test(text) ? "reschedule_appointment"
    : /^(?:annule|annuler)\b/u.test(command) && /\b(?:rendez[- ]vous|rdv)\b/u.test(text) ? "cancel_appointment"
    : /^(?:marque|marquer|signale|signaler)\b/u.test(command) && /\barrive/u.test(text) ? "mark_patient_arrived" : null;
  const mention = parsePatientMention(input.text);
  if (mention.status === "ambiguous") return { state: "missing", slot: "patient" };
  const name = input.patientName ?? (mention.status === "named" ? mention.name : undefined);

  // Imprimer un document DÉJÀ ÉMIS ne crée rien. On ouvre la pièce exacte et
  // l'écran existant lance le dialogue d'impression ; aucun numéro n'est
  // consommé, aucune nouvelle version n'est fabriquée.
  if (tool==="print_issued_document") {
    if (kind === null&&!input.appContext.documentId) return { state: "missing", slot: "content", message: alexaActions.printNoDocument("document") };
    const patient = await resolvePatient(db, name ? { name } : input.appContext.patientId ? { patientId: input.appContext.patientId } : {}, signal);
    if (patient.status !== "resolved") return { state: "missing", slot: "patient" };
    return prepareIssuedDocumentPrint(db, patient.patientId, kind, signal,input.appContext.documentId??undefined,input.appContext.documentRevision??undefined);
  }

  if (!tool || !capaciteEcriture(tool)) return { state: "missing", slot: "operation" };

  if (tool === "send_internal_message") {
    if (messageBody === null) return { state: "missing", slot: "content", message: alexaActions.internalMessageMissing };
    let patientId: string | null = input.appContext.patientId;
    if (patientId === null && name !== undefined) {
      const resolved = await resolvePatient(db, { name }, signal);
      patientId = resolved.status === "resolved" ? resolved.patientId : null;
    }
    let guard: { first_name: string; last_name: string; record_number: string | null; id_document_number: string | null } | null = null;
    if (patientId !== null) {
      const result = await db.rpc<unknown>("get_patient", { p_id: patientId });
      signal.throwIfAborted();
      const row = result.ok ? z.object({
        id: z.uuid(), first_name: z.string().min(1), last_name: z.string().min(1),
        record_number: z.string().nullable().optional(), id_document_number: z.string().nullable().optional(),
      }).safeParse(result.data[0]) : null;
      if (!row?.success || row.data.id !== patientId) return { state: "unavailable" };
      guard = { first_name: row.data.first_name, last_name: row.data.last_name, record_number: row.data.record_number ?? null, id_document_number: row.data.id_document_number ?? null };
    }
    const decision = prepareInternalMessage(messageBody, {
      firstName: guard?.first_name ?? "", lastName: guard?.last_name ?? "",
      recordNumber: guard?.record_number ?? null, idDocumentNumber: guard?.id_document_number ?? null,
    });
    if (!decision.ok) return { state: "missing", slot: "content", message: alexaActions.internalMessageRestricted };
    return { state: "ready", proposal: { tool, args: { clientMsgId: randomUUID(), body: decision.body } }, patientId };
  }

  const patient = await resolvePatient(db, name ? { name } : input.appContext.patientId ? { patientId: input.appContext.patientId } : {}, signal);
  if (patient.status !== "resolved") return { state: "missing", slot: "patient" };

  if (tool === "create_editable_document_draft") {
    if (kind === null) return { state: "missing", slot: "content" };
    const resolved = await resolveDocumentDraftInputs(db, patient.patientId, kind, input.text, input.appContext.page, signal);
    signal.throwIfAborted();
    if (resolved.state === "unavailable") return { state: "unavailable" };
    if (resolved.state === "missing") return { state: "missing", slot: "content", message: resolved.question };
    return {
      state: "ready",
      proposal: {
        tool,
        args: {
          patientId: patient.patientId,
          documentType: resolved.kind,
          variables: JSON.stringify(resolved.variables),
          content: JSON.stringify(resolved.content),
        },
      },
      patientId: patient.patientId,
    };
  }

  if (tool === "close_consultation") {
    const pageConsultation = /^\/consultation\/([0-9a-f-]{36})$/iu.exec(input.appContext.page)?.[1];
    const consultationId=pageConsultation??input.appContext.consultationId??undefined;
    if (!consultationId || !z.uuid().safeParse(consultationId).success) return { state: "missing", slot: "content", message: alexaActions.closeConsultationRequiresTariff };
    const result = await db.rpc<unknown>("get_consultation", { p_id: consultationId });
    signal.throwIfAborted();
    const parsed = result.ok ? z.object({ id: z.uuid(), patient_id: z.uuid() }).safeParse(result.data[0]) : null;
    if (!parsed?.success || parsed.data.id !== consultationId || parsed.data.patient_id !== patient.patientId) return { state: "unavailable" };
    return { state: "ready", proposal: { tool, args: { consultationId: parsed.data.id } }, patientId: patient.patientId };
  }

  const args: AlexaProposal["args"] = {};
  if (["set_consultation_price", "record_payment_collected", "create_document_draft"].includes(tool)) {
    const pageConsultation = /^\/consultation\/([0-9a-f-]{36})$/iu.exec(input.appContext.page)?.[1];
    let consultationId = pageConsultation??input.appContext.consultationId??undefined;
    if (!consultationId && /\b(?:consultation|seance)\s+(?:courante|actuelle|en cours)\b/u.test(text)) {
      try {
        consultationId = (await buildClinicalContext(db, { patientId: patient.patientId }, { count: 1 }, signal)).currentConsultation?.id;
      } catch {
        return { state: "unavailable" };
      }
    }
    if (!consultationId || !z.uuid().safeParse(consultationId).success) return { state: "missing", slot: "content", message: alexaActions.currentConsultationMissing };
    const result = await db.rpc<unknown>("get_consultation", { p_id: consultationId });
    signal.throwIfAborted();
    const parsed = result.ok ? z.object({ id: z.uuid(), patient_id: z.uuid() }).safeParse(result.data[0]) : null;
    if (!parsed?.success || parsed.data.id !== consultationId || parsed.data.patient_id !== patient.patientId) return { state: "unavailable" };
    args["consultationId"] = parsed.data.id;
    if (tool === "set_consultation_price") {
      if (/[+−-]\s*\d|\d\s*[.,]\s*\d/u.test(text)) return { state: "missing", slot: "content" };
      const values = [...text.matchAll(/(?<![\p{L}\p{N}.,])\d+(?![\p{L}\p{N}.,])/gu)];
      if (values.length !== 1 || Number(values[0]![0]) > 1000000) return { state: "missing", slot: "content" };
      args["amountDzd"] = Number(values[0]![0]);
    } else if (tool === "record_payment_collected") {
      const payment = await db.rpc<unknown>("get_consultation_payment", { p_consultation_id: parsed.data.id });
      signal.throwIfAborted();
      const row = payment.ok ? z.object({ payment_id: z.uuid() }).safeParse(payment.data[0]) : null;
      if (!row?.success) return { state: "unavailable" };
      args["paymentId"] = row.data.payment_id;
    } else {
      const type = /bonne sante/u.test(text) ? "bonne_sante_mentale" : /suivi medical/u.test(text) ? "suivi_medical" : /certificat medical/u.test(text) ? "certificat_medical" : /justification/u.test(text) ? "justification" : null;
      if (!type) return { state: "missing", slot: "content" };
      args["documentType"] = type;
    }
  } else {
    const selection = agendaSelection(input.text);
    if (!selection) return { state: "missing", slot: "date" };
    if (tool === "create_appointment" || tool === "reschedule_appointment") {
      const clockTime=explicitAlgerianClockTime(text);
      if (!clockTime) return { state: "missing", slot: "date" };
      const explicitDay = /\d{4}-\d{2}-\d{2}|aujourd|demain|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche/u.test(text);
      if (!explicitDay) return { state: "missing", slot: "date" };
      const startsAt = `${selection.day}T${clockTime}:00+01:00`;
      if (tool === "create_appointment") {
        args["patientId"] = patient.patientId;
        args["startsAt"] = startsAt;
        const durations = [...text.matchAll(/(?<![\p{L}\p{N}])([+−-]?\d[\d.,]*)\s*(?:minutes|min)\b/gu)];
        if (durations.length > 1 || (durations.length === 1 && !/^\d{1,3}$/u.test(durations[0]![1]!))
          || (!durations.length && /\b(?:minutes|min)\b/u.test(text))) return { state: "missing", slot: "content" };
        args["durationMinutes"] = durations.length ? Number(durations[0]![1]) : 45;
        if (Number(args["durationMinutes"]) < 5 || Number(args["durationMinutes"]) > 240) return { state: "missing", slot: "content" };
      } else {
        args["nouveauDebut"] = startsAt;
        const pageMatch = /^\/agenda\/([0-9a-f-]{36})$/iu.exec(input.appContext.page);
        if (pageMatch && z.uuid().safeParse(pageMatch[1]).success) {
          const current = await db.rpc<unknown>("get_appointment", { p_id: pageMatch[1]! });
          signal.throwIfAborted();
          const row = current.ok ? z.object({ id: z.uuid(), patient_id: z.uuid() }).safeParse(current.data[0]) : null;
          if (!row?.success || row.data.id !== pageMatch[1] || row.data.patient_id !== patient.patientId) return { state: "unavailable" };
          args["appointmentId"] = row.data.id;
        } else {
          // The source appointment must be unique on the day the doctor named;
          // a destination time alone never identifies which appointment moves.
          const day = selection.day;
          const appointments = (await readAgendaDay(client, day, false, signal)).filter((row) => row.patient_id === patient.patientId);
          if (appointments.length !== 1) return { state: "missing", slot: "date" };
          args["appointmentId"] = appointments[0]!.id;
        }
        const durations = [...text.matchAll(/(?<![\p{L}\p{N}])([+−-]?\d[\d.,]*)\s*(?:minutes|min)\b/gu)];
        if (durations.length > 1 || (durations.length === 1 && !/^\d{1,3}$/u.test(durations[0]![1]!))) return { state: "missing", slot: "content" };
        if (durations.length) args["nouvelleDureeMinutes"] = Number(durations[0]![1]);
      }
    }
    if (tool !== "create_appointment" && tool !== "reschedule_appointment") {
      const day = selection.day;
      const appointments = (await readAgendaDay(client, day, false, signal)).filter((row) => row.patient_id === patient.patientId);
      if (appointments.length !== 1) return { state: "missing", slot: "date" };
      args["appointmentId"] = appointments[0]!.id;
      if (tool === "cancel_appointment") {
        const reason = /(?:motif|raison)\s*:\s*(.{3,300})$/iu.exec(input.text);
        if (!reason) return { state: "missing", slot: "content" };
        args["motif"] = reason[1]!.trim();
      }
    }
  }
  signal.throwIfAborted();
  // Revalidate the selected dossier immediately before publishing the proposal.
  if ((await resolvePatient(db, { patientId: patient.patientId }, signal)).status !== "resolved") return { state: "unavailable" };
  return { state: "ready", proposal: { tool, args }, patientId: patient.patientId };
}
