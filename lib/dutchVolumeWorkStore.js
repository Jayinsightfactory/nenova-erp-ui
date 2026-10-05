import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const DUTCH_WORK_MAX_BYTES = 900 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
export function dutchWorkError(code, message, statusCode = 400) {
  return Object.assign(new Error(message), { code, statusCode });
}
function invalid(message) { throw dutchWorkError('INVALID_WORK_SNAPSHOT', message); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)); }
function json(value, depth = 0) {
  if (depth > 24) invalid('작업 데이터 중첩이 너무 깊습니다.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!Array.isArray(value) && !object(value)) invalid('작업 데이터는 일반 JSON이어야 합니다.');
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key)) invalid('허용되지 않는 데이터 키입니다.');
    json(child, depth + 1);
  }
}
function string(value, max, required = false) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) invalid('작업 텍스트 값이 올바르지 않습니다.');
  return value;
}
function numeric(value, key = false) {
  if (value === '' || value === null) return value;
  if (!['string', 'number'].includes(typeof value) || (typeof value === 'string' && !value.trim()) || !Number.isFinite(Number(value)) || Number(value) < 0 || (!key && Number(value) > 1e9) || (key && !Number.isSafeInteger(Number(value)))) invalid('작업 수량·단가·매칭키가 올바르지 않습니다.');
  return value;
}
function address(value) {
  const match = typeof value === 'string' && value.match(/^([A-Z]{1,3})([1-9]\d{0,4})$/);
  if (!match) invalid('셀 주소가 올바르지 않습니다.');
  let col = 0; for (const letter of match[1]) col = col * 26 + letter.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (col > 500 || row > 10000) invalid('물량표 사용 범위는 10000행·500열까지입니다.');
  return { r: row - 1, c: col - 1 };
}
function range(value) {
  const parts = typeof value === 'string' ? value.split(':') : [];
  if (!parts.length || parts.length > 2) invalid('시트 범위가 올바르지 않습니다.');
  const s = address(parts[0]), e = address(parts[1] ?? parts[0]);
  if (e.r < s.r || e.c < s.c || (e.r + 1) * (e.c + 1) > 500000) invalid('물량표 사용 면적이 너무 크거나 올바르지 않습니다.');
  return { s, e };
}
function workbook(value) {
  if (!object(value) || !Array.isArray(value.SheetNames) || !object(value.Sheets) || !value.SheetNames.length || value.SheetNames.length > 32) invalid('원본 workbook 형식이 올바르지 않습니다.');
  if (new Set(value.SheetNames).size !== value.SheetNames.length || Object.keys(value.Sheets).length !== value.SheetNames.length) invalid('원본 시트 목록이 일치하지 않습니다.');
  for (const name of value.SheetNames) {
    string(name, 100, true); if (forbidden.has(name) || !Object.hasOwn(value.Sheets, name) || !object(value.Sheets[name])) invalid('시트 이름이 올바르지 않습니다.');
    const sheet = value.Sheets[name];
    const bounds = sheet['!ref'] === undefined ? null : range(sheet['!ref']);
    for (const key of Object.keys(sheet)) {
      if (key.startsWith('!')) continue;
      const pos = address(key);
      if (!bounds || pos.r < bounds.s.r || pos.c < bounds.s.c || pos.r > bounds.e.r || pos.c > bounds.e.c || !object(sheet[key])) invalid('시트 셀과 사용 범위가 일치하지 않습니다.');
    }
    if (sheet['!merges'] !== undefined) {
      if (!Array.isArray(sheet['!merges']) || sheet['!merges'].length > 10000) invalid('병합 셀 범위가 올바르지 않습니다.');
      for (const merge of sheet['!merges']) {
        if (!object(merge) || !object(merge.s) || !object(merge.e) || !bounds) invalid('병합 셀 범위가 올바르지 않습니다.');
        for (const point of [merge.s, merge.e]) if (!Number.isInteger(point.r) || !Number.isInteger(point.c) || point.r < bounds.s.r || point.c < bounds.s.c || point.r > bounds.e.r || point.c > bounds.e.c) invalid('병합 셀이 시트 범위를 벗어납니다.');
        if (merge.s.r > merge.e.r || merge.s.c > merge.e.c) invalid('병합 셀 범위가 올바르지 않습니다.');
      }
    }
  }
  return value;
}
const textFields = ['id', 'sheetName', 'cellAddress', 'product', 'color', 'customer', 'unit', 'sourceFlower', 'sourceItem', 'sourceColor', 'sourceCustomer'];
const numericFields = ['quantity', 'prodKey', 'custKey', 'sourceRow', 'sourceColumn', 'layoutVersion'];
export function normalizeDutchWorkSnapshot(input) {
  json(input);
  if (!object(input)) invalid('작업 저장 본문이 올바르지 않습니다.');
  if (Buffer.byteLength(JSON.stringify(input), 'utf8') > DUTCH_WORK_MAX_BYTES) throw dutchWorkError('WORK_TOO_LARGE', '작업 저장은 900KiB까지 가능합니다. 불필요한 시트·서식을 정리하세요.', 413);
  if (!['UPLOAD', 'LIVE'].includes(input.sourceMode)) invalid('작업 원본 구분이 올바르지 않습니다.');
  const year = String(input.orderYear ?? '');
  if (!/^(?:20\d{2}|2100)$/.test(year)) invalid('연도는 2000~2100이어야 합니다.');
  const match = typeof input.orderWeek === 'string' && input.orderWeek.match(/^(\d{1,2})-(\d{1,2})$/);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 53 || Number(match[2]) < 1 || Number(match[2]) > 99) invalid('차수는 01-01~53-99 형식이어야 합니다.');
  if (!Array.isArray(input.entries) || !input.entries.length || input.entries.length > 5000 || !object(input.prices) || Object.keys(input.prices).length > 10000) invalid('작업 행은 1~5000개여야 합니다.');
  const ids = new Set();
  const entries = input.entries.map(entry => {
    if (!object(entry)) invalid('작업 행 형식이 올바르지 않습니다.');
    const next = {};
    for (const field of textFields) if (Object.hasOwn(entry, field)) next[field] = string(entry[field], field === 'id' ? 500 : 1000, field === 'id');
    if (!next.id || ids.has(next.id)) invalid('작업 행 식별자가 없거나 중복됩니다.'); ids.add(next.id);
    if (!Object.hasOwn(entry, 'quantity')) invalid('작업 행 수량이 필요합니다.');
    for (const field of numericFields) if (Object.hasOwn(entry, field)) next[field] = numeric(entry[field], field !== 'quantity');
    if (Object.hasOwn(entry, 'added')) { if (typeof entry.added !== 'boolean') invalid('추가행 표시가 올바르지 않습니다.'); next.added = entry.added; }
    if (next.cellAddress) address(next.cellAddress);
    return next;
  });
  const prices = {};
  for (const [key, value] of Object.entries(input.prices)) { string(key, 1000, true); prices[key] = numeric(value); }
  return JSON.parse(JSON.stringify({ name: string(input.name, 160, true).trim(), sourceMode: input.sourceMode, fileName: string(input.fileName, 260), orderYear: year, orderWeek: `${match[1].padStart(2, '0')}-${match[2].padStart(2, '0')}`, workbook: workbook(input.workbook, input.sourceMode), entries, prices, sourceIdentity: string(input.sourceIdentity, 1000, true) }));
}
export function resolveDutchWorkOwner(user) {
  if (typeof user?.userId !== 'string' || !user.userId.trim() || user.userId.length > 200) throw dutchWorkError('WORK_OWNER_REQUIRED', '작업 저장에는 유효한 로그인 계정이 필요합니다.', 401);
  return user.userId;
}
export function dutchWorkSummary(snapshot) {
  const { id, name, fileName, sourceMode, orderYear, orderWeek, savedAt, savedBy } = snapshot;
  return { id, name, fileName, sourceMode, orderYear, orderWeek, savedAt, savedBy, entryCount: snapshot.entries.length, sheetCount: snapshot.workbook?.SheetNames.length ?? 0 };
}
export function createDutchVolumeWorkStore({ rootDir = path.resolve(process.cwd(), 'data/runtime/dutch-volume-work') } = {}) {
  const ownerDir = ownerId => path.join(rootDir, createHash('sha256').update(resolveDutchWorkOwner({ userId: ownerId })).digest('hex'));
  const validId = id => { if (typeof id !== 'string' || !UUID.test(id)) throw dutchWorkError('INVALID_WORK_ID', '작업 저장 식별자가 올바르지 않습니다.'); return id; };
  async function getDutchWorkSnapshot({ ownerId, id }) {
    const file = path.join(ownerDir(ownerId), `${validId(id)}.json`);
    let raw;
    try { const stat = await fs.lstat(file); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > DUTCH_WORK_MAX_BYTES + 4096) throw Error('invalid file'); raw = await fs.readFile(file, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') throw dutchWorkError('WORK_NOT_FOUND', '저장된 작업을 찾을 수 없습니다.', 404); throw dutchWorkError('WORK_READ_FAILED', '저장된 작업 파일을 읽을 수 없습니다.', 500); }
    try {
      const stored = JSON.parse(raw), data = normalizeDutchWorkSnapshot(stored.data);
      if (stored.version !== 1 || stored.ownerId !== ownerId || stored.id !== id || typeof stored.savedBy !== 'string' || !stored.savedBy || typeof stored.savedAt !== 'string' || !Number.isFinite(Date.parse(stored.savedAt))) throw Error('metadata');
      return { ...data, id, savedAt: stored.savedAt, savedBy: stored.savedBy };
    } catch { throw dutchWorkError('CORRUPT_WORK_SNAPSHOT', '저장된 작업 데이터가 손상되었습니다.', 500); }
  }
  async function saveDutchWorkSnapshot(input) {
    const { ownerId, savedBy } = input;
    const dir = ownerDir(ownerId), data = normalizeDutchWorkSnapshot(Object.fromEntries(['name', 'sourceMode', 'fileName', 'orderYear', 'orderWeek', 'workbook', 'entries', 'prices', 'sourceIdentity'].map(key => [key, input[key]])));
    string(savedBy, 200, true);
    const id = randomUUID(), savedAt = new Date().toISOString();
    const temp = path.join(dir, `.${randomUUID()}.tmp`), final = path.join(dir, `${id}.json`);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    let handle;
    try {
      handle = await fs.open(temp, 'wx', 0o600);
      await handle.writeFile(JSON.stringify({ version: 1, id, ownerId, savedAt, savedBy, data }), 'utf8'); await handle.sync(); await handle.close(); handle = null;
      await fs.link(temp, final); // Atomic create only: never replace an older snapshot.
    } catch { throw dutchWorkError('WORK_SAVE_FAILED', '작업 저장에 실패했습니다. 다시 시도하세요.', 500); }
    finally { if (handle) await handle.close().catch(() => {}); await fs.unlink(temp).catch(() => {}); }
    return dutchWorkSummary({ ...data, id, savedAt, savedBy });
  }
  async function listDutchWorkSnapshots({ ownerId, cursor, limit = 20 }) {
    const dir = ownerDir(ownerId);
    const size = Number(limit); if (!Number.isInteger(size) || size < 1 || size > 100) invalid('이력 조회 개수는 1~100이어야 합니다.');
    let anchor = null;
    if (cursor !== undefined && cursor !== null && cursor !== '') {
      try { anchor = JSON.parse(Buffer.from(string(cursor, 300, true), 'base64url').toString()); validId(anchor.id); if (typeof anchor.savedAt !== 'string' || !Number.isFinite(Date.parse(anchor.savedAt))) throw Error(); }
      catch { throw dutchWorkError('INVALID_WORK_CURSOR', '작업 이력 페이지 값이 올바르지 않습니다.'); }
    }
    let files; try { files = await fs.readdir(dir); } catch (error) { if (error.code === 'ENOENT') return { items: [], nextCursor: null, corruptCount: 0 }; throw dutchWorkError('WORK_READ_FAILED', '작업 저장 이력을 읽을 수 없습니다.', 500); }
    const summaries = []; let corruptCount = 0;
    for (const file of files) {
      if (!file.endsWith('.json') || !UUID.test(file.slice(0, -5))) continue;
      try { summaries.push(dutchWorkSummary(await getDutchWorkSnapshot({ ownerId, id: file.slice(0, -5) }))); } catch (error) { if (error.code === 'CORRUPT_WORK_SNAPSHOT' || error.code === 'WORK_READ_FAILED') corruptCount += 1; else throw error; }
    }
    summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt) || b.id.localeCompare(a.id));
    const remaining = summaries.filter(item => !anchor || item.savedAt < anchor.savedAt || (item.savedAt === anchor.savedAt && item.id < anchor.id));
    const items = remaining.slice(0, size), last = items.at(-1);
    return { items, nextCursor: remaining.length > size ? Buffer.from(JSON.stringify({ savedAt: last.savedAt, id: last.id })).toString('base64url') : null, corruptCount };
  }
  return { saveDutchWorkSnapshot, listDutchWorkSnapshots, getDutchWorkSnapshot };
}
const store = createDutchVolumeWorkStore();
export const saveDutchWorkSnapshot = store.saveDutchWorkSnapshot;
export const listDutchWorkSnapshots = store.listDutchWorkSnapshots;
export const getDutchWorkSnapshot = store.getDutchWorkSnapshot;
