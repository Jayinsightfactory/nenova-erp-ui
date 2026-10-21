import assert from 'node:assert/strict';
import {
  classifyKind, normSystemActionLog, normShipmentHistory, normPriceChange, normCreditLimit, normApprovalAudit,
  mergeEvents, filterEvents, defaultRange, toCsv, CSV_HEADER,
} from '../lib/mgmt/auditViewCore.js';

// kind 분류
assert.equal(classifyKind('Cost'), '단가');
assert.equal(classifyKind('OutQuantity'), '수량');
assert.equal(classifyKind('isFix'), '확정');
assert.equal(classifyKind('Descr'), null);

// SystemActionLog: 조회(GET) 제외, 매핑 불가 제외
assert.equal(normSystemActionLog({ Method: 'GET', ActionType: 'PRICE_UPDATE' }), null);
assert.equal(normSystemActionLog({ Method: 'POST', ActionType: 'LOGIN' }), null);
const s = normSystemActionLog({ Method: 'POST', ActionType: 'PRICE_UPDATE', ActionDtm: '2026-10-20 10:00:00', Actor: 'u1', AffectedTable: 'Product', Payload: '{"before":100,"after":120,"week":"42-1"}' });
assert.equal(s.kind, '단가'); assert.equal(s.before, '100'); assert.equal(s.after, '120'); assert.equal(s.week, '42-1');
assert.equal(normSystemActionLog({ Method: 'POST', ActionType: 'FIX_WEEK', Payload: '{깨짐' }).kind, '확정'); // 깨진 payload 도 죽지 않음

// ShipmentHistory
const h = normShipmentHistory({ ChangeDtm: '2026-10-20 09:00:00', ChangeID: 'a', ColumName: 'OutQuantity', BeforeValue: '5', AfterValue: '7', OrderWeek: '42-01', CustName: '꽃집', ProdName: '장미' });
assert.equal(h.kind, '수량'); assert.equal(h.week, '42-01'); assert.match(h.target, /꽃집 \/ 장미/);
assert.equal(normShipmentHistory({ ColumName: 'Descr' }), null);

// web_mgmt 원천
assert.equal(normPriceChange({ CreatedAt: '2026-10-20T01:00:00', ProdKey: 3, BeforeValue: 1, AfterValue: 2, CustKey: null }).target, '기본단가 / 품목 #3');
const c = normCreditLimit({ CreatedAt: '2026-10-19T01:00:00', CustName: 'A', LimitKRW: 500, PrevLimit: 300 });
assert.deepEqual([c.kind, c.before, c.after], ['한도', '300', '500']);
assert.equal(normCreditLimit({ CustKey: 1, LimitKRW: 5 }).before, '');
const a = normApprovalAudit({ CreatedAt: '2026-10-18T01:00:00', RequestId: 7, TargetKind: 'remittance', FromStatus: 'requested', ToStatus: 'approved', ActorId: 'x' });
assert.deepEqual([a.kind, a.before, a.after], ['승인', 'requested', 'approved']);

// 병합 정렬(최신 먼저) + 필터
const all = mergeEvents([[s, null], [h], [normPriceChange({ CreatedAt: '2026-10-21T01:00:00', CustName: '꽃집', ProdName: '장미', BeforeValue: 1, AfterValue: 2 })], [c, a]]);
assert.equal(all.length, 5);
assert.ok(all[0].at >= all[1].at);
assert.equal(filterEvents(all, { kind: '단가' }).every((e) => e.kind === '단가'), true);
assert.equal(filterEvents(all, { kind: '단가,수량' }).length, 3);
assert.equal(filterEvents(all, { week: '42-01' }).length, 1);
assert.equal(filterEvents(all, { cust: '꽃집' }).length, 2);
assert.equal(filterEvents(all, { from: '2026-10-21', to: '2026-10-21' }).length, 1);
assert.equal(filterEvents(all, { from: '2026-10-22' }).length, 0);

// 기본 7일
assert.deepEqual(defaultRange(7, new Date(2026, 9, 21)), { from: '2026-10-14', to: '2026-10-21' });

// CSV: BOM, 헤더, 따옴표 이스케이프, 수식 주입 방지
const csv = toCsv([{ at: 't', source: 'x', kind: '단가', target: 'a,"b"', before: '=1+1', after: '2', actor: 'u' }]);
assert.ok(csv.startsWith('﻿'));
assert.ok(csv.includes(CSV_HEADER.join(',')));
assert.ok(csv.includes('"a,""b"""'));
assert.ok(csv.includes("'=1+1"));
// 사람별 집계·평가 API 없음
import * as core from '../lib/mgmt/auditViewCore.js';
assert.equal(Object.keys(core).some((k) => /byActor|perUser|score|rank/i.test(k)), false);
console.log('mgmt audit view tests passed');
