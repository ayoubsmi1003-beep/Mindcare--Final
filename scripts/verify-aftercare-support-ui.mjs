// Uses actual doctor controls and existing synthetic runtime; never calls a SQL gate directly.
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const plan = 'C:/MindCare/mindcare-website/.superpowers/sdd/MASTER-TRANSFORMATION';
const runtime = JSON.parse(readFileSync(`${plan}/runtime.json`, 'utf8'));
const origin = new URL(runtime.clinic).origin;
const relationship = process.env.AFTERCARE_SUPPORT_RELATION;
const evidence = process.env.AFTERCARE_SUPPORT_EVIDENCE;
assert.equal(new URL(origin).hostname, '127.0.0.1');
assert.match(relationship ?? '', /^[0-9a-f-]{36}$/);
assert.match(evidence ?? '', /^[A-Za-z0-9_./:-]{1,200}$/);
const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ storageState: `${plan}/doctor-auth.json` });
  const page = await context.newPage(); page.setDefaultTimeout(120000); page.setDefaultNavigationTimeout(120000);
  await page.goto(runtime.clinic);
  await page.getByText('Destinataires et autorité vérifiée', { exact: true }).click();
  await page.getByRole('button', { name: 'Consulter les relations autorisées', exact: true }).click();
  await page.getByLabel('Destinataire', { exact: true }).selectOption(relationship);
  await page.getByLabel('Référence locale des preuves d’identité et de relation (sans texte clinique)', { exact: true }).fill(evidence);
  await page.getByLabel('Soutien émotionnel', { exact: true }).check();
  await page.getByLabel('Coordination de l’accompagnement', { exact: true }).uncheck();
  await page.getByLabel('Représentation légale documentée', { exact: true }).uncheck();
  await page.getByLabel('Je confirme l’identité du destinataire, les preuves de relation et les seuls périmètres cochés. Ce geste n’accorde aucun accès automatique.', { exact: true }).check();
  const response = page.waitForResponse(response => response.url().endsWith('/api/aftercare/support') && response.request().method() === 'POST' && response.request().postDataJSON()?.action === 'verify');
  await page.getByRole('button', { name: 'Confirmer la vérification de cette relation', exact: true }).click();
  const result = await response; assert.equal(result.status(), 200);
  const body = await result.json(); assert.equal(body.ok, true); assert.equal(body.data.id, relationship); assert.ok(body.data.verifiedAt);
  assert.deepEqual(body.data.verifiedScopes, ['emotional-support']);
  await page.getByText('Vérification confirmée par le portail. Les partages restent choisis par le patient.', { exact: true }).waitFor();
  console.log(JSON.stringify({ result: 'PASS', relationship, actualDoctorUI: true, portalConfirmed: true, scopes: body.data.verifiedScopes, automaticAccess: false }));
} finally { await browser.close(); }
