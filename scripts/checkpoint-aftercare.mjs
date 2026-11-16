// Fresh native PostgreSQL only. No URL, .env, installed service or existing cluster is accepted.
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, realpathSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = process.env.AFTERCARE_TEST_PG_BIN ?? 'C:/Program Files/PostgreSQL/18/bin';
const dir = mkdtempSync(path.join(tmpdir(), 'mindcare_aftercare_synthetic_'));
const data = path.join(dir, 'data');
mkdirSync(data);
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^PG|DATABASE_URL|MINDCARE.*DATABASE/i.test(key)));
const run = (name, args, input) => execFileSync(path.join(bin, process.platform === 'win32' ? `${name}.exe` : name), args, { input, encoding: 'utf8', env, windowsHide: true, timeout: 120000, maxBuffer: 8 * 1024 * 1024, ...(name === 'pg_ctl' ? { stdio: 'ignore' } : {}) });
const server = net.createServer();
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const port = server.address().port;
await new Promise(resolve => server.close(resolve));
const args = ['-X', '-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'mindcare_aftercare_synthetic', '-qAt', '-v', 'ON_ERROR_STOP=1'];
const sql = source => run('psql', args, source);
let started = false;
try {
  // Disposable fixture cluster; skip only initdb's initial disk sync, never reuse it as a database.
  run('initdb', ['-D', data, '-U', 'postgres', '-A', 'trust', '--encoding=UTF8', '--locale=C', '--no-instructions', '--no-sync']);
  started = true;
  run('pg_ctl', ['-D', data, '-l', path.join(dir, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${port}`, '-w', 'start']);
  run('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'mindcare_aftercare_synthetic']);
  assert.equal(realpathSync(sql('SHOW data_directory').trim()).toLowerCase(), realpathSync(data).toLowerCase());
  assert.equal(sql("SELECT current_database()||'|'||count(*) FROM information_schema.tables WHERE table_schema='app'").trim(), 'mindcare_aftercare_synthetic|0');
  const read = name => readFileSync(path.join(root, name), 'utf8').replace(/^\uFEFF/, '');
  // Minimal real dependency chain, excluding seed015. No vector extension is needed for Aftercare.
  const dependencies = readdirSync(path.join(root, 'supabase/migrations')).filter(name => /^\d{3}_.*\.sql$/.test(name) && Number(name.slice(0, 3)) <= 20 && !name.startsWith('015_')).sort();
  sql('SET client_min_messages=warning;\n' + read('supabase/bootstrap/000_platform_compat.sql') + '\n' + dependencies.map(name => read(`supabase/migrations/${name}`)).join('\n') + '\nCREATE ROLE mindcare_app NOLOGIN;\n' + read('supabase/migrations/227_aftercare_master.sql'));
  console.log(`PASS migration227 on fresh PostgreSQL ${sql('SHOW server_version').trim()} with ${dependencies.length} real dependency migrations (seed015 excluded)`);
  assert.ok(sql(read('scripts/checkpoint-aftercare.sql')).includes('AFTERCARE SQL CHECKPOINT PASS'));
  console.log('PASS isolated SQL gates, typed bodies, RLS, revocation/idempotence, audit and outbox');
} finally {
  if (started && existsSync(path.join(data, 'postmaster.pid'))) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
  // Keep the stopped synthetic directory for failed-run diagnosis; never remove a computed tree.
  console.log(`Synthetic cluster ${started ? 'stopped' : 'never started'}: ${dir}`);
}
