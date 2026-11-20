import path from 'node:path';
import { randomUUID } from 'node:crypto';
import phase03 from './customsPhase03.cjs';
import plan from './customsSettlementPlan.cjs';
import store from './customsSettlementStore.cjs';
import { loadSettlementContext } from './customsSettlementContext.js';

export function phase03View(context, ledger) {
  const evidence = phase03.phase03Rows(ledger);
  const rows = context.candidates.filter(c => c.orderWeek === `${context.major}-03` && /^country\|[^|]+\|03$/.test(c.targetKey || '')).map(c => {
    const row = { year: context.year, orderWeek: c.orderWeek, awb: c.awb, category: c.targetKey.split('|')[1] };
    const source = evidence.find(e => phase03.identity(e) === phase03.identity(row));
    const legacy = phase03.legacyPhase(row);
    return { ...row, matchId: c.matchId, headerKeys: c.headerKeys, costs: source?.costs || {}, sources: source?.sources || {},
      conflicts: source?.conflicts || [], legacyPhase: legacy, total: source?.total ?? null,
      notice: legacy ? '기존 1차 반영 대조 대상입니다. 03차에 다시 저장·합산하지 않습니다.' : '',
      documentCount: source?.documents.length || 0 };
  });
  return { rows, digest: plan.hash({ context, ledger }), revision: ledger.revision };
}

export async function savePhase03({ year, major, input, expectedDigest, confirmed, actor, root = store.ROOT, loadContext = loadSettlementContext }) {
  const scope = plan.scopeOf(year, major);
  if (confirmed !== true || !/^[a-f0-9]{64}$/.test(expectedDigest || '')) throw Object.assign(Error('03차 저장 대상과 금액을 확인하세요.'), { statusCode: 400 });
  const entry = phase03.validateEntry({ year: scope.year, orderWeek: input?.orderWeek, awb: input?.awb, category: input?.category, costs: input?.costs }, scope.year, scope.major);
  if (phase03.legacyPhase(entry)) throw Object.assign(Error('기존 1차 반영 대상입니다. 중복 저장하지 않습니다.'), { statusCode: 409 });
  return store.withStoreLock(root, async () => {
    const [ledger, context] = await Promise.all([store.readLedger(root, scope.year, scope.major), loadContext(scope.year, scope.major)]);
    const view = phase03View(context, ledger);
    if (view.digest !== expectedDigest) throw Object.assign(Error('입고·기존 입력·ZIP 연결이 바뀌었습니다. 다시 조회하세요.'), { statusCode: 409 });
    const targets = view.rows.filter(row => phase03.identity(row) === phase03.identity(entry));
    if (targets.length !== 1) throw Object.assign(Error('선택 연도·차수의 유일한 AWB 입고를 확인하지 못했습니다.'), { statusCode: 422 });
    const current = targets[0];
    // ZIP-backed fields are not silently replaced by an ordinary form save.
    for (const field of phase03.FIELDS) if (current.sources[field] === 'settlement' && entry.costs[field] !== current.costs[field]) throw Object.assign(Error('ZIP 원문이 있는 항목은 이 입력창에서 덮어쓰지 않습니다.'), { statusCode: 409 });
    const costs = { ...entry.costs };
    for (const field of phase03.FIELDS) if (current.sources[field] === 'settlement') delete costs[field];
    const manual = { ...entry, costs, updatedAt: new Date().toISOString(), actorHash: plan.hash(String(actor)) };
    const records = (ledger.manualPhase03 || []).filter(row => phase03.identity(row) !== phase03.identity(entry));
    records.push(manual);
    const { contentDigest, ...body } = ledger;
    const next = { ...body, revision: ledger.revision + 1, manualPhase03: records,
      history: [...ledger.history, { id: randomUUID(), at: manual.updatedAt, actorHash: manual.actorHash, action: 'SAVE_PHASE03', identity: phase03.identity(entry), before: (ledger.manualPhase03 || []).find(row => phase03.identity(row) === phase03.identity(entry)) || null, after: manual }] };
    next.contentDigest = plan.hash(next);
    store.validateLedger(next, scope.year, scope.major);
    await store.writeAtomic(path.join(root, `${scope.year}-${scope.major}.json`), next);
    const readback = await store.readLedger(root, scope.year, scope.major);
    if (plan.hash(readback) !== plan.hash(next)) throw Object.assign(Error('저장 결과 확인이 필요합니다. 자동 재시도하지 마세요.'), { statusCode: 503 });
    return { success: true, revision: readback.revision, erpWrites: 0, reportWrites: 0, phase03: phase03View(context, readback) };
  });
}
