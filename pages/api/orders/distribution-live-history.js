import { getPool, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';
import { loadMappings } from '../../../lib/parseMappings';
import { loadCustomerMappings } from '../../../lib/customerMappings';
import { normalizeScope, parseMessages, pairRequests, loadLiveHistoryFacts } from '../../../lib/distributionLiveHistory';

export const config = { api: { bodyParser: { sizeLimit: '64kb' } } };
const MAX_MESSAGES = 50;
const MAX_MESSAGE_CHARS = 50000;
const FACT_CACHE_TTL_MS = 30000;
const FACT_CACHE_MAX = 24;
const factsByScope = new Map();

function sameOrigin(req) {
  const origin = req.headers?.origin;
  const host = String(req.headers?.['x-forwarded-host'] || req.headers?.host || '').split(',')[0].trim();
  try {
    const parsed = new URL(origin);
    return Boolean(host) && (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.host === host;
  } catch { return false; }
}

function validMessage(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    && typeof value.identity === 'string' && value.identity.trim().length > 0 && value.identity.length <= 256
    && typeof value.message === 'string' && value.message.trim().length > 0
    && (value.created_at === undefined || value.created_at === null || typeof value.created_at === 'string')
    && (value.timestamp_approximate === undefined || typeof value.timestamp_approximate === 'boolean');
}

function requestMessages(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || !Array.isArray(body.messages) || body.messages.length > MAX_MESSAGES || !body.messages.every(validMessage)) {
    throw new TypeError('messages는 최대 50개의 유효한 JSON 메시지여야 합니다.');
  }
  const characters = body.messages.reduce((sum, message) => sum + message.message.length, 0);
  if (characters > MAX_MESSAGE_CHARS || JSON.stringify(body).length > 60000) throw new TypeError('메시지 전체는 최대 50,000자여야 합니다.');
  return body.messages;
}

function aliases() {
  try { return { products: loadMappings(), customers: loadCustomerMappings() }; }
  catch { return { products: {}, customers: {} }; }
}

async function queryLiveHistory(statement, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  request.timeout = 8000;
  for (const [name, { type, value }] of Object.entries(params)) request.input(name, type, value);
  return request.query(statement);
}

function scopeKey(scope) {
  return `${scope.year}|${scope.weeks.join(',')}|${scope.from}|${scope.to}`;
}

function trimFactCache() {
  while (factsByScope.size >= FACT_CACHE_MAX) {
    const oldestResolved = [...factsByScope.entries()].find(([, entry]) => entry.resolvedAt !== null);
    if (!oldestResolved) return false;
    factsByScope.delete(oldestResolved[0]);
  }
  return true;
}

function loadScopedFacts(scope) {
  const cacheKey = scopeKey(scope);
  const now = Date.now();
  const cached = factsByScope.get(cacheKey);
  if (cached && (cached.resolvedAt === null || now - cached.resolvedAt < FACT_CACHE_TTL_MS)) return cached.promise;
  if (!cached && !trimFactCache()) return Promise.reject(new Error('facts cache capacity is occupied by active reads'));
  const entry = { resolvedAt: null, promise: null };
  entry.promise = loadLiveHistoryFacts(queryLiveHistory, sql, scope)
    .then(facts => {
      entry.resolvedAt = Date.now();
      return { facts, asOf: new Date(entry.resolvedAt).toISOString() };
    })
    .catch(error => {
      if (factsByScope.get(cacheKey) === entry) factsByScope.delete(cacheKey);
      throw error;
    });
  factsByScope.set(cacheKey, entry);
  return entry.promise;
}

export default withAuth(async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'POST 요청만 가능합니다.' });
  if (req.user?.accountActive !== true) return res.status(403).json({ success: false, error: '활성 계정만 조회할 수 있습니다.' });
  if (!sameOrigin(req)) return res.status(403).json({ success: false, error: '같은 출처의 요청만 허용됩니다.' });
  let scope;
  let messages;
  try { scope = normalizeScope(req.body || {}); messages = requestMessages(req.body); }
  catch (error) { return res.status(400).json({ success: false, advisoryOnly: true, error: error.message }); }
  let facts;
  let asOf;
  try { ({ facts, asOf } = await loadScopedFacts(scope)); }
  catch { return res.status(503).json({ success: false, advisoryOnly: true, erpAction: 'NONE', error: 'ERP 읽기 자료를 불러오지 못했습니다.' }); }
  const items = pairRequests(parseMessages(messages, facts, aliases(), scope), facts, scope);
  const warnings = [
    '자동 대조는 참고용이며 ERP 변경·적용·완료를 수행하거나 뜻하지 않습니다.',
    '원본 삭제 또는 확정 시점 때문에 이력이 없을 수 있으며, 대응 이력 부재는 미처리 증거가 아닙니다.',
    ...(facts.queryTruncated ? ['주문 또는 분배 이력 조회가 1,000건 제한에 도달했습니다. 강한 이력 증거 판정을 하지 않았습니다.'] : []),
    ...(items.some(item => item.requests.some(request => !request.sourceAt || request.timestamp_approximate)) ? ['원문 시각이 없거나 근사값인 항목은 날짜만으로 이력 연결하지 않았습니다.'] : []),
    ...(items.some(item => item.requests.some(request => request.shipmentEvents.some(event => event.multiDate))) ? ['여러 출고일이 연결된 분배 이력은 원래 전후수량을 보존하고 자동 연결하지 않았습니다.'] : []),
  ];
  return res.json({ success: true, advisoryOnly: true, erpAction: 'NONE', scope, asOf, items, warnings });
});
