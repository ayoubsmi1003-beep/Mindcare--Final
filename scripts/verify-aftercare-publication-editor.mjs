// Operates only on uniquely named synthetic publications in the existing qualification runtime.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const plan = 'C:/MindCare/mindcare-website/.superpowers/sdd/MASTER-TRANSFORMATION';
const runtime = JSON.parse(readFileSync(`${plan}/runtime.json`, 'utf8'));
const endpoint = process.env.AFTERCARE_WORKSPACE_TEST_ORIGIN ?? runtime.clinic;
const origin = typeof endpoint === 'number' || /^\d+$/.test(endpoint) ? `http://127.0.0.1:${endpoint}` : new URL(endpoint).origin;
assert.equal(new URL(origin).hostname, '127.0.0.1');
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState: `${plan}/doctor-auth.json` });
  const page = await context.newPage(); page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/aftercare/qualification?patientId=b2000000-0000-4000-8000-000000000001`);
  await page.getByRole('heading', { name: 'Aftercare', exact: true }).waitFor();
  async function action(button) {
    const response = page.waitForResponse(response => response.url().endsWith('/api/aftercare/qualification/rpc') && response.request().method() === 'POST' && response.request().postDataJSON()?.name === 'publish_aftercare_object');
    await button.click(); const result = await response; assert.equal(result.status(), 200); const body = await result.json(); assert.equal(body.ok, true); return body.data[0];
  }
  const prefix = `Synthetic doctor editor ${Date.now()}`;
  const proof = [];
  for (const kind of ['mission', 'carePlan', 'doctorNote']) {
    let editor = page.getByRole('heading', { name: 'Publication médicale', exact: true }).locator('..');
    await editor.getByLabel('Type', { exact: true }).selectOption(kind);
    if (kind !== 'doctorNote') await editor.getByLabel('Titre', { exact: true }).fill(`${prefix} ${kind}`);
    if (kind === 'mission') await editor.getByLabel('Objectif', { exact: true }).fill('Synthetic purpose');
    await editor.getByLabel(kind === 'mission' ? 'Consignes' : 'Texte', { exact: true }).fill(`${prefix} ${kind} original`);
    await editor.getByLabel('Je confirme le contenu exact à transmettre au patient.', { exact: true }).check();
    const created = await action(editor.getByRole('button', { name: 'Publier après confirmation', exact: true }));
    assert.equal(created.envelope.version, 1);
    let article = page.locator('article').filter({ hasText: `${prefix} ${kind} original` });
    await article.getByRole('button', { name: 'Modifier cette publication', exact: true }).click();
    await editor.getByLabel(kind === 'mission' ? 'Consignes' : 'Texte', { exact: true }).fill(`${prefix} ${kind} revised`);
    await editor.getByLabel('Je confirme le contenu exact à transmettre au patient.', { exact: true }).check();
    const updated = await action(editor.getByRole('button', { name: 'Confirmer la nouvelle version', exact: true }));
    assert.equal(updated.object_id, created.object_id); assert.equal(updated.envelope.version, 2);
    article = page.locator('article').filter({ hasText: `${prefix} ${kind} revised` });
    await article.getByRole('button', { name: 'Retirer cette publication', exact: true }).click();
    editor = page.getByRole('heading', { name: 'Retrait de publication', exact: true }).locator('..');
    await editor.getByLabel('Je confirme le retrait de cette publication auprès du patient.', { exact: true }).check();
    const withdrawn = await action(editor.getByRole('button', { name: 'Retirer cette publication', exact: true }));
    assert.equal(withdrawn.object_id, created.object_id); assert.equal(withdrawn.envelope.version, 3); assert.equal(withdrawn.envelope.object.body.status, 'withdrawn');
    proof.push({ kind, versions: [1, 2, 3], sameObject: true, withdrawn: true });
  }
  const editor = page.getByRole('heading', { name: 'Publication médicale', exact: true }).locator('..');
  await editor.getByLabel('Type', { exact: true }).selectOption('personalEvent');
  await editor.getByLabel('Titre', { exact: true }).fill(`${prefix} milestone`);
  await editor.getByLabel('Texte', { exact: true }).fill('Synthetic doctor-approved milestone');
  await editor.getByLabel('Date de l’étape', { exact: true }).fill('2026-11-17');
  await editor.getByLabel('Domaine de l’étape', { exact: true }).selectOption('achievement');
  await editor.getByLabel('Je confirme le contenu exact à transmettre au patient.', { exact: true }).check();
  const milestone = await action(editor.getByRole('button', { name: 'Publier après confirmation', exact: true }));
  assert.equal(milestone.envelope.object.kind, 'personalEvent'); assert.equal(milestone.envelope.object.body.type, 'milestone');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result: 'PASS', publicationEditor: proof, milestone: true, pageErrors: errors.length, transport: 'Not dispatched; original root publications untouched' }));
} finally { await browser.close(); }
