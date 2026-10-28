import type { WorkingReference } from "./request-plan";
import { z } from "zod";

export interface TurnLease { key: string; revision: number; patientId: string | null; page: string }
interface Entry { revision: number; patientId: string | null; page: string; contextKey: string; at: number; turns: WorkingReference[] }
const referenceSchema=z.object({
  intent:z.enum(["history","current_consultation","notes","diagnoses","scales","dialogue","general","navigation","treatments","treatment_changes","summary","preparation","longitudinal","knowledge","agenda","receipts","patient_search","proposal","clarify","app_help","clock","profile","documents","patient_finance"]),
  count:z.number().int().min(1).max(1000),
  cursor:z.object({startedAt:z.string().max(80),id:z.string().max(200)}).strict().optional(),
  selectionBefore:z.object({startedAt:z.string().max(80),id:z.string().max(200)}).strict().optional(),
  operation:z.enum(["compare","summarize"]).optional(),focus:z.enum(["sleep","anxiety","mood","risk","symptoms"]).optional(),
  agendaDay:z.iso.date().optional(),agendaRequestedOnly:z.boolean().optional(),
  patientFilter:z.enum(["all","missing_identity_card","missing_phone","missing_email"]).optional(),
  outputShape:z.enum(["count","list","fact","explanation"]).optional(),
  patients:z.array(z.object({patientId:z.uuid(),label:z.string().max(500)}).strict()).max(20).optional(),
  listOffset:z.number().int().min(0).max(10000).optional(),listTotal:z.number().int().min(0).max(1000000).optional(),
  selectedPatientId:z.uuid().optional(),lastRequest:z.string().min(1).max(4000).optional(),
}).strip();
export function parseWorkingReference(value:unknown):WorkingReference|null {
  const parsed=referenceSchema.safeParse(value);
  return parsed.success?parsed.data as WorkingReference:null;
}
/** Server-only RAM, actor-bound; eight references, fifteen idle minutes. No transcripts. */
export class ConversationState {
  private entries = new Map<string, Entry>();
  private serial = 0;
  private key(actor: string, conversation: string): string { return JSON.stringify([actor, conversation]); }
  private sweep(now: number): void {
    for (const [key, value] of this.entries) if (now - value.at > 900_000) this.entries.delete(key);
    // No unbounded authenticated-client memory growth.
    while (this.entries.size >= 256) this.entries.delete(this.entries.keys().next().value as string);
  }
  read(actor: string, conversation: string, patientId: string | null, page: string, now = Date.now(), contextKey = ""): WorkingReference | null {
    this.sweep(now);
    const value = this.entries.get(this.key(actor, conversation));
    return value && value.patientId === patientId && value.page === page && value.contextKey === contextKey ? value.turns.at(-1) ?? null : null;
  }
  begin(actor: string, conversation: string, patientId: string | null, page: string, now = Date.now(), contextKey = ""): TurnLease {
    this.sweep(now);
    const key = this.key(actor, conversation);
    const old = this.entries.get(key);
    const revision = ++this.serial;
    this.entries.set(key, { revision, patientId, page, contextKey, at: now, turns: old?.patientId === patientId && old.page === page && old.contextKey === contextKey ? old.turns : [] });
    return { key, revision, patientId, page };
  }
  restore(actor:string,conversation:string,patientId:string|null,page:string,reference:unknown,contextKey:string,now=Date.now()):boolean {
    this.sweep(now);
    if(!actor||!conversation||page.length>200||contextKey.length>1000)return false;
    const parsed=parseWorkingReference(reference);if(!parsed)return false;
    const key=this.key(actor,conversation),revision=++this.serial;
    this.entries.set(key,{revision,patientId,page,contextKey,at:now,turns:[parsed]});
    return true;
  }
  isCurrent(lease: TurnLease): boolean { return this.entries.get(lease.key)?.revision === lease.revision; }
  finish(lease: TurnLease, reference: WorkingReference, now = Date.now()): boolean {
    const entry = this.entries.get(lease.key);
    if (!entry || !this.isCurrent(lease)) return false;
    entry.turns = [...entry.turns, reference].slice(-8);
    entry.at = now;
    return true;
  }
  clear(actor: string, conversation: string): void { this.entries.delete(this.key(actor, conversation)); }
}

export const conversationState = new ConversationState();

/** An ordinal is a local selection, never an instruction or an arbitrary identifier. */
export function resolveListedReference(text:string,candidates:readonly {patientId:string;label:string}[]):string|null {
  const value=text.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("fr").replace(/[?!.؟]/gu,"").trim();
  const normalized=value.replace(/^(?:le|la|patient|المريض)\s+/u,"");
  const ordinals:Record<string,number>={premier:1,premiere:1,deuxieme:2,second:2,seconde:2,troisieme:3,quatrieme:4,cinquieme:5,"الاول":1,"الثاني":2,"الثالث":3};
  const index=/^\d{1,2}$/u.test(normalized)?Number(normalized):ordinals[normalized];
  if(index!==undefined)return candidates[index-1]?.patientId??null;
  const exact=candidates.filter(c=>c.label.normalize("NFKD").replace(/\p{M}/gu,"").toLocaleLowerCase("fr")===value);
  return exact.length===1?exact[0]!.patientId:null;
}
