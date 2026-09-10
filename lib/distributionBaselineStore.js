const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const XLSX = require('xlsx');
const { parseDistributionBaseline } = require('./distributionBaseline');

const MAX_FILE_BYTES = 512 * 1024;
const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'distribution-board', 'baselines');
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class BaselineStoreError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'BaselineStoreError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateScope({ year, week }) {
  const normalizedYear = asText(year);
  const normalizedWeek = asText(week);
  if (!/^20\d{2}$/.test(normalizedYear)) throw new BaselineStoreError('INVALID_YEAR', '연도는 20xx 형식으로 입력해 주세요.');
  if (!/^\d{2}-\d{2}$/.test(normalizedWeek)) throw new BaselineStoreError('INVALID_WEEK', '차수는 NN-NN 형식으로 입력해 주세요.');
  return { year: normalizedYear, week: normalizedWeek };
}

function validateFileName(value) {
  const fileName = asText(value);
  if (!fileName || fileName.length > 255 || /[\\/\0]/.test(fileName) || path.basename(fileName) !== fileName || !/\.xlsx$/i.test(fileName)) {
    throw new BaselineStoreError('INVALID_FILE_NAME', '경로 없이 엑셀 파일명만 입력해 주세요.');
  }
  return fileName;
}

function decodeBase64(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new BaselineStoreError('INVALID_FILE_BASE64', '파일 데이터 형식이 올바르지 않습니다.');
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.toString('base64') !== value) {
    throw new BaselineStoreError('INVALID_FILE_BASE64', '파일 데이터를 읽을 수 없습니다.');
  }
  if (buffer.length > MAX_FILE_BYTES) throw new BaselineStoreError('FILE_TOO_LARGE', '파일은 512KiB 이하여야 합니다.');
  if (buffer.length < 4 || !buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    throw new BaselineStoreError('INVALID_XLSX_MAGIC', '엑셀 파일 형식이 올바르지 않습니다.');
  }
  return buffer;
}

function validateCoverage(value, week) {
  const coverage = asText(value);
  if (!['single', 'combined'].includes(coverage)) throw new BaselineStoreError('INVALID_COVERAGE', '수량 범위를 다시 선택해 주세요.');
  if (week.endsWith('-01') && coverage !== 'single') {
    throw new BaselineStoreError('INVALID_COVERAGE', '01 차수는 single coverage만 허용됩니다.');
  }
  return coverage;
}

function createdByFor(user) {
  const createdBy = asText(user?.userId ?? user?.UserID);
  if (!createdBy) throw new BaselineStoreError('MISSING_USER', '인증된 사용자 ID가 필요합니다.', 401);
  return createdBy;
}

function publicBaseline(record) {
  return {
    id: record.id,
    status: record.status,
    year: record.year,
    week: record.week,
    coverage: record.coverage,
    fileName: record.fileName,
    sha256: record.sha256,
    createdAt: record.createdAt,
    createdBy: record.createdBy,
    parsed: record.parsed,
    source: record.source,
    erpSnapshot: null,
    reconciliationStatus: 'NOT_CAPTURED',
  };
}

function listItem(record) {
  const baseline = publicBaseline(record);
  delete baseline.parsed;
  return baseline;
}

function isSamePayload(record, incoming) {
  return record.year === incoming.year
    && record.week === incoming.week
    && record.requestId === incoming.requestId
    && record.fileName === incoming.fileName
    && record.sha256 === incoming.sha256
    && record.coverage === incoming.coverage
    && record.createdBy === incoming.createdBy;
}

function createDistributionBaselineStore({ directory = DEFAULT_DIRECTORY, now = () => new Date(), xlsx = XLSX, parse = parseDistributionBaseline } = {}) {
  const storageDirectory = path.resolve(directory);

  async function readRecord(filePath) {
    let record;
    try {
      record = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new BaselineStoreError('BASELINE_NOT_FOUND', '요청한 기준본을 찾을 수 없습니다.', 404);
      throw new BaselineStoreError('BASELINE_STORAGE_CORRUPT', `저장된 기준본을 읽을 수 없습니다: ${error.message}`, 500);
    }
    if (!record || typeof record !== 'object' || !/^[a-f0-9]{64}$/.test(record.id || '')) {
      throw new BaselineStoreError('BASELINE_STORAGE_CORRUPT', '저장된 기준본 형식이 올바르지 않습니다.', 500);
    }
    return record;
  }

  async function getBaseline({ year, week, id }) {
    const scope = validateScope({ year, week });
    if (!/^[a-f0-9]{64}$/.test(asText(id))) throw new BaselineStoreError('INVALID_BASELINE_ID', '기준본 식별자 형식이 올바르지 않습니다.');
    const record = await readRecord(path.join(storageDirectory, `${id}.json`));
    if (record.year !== scope.year || record.week !== scope.week) {
      throw new BaselineStoreError('BASELINE_NOT_FOUND', '요청한 차수의 기준본을 찾을 수 없습니다.', 404);
    }
    return publicBaseline(record);
  }

  async function listBaselines({ year, week }) {
    const scope = validateScope({ year, week });
    let names;
    try {
      names = await fs.promises.readdir(storageDirectory);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = await Promise.all(names
      .filter(name => /^[a-f0-9]{64}\.json$/.test(name))
      .map(name => readRecord(path.join(storageDirectory, name))));
    return records
      .filter(record => record.year === scope.year && record.week === scope.week)
      .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)) || left.id.localeCompare(right.id))
      .map(listItem);
  }

  async function createBaseline(input, user) {
    const { year, week } = validateScope(input || {});
    const requestId = asText(input?.requestId);
    if (!UUID_RE.test(requestId)) throw new BaselineStoreError('INVALID_REQUEST_ID', '요청 식별자 형식이 올바르지 않습니다.');
    const fileName = validateFileName(input?.fileName);
    const coverage = validateCoverage(input?.coverage, week);
    const createdBy = createdByFor(user);
    const fileBuffer = decodeBase64(input?.fileBase64);
    const sha = sha256(fileBuffer);
    const id = sha256(`${year}\n${week}\n${createdBy}\n${requestId}`);
    let workbook;
    let parsed;
    try {
      workbook = xlsx.read(fileBuffer, { type: 'buffer' });
      parsed = parse(workbook, { year, week, fileName });
    } catch (error) {
      if (error instanceof BaselineStoreError) throw error;
      throw new BaselineStoreError('INVALID_XLSX', `워크북을 검증할 수 없습니다: ${error.message}`);
    }
    const createdAt = now().toISOString();
    const record = {
      schemaVersion: 1,
      id,
      status: 'STORED',
      year,
      week,
      requestId,
      fileName,
      sha256: sha,
      fileBase64: input.fileBase64,
      coverage,
      createdAt,
      createdBy,
      parsed,
      source: { fileName, sha256: sha, bytes: fileBuffer.length, format: 'xlsx' },
      erpSnapshot: null,
      reconciliationStatus: 'NOT_CAPTURED',
    };
    const target = path.join(storageDirectory, `${id}.json`);
    await fs.promises.mkdir(storageDirectory, { recursive: true });
    const temporary = path.join(storageDirectory, `.${id}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await fs.promises.link(temporary, target);
      return publicBaseline(record);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readRecord(target);
      if (isSamePayload(existing, record)) return publicBaseline(existing);
      throw new BaselineStoreError('BASELINE_ID_CONFLICT', '같은 requestId로 다른 기준본을 저장할 수 없습니다.', 409);
    } finally {
      await fs.promises.unlink(temporary).catch(() => {});
    }
  }

  return { directory: storageDirectory, createBaseline, getBaseline, listBaselines };
}

const defaultStore = createDistributionBaselineStore();

module.exports = {
  MAX_FILE_BYTES,
  BaselineStoreError,
  createDistributionBaselineStore,
  createBaseline: defaultStore.createBaseline,
  getBaseline: defaultStore.getBaseline,
  listBaselines: defaultStore.listBaselines,
};
