#!/usr/bin/env node
// Explicit first cutover only. Runtime app code never imports source JSON files.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MAPPING_MIGRATION_KEY, MAPPING_STORE_KEYS } from '../lib/mappingStoreKeys.js';
import { prepareMappingMigration, applyMappingSnapshot } from '../lib/mappingMigration.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
for (const line of (await fs.readFile(path.join(root, '.env.local'), 'utf8').catch(() => '')).split(/\r?\n/)) {
  const match = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (match && process.env[match[1]] == null) process.env[match[1]] = match[2];
}
for (const name of ['DB_SERVER', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[name]) throw new Error(`${name} DB 연결 설정이 필요합니다.`);
}
const { query, withTransaction, sql, getPool } = await import('../lib/db.js');
const args = process.argv.slice(2);
const option = flag => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const has = flag => args.includes(flag);
const migrationParam = { migrationKey: { type: sql.NVarChar, value: MAPPING_MIGRATION_KEY } };

function fail(message) { throw new Error(`[mapping-migration] ${message}`); }
async function tablePresence(q) {
  // This read must succeed even when neither web mapping table exists yet.
  const result = await q(`SELECT OBJECT_ID(N'dbo.WebMappingStore', N'U') AS StoreObject,
    OBJECT_ID(N'dbo.WebMappingMigration', N'U') AS MarkerObject`);
  return { store: result.recordset[0]?.StoreObject != null,
    marker: result.recordset[0]?.MarkerObject != null };
}
async function inspect(q) {
  const tables = await tablePresence(q);
  const marker = tables.marker ? await q(
    `SELECT MigrationKey FROM dbo.WebMappingMigration WHERE MigrationKey=@migrationKey`, migrationParam) : null;
  const docs = tables.store ? await q(
    `SELECT StoreKey, Payload, Revision FROM dbo.WebMappingStore`) : null;
  return { tables, marker: marker?.recordset?.length === 1, documents: docs?.recordset || [] };
}
async function checkUnmigrated() {
  const state = await inspect(query);
  if (state.marker || state.documents.length !== 0) {
    fail('완료 표식 또는 부분 매칭 문서가 있어 이전 빌드 재시작을 허용할 수 없습니다.');
  }
  return state;
}
async function checkReady() {
  const state = await inspect(query);
  if (!state.marker || !state.tables.store || state.documents.length !== 3) {
    fail('공유 매칭 DB 이전 완료 상태가 아닙니다.');
  }
  const keys = new Set(Object.values(MAPPING_STORE_KEYS));
  for (const row of state.documents) {
    if (!keys.delete(row.StoreKey) || !Number.isInteger(Number(row.Revision)) || Number(row.Revision) < 1) {
      fail('공유 매칭 문서 키 또는 버전이 올바르지 않습니다.');
    }
    try {
      const parsed = JSON.parse(row.Payload);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid object');
    } catch { fail(`${row.StoreKey} 공유 매칭 문서가 손상되었습니다.`); }
  }
  if (keys.size) fail('공유 매칭 문서가 누락되었습니다.');
  return state;
}

async function readRequiredFile(flag) {
  const filename = option(flag);
  if (!filename) fail(`${flag} 경로가 필요합니다.`);
  try { return { path: path.resolve(filename), bytes: await fs.readFile(path.resolve(filename)) }; }
  catch (error) { fail(`${flag} 파일 읽기 실패: ${error.message}`); }
}
async function readOptionalFile(flag) {
  const filename = option(flag);
  if (!filename) {
    const expected = path.join(root, 'data', 'order-import-customer-product-mappings.runtime.json');
    if (await fs.stat(expected).then(() => true).catch(error => {
      if (error.code === 'ENOENT') return false;
      throw error;
    })) fail(`${flag}가 생략됐지만 업체별 품목 매칭 파일이 존재합니다.`);
    return { path: null, bytes: null };
  }
  try { return { path: path.resolve(filename), bytes: await fs.readFile(path.resolve(filename)) }; }
  catch (error) { fail(`${flag} 파일 읽기 실패: ${error.message}`); }
}
async function backupSources(sources, snapshot) {
  const backupDir = option('--backup-dir');
  if (!backupDir) fail('--backup-dir 경로가 필요합니다.');
  const destination = path.resolve(backupDir);
  await fs.mkdir(destination);
  for (const [name, source] of Object.entries(sources)) {
    if (source.bytes) await fs.writeFile(path.join(destination, `${name}.json`), source.bytes, { flag: 'wx' });
  }
  const manifest = {
    capturedAt: new Date().toISOString(),
    sourcePaths: Object.fromEntries(Object.entries(sources).map(([key, source]) => [key, source.path])),
    sourceMissing: snapshot.documents.filter(doc => doc.sourceMissing).map(doc => doc.storeKey),
    byteHashes: snapshot.sourceHashes, semanticHashes: snapshot.semanticHashes, counts: snapshot.counts,
  };
  await fs.writeFile(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
  for (const [name, source] of Object.entries(sources)) {
    if (!source.bytes) continue;
    const copied = await fs.readFile(path.join(destination, `${name}.json`));
    if (!copied.equals(source.bytes)) fail(`${name} 원본 백업 바이트가 다릅니다.`);
  }
  return destination;
}

async function apply() {
  if (!has('--writers-stopped')) fail('--writers-stopped 명시가 필요합니다.');
  const writerCheck = spawnSync(process.execPath,
    [path.join(root, 'scripts', 'assert-mapping-writers-stopped.cjs')],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  if (writerCheck.status !== 0) fail(`기존 파일 작성자 중지 확인 실패: ${String(writerCheck.stderr || writerCheck.stdout).trim()}`);
  const existingState = await inspect(query);
  if (existingState.marker) {
    await checkReady();
    console.log('공유 매칭 DB 이전이 이미 완료되어 파일 재수입을 건너뜁니다.');
    return;
  }
  if (existingState.documents.length) fail('완료 표식 없이 부분 매칭 문서가 있어 적용을 중단합니다.');
  const sources = {
    customer: await readRequiredFile('--customer-file'),
    product: await readRequiredFile('--product-file'),
    customerProduct: await readOptionalFile('--customer-product-file'),
  };
  const snapshot = prepareMappingMigration({ customer: sources.customer.bytes,
    product: sources.product.bytes, customerProduct: sources.customerProduct.bytes });
  const backupDir = await backupSources(sources, snapshot);
  // Verify writers again after final file snapshot and before entering SQL commit.
  const secondCheck = spawnSync(process.execPath,
    [path.join(root, 'scripts', 'assert-mapping-writers-stopped.cjs')],
    { cwd: root, encoding: 'utf8', windowsHide: true });
  if (secondCheck.status !== 0) fail('백업 후 파일 작성자 중지 확인에 실패했습니다.');
  const ddl = await fs.readFile(path.join(root, 'docs', 'migrations', '2026-10-15_web_mapping_store.sql'), 'utf8');
  await withTransaction(tQuery => applyMappingSnapshot({ tQuery, sql, snapshot, ddl }), { retries: 0 });
  await checkReady();
  console.log(JSON.stringify({ ready: true, backupDir, counts: snapshot.counts,
    byteHashes: snapshot.sourceHashes, semanticHashes: snapshot.semanticHashes }));
}

let pool;
try {
  pool = await getPool();
  const modes = ['--check-ready', '--check-unmigrated', '--apply'].filter(has);
  if (modes.length !== 1) fail('--check-ready, --check-unmigrated, --apply 중 하나만 지정하세요.');
  if (modes[0] === '--check-ready') {
    await checkReady(); console.log('공유 매칭 DB 이전 준비 완료');
  } else if (modes[0] === '--check-unmigrated') {
    await checkUnmigrated(); console.log('DB 조회 성공, 이전 표식과 부분 문서 없음');
  } else await apply();
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (pool) await pool.close(); }
