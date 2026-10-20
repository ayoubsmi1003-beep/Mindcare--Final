import { readFileSync, realpathSync } from 'node:fs';
import { isBuiltin, createRequire } from 'node:module';
import path from 'node:path';
import ts from 'typescript';

/** Audit emitted JavaScript, including literal import(), require() and re-exports. */
export function auditElectronModules(files) {
  const errors = [];
  for (const [name, source] of files) {
    if (!/^dist-electron\/(main|preload)\/.+\.(?:js|cjs)$/.test(name)) continue;
    const tree = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    function check(specifier) {
      if (specifier === 'electron' || isBuiltin(specifier)) return;
      if (!specifier.startsWith('.')) {
        errors.push(`${name}: runtime dependency outside the Electron allowlist: ${specifier}`);
        return;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), specifier));
      if (!files.has(target)) errors.push(`${name}: missing relative runtime module: ${target}`);
    }
    function visit(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) check(node.moduleSpecifier.text);
      if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
        if (node.arguments.length > 0 && ts.isStringLiteral(node.arguments[0])) check(node.arguments[0].text);
        else errors.push(`${name}: non-literal runtime import cannot be verified`);
      }
      ts.forEachChild(node, visit);
    }
    visit(tree);
  }
  for (const required of ['dist-electron/main/index.js', 'dist-electron/preload/index.cjs']) {
    if (!files.has(required)) errors.push(`missing Electron entry point: ${required}`);
  }
  return errors;
}

export function readAsarModules(archive) {
  const raw = readFileSync(archive);
  const size = raw.readUInt32LE(12);
  if (size > raw.length - 16) throw new Error('Invalid ASAR header');
  const header = JSON.parse(raw.subarray(16, 16 + size).toString('utf8'));
  const payload = 8 + raw.readUInt32LE(4);
  const files = new Map();
  function visit(node, prefix) {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const full = prefix ? `${prefix}/${name}` : name;
      if (entry.files) visit(entry, full);
      else if (/^dist-electron\/(main|preload)\/.+\.(?:js|cjs)$/.test(full)) {
        if (entry.unpacked || entry.link) throw new Error(`Unexpected unpacked or linked Electron module: ${full}`);
        const start = payload + Number(entry.offset);
        const end = start + entry.size;
        if (!Number.isSafeInteger(start) || end > raw.length) throw new Error(`Invalid ASAR module offset: ${full}`);
        files.set(full, raw.subarray(start, end).toString('utf8'));
      }
    }
  }
  visit(header, '');
  return files;
}

export function readAsarPackage(archive) {
  const raw = readFileSync(archive);
  const size = raw.readUInt32LE(12);
  if (size > raw.length - 16) throw new Error('Invalid ASAR header');
  const entry = JSON.parse(raw.subarray(16, 16 + size).toString('utf8')).files?.['package.json'];
  if (!entry || entry.unpacked || entry.link || entry.size > 65536) throw new Error('Invalid ASAR package metadata');
  const start = 8 + raw.readUInt32LE(4) + Number(entry.offset);
  if (!Number.isSafeInteger(start) || start < 16 || start + entry.size > raw.length) throw new Error('Invalid ASAR package offset');
  return JSON.parse(raw.subarray(start, start + entry.size).toString('utf8'));
}

/** Closed client inventory: patient payloads cannot hide under an unexpected name. */
export function auditAssistantFiles(diskFiles, asarFiles, deployment, resourceHashes = {}) {
  const errors = [];
  const allowed = new Set(['MindCare Assistant.exe', 'chrome_100_percent.pak', 'chrome_200_percent.pak', 'd3dcompiler_47.dll', 'ffmpeg.dll', 'icudtl.dat', 'libEGL.dll', 'libGLESv2.dll', 'LICENSE.electron.txt', 'LICENSES.chromium.html', 'resources.pak', 'snapshot_blob.bin', 'v8_context_snapshot.bin', 'vk_swiftshader_icd.json', 'vk_swiftshader.dll', 'vulkan-1.dll',
    'resources/app.asar', 'resources/cabinet/configurer-cabinet.ps1', 'resources/cabinet/deploiement-cabinet.md', 'resources/elevate.exe']);
  // Per-machine NSIS 3.0.4.1 adds this stock helper. No arbitrary bytes may
  // enter the client under its name; measured against the builder's cached copy.
  if (diskFiles.includes('resources/elevate.exe') && resourceHashes['resources/elevate.exe'] !== '9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37') errors.push('unverified Assistant elevation helper: resources/elevate.exe');
  for (const file of diskFiles) if (!allowed.has(file) && !/^locales\/[a-z]{2,3}(?:-[a-zA-Z0-9]{2,4})?\.pak$/.test(file)) errors.push(`unexpected Assistant file: ${file}`);
  for (const file of asarFiles) if (file !== 'package.json' && !/^dist-electron\/(?:main\/.+\.js|preload\/.+\.cjs)$/.test(file)) errors.push(`unexpected Assistant ASAR entry: ${file}`);
  for (const file of ['MindCare Assistant.exe', 'resources/app.asar', 'resources/cabinet/configurer-cabinet.ps1', 'resources/cabinet/deploiement-cabinet.md']) if (!diskFiles.includes(file)) errors.push(`missing Assistant file: ${file}`);
  for (const file of ['dist-electron/main/index.js', 'dist-electron/preload/index.cjs', 'package.json']) if (!asarFiles.includes(file)) errors.push(`missing Assistant ASAR entry: ${file}`);
  if (deployment !== 'clinic-client') errors.push('Assistant artifact must declare clinic-client deployment');
  return errors;
}

/** Loads real packaged packages using their own resolution roots, without connecting to a DB. */
export function auditServerDependencies(serverRoot, packages = ['pg', 'next', 'react', 'react-dom', 'zod', 'styled-jsx', '@swc/helpers', '@next/env', 'onnxruntime-node']) {
  const loader = createRequire(path.join(serverRoot, 'package.json'));
  const errors = [];
  for (const name of packages) {
    try {
      const root = realpathSync(serverRoot);
      const within = file => {
        const relative = path.relative(root, realpathSync(file));
        return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
      };
      const resolved = loader.resolve(name);
      if (!within(resolved)) throw Object.assign(new Error('outside packaged server'), {code:'OUTSIDE_PACKAGE'});
      loader(name);
      const seen = new Set();
      const visit = module => {
        if (!module || seen.has(module.id)) return;
        seen.add(module.id);
        if (module.filename && !within(module.filename)) throw Object.assign(new Error('dependency outside packaged server'), {code:'OUTSIDE_PACKAGE'});
        for (const child of module.children) visit(child);
      };
      visit(loader.cache[resolved]);
    }
    catch (error) {
      const missing = /Cannot find (?:module|package) ['"]([^'"]+)['"]/.exec(String(error.message))?.[1];
      errors.push(`${name}: ${error.code ?? 'LOAD_FAILED'}${error.code === 'OUTSIDE_PACKAGE' ? ' (dependency outside packaged server)' : missing ? ` (${missing})` : ''}`);
    }
  }
  return errors;
}

/** Loss of even one source patient is a release failure, regardless of synthetic flags. */
export function auditSnapshotPreservation(manifest) {
  if (!manifest || !Number.isInteger(manifest.patient_count) || manifest.patient_count < 0 || manifest.fixtures_exclues !== 0 || manifest.patient_count !== manifest.patients_total_source || manifest.patient_count !== manifest.counts?.['app.patients']) {
    return ['snapshot excludes source patients; production release requires every source record'];
  }
  return [];
}
