import { agendaPeriodOf, agendaStatusOf, renderAgendaQuestion } from "./agenda-frame";
import type { CatalogueIntent } from "./intent-catalogue";
import { patientPeriod, patientSubject, renderPatientQuestion } from "./patient-question";
import { practiceQuestionFor } from "./practice-frame";

/**
 * The closed question for an intent chosen by meaning, written by the same renderers as the word-based frames, with the
 * subject and the period taken from the doctor's own sentence by the same parsers. Null when the sentence does not say who
 * or when clearly enough: the turn then keeps its previous route, which asks.
 */
export function renderIntent(intent: CatalogueIntent, text: string, options: { contextPatient: boolean; followup: boolean; ignoreUnknownWords?: boolean }, asOf: string): { readonly text: string; readonly contextPatient: boolean; readonly name?: string } | null {
  const target = intent.target;
  const plain = (value: string | null) => (value ? { text: value, contextPatient: false } : null);
  switch (target.family) {
    case "patient": {
      const period = patientPeriod(text, target.section, asOf);
      if (period === "refuse") return null;
      const subject = patientSubject(text, { ...options, periodRead: !!period }, target.section);
      if (!subject) return null;
      const question = renderPatientQuestion(target.section === "prev" ? { section: "prev", n: 3 } : { section: target.section }, subject, period ?? undefined);
      return subject.kind === "named" ? { text: question, contextPatient: false, name: subject.name } : { text: question, contextPatient: subject.kind === "context" };
    }
    case "agenda": return plain(renderAgendaQuestion(target.intent, target.intent === "next" ? null : agendaPeriodOf(text, asOf), agendaStatusOf(text)));
    case "finance": return plain(practiceQuestionFor(target.measure, text, asOf));
    case "activity": return plain(practiceQuestionFor("activity", text, asOf));
  }
}
