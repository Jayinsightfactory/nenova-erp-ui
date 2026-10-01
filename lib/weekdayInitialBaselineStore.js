const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = 'ERP_DISTRIBUTION';
const MAX_ROWS = 500;
const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'runtime', 'weekday-baselines');

class WeekdayBaselineError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'WeekdayBaselineError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeBaselineScope(input = {}) {
  const numeric = (value) => (typeof value === 'number' || typeof value === 'string')
    && /^\d+$/.test(String(value));
  if (!numeric(input.year) || !/^\d{4}$/.test(String(input.year))
    || Number(input.year) < 2000 || Number(input.year) > 2200) {
    throw new WeekdayBaselineError('INVALID_YEAR', '연도를 명시하세요.');
  }
  if (!numeric(input.custKey) || !Number.isInteger(Number(input.custKey))
    || Number(input.custKey) <= 0 || Number(input.custKey) > 2147483647) {
    throw new WeekdayBaselineError('INVALID_CUSTOMER', '실제 거래처 키를 명시하세요.');
  }
  if (typeof input.orderWeek !== 'string' || !/^\d{2}-\d{2}$/.test(input.orderWeek)) {
    throw new WeekdayBaselineError('INVALID_WEEK', '세부차수는 NN-NN 형식이어야 합니다.');
  }
  return { year: Number(input.year), orderWeek: input.orderWeek, custKey: Number(input.custKey) };
}

function canonicalRows(rows, { requirePositive = false } = {}) {
  if (!Array.isArray(rows) || rows.length > MAX_ROWS) {
    throw new WeekdayBaselineError('INVALID_BASELINE_ROWS', '기준 품목은 최대 500개입니다.');
  }
  const keys = new Set();
  const normalized = rows.map((row) => {
    if (!row || !Number.isInteger(row.prodKey) || row.prodKey <= 0 || row.prodKey > 2147483647
      || keys.has(row.prodKey) || typeof row.prodName !== 'string' || !row.prodName.trim()
      || row.prodName.length > 1000 || !(row.flowerName === null || typeof row.flowerName === 'string')
      || (typeof row.flowerName === 'string' && row.flowerName.length > 1000)
      || !['박스', '단', '송이'].includes(row.unit)
      || !(row.estUnit === null || ['박스', '단', '송이'].includes(row.estUnit))
      || typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity < 0) {
      throw new WeekdayBaselineError('INVALID_BASELINE_ROWS', '품목·단위·수량이 유효한 전산 기준이 필요합니다.');
    }
    keys.add(row.prodKey);
    if (!Array.isArray(row.shipmentDates) || row.shipmentDates.length > 10000
      || (row.shipmentDates.length && row.estUnit === null)) {
      throw new WeekdayBaselineError('INVALID_BASELINE_DATES', '실제 출고일 배분과 견적 단위가 필요합니다.');
    }
    const dates = new Set();
    const shipmentDates = row.shipmentDates.map((allocation) => {
      const date = allocation?.date;
      const key = `${date}|${allocation?.orderWeek}`;
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)
        || !Number.isFinite(Date.parse(`${date}T00:00:00.000Z`))
        || new Date(`${date}T00:00:00.000Z`).toISOString().slice(0,10) !== date
        || typeof allocation.orderWeek !== 'string' || !/^\d{2}-\d{2}$/.test(allocation.orderWeek)
        || dates.has(key) || typeof allocation.quantity !== 'number'
        || !Number.isFinite(allocation.quantity) || allocation.quantity < 0
        || typeof allocation.estimateQuantity !== 'number'
        || !Number.isFinite(allocation.estimateQuantity) || allocation.estimateQuantity < 0) {
        throw new WeekdayBaselineError('INVALID_BASELINE_DATES', '출고일·수량 기준이 올바르지 않습니다.');
      }
      dates.add(key);
      return { date, orderWeek: allocation.orderWeek, quantity: allocation.quantity,
        estimateQuantity: allocation.estimateQuantity };
    }).sort((a, b) => a.date.localeCompare(b.date) || a.orderWeek.localeCompare(b.orderWeek));
    return { prodKey: row.prodKey, prodName: row.prodName, flowerName: row.flowerName,
      unit: row.unit, quantity: Object.is(row.quantity, -0) ? 0 : row.quantity,
      estUnit: row.estUnit, shipmentDates };
  }).sort((a, b) => a.prodKey - b.prodKey);
  if (requirePositive && !normalized.some((row) => row.quantity > 0)) {
    throw new WeekdayBaselineError('EMPTY_BASELINE', '양수 분배가 없는 차수는 최초 기준을 확정할 수 없습니다.', 409);
  }
  return normalized;
}

function baselineDigest(scope, rows) {
  const normalizedScope = normalizeBaselineScope(scope);
  const normalizedRows = canonicalRows(rows);
  if (normalizedRows.some(row => row.shipmentDates.some(date => date.orderWeek !== normalizedScope.orderWeek))) {
    throw new WeekdayBaselineError('INVALID_BASELINE_DATES', '출고일 배분의 세부차수가 기준 범위와 다릅니다.');
  }
  return crypto.createHash('sha256').update(JSON.stringify({ version: 1,
    ...normalizedScope, source: SOURCE, rows: normalizedRows })).digest('hex');
}

function validateBaselineRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new WeekdayBaselineError('INVALID_BASELINE_RECORD', '기준본 형식이 올바르지 않습니다.');
  }
  const scope = normalizeBaselineScope(record);
  const rows = canonicalRows(record.rows, { requirePositive: true });
  if (record.version !== 1 || record.source !== SOURCE || record.year !== scope.year
    || record.custKey !== scope.custKey || typeof record.confirmedBy !== 'string'
    || !record.confirmedBy.trim() || record.confirmedBy !== record.confirmedBy.trim()
    || record.confirmedBy.length > 200 || typeof record.confirmedAt !== 'string'
    || !Number.isFinite(Date.parse(record.confirmedAt))
    || new Date(record.confirmedAt).toISOString() !== record.confirmedAt
    || typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest)
    || record.digest !== baselineDigest(scope, rows)) {
    throw new WeekdayBaselineError('INVALID_BASELINE_RECORD', '기준본 메타데이터 또는 지문이 올바르지 않습니다.');
  }
  return { version: 1, ...scope, confirmedAt: record.confirmedAt, confirmedBy: record.confirmedBy,
    source: SOURCE, digest: record.digest, rows };
}

function createWeekdayInitialBaselineStore({ directory = DEFAULT_DIRECTORY, io = fs.promises } = {}) {
  const storageDirectory = path.resolve(directory);
  const targetFor = (scope) => path.join(storageDirectory,
    `${scope.year}_${scope.orderWeek}_${scope.custKey}.json`);
  const corrupt = () => new WeekdayBaselineError('BASELINE_STORAGE_CORRUPT', '최초 기준 저장 파일을 검증할 수 없습니다.', 500);

  async function get(input) {
    const scope = normalizeBaselineScope(input);
    const target = targetFor(scope);
    try {
      const stat = await io.lstat(target);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw corrupt();
      const text = await io.readFile(target, 'utf8');
      if (Buffer.byteLength(text) > MAX_FILE_BYTES) throw corrupt();
      const record = validateBaselineRecord(JSON.parse(text));
      if (record.year !== scope.year || record.orderWeek !== scope.orderWeek || record.custKey !== scope.custKey) throw corrupt();
      return record;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw corrupt();
    }
  }

  async function list({ year, custKey, orderWeeks } = {}) {
    if (!Array.isArray(orderWeeks) || !orderWeeks.length || orderWeeks.length > 20) {
      throw new WeekdayBaselineError('INVALID_WEEKS', '세부차수는 1~20개를 명시하세요.');
    }
    const scopes = [...new Set(orderWeeks)].map((orderWeek) => normalizeBaselineScope({ year, custKey, orderWeek }));
    return (await Promise.all(scopes.map(get))).filter((record) => record !== null);
  }

  async function create(input) {
    const record = validateBaselineRecord(input);
    const target = targetFor(record);
    // A corrupt existing record must not be mistaken for a fresh confirmation.
    if (await get(record)) throw new WeekdayBaselineError('BASELINE_ALREADY_CONFIRMED', '이미 최초 기준이 확정된 차수입니다.', 409);
    const serialized = JSON.stringify(record);
    if (Buffer.byteLength(serialized) > MAX_FILE_BYTES) throw new WeekdayBaselineError('BASELINE_TOO_LARGE', '기준본 크기가 너무 큽니다.');
    let temporary;
    let ownsTemporary = false;
    try {
      await io.mkdir(storageDirectory, { recursive: true, mode: 0o700 });
      temporary = path.join(storageDirectory, `.${crypto.randomUUID()}.tmp`);
      const handle = await io.open(temporary, 'wx', 0o600);
      ownsTemporary = true;
      try { await handle.writeFile(serialized, 'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      // Hard-link publication is atomic and never replaces an existing scope, across processes.
      await io.link(temporary, target);
      const saved = await get(record);
      if (!saved) throw corrupt();
      return saved;
    } catch (error) {
      if (error.code === 'EEXIST' && ownsTemporary) {
        if (!(await get(record))) throw corrupt();
        throw new WeekdayBaselineError('BASELINE_ALREADY_CONFIRMED', '이미 최초 기준이 확정된 차수입니다.', 409);
      }
      if (error instanceof WeekdayBaselineError) throw error;
      throw new WeekdayBaselineError('BASELINE_STORAGE_FAILED', '최초 기준 저장에 실패했습니다. 저장 상태를 다시 조회하세요.', 500);
    } finally {
      if (ownsTemporary) await io.unlink(temporary).catch(() => {});
    }
  }

  return { directory: storageDirectory, get, list, create };
}

const defaultStore = createWeekdayInitialBaselineStore();
module.exports = { SOURCE, MAX_ROWS, MAX_FILE_BYTES, DEFAULT_DIRECTORY, WeekdayBaselineError,
  normalizeBaselineScope, canonicalRows, baselineDigest, validateBaselineRecord,
  createWeekdayInitialBaselineStore, get: defaultStore.get, list: defaultStore.list, create: defaultStore.create };
