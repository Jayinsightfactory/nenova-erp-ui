const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const MAX_REPORT_BYTES = 2 * 1024 * 1024;
const MAX_LIST_ITEMS = 20;
const MAX_CREATE_ATTEMPTS = 8;
const DEFAULT_ROOT = path.join(
  process.cwd(),
  'data',
  'distribution-board',
  'baselines',
  'automated-audits',
);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const FULL_WEEK_RE = /^(0[1-9]|[1-4][0-9]|5[0-3])-(0[1-9]|[1-9][0-9])$/;
const REQUIRED_REPORT_ARRAYS = ['requests', 'findings', 'unresolved', 'warnings'];
const SENSITIVE_KEY_RE = /^(authorization|proxyauthorization|cookie|setcookie|password|passwd|pwd|secret|clientsecret|token|accesstoken|refreshtoken|idtoken|apikey|privatekey|connectionstring|databaseurl|dbpassword)$/;
const SENSITIVE_VALUE_RES = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
];

class DistributionAuditStoreError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'DistributionAuditStoreError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function validateScope(input = {}) {
  const { year, week } = input;
  if (typeof year !== 'string' || !/^20\d{2}$/.test(year)) {
    throw new DistributionAuditStoreError('INVALID_YEAR', '연도는 정확한 20xx 문자열이어야 합니다.');
  }
  if (typeof week !== 'string' || !FULL_WEEK_RE.test(week)) {
    throw new DistributionAuditStoreError('INVALID_WEEK', '차수는 대차수 01~53, 세부차수 01~99인 전체 WW-SS 형식이어야 합니다.');
  }
  return { year, week };
}

function validateUserId(value) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.length > 200
    || value.trim() !== value
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new DistributionAuditStoreError('MISSING_USER', 'API가 전달한 인증 사용자 ID가 필요합니다.', 401);
  }
  return value;
}

function sensitiveKey(key) {
  return SENSITIVE_KEY_RE.test(String(key).toLowerCase().replace(/[^a-z]/g, ''));
}

function assertJsonValue(value, location = 'report', seen = new Set()) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && SENSITIVE_VALUE_RES.some(pattern => pattern.test(value))) {
      throw new DistributionAuditStoreError('REPORT_CONTAINS_SECRET', `${location}에 비밀값으로 보이는 문자열을 저장할 수 없습니다.`);
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', `${location}에는 유한한 숫자만 사용할 수 있습니다.`);
    }
    return;
  }
  if (typeof value !== 'object') {
    throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', `${location}에는 JSON 값만 사용할 수 있습니다.`);
  }
  if (seen.has(value)) {
    throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', `${location}에 순환 참조가 있습니다.`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', `${location}에는 일반 JSON 객체만 사용할 수 있습니다.`);
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonValue(item, `${location}[${index}]`, seen));
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (sensitiveKey(key)) {
        throw new DistributionAuditStoreError('REPORT_CONTAINS_SECRET', `${location}.${key} 같은 민감 필드는 저장할 수 없습니다.`);
      }
      assertJsonValue(child, `${location}.${key}`, seen);
    }
  }
  seen.delete(value);
}

function normalizeReport(report) {
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', 'report는 JSON 객체여야 합니다.');
  }
  for (const field of REQUIRED_REPORT_ARRAYS) {
    if (!Array.isArray(report[field])) {
      throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', `report.${field}는 배열이어야 합니다.`);
    }
  }
  if (report.advisoryOnly !== true) {
    throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', '자동 비교 report는 advisoryOnly=true여야 합니다.');
  }
  assertJsonValue(report);
  let serialized;
  try {
    serialized = JSON.stringify(report);
  } catch (error) {
    throw new DistributionAuditStoreError('INVALID_REPORT_SCHEMA', `report를 JSON으로 만들 수 없습니다: ${error.message}`);
  }
  if (Buffer.byteLength(serialized, 'utf8') > MAX_REPORT_BYTES) {
    throw new DistributionAuditStoreError('REPORT_TOO_LARGE', '자동 비교 report는 2MiB 이하여야 합니다.', 413);
  }
  return { report: JSON.parse(serialized), serialized };
}

function validateAuditId(value) {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw new DistributionAuditStoreError('INVALID_AUDIT_ID', '감사 snapshot ID 형식이 올바르지 않습니다.');
  }
  return value;
}

function targetPath(storageRoot, id) {
  const resolved = path.resolve(storageRoot, `${validateAuditId(id)}.json`);
  if (path.dirname(resolved) !== storageRoot) {
    throw new DistributionAuditStoreError('INVALID_AUDIT_ID', '감사 snapshot 경로가 올바르지 않습니다.');
  }
  return resolved;
}

function validateStoredRecord(record) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record) || record.schemaVersion !== 1) {
      throw new Error('schemaVersion');
    }
    validateAuditId(record.id);
    validateScope(record);
    validateUserId(record.userId);
    if (
      typeof record.createdAt !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(record.createdAt)
      || Number.isNaN(Date.parse(record.createdAt))
    ) {
      throw new Error('createdAt');
    }
    normalizeReport(record.report);
    if (record.advisoryOnly !== true || record.erpAction !== 'NONE') {
      throw new Error('safety markers');
    }
    return record;
  } catch (error) {
    throw new DistributionAuditStoreError(
      'AUDIT_STORAGE_CORRUPT',
      `저장된 감사 snapshot schema가 올바르지 않습니다: ${error.message}`,
      500,
    );
  }
}

function publicAudit(record) {
  return {
    id: record.id,
    year: record.year,
    week: record.week,
    userId: record.userId,
    createdAt: record.createdAt,
    advisoryOnly: true,
    erpAction: 'NONE',
    report: record.report,
  };
}

function listItem(record) {
  return {
    id: record.id,
    year: record.year,
    week: record.week,
    userId: record.userId,
    createdAt: record.createdAt,
    advisoryOnly: true,
    erpAction: 'NONE',
    counts: Object.fromEntries(REQUIRED_REPORT_ARRAYS.map(field => [field, record.report[field].length])),
  };
}

function createDistributionAuditStore({ root = DEFAULT_ROOT, now = () => new Date(), randomUUID = () => crypto.randomUUID() } = {}) {
  const storageRoot = path.resolve(root);

  async function readAudit(filePath) {
    try {
      const stat = await fs.promises.lstat(filePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new DistributionAuditStoreError('AUDIT_STORAGE_CORRUPT', '감사 snapshot이 일반 파일이 아닙니다.', 500);
      }
      return validateStoredRecord(JSON.parse(await fs.promises.readFile(filePath, 'utf8')));
    } catch (error) {
      if (error instanceof DistributionAuditStoreError) throw error;
      if (error.code === 'ENOENT') {
        throw new DistributionAuditStoreError('AUDIT_NOT_FOUND', '감사 snapshot을 찾을 수 없습니다.', 404);
      }
      throw new DistributionAuditStoreError('AUDIT_STORAGE_CORRUPT', `감사 snapshot을 읽을 수 없습니다: ${error.message}`, 500);
    }
  }

  async function saveAudit({ year, week, userId, report } = {}) {
    const scope = validateScope({ year, week });
    const createdBy = validateUserId(userId);
    const normalized = normalizeReport(report);
    const date = now();
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
      throw new DistributionAuditStoreError('INVALID_SERVER_TIME', '서버 시간을 생성할 수 없습니다.', 500);
    }
    await fs.promises.mkdir(storageRoot, { recursive: true, mode: 0o700 });

    for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt += 1) {
      const id = validateAuditId(randomUUID());
      const record = {
        schemaVersion: 1,
        id,
        year: scope.year,
        week: scope.week,
        userId: createdBy,
        createdAt: date.toISOString(),
        advisoryOnly: true,
        erpAction: 'NONE',
        report: normalized.report,
      };
      const finalPath = targetPath(storageRoot, id);
      const temporaryPath = path.join(storageRoot, `.${id}.${crypto.randomUUID()}.tmp`);
      try {
        await fs.promises.writeFile(temporaryPath, JSON.stringify(record), {
          encoding: 'utf8', flag: 'wx', mode: 0o600,
        });
        await fs.promises.link(temporaryPath, finalPath);
        return publicAudit(record);
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      } finally {
        await fs.promises.unlink(temporaryPath).catch(() => {});
      }
    }
    throw new DistributionAuditStoreError('AUDIT_ID_COLLISION', '고유한 감사 snapshot ID를 만들 수 없습니다.', 409);
  }

  async function listAudits({ year, week } = {}) {
    const scope = validateScope({ year, week });
    let names;
    try {
      names = await fs.promises.readdir(storageRoot);
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const records = await Promise.all(names
      .filter(name => UUID_RE.test(name.slice(0, -5)) && name.endsWith('.json'))
      .map(name => readAudit(targetPath(storageRoot, name.slice(0, -5)))));
    return records
      .filter(record => record.year === scope.year && record.week === scope.week)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(0, MAX_LIST_ITEMS)
      .map(listItem);
  }

  async function getAudit({ year, week, id } = {}) {
    const scope = validateScope({ year, week });
    const record = await readAudit(targetPath(storageRoot, id));
    if (record.year !== scope.year || record.week !== scope.week) {
      throw new DistributionAuditStoreError('AUDIT_NOT_FOUND', '요청한 연도·차수의 감사 snapshot을 찾을 수 없습니다.', 404);
    }
    return publicAudit(record);
  }

  return { root: storageRoot, saveAudit, listAudits, getAudit };
}

const defaultStore = createDistributionAuditStore();

function storeFor(options) {
  return options && Object.keys(options).length ? createDistributionAuditStore(options) : defaultStore;
}

module.exports = {
  MAX_REPORT_BYTES,
  MAX_LIST_ITEMS,
  DistributionAuditStoreError,
  createDistributionAuditStore,
  saveAudit: (input, options) => storeFor(options).saveAudit(input),
  listAudits: (input, options) => storeFor(options).listAudits(input),
  getAudit: (input, options) => storeFor(options).getAudit(input),
};
