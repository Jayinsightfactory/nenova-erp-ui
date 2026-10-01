// 자동 주문 실행기 안전장치 단위 테스트 (DB/HTTP 는 가짜 주입)
const assert = require('node:assert/strict');

const sql = { Int: 'Int', NVarChar: 'NVarChar' };

function fakeWorld({ lockedTimes = 0 } = {}) {
  const orders = new Map(); // `${ck}|${year}|${wk}|${pk}` -> qty (요청 단위 열 하나로 단순화)
  const ledger = new Map();
  const posts = [];
  let locked = lockedTimes;
  const p = (params, k) => params[k]?.value;
  const query = async (text, params = {}) => {
    if (/FROM Customer/.test(text)) return { recordset: Number(p(params, 'ck')) > 0 ? [{ CustKey: p(params, 'ck') }] : [] };
    if (/FROM ShipmentMaster/.test(text)) return { recordset: [{ N: 0 }] };
    if (/FROM OrderMaster om/.test(text)) {
      const q = orders.get(`${p(params, 'ck')}|${p(params, 'year')}|${p(params, 'wk')}|${p(params, 'pk')}`) || 0;
      return { recordset: [{ Qty: q, OutQty: q, Rows: q > 0 ? 1 : 0 }] };
    }
    if (/INSERT INTO WebOrderExecLedger/.test(text)) {
      const rid = p(params, 'rid');
      if (ledger.has(rid)) return { recordsets: [[{ Claimed: 0 }]] };
      ledger.set(rid, { RequestId: rid, Kind: p(params, 'kind'), CustKey: p(params, 'ck'), OrderYear: p(params, 'year'), OrderWeek: p(params, 'wk'), Status: 'RUNNING', PlanJson: p(params, 'plan') });
      return { recordsets: [[{ Claimed: 1 }]] };
    }
    if (/UPDATE WebOrderExecLedger/.test(text)) {
      Object.assign(ledger.get(p(params, 'rid')), { Status: p(params, 'st'), ResultJson: p(params, 'res'), ErrorText: p(params, 'err') });
      return { recordset: [] };
    }
    if (/FROM WebOrderExecLedger/.test(text)) return { recordset: ledger.has(p(params, 'rid')) ? [ledger.get(p(params, 'rid'))] : [] };
    throw new Error('unexpected sql ' + text.slice(0, 60));
  };
  const postOrder = async (body) => {
    posts.push(body);
    if (locked > 0) { locked -= 1; return { status: 409, body: { success: false, code: 'ERP_EDIT_LOCKED' } }; }
    for (const it of body.items) {
      const k = `${body.custKey}|${body.year}|${body.week}|${it.prodKey}`;
      orders.set(k, Math.max(0, (orders.get(k) || 0) + it.qty)); // 실제 API 처럼 가산
    }
    return { status: 201, body: { success: true, orderMasterKey: 6828 } };
  };
  const deps = { query, sql, postOrder, sleep: async () => {}, allowedScope: { custKey: 1, year: '2026' } };
  return { deps, orders, ledger, posts };
}

(async () => {
  const ex = await import('../lib/orderExecutor.js');
  const base = { custKey: 1, year: '2026', week: '41-01', mode: 'live', items: [{ prodKey: 10, qty: 3, unit: '단' }] };

  // ④ delta 만 전송 + ⑤ 대조 + ⑦ 원장
  let w = fakeWorld();
  w.orders.set('1|2026|41-01|10', 1);
  let r = await ex.executePlan(w.deps, { ...base, requestId: 'req-a' });
  assert.equal(r.status, 'DONE');
  assert.deepEqual(w.posts[0].items, [{ prodKey: 10, qty: 2, unit: '단' }], '현재 1 → 목표 3 이면 +2 만 보내야 함');
  assert.equal(w.orders.get('1|2026|41-01|10'), 3);
  assert.equal(w.ledger.get('req-a').Status, 'DONE');

  // ② 같은 requestId → skip, 수량 불변
  r = await ex.executePlan(w.deps, { ...base, requestId: 'req-a' });
  assert.equal(r.status, 'SKIPPED_DUPLICATE');
  assert.equal(w.posts.length, 1);
  assert.equal(w.orders.get('1|2026|41-01|10'), 3);

  // 목표 = 현재 → delta 0, POST 없음
  r = await ex.executePlan(w.deps, { ...base, requestId: 'req-b' });
  assert.equal(r.status, 'NOOP');
  assert.equal(w.posts.length, 1);

  // cancelPlan = 정확한 음수 delta (적용분 +2 만 되돌림 → 1)
  r = await ex.cancelPlan(w.deps, 'req-a');
  assert.equal(r.status, 'DONE');
  assert.deepEqual(w.posts[1].items, [{ prodKey: 10, qty: -2, unit: '단' }]);
  assert.equal(w.orders.get('1|2026|41-01|10'), 1);
  r = await ex.cancelPlan(w.deps, 'req-a');
  assert.equal(r.status, 'SKIPPED_DUPLICATE', '취소도 멱등');

  // ① 범위 위반 → DB 접근 전 거부
  for (const bad of [{ custKey: 2 }, { year: '2025' }]) {
    w = fakeWorld();
    await assert.rejects(ex.executePlan(w.deps, { ...base, ...bad, requestId: 'req-x' }), { code: 'ERP_SCOPE_MISMATCH' });
    assert.equal(w.posts.length, 0); assert.equal(w.ledger.size, 0);
  }
  await assert.rejects(ex.executePlan({ ...fakeWorld().deps, allowedScope: null }, { ...base, requestId: 'req-y' }), { code: 'ERP_SCOPE_MISMATCH' });

  // dry → 쓰기 없음
  w = fakeWorld();
  r = await ex.executePlan(w.deps, { ...base, mode: 'dry', requestId: 'req-d' });
  assert.equal(r.status, 'DRY_RUN'); assert.equal(r.plan[0].deltaQty, 3);
  assert.equal(w.posts.length, 0); assert.equal(w.ledger.size, 0);

  // ⑥ 409 두 번 → 재시도 후 성공, 가산 없음
  w = fakeWorld({ lockedTimes: 2 });
  r = await ex.executePlan(w.deps, { ...base, requestId: 'req-l' });
  assert.equal(r.status, 'DONE'); assert.equal(r.attempts, 3); assert.equal(w.orders.get('1|2026|41-01|10'), 3);
  // 409 네 번 → 3회 재시도 후 실패, 원장 FAILED
  w = fakeWorld({ lockedTimes: 9 });
  await assert.rejects(ex.executePlan(w.deps, { ...base, requestId: 'req-f' }), { code: 'ERP_EDIT_LOCKED' });
  assert.equal(w.posts.length, 4); assert.equal(w.ledger.get('req-f').Status, 'FAILED');

  // 입력 검증
  assert.throws(() => ex.validateExecRequest({ ...base, requestId: 'req-1', week: '41' }, { custKey: 1, year: '2026' }), { code: 'ORDER_WEEK_INVALID' });
  assert.throws(() => ex.validateExecRequest({ ...base, requestId: 'req-1', items: [{ prodKey: 1, qty: -1 }] }, { custKey: 1, year: '2026' }), { code: 'ITEM_INVALID' });

  // 소스 계약: 분배/출고 쓰기 금지
  const src = require('node:fs').readFileSync('lib/orderExecutor.js', 'utf8');
  assert.doesNotMatch(src, /(INSERT INTO|UPDATE|DELETE FROM)\s+(Shipment|OrderDetail|OrderMaster|ProductStock)/i);
  assert.doesNotMatch(src, /\/api\/(shipment|distribute)/i);
  console.log('orderExecutor ok');
})().catch((e) => { console.error(e); process.exit(1); });
