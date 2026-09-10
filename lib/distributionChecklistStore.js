const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_DIRECTORY = path.join(process.cwd(), 'data', 'distribution-board', 'baselines', 'checklist-events');
const MAX_SOURCE_IDENTITY_LENGTH = 512;
const MAX_MEMO_LENGTH = 1000;
const STATUSES = new Set(['PENDING', 'REVIEWED', 'NOT_NEEDED', 'LATER']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ChecklistStoreError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'ChecklistStoreError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

function validateScope({ year, week }) {
  const normalizedYear = text(year);
  const normalizedWeek = text(week);
  if (!/^20\d{2}$/.test(normalizedYear)) throw new ChecklistStoreError('INVALID_YEAR', '연도는 20xx 형식으로 입력해 주세요.');
  if (!/^(0[1-9]|[1-4]\d|5[0-3])-(01|02)$/.test(normalizedWeek)) {
    throw new ChecklistStoreError('INVALID_WEEK', '전체 차수는 WW-SS 형식으로 입력해 주세요.');
  }
  return { year: normalizedYear, week: normalizedWeek };
}

function validateSourceIdentity(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_IDENTITY_LENGTH || /[\u0000-\u001f\u007f]/.test(value) || /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(value)) {
    throw new ChecklistStoreError('INVALID_SOURCE_IDENTITY', '검토 대상 식별자가 올바르지 않습니다.');
  }
  return value;
}

function validateMemo(value) {
  if (typeof value !== 'string' || value.length > MAX_MEMO_LENGTH) {
    throw new ChecklistStoreError('INVALID_MEMO', '메모는 1,000자 이하로 입력해 주세요.');
  }
  return value;
}

function validateStatus(value) {
  if (!STATUSES.has(value)) throw new ChecklistStoreError('INVALID_STATUS', '검토 상태를 다시 선택해 주세요.');
  return value;
}

function authorFor(user) {
  const userId = text(user?.userId ?? user?.UserID);
  if (!userId) throw new ChecklistStoreError('MISSING_USER', '로그인한 사용자가 필요합니다.', 401);
  return { userId, userName: text(user?.userName ?? user?.UserName) || null };
}

function publicReview(record) {
  return {
    eventId: record.eventId,
    sourceIdentity: record.sourceIdentity,
    status: record.status,
    memo: record.memo,
    createdAt: record.createdAt,
    author: record.author,
    advisoryOnly: true,
    erpAction: 'NONE',
  };
}

function sameEvent(record, incoming) {
  return record.year === incoming.year
    && record.week === incoming.week
    && record.requestId === incoming.requestId
    && record.sourceIdentity === incoming.sourceIdentity
    && record.status === incoming.status
    && record.memo === incoming.memo
    && record.author?.userId === incoming.author.userId;
}

function createDistributionChecklistStore({ directory = DEFAULT_DIRECTORY, now = () => new Date() } = {}) {
  const storageDirectory = path.resolve(directory);
  let lastTimestamp = 0;

  function serverTimestamp() {
    const candidate = now().getTime();
    const timestamp = Math.max(candidate, lastTimestamp + 1);
    lastTimestamp = timestamp;
    return new Date(timestamp).toISOString();
  }

  async function readEvent(filePath) {
    let record;
    try {
      record = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new ChecklistStoreError('REVIEW_NOT_FOUND', '검토 기록을 찾을 수 없습니다.', 404);
      throw new ChecklistStoreError('CHECKLIST_STORAGE_CORRUPT', `검토 기록을 읽을 수 없습니다: ${error.message}`, 500);
    }
    if (!record || typeof record !== 'object' || !/^[a-f0-9]{64}$/.test(record.eventId || '')) {
      throw new ChecklistStoreError('CHECKLIST_STORAGE_CORRUPT', '저장된 검토 기록 형식이 올바르지 않습니다.', 500);
    }
    return record;
  }

  async function listReviews({ year, week }) {
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
      .map(name => readEvent(path.join(storageDirectory, name))));
    const latestBySource = new Map();
    for (const record of records) {
      if (record.year !== scope.year || record.week !== scope.week) continue;
      const existing = latestBySource.get(record.sourceIdentity);
      if (!existing || record.createdAt > existing.createdAt || (record.createdAt === existing.createdAt && record.eventId > existing.eventId)) {
        latestBySource.set(record.sourceIdentity, record);
      }
    }
    return [...latestBySource.values()]
      .sort((left, right) => left.sourceIdentity.localeCompare(right.sourceIdentity))
      .map(publicReview);
  }

  async function recordReview(input, user) {
    const { year, week } = validateScope(input || {});
    const sourceIdentity = validateSourceIdentity(input?.sourceIdentity);
    const status = validateStatus(input?.status);
    const memo = validateMemo(input?.memo);
    const requestId = text(input?.requestId);
    if (!UUID_RE.test(requestId)) throw new ChecklistStoreError('INVALID_REQUEST_ID', '요청 식별자 형식이 올바르지 않습니다.');
    const author = authorFor(user);
    const eventId = sha256(`${year}\n${week}\n${author.userId}\n${requestId}`);
    const record = {
      schemaVersion: 1,
      eventId,
      year,
      week,
      sourceIdentity,
      status,
      memo,
      requestId,
      createdAt: serverTimestamp(),
      author,
      advisoryOnly: true,
      erpAction: 'NONE',
    };
    const target = path.join(storageDirectory, `${eventId}.json`);
    await fs.promises.mkdir(storageDirectory, { recursive: true });
    const temporary = path.join(storageDirectory, `.${eventId}.${crypto.randomUUID()}.tmp`);
    try {
      await fs.promises.writeFile(temporary, JSON.stringify(record), { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      await fs.promises.link(temporary, target);
      return publicReview(record);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = await readEvent(target);
      if (sameEvent(existing, record)) return publicReview(existing);
      throw new ChecklistStoreError('REQUEST_ID_CONFLICT', '같은 요청 식별자로 다른 검토 기록을 저장할 수 없습니다.', 409);
    } finally {
      await fs.promises.unlink(temporary).catch(() => {});
    }
  }

  return { directory: storageDirectory, listReviews, recordReview };
}

const defaultStore = createDistributionChecklistStore();

module.exports = {
  MAX_SOURCE_IDENTITY_LENGTH,
  MAX_MEMO_LENGTH,
  STATUSES,
  ChecklistStoreError,
  createDistributionChecklistStore,
  listReviews: defaultStore.listReviews,
  recordReview: defaultStore.recordReview,
};
