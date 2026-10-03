import type { ClinicalConsultation } from "@/shared/alexa/clinical";
import type { ClinicalFocus } from "@/shared/alexa/request-plan";

export interface NoteExcerpt {
  text: string;
  noteVersion: string;
  amendmentAt?: string;
  area?: "working" | "subjective" | "objective" | "assessment" | "plan";
  unsigned?: boolean;
}
const topic: Record<Exclude<ClinicalFocus, "symptoms">, RegExp> = {
  sleep: /sommeil|dorm|insomni|r[eé]veil|endorm|sleep|النوم|نوم|ينعس|رقد|ارق|نعاس/iu,
  anxiety: /anxi|angoiss|panique|anxiety|قلق|خلع/iu,
  mood: /humeur|trist|depress|d[eé]press|euphori|irritab|mood|مزاج|حزن|اكتئاب/iu,
  risk: /suicid|auto.?agress|danger|risque|انتحار|خطر/iu,
};
const instruction = /ignore.{0,40}(?:instruction|consigne)|(?:system|assistant|developer)\s*:|(?:call|appelle|execute|ex[eé]cute).{0,40}(?:tool|outil|delete_|app\.)|\/api\/|تجاهل.{0,40}تعليمات/iu;

/** Quote complete recorded fields locally, preserving later attribution and
 * qualifiers. No diagnosis, translation or inference is made here. */
export function consultationExcerpts(consultation: ClinicalConsultation, focus?: ClinicalFocus, maxCharacters = 3000, maxExcerpts = 10, maxFieldCharacters = 500): { excerpts: NoteExcerpt[]; omitted: boolean; hasContent: boolean } {
  const excerpts: NoteExcerpt[] = [];
  let omitted = false, hasContent = false, used = 0;
  const seen = new Set<string>();
  const append = (value: string | null, noteVersion: string, amendmentAt?: string, area?: NoteExcerpt["area"], unsigned?: boolean) => {
    if (!value?.trim()) return;
    hasContent = true;
    // An adjacent sentence or line can qualify the first one. Do not select
    // individual sentences, even if they contain the requested topic word.
    const text = value.trim();
    if (!amendmentAt && focus && focus !== "symptoms" && !topic[focus].test(text)) return;
    if (instruction.test(text)) { omitted = true; return; }
    const key = JSON.stringify([text, noteVersion, amendmentAt, area]);
    if (seen.has(key)) return;
    seen.add(key);
    if (text.length > maxFieldCharacters || used + text.length > maxCharacters || excerpts.length >= maxExcerpts) { omitted = true; return; }
    excerpts.push({ text, noteVersion, ...(amendmentAt ? { amendmentAt } : {}), ...(area ? { area } : {}), ...(unsigned ? { unsigned: true } : {}) });
    used += text.length;
  };
  // Reserve the bounded excerpt space for corrections before original text.
  for (const note of consultation.notes) {
    for (const amendment of [...note.amendments].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))) append(amendment.body, note.version, amendment.createdAt);
  }
  append(consultation.rawNotes ?? null, consultation.rawNotesVersion ?? consultation.startedAt, undefined, "working", true);
  for (const note of consultation.notes) {
    for (const area of ["subjective", "objective", "assessment", "plan"] as const) append(note[area], note.version, undefined, area, note.status === "draft");
  }
  return { excerpts, omitted, hasContent };
}
