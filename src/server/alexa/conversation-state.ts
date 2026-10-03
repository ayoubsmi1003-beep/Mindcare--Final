import type { WorkingReference } from "./request-plan";

export interface TurnLease { key: string; revision: number; patientId: string | null; page: string }
interface Entry { revision: number; patientId: string | null; page: string; at: number; turns: WorkingReference[] }
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
  read(actor: string, conversation: string, patientId: string | null, page: string, now = Date.now()): WorkingReference | null {
    this.sweep(now);
    const value = this.entries.get(this.key(actor, conversation));
    return value && value.patientId === patientId && value.page === page ? value.turns.at(-1) ?? null : null;
  }
  begin(actor: string, conversation: string, patientId: string | null, page: string, now = Date.now()): TurnLease {
    this.sweep(now);
    const key = this.key(actor, conversation);
    const old = this.entries.get(key);
    const revision = ++this.serial;
    this.entries.set(key, { revision, patientId, page, at: now, turns: old?.patientId === patientId && old.page === page ? old.turns : [] });
    return { key, revision, patientId, page };
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
