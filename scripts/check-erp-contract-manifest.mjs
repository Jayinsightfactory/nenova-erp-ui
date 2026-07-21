import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.cwd();
const contractDir = path.join(root, 'docs', 'contracts');
const allowedOrderEffects = new Set(['create-positive', 'preserve']);
const allowedShipmentEffects = new Set(['increase', 'decrease', 'preserve']);
const ERP_FEATURE_FILE_RE = /^(?:pages\/api\/|pages\/(?:shipment|orders|stock|warehouse|estimate|sales|raum)\/|components\/raum\/|lib\/(?:pivot|order|shipment|exe|db|raum))/;

function fail(message) {
  throw new Error(`ERP contract manifest: ${message}`);
}

function requireString(value, label) {
  if (typeof value !== 'string' || !value.trim()) fail(`${label}은 문자열이어야 합니다.`);
}

function requireFile(relativePath, label) {
  requireString(relativePath, label);
  if (!fs.existsSync(path.join(root, relativePath))) fail(`${label} 파일 없음: ${relativePath}`);
}

export function validateManifest(manifest, fileName) {
  if (!manifest || typeof manifest !== 'object') fail(`${fileName}: JSON 객체가 아닙니다.`);
  requireString(manifest.id, `${fileName}.id`);
  requireString(manifest.title, `${fileName}.title`);
  if (!Array.isArray(manifest.scope) || manifest.scope.length === 0) fail(`${fileName}.scope가 비어 있습니다.`);
  manifest.scope.forEach((file) => requireFile(file, `${fileName}.scope[]`));

  const identity = manifest.businessIdentity;
  if (!Array.isArray(identity) || identity.join('|') !== 'OrderYear|OrderWeek|CustKey|ProdKey') {
    fail(`${fileName}.businessIdentity는 OrderYear|OrderWeek|CustKey|ProdKey 순서여야 합니다.`);
  }

  if (!Array.isArray(manifest.actions) || manifest.actions.length === 0) fail(`${fileName}.actions가 비어 있습니다.`);
  const names = new Set();
  for (const action of manifest.actions) {
    requireString(action?.name, `${fileName}.actions[].name`);
    if (names.has(action.name)) fail(`${fileName}: 중복 action ${action.name}`);
    names.add(action.name);
    if (!allowedOrderEffects.has(action.orderDetail)) fail(`${fileName}:${action.name}의 orderDetail 효과가 올바르지 않습니다.`);
    if (!allowedShipmentEffects.has(action.shipmentDetail)) fail(`${fileName}:${action.name}의 shipmentDetail 효과가 올바르지 않습니다.`);
  }

  if (manifest.crossYearFixture?.required !== true) fail(`${fileName}: crossYearFixture.required=true가 필요합니다.`);
  if (!Array.isArray(manifest.requiredTestFiles) || manifest.requiredTestFiles.length === 0) fail(`${fileName}.requiredTestFiles가 비어 있습니다.`);
  manifest.requiredTestFiles.forEach((file) => requireFile(file, `${fileName}.requiredTestFiles[]`));

  const evidence = manifest.dnspyEvidence;
  if (evidence?.required !== true) fail(`${fileName}: dnspyEvidence.required=true가 필요합니다.`);
  requireFile(evidence.record, `${fileName}.dnspyEvidence.record`);
  requireString(evidence.source, `${fileName}.dnspyEvidence.source`);
  if (!Array.isArray(evidence.methods) || evidence.methods.length === 0) {
    fail(`${fileName}.dnspyEvidence.methods가 비어 있습니다.`);
  }
  if (!Array.isArray(evidence.tables) || evidence.tables.length === 0) {
    fail(`${fileName}.dnspyEvidence.tables가 비어 있습니다.`);
  }

  const commands = manifest.requiredCommands;
  if (!Array.isArray(commands) || !commands.includes('npm run test:erp-contract')) {
    fail(`${fileName}.requiredCommands에 npm run test:erp-contract가 필요합니다.`);
  }
  if (!commands.includes('npm run test:nenova-dnspy-evidence')) {
    fail(`${fileName}.requiredCommands에 npm run test:nenova-dnspy-evidence가 필요합니다.`);
  }
  if (!commands.includes('npm run guard:erp-writes -- --changed-from HEAD^')) {
    fail(`${fileName}.requiredCommands에 변경 SQL 스코프 검사가 필요합니다.`);
  }
  return true;
}

export function loadManifests() {
  if (!fs.existsSync(contractDir)) fail('docs/contracts 디렉터리가 없습니다.');
  return fs.readdirSync(contractDir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const file = path.join(contractDir, name);
      let manifest;
      try {
        manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch (error) {
        fail(`${name}: JSON 파싱 실패 (${error.message})`);
      }
      validateManifest(manifest, name);
      return { name, manifest };
    });
}

function parseArgs(argv) {
  const at = argv.indexOf('--changed-from');
  return { changedFrom: at >= 0 ? argv[at + 1] : '' };
}

function changedRelevantFiles(changedFrom) {
  if (!changedFrom) return [];
  const names = execFileSync('git', ['diff', '--name-only', changedFrom], {
    cwd: root,
    encoding: 'utf8',
  });
  return names.split(/\r?\n/)
    .map((name) => name.trim().replace(/\\/g, '/'))
    .filter((name) => ERP_FEATURE_FILE_RE.test(name) && fs.existsSync(path.join(root, name)));
}

function assertChangedFilesCovered(manifests, changedFrom) {
  const changed = changedRelevantFiles(changedFrom);
  if (!changed.length) return;
  const scopes = manifests.flatMap(({ manifest }) => manifest.scope || []);
  const uncovered = changed.filter((file) => !scopes.includes(file));
  if (uncovered.length) {
    fail(`변경된 ERP 파일이 기능 계약 scope에 등록되지 않았습니다 (${changedFrom} 기준): ${uncovered.join(', ')}`);
  }
}

function main() {
  const manifests = loadManifests();
  if (manifests.length === 0) fail('계약 JSON이 하나도 없습니다.');
  const { changedFrom } = parseArgs(process.argv.slice(2));
  assertChangedFilesCovered(manifests, changedFrom);
  console.log(`ERP contract manifest guard passed (${manifests.length} manifest(s) checked)`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
