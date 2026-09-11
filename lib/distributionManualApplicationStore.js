const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'distribution-board', 'baselines', 'manual-application-events');
const MAX_SOURCE_IDENTITY_LENGTH = 512;
const MAX_MEMO_LENGTH = 1000;
const STATUSES = new Set(['MANUALLY_APPLIED', 'MANUALLY_NOT_APPLIED', 'CLEAR']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ManualApplicationStoreError extends Error { constructor(code, message, statusCode = 400) { super(message); this.name = 'ManualApplicationStoreError'; this.code = code; this.statusCode = statusCode; } }
const text = value => typeof value === 'string' ? value : '';
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function validateScope(input = {}) {
  const year = text(input.year); const week = text(input.week);
  if (!/^20\d{2}$/.test(year)) throw new ManualApplicationStoreError('INVALID_YEAR', '연도는 20xx 형식으로 입력해 주세요.');
  if (!/^(0[1-9]|[1-4]\d|5[0-3])-(0[1-9]|[1-9]\d)$/.test(week)) throw new ManualApplicationStoreError('INVALID_WEEK', '전체 차수는 WW-SS 형식으로 입력해 주세요.');
  return { year, week };
}
function validateSourceIdentity(value) { if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_IDENTITY_LENGTH || /[\u0000-\u001f\u007f]/.test(value) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)) throw new ManualApplicationStoreError('INVALID_SOURCE_IDENTITY', '원문 식별자가 올바르지 않습니다.'); return value; }
function validateStatus(value) { if (!STATUSES.has(value)) throw new ManualApplicationStoreError('INVALID_STATUS', '수동 적용 상태를 다시 선택해 주세요.'); return value; }
function validateMemo(value) { if (typeof value !== 'string' || value.length > MAX_MEMO_LENGTH) throw new ManualApplicationStoreError('INVALID_MEMO', '메모는 1,000자 이하로 입력해 주세요.'); return value; }
function validateExpectedCurrentEventId(value) { if (value === null) return null; if (typeof value !== 'string' || !/^[a-f0-9]{64}$/i.test(value)) throw new ManualApplicationStoreError('INVALID_EXPECTED_EVENT', '직전 수동 적용 기록 ID가 올바르지 않습니다.'); return value; }
function requiredExpectedCurrentEventId(input) { if (!input || !Object.prototype.hasOwnProperty.call(input, 'expectedCurrentEventId')) throw new ManualApplicationStoreError('MISSING_EXPECTED_EVENT', '직전 수동 적용 기록 ID를 null 또는 현재 ID로 지정해 주세요.'); return validateExpectedCurrentEventId(input.expectedCurrentEventId); }
function authorFor(user) { const userId = text(user?.userId ?? user?.UserID); if (!userId) throw new ManualApplicationStoreError('MISSING_USER', '로그인한 사용자가 필요합니다.', 401); return { userId, userName: text(user?.userName ?? user?.UserName) || null }; }
function publicEvent(record) { return { eventId: record.eventId, year: record.year, week: record.week, sourceIdentity: record.sourceIdentity, status: record.status, memo: record.memo, expectedCurrentEventId: record.expectedCurrentEventId, createdAt: record.createdAt, author: record.author, advisoryOnly: true, erpAction: 'NONE' }; }
function sameEvent(record, incoming) { return record.eventId === incoming.eventId && record.year === incoming.year && record.week === incoming.week && record.requestId === incoming.requestId && record.sourceIdentity === incoming.sourceIdentity && record.status === incoming.status && record.memo === incoming.memo && record.expectedCurrentEventId === incoming.expectedCurrentEventId && record.author?.userId === incoming.author.userId; }

function createDistributionManualApplicationStore({ directory = DEFAULT_DIRECTORY, now = () => new Date() } = {}) {
  const storageDirectory = path.resolve(directory);
  function scopeDirectory(scope) {
    const resolved = path.resolve(storageDirectory, scope.year, scope.week);
    if (!resolved.startsWith(`${storageDirectory}${path.sep}`)) throw new ManualApplicationStoreError('INVALID_SCOPE', '수동 적용 저장 범위가 올바르지 않습니다.');
    return resolved;
  }
  function paths(scope) { const root = scopeDirectory(scope); return { root, receipts: path.join(root, 'receipts'), transitions: path.join(root, 'transitions') }; }
  async function readEvent(filePath, kind = '') {
    let record;
    try { const stat = await fs.promises.lstat(filePath); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not regular'); record = JSON.parse(await fs.promises.readFile(filePath, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') throw new ManualApplicationStoreError('APPLICATION_NOT_FOUND', '수동 적용 기록을 찾을 수 없습니다.', 404); throw new ManualApplicationStoreError('APPLICATION_STORAGE_CORRUPT', '수동 적용 기록을 읽을 수 없습니다.', 500); }
    try {
      if (!record || typeof record !== 'object' || record.schemaVersion !== 1 || !/^[a-f0-9]{64}$/i.test(record.eventId || '')) throw new Error('schema');
      validateScope(record); validateSourceIdentity(record.sourceIdentity); validateStatus(record.status); validateMemo(record.memo); validateExpectedCurrentEventId(record.expectedCurrentEventId);
      if (!UUID_RE.test(record.requestId || '') || !record.author || typeof record.author.userId !== 'string' || !record.author.userId || typeof record.createdAt !== 'string' || Number.isNaN(Date.parse(record.createdAt)) || record.advisoryOnly !== true || record.erpAction !== 'NONE') throw new Error('data');
      if (record.eventId !== sha256(`${record.year}\n${record.week}\n${record.author.userId}\n${record.requestId}`)) throw new Error('eventId');
      const filename = path.basename(filePath, '.json');
      if (kind === 'receipt' && filename !== record.eventId) throw new Error('receipt filename');
      if (kind === 'transition' && filename !== sha256(`${record.sourceIdentity}\n${record.expectedCurrentEventId || '<root>'}`)) throw new Error('transition filename');
      return record;
    } catch { throw new ManualApplicationStoreError('APPLICATION_STORAGE_CORRUPT', '저장된 수동 적용 기록 형식이 올바르지 않습니다.', 500); }
  }
  async function transitionRecords(scope) {
    const { transitions } = paths(scope); let names;
    try { names = await fs.promises.readdir(transitions); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    const records = await Promise.all(names.filter(name => /^[a-f0-9]{64}\.json$/i.test(name)).map(name => readEvent(path.join(transitions, name), 'transition')));
    if (records.some(record => record.year !== scope.year || record.week !== scope.week)) throw new ManualApplicationStoreError('APPLICATION_STORAGE_CORRUPT', '수동 적용 기록의 저장 범위가 올바르지 않습니다.', 500);
    return records;
  }
  function latestFor(records, sourceIdentity) { return records.filter(record => record.sourceIdentity === sourceIdentity).sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.eventId.localeCompare(left.eventId))[0] || null; }
  function timestampAfter(records) {
    const candidate = now().getTime(); if (!Number.isFinite(candidate)) throw new ManualApplicationStoreError('INVALID_SERVER_TIME', '서버 시간을 만들 수 없습니다.', 500);
    const persisted = records.reduce((maximum, record) => Math.max(maximum, Date.parse(record.createdAt) || 0), 0);
    return new Date(Math.max(candidate, persisted + 1)).toISOString();
  }
  async function writeReceipt(receiptPath, record) {
    const temporary = `${receiptPath}.${crypto.randomUUID()}.tmp`;
    try { const handle = await fs.promises.open(temporary, 'wx', 0o600); try { await handle.writeFile(JSON.stringify(record), 'utf8'); await handle.sync(); } finally { await handle.close(); } await fs.promises.link(temporary, receiptPath); return record; }
    catch (error) { if (error.code !== 'EEXIST') throw error; const existing = await readEvent(receiptPath, 'receipt'); if (sameEvent(existing, record)) return existing; throw new ManualApplicationStoreError('REQUEST_ID_CONFLICT', '같은 요청 식별자로 다른 수동 적용 기록을 저장할 수 없습니다.', 409); }
    finally { await fs.promises.unlink(temporary).catch(() => {}); }
  }
  async function listApplications({ year, week } = {}) {
    const scope = validateScope({ year, week }); const latest = new Map();
    for (const record of await transitionRecords(scope)) { const existing = latest.get(record.sourceIdentity); if (!existing || record.createdAt > existing.createdAt || (record.createdAt === existing.createdAt && record.eventId > existing.eventId)) latest.set(record.sourceIdentity, record); }
    return [...latest.values()].sort((left, right) => left.sourceIdentity.localeCompare(right.sourceIdentity)).map(publicEvent);
  }
  async function recordApplication(input, user) {
    const scope = validateScope(input || {}); const sourceIdentity = validateSourceIdentity(input?.sourceIdentity); const status = validateStatus(input?.status); const memo = validateMemo(input?.memo); const expectedCurrentEventId = requiredExpectedCurrentEventId(input); const requestId = text(input?.requestId);
    if (!UUID_RE.test(requestId)) throw new ManualApplicationStoreError('INVALID_REQUEST_ID', '요청 식별자 형식이 올바르지 않습니다.');
    const author = authorFor(user); const eventId = sha256(`${scope.year}\n${scope.week}\n${author.userId}\n${requestId}`); const locations = paths(scope);
    await fs.promises.mkdir(locations.receipts, { recursive: true, mode: 0o700 }); await fs.promises.mkdir(locations.transitions, { recursive: true, mode: 0o700 });
    const records = await transitionRecords(scope); const current = latestFor(records, sourceIdentity);
    const candidate = { schemaVersion: 1, eventId, ...scope, sourceIdentity, status, memo, expectedCurrentEventId, requestId, createdAt: timestampAfter(records), author, advisoryOnly: true, erpAction: 'NONE' };
    const receipt = await writeReceipt(path.join(locations.receipts, `${eventId}.json`), candidate);
    const transitionId = sha256(`${sourceIdentity}\n${expectedCurrentEventId || '<root>'}`); const transitionPath = path.join(locations.transitions, `${transitionId}.json`);
    if ((current?.eventId || null) !== expectedCurrentEventId) {
      const existingTransition = await readEvent(transitionPath, 'transition').catch(error => error.code === 'APPLICATION_NOT_FOUND' ? null : Promise.reject(error));
      if (existingTransition && sameEvent(existingTransition, receipt)) return publicEvent(existingTransition);
      throw new ManualApplicationStoreError('CURRENT_EVENT_CONFLICT', '다른 사용자의 수동 적용 표시가 먼저 저장되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.', 409);
    }
    try { await fs.promises.link(path.join(locations.receipts, `${eventId}.json`), transitionPath); return publicEvent(receipt); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readEvent(transitionPath, 'transition'); if (sameEvent(existing, receipt)) return publicEvent(existing);
      throw new ManualApplicationStoreError('CURRENT_EVENT_CONFLICT', '다른 사용자의 수동 적용 표시가 먼저 저장되었습니다. 최신 상태를 확인한 뒤 다시 시도해 주세요.', 409);
    }
  }
  return { directory: storageDirectory, listApplications, recordApplication };
}
const defaultStore = createDistributionManualApplicationStore();
module.exports = { MAX_SOURCE_IDENTITY_LENGTH, MAX_MEMO_LENGTH, STATUSES, ManualApplicationStoreError, createDistributionManualApplicationStore, listApplications: defaultStore.listApplications, recordApplication: defaultStore.recordApplication };
