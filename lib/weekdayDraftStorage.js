// Browser-only planning storage. It contains no ERP snapshots or save authority.
const PREFIX = 'nenova-weekday-input-v1:';
const MAX_BYTES = 2 * 1024 * 1024;
const PLAN_FIELDS = ['id','draftScope','custKey','prodKey','year','orderWeek','date','quantity','unit',
  'prodName','sourceLabel','sheet','sourceCell','sourceRow','raw','header','sourceYear','sourceOrderWeek','wdetailKey','moveEventId'];
const WILSON_FIELDS = ['year','majorWeek','orderWeek','custKey','prodKey','date','unit','wilsonQuantity','expectedTotal','expectedRevision','scopeKey'];
const positive = value => Number.isSafeInteger(value) && value > 0 && value <= 2147483647;
// Input preservation is independent of the ERP apply endpoint's three-digit policy.
const inputQuantity = value => (typeof value === 'number' || typeof value === 'string'
  && /^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim()))
  && Number.isFinite(Number(value)) && Number(value) >= 0;
const text = value => typeof value === 'string' && value.length <= 4000 && !value.includes('\0');
const fail = () => { throw new Error('보관된 입력을 검증할 수 없습니다. 현재 입력과 기존 보관 기록을 유지합니다.'); };

export function weekdayInputStorageKey(userId) {
  if (!text(userId) || !userId.trim() || userId.trim() !== userId || userId.length > 200) fail();
  return PREFIX + encodeURIComponent(userId);
}

function scopeParts(scope) {
  const match = typeof scope === 'string' && /^(\d+)\|(\d{4})\|(\d{2})$/.exec(scope);
  if (!match || !positive(Number(match[1])) || Number(match[2]) < 2000 || Number(match[2]) > 2200
    || Number(match[3]) < 1 || Number(match[3]) > 53) fail();
  return { custKey: Number(match[1]), year: Number(match[2]) };
}

function identity(record, scope) {
  const center = scopeParts(scope);
  if (!positive(record.custKey) || record.custKey !== center.custKey || !positive(record.prodKey)
    || !Number.isInteger(record.year) || record.year < 2000 || record.year > 2200 || Math.abs(record.year - center.year) > 1
    || !/^\d{2}-\d{2}$/.test(record.orderWeek ?? '') || Number(record.orderWeek.slice(3)) < 1 || Number(record.orderWeek.slice(0, 2)) < 1
    || Number(record.orderWeek.slice(0, 2)) > 53 || !['박스','단','송이'].includes(record.unit)
    || !/^\d{4}-\d{2}-\d{2}$/.test(record.date ?? '') || !Number.isFinite(Date.parse(`${record.date}T00:00:00Z`))
    || new Date(`${record.date}T00:00:00Z`).toISOString().slice(0, 10) !== record.date) fail();
}

export function validateWeekdayStoredInputs(value, userId) {
  if (!value || Object.keys(value).sort().join('|') !== 'plans|savedAt|userId|version|wilsonDrafts' || value.version !== 1
    || value.userId !== userId || !text(value.savedAt) || !Number.isFinite(Date.parse(value.savedAt))
    || !Array.isArray(value.plans) || !Array.isArray(value.wilsonDrafts) || value.plans.length + value.wilsonDrafts.length > 5000) fail();
  const ids = new Set();
  for (const plan of value.plans) {
    if (!plan || Object.keys(plan).some(key => !PLAN_FIELDS.includes(key)) || !text(plan.id) || !plan.id || !inputQuantity(plan.quantity)) fail();
    identity(plan, plan.draftScope);
    const key = `${plan.draftScope}|${plan.id}`;
    if (ids.has(key)) fail(); ids.add(key);
    for (const key of ['prodName','sourceLabel','sheet','sourceCell','header','moveEventId']) if (plan[key] !== undefined && !text(plan[key])) fail();
    if (plan.raw != null && !text(plan.raw) && !(typeof plan.raw === 'number' && Number.isFinite(plan.raw))) fail();
    for (const key of ['sourceRow','wdetailKey']) if (plan[key] != null && !positive(plan[key])) fail();
    if (plan.sourceYear != null && (!Number.isInteger(plan.sourceYear) || plan.sourceYear < 2000 || plan.sourceYear > 2200)) fail();
    if (plan.sourceOrderWeek != null && !/^\d{2}-\d{2}$/.test(plan.sourceOrderWeek)) fail();
  }
  const splits = new Set();
  for (const record of value.wilsonDrafts) {
    if (!record || Object.keys(record).some(key => !WILSON_FIELDS.includes(key)) || !inputQuantity(record.wilsonQuantity)
      || !inputQuantity(record.expectedTotal) || Number(record.wilsonQuantity) > Number(record.expectedTotal)
      || !Number.isSafeInteger(record.expectedRevision) || record.expectedRevision < 0) fail();
    identity(record, record.scopeKey);
    if (record.majorWeek !== record.orderWeek.slice(0, 2) || !['01','02'].includes(record.orderWeek.slice(3))) fail();
    const key = `${record.scopeKey}|${record.year}|${record.orderWeek}|${record.custKey}|${record.prodKey}|${record.date}`;
    if (splits.has(key)) fail(); splits.add(key);
    const plan = value.plans.find(plan => plan.draftScope === record.scopeKey && plan.year === record.year
      && plan.orderWeek === record.orderWeek && plan.custKey === record.custKey && plan.prodKey === record.prodKey && plan.date === record.date);
    if (!plan || plan.unit !== record.unit || Number(plan.quantity) !== Number(record.expectedTotal)) fail();
  }
  return value;
}

export function readWeekdayStoredInputs(storage, userId) {
  const raw = storage.getItem(weekdayInputStorageKey(userId));
  if (raw === null) return { version: 1, userId, savedAt: new Date().toISOString(), plans: [], wilsonDrafts: [] };
  if (typeof raw !== 'string' || raw.length > MAX_BYTES) fail();
  let parsed; try { parsed = JSON.parse(raw); } catch { fail(); }
  return validateWeekdayStoredInputs(parsed, userId);
}

function publish(storage, userId, value) {
  validateWeekdayStoredInputs(value, userId);
  const serialized = JSON.stringify(value);
  if (serialized.length > MAX_BYTES) fail();
  storage.setItem(weekdayInputStorageKey(userId), serialized);
  return value;
}

export function saveWeekdayScopedInputs(storage, userId, scope, plans, wilsonDrafts, expectedScope) {
  scopeParts(scope);
  const current = readWeekdayStoredInputs(storage, userId);
  if (expectedScope !== undefined) {
    if (!expectedScope || Object.keys(expectedScope).sort().join('|') !== 'plans|wilsonDrafts'
      || !Array.isArray(expectedScope.plans) || !Array.isArray(expectedScope.wilsonDrafts)
      || expectedScope.plans.some(plan => plan.draftScope !== scope)
      || expectedScope.wilsonDrafts.some(record => record.scopeKey !== scope)) fail();
    validateWeekdayStoredInputs({ version: 1, userId, savedAt: current.savedAt, ...expectedScope }, userId);
    const currentScope = { plans: current.plans.filter(plan => plan.draftScope === scope),
      wilsonDrafts: current.wilsonDrafts.filter(record => record.scopeKey === scope) };
    if (JSON.stringify(currentScope) !== JSON.stringify(expectedScope)) {
      throw new Error('다른 창에서 이 범위의 보관 입력이 변경되었습니다. 현재 입력과 최신 보관 기록을 유지하며 덮어쓰기를 차단했습니다.');
    }
  }
  return publish(storage, userId, { ...current, savedAt: new Date().toISOString(),
    plans: [...current.plans.filter(plan => plan.draftScope !== scope), ...plans.filter(plan => plan.draftScope === scope)],
    wilsonDrafts: [...current.wilsonDrafts.filter(record => record.scopeKey !== scope), ...wilsonDrafts.filter(record => record.scopeKey === scope)] });
}

export function mergeWeekdayStoredInputs(current, saved, pending) {
  if (pending && (!saved.userId || pending.inputUser !== saved.userId)) {
    throw new Error('이전 ERP 저장 작업의 로그인 사용자를 확인할 수 없습니다. 복구 기록은 유지하며 입력 병합을 차단합니다.');
  }
  const plans = [...saved.plans, ...current.plans, ...(pending?.drafts || [])];
  const wilsonDrafts = [...saved.wilsonDrafts, ...current.wilsonDrafts, ...(pending?.wilson || [])];
  const merge = (items, key) => [...new Map(items.map(item => [key(item), item])).values()];
  return { plans: merge(plans, plan => `${plan.draftScope}|${plan.id}`),
    wilsonDrafts: merge(wilsonDrafts, record => `${record.scopeKey}|${record.year}|${record.orderWeek}|${record.custKey}|${record.prodKey}|${record.date}`) };
}

export function clearWeekdayStoredSubmission(storage, userId, submission) {
  const current = readWeekdayStoredInputs(storage, userId);
  const submitted = new Set(submission.submitted || []);
  const plans = current.plans.filter(plan => !submitted.has(JSON.stringify(plan)));
  const wilsonDrafts = current.wilsonDrafts.filter(record => plans.some(plan => plan.draftScope === record.scopeKey
    && plan.year === record.year && plan.orderWeek === record.orderWeek && plan.custKey === record.custKey && plan.prodKey === record.prodKey
    && plan.date === record.date && Number(plan.quantity) === Number(record.expectedTotal)));
  return publish(storage, userId, { ...current, savedAt: new Date().toISOString(), plans, wilsonDrafts });
}
