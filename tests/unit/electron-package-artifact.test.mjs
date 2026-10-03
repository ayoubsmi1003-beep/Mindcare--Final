import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const fixtures = [];
const pinnedTest = "resources/voix/packages/certifi/tests/test_certify.py";
const pinnedShell = "resources/voix/packages/tqdm/completion.sh";

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    const relative = path.relative(tmpdir(), fixture);
    assert.ok(relative.startsWith("mindcare-package-test-") && !relative.includes(path.sep));
    rmSync(fixture, { recursive: true, force: true });
  }
});

function artifact() {
  const directory = mkdtempSync(path.join(tmpdir(), "mindcare-package-test-"));
  fixtures.push(directory);
  const put = (relative, data = "") => {
    const target = path.join(directory, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, data);
  };
  for (const relative of ["MindCare OS.exe", "resources/serveur/server.js",
    "resources/serveur/scripts/verifier-base.mjs", "resources/serveur/scripts/lib/base-locale.mjs",
    "resources/serveur/scripts/garde-origine.mjs", "resources/serveur/scripts/sauvegarde.mjs",
    "resources/serveur/supabase/bootstrap/010_app_role.sql", "resources/serveur/supabase/migrations/120_fixture.sql",
    "resources/pgsql/bin/initdb.exe"]) put(relative);
  const header = Buffer.from(JSON.stringify({ files: { "dist-electron": { files: {
    main: { files: { "index.js": {} } }, preload: { files: { "index.cjs": {} } },
  } } } }));
  const pickle = Buffer.alloc(16);
  pickle.writeUInt32LE(header.length, 12);
  put("resources/app.asar", Buffer.concat([pickle, header]));
  put("resources/pgsql/lib/vector.dll", readFileSync(path.join(root, "resources/pgsql/lib/vector.dll")));
  const extensions = path.join(root, "resources/pgsql/share/extension");
  for (const file of readdirSync(extensions).filter(f => f === "vector.control" || /^vector--.*\.sql$/.test(f))) {
    put(`resources/pgsql/share/extension/${file}`, readFileSync(path.join(extensions, file)));
  }
  for (const relative of ["resources/voix/inventory.json", pinnedTest, pinnedShell]) {
    const target = path.join(directory, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(path.join(root, relative), target);
  }
  return { directory, put };
}

function verify(directory) {
  return spawnSync(process.execPath, [path.join(root, "scripts/verifier-paquet.mjs"), directory], {
    cwd: root, encoding: "utf8", timeout: 30000,
  });
}

test("accepts only unchanged inventory-pinned wheel tests and the pinned completion asset", () => {
  const { directory } = artifact();
  const result = verify(directory);
  assert.equal(result.status, 0, result.stderr);
});

test("rejects first-party checkpoint tooling and arbitrary files under voice packages", () => {
  const { directory, put } = artifact();
  put("resources/serveur/scripts/checkpoint-unapproved.mjs", "export const fixture = true;");
  put("resources/serveur/scripts/unapproved-runtime.mjs", "export const fixture = true;");
  put("resources/voix/packages/unapproved/tests/private.py", "pass");
  const result = verify(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /resources\/serveur\/scripts\/checkpoint-unapproved\.mjs/);
  assert.match(result.stderr, /resources\/serveur\/scripts\/unapproved-runtime\.mjs/);
  assert.match(result.stderr, /resources\/voix\/packages\/unapproved\/tests\/private\.py/);
});

test("rejects a changed third-party test even when its path is listed in the inventory", () => {
  const { directory, put } = artifact();
  put(pinnedTest, "# replaced vendor file");
  const result = verify(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /certifi\/tests\/test_certify\.py/);
});

test("rejects unpinned shell scripts and changes to the pinned completion asset", () => {
  const { directory, put } = artifact();
  put(pinnedShell, "# replaced completion");
  put("resources/voix/packages/tqdm/unapproved.sh", "echo fixture");
  const result = verify(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /tqdm\/completion\.sh/);
  assert.match(result.stderr, /tqdm\/unapproved\.sh/);
});

test("retains credential-shaped URL rejection for first-party files", () => {
  const { directory, put } = artifact();
  put("resources/serveur/server.js", "postgresql://fixture_user:fixture_password@localhost/fixture");
  const result = verify(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /une URL PostgreSQL avec identifiants/);
  assert.match(result.stderr, /resources\/serveur\/server\.js/);
});

test("rejects a changed voice inventory before granting dependency exemptions", () => {
  const { directory, put } = artifact();
  put("resources/voix/inventory.json", "[]");
  const result = verify(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inventaire voix/);
});

test("rejects development qualification records and cached test artifacts", () => {
  const { directory, put } = artifact();
  put("resources/serveur/.cache/alexa/gemini-free-qualification.json", "{}");
  put("resources/serveur/.cache/alexa/synthetic-result.json", "{}");
  const result = verify(directory);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\.cache\/alexa\/gemini-free-qualification\.json/);
  assert.match(result.stderr, /\.cache\/alexa\/synthetic-result\.json/);
});
