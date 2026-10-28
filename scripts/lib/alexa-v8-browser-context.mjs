const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const sha256Pattern = /^[a-f0-9]{64}$/u;

function selectedIssuedDocument(scenarioId, preconditions, snapshot) {
  if (typeof scenarioId !== 'string' || !scenarioId || !preconditions || preconditions.version !== 1 ||
      !preconditions.cases || typeof preconditions.cases !== 'object' || Array.isArray(preconditions.cases)) {
    throw new Error('Invalid evaluation browser preconditions');
  }
  const setup = preconditions.cases[scenarioId];
  if (setup === undefined) return null;
  if (!setup || setup.kind !== 'selected_issued_document' || setup.source !== 'currentDocument') {
    throw new Error(`Unsupported evaluation precondition: ${scenarioId}`);
  }

  const document = snapshot?.currentDocument;
  if (!document || typeof document !== 'object') throw new Error('Selected document is unavailable in the frozen snapshot');
  if (document.status !== 'issued') throw new Error('Selected document must be issued');
  if (document.is_synthetic !== true) throw new Error('Selected document must be synthetic evaluation data');
  if (typeof document.id !== 'string' || !uuidPattern.test(document.id) ||
      typeof document.patient_id !== 'string' || !uuidPattern.test(document.patient_id) ||
      typeof document.content_hash !== 'string' || !sha256Pattern.test(document.content_hash) ||
      typeof document.doc_number !== 'string' || !/^DOC-\d{4}-\d{5,}$/u.test(document.doc_number)) {
    throw new Error('Selected document identity or revision is invalid');
  }
  return document;
}

/** Resolve an audited UI precondition without changing a frozen prompt or oracle. */
export function resolveV8ScenarioPath(scenarioId, preconditions, snapshot, origin) {
  let base;
  try { base = new URL(origin); } catch { throw new Error('Invalid evaluation origin'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) {
    throw new Error('Invalid evaluation origin');
  }

  const path = new URL('/jarvis', base);
  const document = selectedIssuedDocument(scenarioId, preconditions, snapshot);
  if (document === null) return path.href;

  path.pathname = '/documents';
  path.searchParams.set('patient', document.patient_id);
  path.searchParams.set('document', document.id);
  return path.href;
}

/** Describe how the runner reaches Alexa from the scenario's current screen. */
export function resolveV8AssistantInteraction(scenarioId, preconditions, snapshot) {
  const document = selectedIssuedDocument(scenarioId, preconditions, snapshot);
  return document === null
    ? { openPanel: false, inputSelector: 'main textarea' }
    : { openPanel: true, inputSelector: 'aside input[aria-label]' };
}

/** Fail the UI scenario if its exact selected document context was not submitted. */
export function assertV8ScenarioAppContext(scenarioId, preconditions, snapshot, appContext) {
  const document = selectedIssuedDocument(scenarioId, preconditions, snapshot);
  if (document === null) return;
  if (!appContext || typeof appContext !== 'object' || appContext.page !== '/documents' ||
      appContext.patientId !== document.patient_id || appContext.documentId !== document.id ||
      appContext.documentRevision !== document.content_hash) {
    throw new Error('Submitted app context does not match the selected document and revision');
  }
}

/** Return failed same-origin Next assets, excluding unrelated third-party requests. */
export function findV8StaticAssetFailures(responses, origin) {
  let target;
  try { target = new URL(origin); } catch { throw new Error('Invalid evaluation origin'); }
  if (!Array.isArray(responses)) throw new Error('Invalid static asset observations');
  return responses.flatMap(response => {
    if (!response || typeof response.url !== 'string' || !Number.isInteger(response.status) || response.status < 400) return [];
    try {
      const url = new URL(response.url);
      return url.origin === target.origin && url.pathname.startsWith('/_next/static/')
        ? [{ path: url.pathname, status: response.status }]
        : [];
    } catch { return []; }
  });
}
