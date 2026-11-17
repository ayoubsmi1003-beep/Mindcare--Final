// Fresh native PostgreSQL only. No URL, .env, installed service or existing cluster is accepted.
import { execFileSync, spawn } from 'node:child_process';
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
  if (process.argv.includes('--transport') || process.argv.includes('--serve')) {
    sql(read('supabase/migrations/074_patient_treatments_state.sql') + '\n' + read('supabase/migrations/228_aftercare_clinical_snapshots.sql') + '\n' + read('supabase/migrations/229_aftercare_support_authority.sql'));
    if (process.argv.includes('--serve')) {
      assert.equal(env.AFTERCARE_ENABLED, 'synthetic');
      assert.ok((env.AFTERCARE_BRIDGE_KEY ?? '').length >= 32);
      const bridge = new URL(env.AFTERCARE_BRIDGE_URL ?? ''); assert.equal(bridge.hostname, '127.0.0.1'); assert.equal(bridge.pathname, '/api/sanad/bridge');
      sql(read('supabase/migrations/070_local_auth.sql') + '\n' + read('supabase/migrations/158_username_login.sql'));
      sql(read('scripts/aftercare-transport-fixture.sql').split('SELECT app.verify_aftercare_binding')[0] + '\nCOMMIT;');
      sql("UPDATE auth.users SET email=CASE WHEN id='b1000000-0000-4000-8000-000000000001' THEN 'synthetic-doctor@aftercare.invalid' ELSE 'synthetic-reception@aftercare.invalid' END,encrypted_password=public.crypt('Synthetic-Aftercare-Only-2026!',public.gen_salt('bf'));");
      const httpPort = env.AFTERCARE_CLINIC_PORT ?? '3291';
      const child = spawn(process.execPath, [path.join(root, 'scripts/start-aftercare-qualification.mjs')], { cwd: root, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'], env: { ...env, AFTERCARE_NATIVE_QUALIFICATION: 'synthetic', MINDCARE_LIVE_CHECK: '1', MINDCARE_DATABASE_URL: `postgresql://mindcare_app@127.0.0.1:${port}/mindcare_aftercare_synthetic`, HOSTNAME: '127.0.0.1' } });
      let stopping = false;
      const stop = () => { stopping = true; if (process.platform === 'win32' && child.pid) execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); else child.kill(); };
      process.once('SIGINT', stop); process.once('SIGTERM', stop); process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => { if (chunk.includes('STOP')) stop(); });
      console.log(`AFTERCARE_QUALIFICATION_URL=http://127.0.0.1:${httpPort}/aftercare/qualification?patientId=b2000000-0000-4000-8000-000000000001`);
      await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => code && !stopping ? reject(new Error('Qualification server failed')) : resolve()); });
      process.stdin.pause();
    } else {
      sql(read('scripts/aftercare-transport-fixture.sql'));
      execFileSync(process.execPath, [path.join(root, 'node_modules/vitest/vitest.mjs'), 'run', 'tests/integration/aftercare-transport.test.ts'], { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...env, AFTERCARE_NATIVE_TEST: 'synthetic', MINDCARE_DATABASE_URL: `postgresql://mindcare_app@127.0.0.1:${port}/mindcare_aftercare_synthetic` }, timeout: 120000 });
    }
  } else {
    assert.ok(sql(read('scripts/checkpoint-aftercare.sql')).includes('AFTERCARE SQL CHECKPOINT PASS'));
    console.log('PASS isolated SQL gates, typed bodies, RLS, revocation/idempotence, audit and outbox');
  }
} finally {
  if (started && existsSync(path.join(data, 'postmaster.pid'))) run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
  // Keep the stopped synthetic directory for failed-run diagnosis; never remove a computed tree.
  console.log(`Synthetic cluster ${started ? 'stopped' : 'never started'}: ${dir}`);
}
