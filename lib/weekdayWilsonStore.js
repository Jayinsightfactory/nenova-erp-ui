// Private page annotations only. This module never reads or writes ERP data.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'runtime', 'weekday-wilson');
const MAX_FILE_BYTES = 16 * 1024;

const SCOPE_FIELDS = ['year', 'majorWeek', 'custKey'];
const IDENTITY_FIELDS = [...SCOPE_FIELDS, 'prodKey', 'orderWeek', 'date'];
const INPUT_FIELDS = [...IDENTITY_FIELDS, 'unit', 'expectedTotal', 'wilsonQuantity', 'expectedRevision'];

class WeekdayWilsonError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'WeekdayWilsonError';
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
    throw new WeekdayWilsonError('INVALID_FIELDS', '필수 항목만 정확히 전달하세요.');
  }
}

function integer(value, min, max, field, allowString = false) {
  if (!(typeof value === 'number' || (allowString && typeof value === 'string' && /^\d+$/.test(value)))
    || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new WeekdayWilsonError('INVALID_INPUT', `${field} 값이 올바르지 않습니다.`);
  }
  return Number(value);
}

function normalizeWilsonScope(input, { product = false, query = false } = {}) {
  exactFields(input, product ? IDENTITY_FIELDS : SCOPE_FIELDS);
  if (typeof input.year === 'string' && !/^\d{4}$/.test(input.year)) {
    throw new WeekdayWilsonError('INVALID_INPUT', '연도는 4자리여야 합니다.');
  }
  const year = integer(input.year, 2000, 2200, 'year', query);
  if (typeof input.majorWeek !== 'string' || !/^\d{2}$/.test(input.majorWeek)
    || Number(input.majorWeek) < 1 || Number(input.majorWeek) > 53) {
    throw new WeekdayWilsonError('INVALID_INPUT', '대차수는 01~53 형식이어야 합니다.');
  }
  const scope = { year, majorWeek: input.majorWeek,
    custKey: integer(input.custKey, 1, 2147483647, 'custKey', query) };
  if (product) {
    scope.prodKey = integer(input.prodKey, 1, 2147483647, 'prodKey', query);
    if (typeof input.orderWeek !== 'string' || !/^\d{2}-\d{2}$/.test(input.orderWeek)
      || input.orderWeek.slice(0, 2) !== scope.majorWeek || !['01', '02'].includes(input.orderWeek.slice(3))) {
      throw new WeekdayWilsonError('INVALID_INPUT', '실제 선택 차수의 세부차수가 필요합니다.');
    }
    if (typeof input.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)
      || !Number.isFinite(Date.parse(`${input.date}T00:00:00Z`))
      || new Date(`${input.date}T00:00:00Z`).toISOString().slice(0, 10) !== input.date) {
      throw new WeekdayWilsonError('INVALID_INPUT', '실제 출고일이 필요합니다.');
    }
    scope.orderWeek = input.orderWeek; scope.date = input.date;
  }
  return scope;
}

function quantity(value, field) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0
    || value > 2147483647 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.000001) {
    throw new WeekdayWilsonError('INVALID_INPUT', `${field}은 소수점 3자리 이내의 0 이상 수량이어야 합니다.`);
  }
  return value;
}

function normalizeWilsonInput(input) {
  exactFields(input, INPUT_FIELDS);
  const scope = normalizeWilsonScope(Object.fromEntries(IDENTITY_FIELDS.map(key => [key, input[key]])), { product: true });
  if (!['박스', '단', '송이'].includes(input.unit)) throw new WeekdayWilsonError('INVALID_INPUT', '출고 단위를 명시하세요.');
  const expectedTotal = quantity(input.expectedTotal, '합계'); const wilsonQuantity = quantity(input.wilsonQuantity, '윌슨');
  if (wilsonQuantity > expectedTotal) throw new WeekdayWilsonError('WILSON_EXCEEDS_TOTAL', '윌슨 구분 수량은 실제 출고 합계보다 클 수 없습니다.');
  return { ...scope, unit: input.unit, expectedTotal, wilsonQuantity,
    expectedRevision: integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, 'expectedRevision') };
}

function validateUserId(userId) {
  if (typeof userId !== 'string' || !userId.trim() || userId.trim() !== userId
    || userId.length > 200 || /[\x00-\x1f\x7f]/.test(userId)) {
    throw new WeekdayWilsonError('UNAUTHENTICATED', '로그인 사용자 ID가 필요합니다.', 401);
  }
  return userId;
}

function validateWilsonRecord(record) {
  exactFields(record, ['version', ...IDENTITY_FIELDS, 'unit', 'expectedTotal', 'wilsonQuantity', 'revision', 'updatedAt', 'updatedBy']);
  const revision = integer(record.revision, 1, Number.MAX_SAFE_INTEGER, 'revision');
  const normalized = normalizeWilsonInput({ ...Object.fromEntries(INPUT_FIELDS.filter(key => key !== 'expectedRevision')
    .map(key => [key, record[key]])), expectedRevision: revision - 1 });
  if (record.version !== 1 || typeof record.updatedAt !== 'string'
    || !Number.isFinite(Date.parse(record.updatedAt))
    || new Date(record.updatedAt).toISOString() !== record.updatedAt) {
    throw new WeekdayWilsonError('INVALID_RECORD', '윌슨 구분 저장 메타데이터가 올바르지 않습니다.');
  }
  const { expectedRevision, ...content } = normalized;
  return { version: 1, ...content, revision, updatedAt: record.updatedAt, updatedBy: validateUserId(record.updatedBy) };
}

function wilsonDigest(record) {
  return crypto.createHash('sha256').update(JSON.stringify(validateWilsonRecord(record))).digest('hex');
}

function createWeekdayWilsonStore({ directory = DEFAULT_DIRECTORY, io = fs.promises,
  now = () => new Date(), lockTimeoutMs = 2000, lockRetryMs = 20 } = {}) {
  const storageDirectory = path.resolve(directory);
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0 || !Number.isFinite(lockRetryMs) || lockRetryMs <= 0) {
    throw new Error('Invalid lock timing');
  }
  const filename = scope => `${scope.year}_${scope.majorWeek}_${scope.custKey}_${scope.prodKey}_${scope.orderWeek}_${scope.date}.json`;
  const targetFor = scope => path.join(storageDirectory, filename(scope));
  const corrupt = () => new WeekdayWilsonError('WILSON_STORAGE_CORRUPT', '윌슨 구분 저장 파일을 검증할 수 없습니다.', 500);
  const failed = () => new WeekdayWilsonError('WILSON_STORAGE_FAILED', '윌슨 구분 저장에 실패했습니다. 저장 상태를 다시 조회하세요.', 500);

  async function checkDirectory() {
    try {
      const stat = await io.lstat(storageDirectory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw corrupt();
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      if (error instanceof WeekdayWilsonError) throw error;
      throw failed();
    }
  }

  async function get(input) {
    const scope = normalizeWilsonScope(input, { product: true });
    if (!(await checkDirectory())) return null;
    try {
      const target = targetFor(scope);
      const stat = await io.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw corrupt();
      const text = await io.readFile(target, 'utf8');
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw corrupt();
      const envelope = JSON.parse(text);
      exactFields(envelope, ['record', 'digest']);
      const record = validateWilsonRecord(envelope.record);
      if (envelope.digest !== wilsonDigest(record) || filename(record) !== filename(scope)) throw corrupt();
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw corrupt();
    }
  }

  async function list(input) {
    const scope = normalizeWilsonScope(input);
    if (!(await checkDirectory())) return [];
    const prefix = `${scope.year}_${scope.majorWeek}_${scope.custKey}_`;
    let names;
    try { names = await io.readdir(storageDirectory); } catch { throw failed(); }
    const records = [];
    for (const name of names.filter(name => name.startsWith(prefix) && name.endsWith('.json')).sort()) {
      const match = /^(\d+)_(\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(name.slice(prefix.length, -5));
      if (!match || Number(match[1]) > 2147483647) throw corrupt();
      const record = await get({ ...scope, prodKey: Number(match[1]), orderWeek: match[2], date: match[3] });
      if (!record) throw corrupt();
      records.push(record);
    }
    return records.sort((a, b) => a.prodKey - b.prodKey || a.date.localeCompare(b.date));
  }

  async function save(input, userId) {
    const normalized = normalizeWilsonInput(input);
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
          if (Date.now() >= deadline) throw new WeekdayWilsonError('WILSON_LOCKED',
            '다른 윌슨 구분 저장이 진행 중이거나 잠금 복구가 필요합니다. 다시 조회하세요.', 409);
          await new Promise(resolve => setTimeout(resolve, lockRetryMs));
        }
      }
      // Never steal an old lock: a paused writer may still own it in another process.
      const current = await get(scope);
      const currentRevision = current?.revision ?? 0;
      if (normalized.expectedRevision !== currentRevision) {
        // Lost-response retry: after validating fresh ERP totals, returning the
        // exact already-published classification is safe and does not revise it.
        const { expectedRevision: ignoredRevision, ...desired } = normalized;
        if (current && Object.entries(desired).every(([key, value]) => current[key] === value)) return current;
        throw new WeekdayWilsonError('REVISION_CONFLICT', '다른 사용자가 윌슨 구분를 변경했습니다. 최신 기록을 조회하세요.',
          409, { currentRevision });
      }
      const { expectedRevision, ...content } = normalized;
      const record = validateWilsonRecord({ version: 1, ...content, revision: currentRevision + 1,
        updatedAt: now().toISOString(), updatedBy: userId });
      const serialized = JSON.stringify({ record, digest: wilsonDigest(record) });
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
      if (error instanceof WeekdayWilsonError) throw error;
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

const defaultStore = createWeekdayWilsonStore();
module.exports = { DEFAULT_DIRECTORY, MAX_FILE_BYTES, WeekdayWilsonError,
  normalizeWilsonScope, normalizeWilsonInput, validateUserId, validateWilsonRecord,
  wilsonDigest, createWeekdayWilsonStore, get: defaultStore.get, list: defaultStore.list, save: defaultStore.save };
