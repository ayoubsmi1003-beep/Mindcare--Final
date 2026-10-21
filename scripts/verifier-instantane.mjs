#!/usr/bin/env node
// Refuse a stale or lossy clinical snapshot before producing an installer.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditSnapshotPreservation } from './lib/electron-runtime-audit.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
try {
  const snapshotRoot = path.join(root, 'resources', 'snapshot');
  const manifest = JSON.parse(readFileSync(path.join(snapshotRoot, 'manifest.json'), 'utf8'));
  const errors = auditSnapshotPreservation(manifest);
  const migrations = readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter(name => name.endsWith('.sql')).map(name => name.slice(0, -4)).sort();
  if (!Array.isArray(manifest.migrations) || JSON.stringify([...manifest.migrations].sort()) !== JSON.stringify(migrations)) {
    errors.push('snapshot migrations do not match the application');
  }
  if (errors.length) {
    console.error(`[instantané] REFUS — ${errors.join('; ')}. Aucun installateur créé.`);
    process.exit(1);
  }
  const hash = createHash('sha256').update(readFileSync(path.join(snapshotRoot, 'base.dump'))).digest('hex');
  if (hash !== manifest.sha256?.toLowerCase()) throw new Error('integrity');
  console.log(`[instantané] ${manifest.patient_count} patients conservés, migrations et empreinte vérifiées.`);
} catch {
  console.error('[instantané] REFUS — fichiers absents, illisibles ou empreinte incorrecte. Aucun installateur créé.');
  process.exit(1);
}
