// Private manual ending balances only. No ERP access and no automatic stock writes.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'runtime', 'weekday-carryovers');
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_HISTORY = 10000;
const SCOPE_FIELDS = ['year', 'majorWeek', 'custKey'];
const IDENTITY_FIELDS = [...SCOPE_FIELDS, 'prodKey'];
const INPUT_FIELDS = [...IDENTITY_FIELDS, 'unit', 'quantity', 'reason', 'expectedRevision'];

class WeekdayCarryoverError extends Error {
  constructor(code, message, statusCode = 400, details = {}) {
    super(message);
    this.name = 'WeekdayCarryoverError';
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
    throw new WeekdayCarryoverError('INVALID_FIELDS', '필수 항목만 정확히 전달하세요.');
  }
}

function integer(value, min, max, field, query = false) {
  if (!(typeof value === 'number' || (query && typeof value === 'string' && /^\d+$/.test(value)))
    || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new WeekdayCarryoverError('INVALID_INPUT', `${field} 값이 올바르지 않습니다.`);
  }
  return Number(value);
}

function normalizeCarryoverScope(input, { product = false, query = false } = {}) {
  exactFields(input, product ? IDENTITY_FIELDS : SCOPE_FIELDS);
  const year = integer(input.year, 2000, 2200, 'year', query);
  if (typeof input.year === 'string' && !/^\d{4}$/.test(input.year)) {
    throw new WeekdayCarryoverError('INVALID_INPUT', '연도는 4자리여야 합니다.');
  }
  if (typeof input.majorWeek !== 'string' || !/^\d{2}$/.test(input.majorWeek)
    || Number(input.majorWeek) < 1 || Number(input.majorWeek) > 53) {
    throw new WeekdayCarryoverError('INVALID_INPUT', '대차수는 01~53 형식이어야 합니다.');
  }
  return { year, majorWeek: input.majorWeek,
    custKey: integer(input.custKey, 1, 2147483647, 'custKey', query),
    ...(product ? { prodKey: integer(input.prodKey, 1, 2147483647, 'prodKey', query) } : {}) };
}

function quantity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) {
    throw new WeekdayCarryoverError('INVALID_QUANTITY', '잔량은 유한한 숫자여야 합니다. 0·음수도 직접 지정할 수 있습니다.');
  }
  return Object.is(value, -0) ? 0 : value;
}

function reason(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || value.length > 1000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new WeekdayCarryoverError('INVALID_REASON', '수정 사유를 1000자 이하로 명시하세요.');
  }
  return value;
}

function validateUserId(value) {
  if (typeof value !== 'string' || !value.trim() || value !== value.trim()
    || value.length > 200 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new WeekdayCarryoverError('UNAUTHENTICATED', '활성 로그인 사용자 ID가 필요합니다.', 401);
  }
  return value;
}

function validateStartDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value
    || new Date(`${value}T00:00:00.000Z`).getUTCDay() !== 4) {
    throw new WeekdayCarryoverError('INVALID_CALENDAR', '서버가 검증한 실제 목요일 anchor가 필요합니다.', 409);
  }
  return value;
}

function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
    || new Date(value).toISOString() !== value) {
    throw new WeekdayCarryoverError('INVALID_RECORD', '저장 시각이 올바르지 않습니다.');
  }
  return value;
}

function normalizeCarryoverInput(input) {
  exactFields(input, INPUT_FIELDS);
  const scope = normalizeCarryoverScope(Object.fromEntries(IDENTITY_FIELDS.map(key => [key, input[key]])), { product: true });
  if (!['박스', '단', '송이'].includes(input.unit)) {
    throw new WeekdayCarryoverError('INVALID_UNIT', '실제 출고 단위를 명시하세요.');
  }
  return { ...scope, unit: input.unit, quantity: quantity(input.quantity), reason: reason(input.reason),
    expectedRevision: integer(input.expectedRevision, 0, Number.MAX_SAFE_INTEGER - 1, 'expectedRevision') };
}

function validateCarryoverRecord(record) {
  exactFields(record, ['version', ...IDENTITY_FIELDS, 'startDate', 'unit', 'quantity', 'revision', 'updatedAt', 'updatedBy', 'history']);
  const scope = normalizeCarryoverScope(Object.fromEntries(IDENTITY_FIELDS.map(key => [key, record[key]])), { product: true });
  const revision = integer(record.revision, 1, Number.MAX_SAFE_INTEGER, 'revision');
  if (record.version !== 1 || !['박스', '단', '송이'].includes(record.unit)
    || !Array.isArray(record.history) || record.history.length !== revision || record.history.length > MAX_HISTORY) {
    throw new WeekdayCarryoverError('INVALID_RECORD', '마감 잔량의 전체 수정 이력이 필요합니다.');
  }
  let previous = null;
  let previousTimestamp = null;
  const history = record.history.map((entry, index) => {
    exactFields(entry, ['before', 'after', 'reason', 'actor', 'timestamp', 'revision']);
    const after = quantity(entry.after);
    const time = timestamp(entry.timestamp);
    if (entry.revision !== index + 1 || entry.before !== previous
      || (previousTimestamp !== null && time < previousTimestamp)) {
      throw new WeekdayCarryoverError('INVALID_RECORD', '잔량 수정 이력의 연결이 올바르지 않습니다.');
    }
    const normalized = { before: previous, after, reason: reason(entry.reason),
      actor: validateUserId(entry.actor), timestamp: time, revision: index + 1 };
    previous = after;
    previousTimestamp = time;
    return normalized;
  });
  const last = history[history.length - 1];
  if (quantity(record.quantity) !== last.after || record.updatedAt !== last.timestamp || record.updatedBy !== last.actor) {
    throw new WeekdayCarryoverError('INVALID_RECORD', '현재 잔량과 최종 수정 이력이 일치하지 않습니다.');
  }
  return { version: 1, ...scope, startDate: validateStartDate(record.startDate), unit: record.unit,
    quantity: last.after, revision, updatedAt: last.timestamp, updatedBy: last.actor, history };
}

function carryoverDigest(record) {
  return crypto.createHash('sha256').update(JSON.stringify(validateCarryoverRecord(record))).digest('hex');
}

function createWeekdayCarryoverStore({ directory = DEFAULT_DIRECTORY, io = fs.promises,
  now = () => new Date(), lockTimeoutMs = 2000, lockRetryMs = 20,
  maxFileBytes = MAX_FILE_BYTES, maxHistory = MAX_HISTORY } = {}) {
  const storageDirectory = path.resolve(directory);
  if (!Number.isFinite(lockTimeoutMs) || lockTimeoutMs < 0 || !Number.isFinite(lockRetryMs) || lockRetryMs <= 0
    || !Number.isSafeInteger(maxFileBytes) || maxFileBytes <= 0 || maxFileBytes > MAX_FILE_BYTES
    || !Number.isSafeInteger(maxHistory) || maxHistory <= 0 || maxHistory > MAX_HISTORY) throw new Error('Invalid storage limits');
  const filename = scope => `${scope.year}_${scope.majorWeek}_${scope.custKey}_${scope.prodKey}.json`;
  const targetFor = scope => path.join(storageDirectory, filename(scope));
  const corrupt = () => new WeekdayCarryoverError('CARRYOVER_STORAGE_CORRUPT', '잔량 저장 파일을 검증할 수 없습니다.', 500);
  const failed = () => new WeekdayCarryoverError('CARRYOVER_STORAGE_FAILED', '잔량 저장에 실패했습니다. 저장 상태를 다시 조회하세요.', 500);

  async function checkDirectory() {
    try {
      const stat = await io.lstat(storageDirectory);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw corrupt();
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      if (error instanceof WeekdayCarryoverError) throw error;
      throw failed();
    }
  }

  async function get(input) {
    const scope = normalizeCarryoverScope(input, { product: true });
    if (!(await checkDirectory())) return null;
    try {
      const target = targetFor(scope);
      const stat = await io.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw corrupt();
      const text = await io.readFile(target, 'utf8');
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw corrupt();
      const envelope = JSON.parse(text);
      exactFields(envelope, ['record', 'digest']);
      const record = validateCarryoverRecord(envelope.record);
      if (typeof envelope.digest !== 'string' || envelope.digest !== carryoverDigest(record)
        || filename(record) !== filename(scope)) throw corrupt();
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw corrupt();
    }
  }

  async function listCustomer(custKey) {
    integer(custKey, 1, 2147483647, 'custKey');
    if (!(await checkDirectory())) return [];
    let names;
    try { names = await io.readdir(storageDirectory); } catch { throw failed(); }
    const records = [];
    for (const name of names.filter(name => name.endsWith('.json')).sort()) {
      // Do not read or leak another customer's files, even if they are corrupt.
      const parts = name.slice(0, -5).split('_');
      if (parts.length !== 4 || Number(parts[2]) !== custKey) continue;
      if (!/^\d{4}_\d{2}_[1-9]\d*_[1-9]\d*\.json$/.test(name)) throw corrupt();
      let scope;
      try { scope = normalizeCarryoverScope({ year: Number(parts[0]), majorWeek: parts[1],
        custKey, prodKey: Number(parts[3]) }, { product: true }); } catch { throw corrupt(); }
      if (filename(scope) !== name) throw corrupt();
      const record = await get(scope);
      if (!record) throw corrupt();
      records.push(record);
    }
    return records.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.prodKey - b.prodKey);
  }

  async function list(input) {
    const scope = normalizeCarryoverScope(input);
    return (await listCustomer(scope.custKey)).filter(record => record.year === scope.year && record.majorWeek === scope.majorWeek);
  }

  async function save(input, userId, serverContext) {
    const normalized = normalizeCarryoverInput(input);
    validateUserId(userId);
    exactFields(serverContext, ['startDate']);
    const startDate = validateStartDate(serverContext.startDate);
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
          if (Date.now() >= deadline) throw new WeekdayCarryoverError('CARRYOVER_LOCKED', '다른 잔량 저장이 진행 중이거나 잠금 복구가 필요합니다.', 409);
          await new Promise(resolve => setTimeout(resolve, lockRetryMs));
        }
      }
      // Never steal a paused writer's lock; compare revision inside the exclusive lock.
      const current = await get(scope);
      const currentRevision = current?.revision ?? 0;
      if (normalized.expectedRevision !== currentRevision) throw new WeekdayCarryoverError('REVISION_CONFLICT',
        '다른 사용자가 잔량을 변경했습니다. 최신 기록을 조회하세요.', 409, { currentRevision });
      if (current && (current.unit !== normalized.unit || current.startDate !== startDate)) {
        throw new WeekdayCarryoverError('CARRYOVER_IDENTITY_CHANGED', '저장 후 실제 단위 또는 달력이 달라졌습니다. 기존 이력을 임의 환산하지 않습니다.', 409);
      }
      if (currentRevision >= maxHistory) throw new WeekdayCarryoverError('CARRYOVER_HISTORY_LIMIT', '전체 이력 보관 한도를 넘습니다. 이력을 삭제하지 않고 저장을 거부합니다.', 409);
      const updatedAt = now().toISOString();
      const entry = { before: current?.quantity ?? null, after: normalized.quantity, reason: normalized.reason,
        actor: userId, timestamp: updatedAt, revision: currentRevision + 1 };
      const record = validateCarryoverRecord({ version: 1, ...scope, startDate, unit: normalized.unit,
        quantity: normalized.quantity, revision: currentRevision + 1, updatedAt, updatedBy: userId,
        history: [...(current?.history ?? []), entry] });
      const serialized = JSON.stringify({ record, digest: carryoverDigest(record) });
      if (Buffer.byteLength(serialized) > maxFileBytes) throw new WeekdayCarryoverError('CARRYOVER_HISTORY_LIMIT', '전체 이력 파일 크기 한도를 넘습니다. 저장을 거부합니다.', 409);
      const temporaryPath = path.join(storageDirectory, `.${crypto.randomUUID()}.tmp`);
      const handle = await io.open(temporaryPath, 'wx', 0o600);
      temporary = temporaryPath;
      try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await io.rename(temporary, target);
      temporary = null;
      let directoryHandle;
      try { directoryHandle = await io.open(storageDirectory, 'r'); await directoryHandle.sync(); }
      catch (error) { if (!['EINVAL', 'EPERM', 'ENOTSUP', 'EISDIR', 'EACCES'].includes(error.code)) throw error; }
      finally { if (directoryHandle) await directoryHandle.close(); }
      const saved = await get(scope);
      if (!saved) throw corrupt();
      return saved;
    } catch (error) {
      if (error instanceof WeekdayCarryoverError) throw error;
      throw failed();
    } finally {
      if (temporary) await io.unlink(temporary).catch(() => {});
      if (lock) {
        await lock.close().catch(() => {});
        await io.unlink(lockPath).catch(() => {});
      }
    }
  }

  return { directory: storageDirectory, get, list, listCustomer, save };
}

const defaultStore = createWeekdayCarryoverStore();
module.exports = { DEFAULT_DIRECTORY, MAX_FILE_BYTES, MAX_HISTORY, WeekdayCarryoverError,
  normalizeCarryoverScope, normalizeCarryoverInput, validateCarryoverRecord, validateStartDate,
  validateUserId, carryoverDigest, createWeekdayCarryoverStore,
  get: defaultStore.get, list: defaultStore.list, listCustomer: defaultStore.listCustomer, save: defaultStore.save };
