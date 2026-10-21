#!/usr/bin/env node
import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { auditAssistantFiles, auditElectronModules, readAsarModules, readAsarPackage } from './lib/electron-runtime-audit.mjs';

const root = path.resolve(process.argv[2] ?? path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'assistant', 'win-unpacked'));
const files = [];
function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Linked client resources are not allowed');
    if (entry.isDirectory()) walk(file); else files.push(path.relative(root, file).split(path.sep).join('/'));
  }
}
try {
  walk(root);
  const archive = path.join(root, 'resources', 'app.asar');
  const raw = readFileSync(archive);
  const size = raw.readUInt32LE(12);
  if (size > raw.length - 16) throw new Error('Invalid ASAR header');
  const header = JSON.parse(raw.subarray(16, 16 + size).toString('utf8'));
  const asarFiles = [];
  function descend(node, prefix) {
    for (const [name, entry] of Object.entries(node.files ?? {})) {
      const file = prefix ? `${prefix}/${name}` : name;
      if (entry.link || entry.unpacked) throw new Error('Linked or unpacked client ASAR entries are not allowed');
      if (entry.files) descend(entry, file); else asarFiles.push(file);
    }
  }
  descend(header, '');
  const metadata = readAsarPackage(archive);
  const modules = readAsarModules(archive);
  const resourceHashes = {};
  if (files.includes('resources/elevate.exe')) resourceHashes['resources/elevate.exe'] = createHash('sha256').update(readFileSync(path.join(root, 'resources/elevate.exe'))).digest('hex');
  const errors = [...auditAssistantFiles(files, asarFiles, metadata.mindcareDeployment, resourceHashes), ...auditElectronModules(modules)];
  const credentialUrl = /postgres(?:ql)?:\/\/[^\s'"`$;]+:[^\s'"`$;@]+@/;
  for (const [name, text] of modules) if (credentialUrl.test(text)) errors.push(`credential URL in ${name}`);
  if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
  else console.log(JSON.stringify({ status: 'PASS', scope: 'Assistant package content and module closure; no clinical acceptance claim', root, version: metadata.version, diskFiles: files.length, asarFiles: asarFiles.length, deployment: metadata.mindcareDeployment, patientPayload: false, backendPayload: false, postgresPayload: false, privateKeys: false }));
} catch { console.error('Assistant artifact unreadable or incomplete.'); process.exitCode = 1; }
