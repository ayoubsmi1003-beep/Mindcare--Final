import { describe, expect, it } from 'vitest';
import { auditElectronModules, auditServerDependencies, auditSnapshotPreservation, auditAssistantFiles } from '../../scripts/lib/electron-runtime-audit.mjs';
import path from 'node:path';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const entrypoints = (source: string) => new Map([
  ['dist-electron/main/index.js', source],
  ['dist-electron/preload/index.cjs', 'const {contextBridge} = require("electron");'],
]);

describe('Electron production runtime dependency gates', () => {
  it('refuses the missing pg main-process dependency before installation', () => {
    expect(auditElectronModules(entrypoints('import pg from "pg";')).join('\n')).toMatch(/pg/);
  });
  it('accepts builtin imports and finds emitted relative modules', () => {
    const files = entrypoints('import fs from "node:fs"; import "./config.js";');
    expect(auditElectronModules(files).join('\n')).toMatch(/config\.js/);
    files.set('dist-electron/main/config.js', 'export const port = 3000;');
    expect(auditElectronModules(files)).toEqual([]);
  });
  it('checks dynamic imports and requires without reading comments as imports', () => {
    expect(auditElectronModules(entrypoints('// import pg from "pg"\n const fs = require("node:fs");'))).toEqual([]);
    expect(auditElectronModules(entrypoints('await import("pg");')).join('\n')).toMatch(/pg/);
    expect(auditElectronModules(entrypoints('require("pg");')).join('\n')).toMatch(/pg/);
    expect(auditElectronModules(entrypoints('await import(variable);')).join('\n')).toMatch(/non-literal/);
  });
  it('loads a real package and detects its missing transitive dependency', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'mindcare-runtime-gate-'));
    try {
      mkdirSync(path.join(root, 'node_modules', 'runtime-example'), {recursive: true});
      writeFileSync(path.join(root, 'package.json'), '{}');
      writeFileSync(path.join(root, 'node_modules', 'runtime-example', 'index.js'), 'module.exports=require("missing-transitive-dependency");');
      expect(auditServerDependencies(root, ['runtime-example']).join('\n')).toMatch(/missing-transitive-dependency/);
      writeFileSync(path.join(root, 'node_modules', 'runtime-example', 'index.js'), 'module.exports={};');
      expect(auditServerDependencies(root, ['runtime-example'])).toEqual([]);
      // A developer checkout must not satisfy a missing packaged dependency.
      const incomplete = path.join(root, 'incomplete-server');
      mkdirSync(incomplete);
      writeFileSync(path.join(incomplete, 'package.json'), '{}');
      expect(auditServerDependencies(incomplete, ['runtime-example']).join('\n')).toMatch(/outside/);
    } finally {
      if (path.dirname(path.resolve(root)) !== path.resolve(tmpdir())) throw new Error('Unsafe test cleanup path');
      rmSync(root, {recursive: true, force: true});
    }
  });
  it('rejects a snapshot reducing 1559 source patients to 1558', () => {
    expect(auditSnapshotPreservation({patient_count:1558,patients_total_source:1559,fixtures_exclues:1,counts:{'app.patients':1559}})).toHaveLength(1);
    expect(auditSnapshotPreservation({patient_count:1559,patients_total_source:1559,fixtures_exclues:0,counts:{'app.patients':1559}})).toEqual([]);
  });
  it('refuses any clinical, server or secret resource in the Assistant artifact', () => {
    const disk = ['MindCare Assistant.exe', 'resources/app.asar', 'resources/cabinet/configurer-cabinet.ps1', 'resources/cabinet/deploiement-cabinet.md'];
    const asar = ['package.json', 'dist-electron/main/index.js', 'dist-electron/preload/index.cjs'];
    expect(auditAssistantFiles(disk, asar, 'clinic-client')).toEqual([]);
    for (const file of ['resources/snapshot/base.dump', 'resources/serveur/server.js', 'resources/pgsql/bin/psql.exe', 'resources/voix/assets/model.bin', 'resources/cabinet/clinic.pfx', 'resources/cabinet/runtime.env', 'patients.dump', 'postgres.exe']) {
      expect(auditAssistantFiles([...disk, file], asar, 'clinic-client').join('\n')).toContain(file);
    }
    expect(auditAssistantFiles(disk, [...asar, 'private/clinical.json'], 'clinic-client').join('\n')).toContain('clinical.json');
    expect(auditAssistantFiles(disk, asar, 'clinic-host').join('\n')).toMatch(/clinic-client/);
    expect(auditAssistantFiles(disk, ['package.json'], 'clinic-client').join('\n')).toMatch(/index/);
  });
  it('accepts only the byte-pinned NSIS elevation helper in the client inventory', () => {
    const disk = ['MindCare Assistant.exe', 'resources/app.asar', 'resources/cabinet/configurer-cabinet.ps1', 'resources/cabinet/deploiement-cabinet.md', 'resources/elevate.exe'];
    const asar = ['package.json', 'dist-electron/main/index.js', 'dist-electron/preload/index.cjs'];
    const trusted = { 'resources/elevate.exe': '9b1fbf0c11c520ae714af8aa9af12cfd48503eedecd7398d8992ee94d1b4dc37' };
    expect(auditAssistantFiles(disk, asar, 'clinic-client', trusted)).toEqual([]);
    expect(auditAssistantFiles(disk, asar, 'clinic-client', {}).join('\n')).toMatch(/elevate/);
    expect(auditAssistantFiles(disk, asar, 'clinic-client', { 'resources/elevate.exe': '0'.repeat(64) }).join('\n')).toMatch(/elevate/);
  });
});
