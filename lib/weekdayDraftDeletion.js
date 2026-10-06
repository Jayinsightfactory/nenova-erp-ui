import { validateWeekdayStoredInputs, weekdayInputStorageKey } from './weekdayDraftStorage.js';

const sameCell = (a, b) => a.year === b.year && a.orderWeek === b.orderWeek && a.custKey === b.custKey
  && a.prodKey === b.prodKey && a.date === b.date && a.unit === b.unit;
const fingerprint = value => JSON.stringify(value);
const fail = () => { throw new Error('입력이 변경되었거나 삭제 범위를 확인할 수 없습니다. 현재 입력을 유지합니다.'); };

// Both memory and saved inputs are returned; unsaved edits are never implicitly published.
export function prepareWeekdayDraftDeletion({ userId, scope, current, storedScope, expectedDrafts, all = false }) {
  if (!Array.isArray(expectedDrafts) || !storedScope || !current) fail();
  weekdayInputStorageKey(userId);
  const scopeMatch = /^(\d+)\|(\d{4})\|(\d{2})$/.exec(scope || '');
  if (!scopeMatch || expectedDrafts.some(plan => !plan || plan.draftScope !== scope
    || plan.custKey !== Number(scopeMatch[1]) || typeof plan.id !== 'string' || !plan.id)) fail();
  // Invalid upload inputs can be removed by their exact original fingerprint.
  // Persisted entries still use the complete storage contract.
  validateWeekdayStoredInputs({ version: 1, userId, savedAt: new Date().toISOString(), ...storedScope }, userId);
  const active = current.plans.filter(plan => plan.draftScope === scope);
  if (all && fingerprint(active) !== fingerprint(expectedDrafts)) fail();
  for (const expected of expectedDrafts) {
    const matches = active.filter(plan => plan.id === expected.id);
    if (matches.length !== 1 || fingerprint(matches[0]) !== fingerprint(expected)) fail();
  }
  const removed = plan => plan.draftScope === scope && expectedDrafts.some(expected =>
    expected.id === plan.id && sameCell(expected, plan));
  const linked = record => record.scopeKey === scope && expectedDrafts.some(expected => sameCell(expected, record));
  const removedStored = plan => plan.draftScope === scope && expectedDrafts.some(expected => expected.id === plan.id);
  const storedRemoved = storedScope.plans.filter(removedStored);
  const linkedStored = record => linked(record) || record.scopeKey === scope && storedRemoved.some(plan => sameCell(plan, record));
  return { removed: expectedDrafts,
    current: { plans: current.plans.filter(plan => !removed(plan)), wilsonDrafts: current.wilsonDrafts.filter(record => all ? record.scopeKey !== scope : !linkedStored(record)) },
    storedScope: all ? { plans: [], wilsonDrafts: [] } : { plans: storedScope.plans.filter(plan => !removedStored(plan)), wilsonDrafts: storedScope.wilsonDrafts.filter(record => !linkedStored(record)) } };
}

export function weekdayCellDrafts(plans, scope, payload) {
  if (!Array.isArray(payload?.expectedDrafts)) fail();
  const actual = plans.filter(plan => plan.draftScope === scope && sameCell(plan, payload));
  if (fingerprint(actual) !== fingerprint(payload.expectedDrafts)) fail();
  return actual;
}
