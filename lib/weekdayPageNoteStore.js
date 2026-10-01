// Private page annotations only. This module never reads or writes ERP data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'runtime', 'weekday-notes');
const MAX_FILE_BYTES = 16 * 1024;
const CONFIRMATION = 'MANUAL_USER_DECLARATION';
const SCOPE_FIELDS = ['year', 'majorWeek', 'custKey'];
const IDENTITY_FIELDS = [...SCOPE_FIELDS, 'prodKey'];
const INPUT_FIELDS = [...IDENTITY_FIELDS, 'note', 'earlyShipment', 'expectedRevision'];

class WeekdayPageNoteError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'WeekdayPageNoteError';
    this.code = code;
    this.statusCode = statusCode;
    Object.assign(this, details);
  }
}

function exactFields(value, fields) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length
    || fields.some(key => !Object.prototype.hasOwnProperty.call(value, key))
    || Object.keys(value).some(key => !fields.includes(key))) {
    throw new WeekdayPageNoteError('INVALID_FIELDS', '필수 항목만 정확히 전달하세요.');
  }
}

function integer(value, min, max, field, allowString = false) {
  if (!(typeof value === 'number' || (allowString && typeof value === 'string' && /^\d+$/.test(value)))
    || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new WeekdayPageNoteError('INVALID_INPUT', `${field} 값이 올바르지 않습니다.`);
  }
  return Number(value);
}

function normalizeNoteScope(input, { product = false, query = false } = {}) {
  exactFields(input, product ? IDENTITY_FIELDS : SCOPE_FIELDS);
  if (typeof input.year === 'string' && !/^\d{4}$/.test(input.year)) {
    throw new WeekdayPageNoteError('INVALID_INPUT', '연도는 4자리여야 합니다.');
  }
  const year = integer(input.year, 2000, 2200, 'year', query);
  if (typeof input.majorWeek !== 'string' || !/^\d{2}$/.test(input.majorWeek)
    || Number(input.majorWeek) < 1 || Number(input.majorWeek) > 53) {
    throw new WeekdayPageNoteError('INVALID_INPUT', '대차수는 01~53 형식이어야 합니다.');
  }
  const scope = { year, majorWeek: input.majorWeek,
    custKey: integer(input.custKey, 1, 2147483647, 'custKey', query) };
  if (product) scope.prodKey = integer(input.prodKey, 1, 2147483647, 'prodKey', query);
  return scope;
}

function normalizeEarlyShipment(value) {
  if (value === null) return null;
  exactFields(value, ['date', 'sourceYear', 'sourceOrderWeek', 'quantity', 'unit', 'confirmation']);
  const date = value.date;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
    || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))
    || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) !== date) {
    throw new WeekdayPageNoteError('INVALID_INPUT', '실제 YYYY-MM-DD 출고일을 입력하세요.');
  }
  const sourceYear = integer(value.sourceYear, 2000, 2200, 'sourceYear');
  if (typeof value.sourceOrderWeek !== 'string' || !/^\d{2}-\d{2}$/.test(value.sourceOrderWeek)
    || Number(value.sourceOrderWeek.slice(0, 2)) < 1 || Number(value.sourceOrderWeek.slice(0, 2)) > 53
    || Number(value.sourceOrderWeek.slice(3)) < 1
    || typeof value.quantity !== 'number' || !Number.isFinite(value.quantity) || value.quantity <= 0
    || !['박스', '단', '송이'].includes(value.unit) || value.confirmation !== CONFIRMATION) {
    throw new WeekdayPageNoteError('INVALID_INPUT', '원천 연도·세부차수·양수 수량·단위·수동 확인을 명시하세요.');
  }
  return { date, sourceYear, sourceOrderWeek: value.sourceOrderWeek,
    quantity: value.quantity, unit: value.unit, confirmation: CONFIRMATION };
}

function normalizeNoteInput(input) {
  exactFields(input, INPUT_FIELDS);
  const scope = normalizeNoteScope(Object.fromEntries(IDENTITY_FIELDS.map(key => [key, input[key]])), { product: true });
  if (typeof input.note !== 'string' || input.note.length > 1000 || input.note.includes('\0')) {
    throw new WeekdayPageNoteError('INVALID_INPUT', '비고는 1000자 이하 문자열이어야 합니다.');
  }
  return { ...scope, note: input.note, earlyShipment: normalizeEarlyShipment(input.earlyShipment),
    expectedRevision: integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, 'expectedRevision') };
}

function validateUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim() || userId.trim() !== userId
    || userId.length > 200 || /[\x00-\x1f\x7f]/.test(userId)) {
    throw new WeekdayPageNoteError('UNAUTHENTICATED', '로그인 사용자 ID가 필요합니다.', 401);
  }
  return userId;
}

function validateNoteRecord(record) {
  exactFields(record, ['version', ...IDENTITY_FIELDS, 'note', 'earlyShipment', 'revision', 'updatedAt', 'updatedBy']);
  const revision = integer(record.revision, 1, Number.MAX_SAFE_INTEGER, 'revision');
  const normalized = normalizeNoteInput({ ...Object.fromEntries(INPUT_FIELDS.filter(key => key !== 'expectedRevision')
    .map(key => [key, record[key]])), expectedRevision: revision - 1 });
  if (record.version !== 1 || typeof record.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(record.updatedAt))
    || new Date(record.updatedAt).toISOString() !== record.updatedAt) {
    throw new WeekdayPageNoteError('INVALID_RECORD', '비고 저장 메타데이터가 올바르지 않습니다.');
  }
  const { expectedRevision, ...content } = normalized;
  return { version: 1, ...content, revision, updatedAt: record.updatedAt, updatedBy: validateUserId(record.updatedBy) };
}

function noteDigest(record) {
  return crypto.createHash('sha256').update(JSON.stringify(validateNoteRecord(record))).digest('hex');
}

function createWeekdayPageNoteStore({ directory = DEFAULT_DIRECTORY, io = fs.promises,
  now = () => new Date(), lockTimeoutMs = 2000, lockRetryMs = 20 } = {}) {
  const storageDirectory = path.resolve(directory);
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0 || !Number.isFinite(lockRetryMs) || lockRetryMs <= 0) {
    throw new Error('Invalid lock timing');
  }
  const filename = scope => `${scope.year}_${scope.majorWeek}_${scope.custKey}_${scope.prodKey}.json`;
  const targetFor = scope => path.join(storageDirectory, filename(scope));
  const corrupt = () => new WeekdayPageNoteError('NOTE_STORAGE_CORRUPT', '비고 저장 파일을 검증할 수 없습니다.', 500);
  const failed = () => new WeekdayPageNoteError('NOTE_STORAGE_FAILED', '비고 저장에 실패했습니다. 저장 상태를 다시 조회하세요.', 500);

  async function checkDirectory() {
    try {
      const stat = await io.lstat(storageDirectory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw corrupt();
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      if (error instanceof WeekdayPageNoteError) throw error;
      throw failed();
    }
  }

  async function get(input) {
    const scope = normalizeNoteScope(input, { product: true });
    if (!(await checkDirectory())) return null;
    try {
      const target = targetFor(scope);
      const stat = await io.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw corrupt();
      const text = await io.readFile(target, 'utf8');
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw corrupt();
      const envelope = JSON.parse(text);
      exactFields(envelope, ['record', 'digest']);
      const record = validateNoteRecord(envelope.record);
      if (envelope.digest !== noteDigest(record) || filename(record) !== filename(scope)) throw corrupt();
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw corrupt();
    }
  }

  async function list(input) {
    const scope = normalizeNoteScope(input);
    if (!(await checkDirectory())) return [];
    const prefix = `${scope.year}_${scope.majorWeek}_${scope.custKey}_`;
    let names;
    try { names = await io.readdir(storageDirectory); } catch { throw failed(); }
    const records = [];
    for (const name of names.filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort()) {
      const key = name.slice(prefix.length, -5);
      if (!/^[1-9]\d*$/.test(key) || Number(key) > 2147483647) throw corrupt();
      const record = await get({ ...scope, prodKey: Number(key) });
      if (!record) throw corrupt();
      records.push(record);
    }
    return records.sort((a, b) => a.prodKey - b.prodKey);
  }

  async function save(input, userId) {
    const normalized = normalizeNoteInput(input);
    validateUserId(userId);
    const scope = Object.fromEntries(IDENTITY_FIELDS.map(key => [key, normalized[key]]));
    const target = targetFor(scope);
    const lockPath = `${target}.lock`;
    let lock;
    let temporary;
    try {
      await io.mkdir(storageDirectory, { recursive: true, mode: 0o700 });
      await checkDirectory();
      const deadline = Date.now() + lockTimeoutMs;
      while (!lock) {
        try { lock = await io.open(lockPath, 'wx', 0o600); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          if (Date.now() >= deadline) throw new WeekdayPageNoteError('NOTE_LOCKED',
            '다른 비고 저장이 진행 중이거나 잠금 복구가 필요합니다. 다시 조회하세요.', 409);
          await new Promise(resolve => setTimeout(resolve, lockRetryMs));
        }
      }
      // Never steal an old lock: a paused writer may still own it in another process.
      const current = await get(scope);
      const currentRevision = current?.revision ?? 0;
      if (normalized.expectedRevision !== currentRevision) {
        throw new WeekdayPageNoteError('REVISION_CONFLICT', '다른 사용자가 비고를 변경했습니다. 최신 기록을 조회하세요.',
          409, { currentRevision });
      }
      const { expectedRevision, ...content } = normalized;
      const record = validateNoteRecord({ version: 1, ...content, revision: currentRevision + 1,
        updatedAt: now().toISOString(), updatedBy: userId });
      const serialized = JSON.stringify({ record, digest: noteDigest(record) });
      if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw failed();
      const temporaryPath = path.join(storageDirectory, `.${crypto.randomUUID()}.tmp`);
      const handle = await io.open(temporaryPath, 'wx', 0o600);
      temporary = temporaryPath;
      try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await io.rename(temporary, target);
      temporary = null;
      // File bytes are flushed before atomic publication. Flush directory on supported hosts.
      let directoryHandle;
      try { directoryHandle = await io.open(storageDirectory, 'r'); await directoryHandle.sync(); }
      catch (error) { if (!['EINVAL', 'EPERM', 'ENOTSUP', 'EISDIR', 'EACCES'].includes(error.code)) throw error; }
      finally { if (directoryHandle) await directoryHandle.close(); }
      return await get(scope);
    } catch (error) {
      if (error instanceof WeekdayPageNoteError) throw error;
      throw failed();
    } finally {
      if (temporary) await io.unlink(temporary).catch(() => {});
      if (lock) {
        await lock.close().catch(() => {});
        await io.unlink(lockPath).catch(() => {});
      }
    }
  }

  return { directory: storageDirectory, get, list, save };
}

const defaultStore = createWeekdayPageNoteStore();
module.exports = { DEFAULT_DIRECTORY, MAX_FILE_BYTES, CONFIRMATION, WeekdayPageNoteError,
  normalizeNoteScope, normalizeNoteInput, normalizeEarlyShipment, validateUserId, validateNoteRecord,
  noteDigest, createWeekdayPageNoteStore, get: defaultStore.get, list: defaultStore.list, save: defaultStore.save };
