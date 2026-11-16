// 연습 자료로 만든 아침 브리핑 응답. 실제 변환 경로(lib/morningBriefing.js → desktop/morning-briefing.cjs)를 그대로 탄다.
const { projectBriefing } = require('../../desktop/morning-briefing.cjs');
const ok = data => ({ ok: true, data });
async function practiceBriefing(owner) {
  const { buildBriefing, todayKst } = await import('../../lib/morningBriefing.js');
  const today = todayKst(), day = offset => new Date(Date.now() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);
  const built = buildBriefing({
    orderRequests: ok({ requests: [{ CustName: '연습꽃집 가', OrderWeek: '46-01', itemCount: 3, RequesterName: '연습 직원' }, { CustName: '연습꽃집 나', OrderWeek: '46-01', itemCount: 1, RequesterName: '연습 직원' }] }),
    approvals: ok({ rows: [] }),
    incoming: ok({ rows: [{ week: '46-01', farm: '연습농장 A', awb: '000-00000001', eta: day(-1), stage: '선적', late: true }, { week: '46-01', farm: '연습농장 B', awb: '000-00000002', eta: today, stage: '통관중', late: false }, { week: '46-02', farm: '연습농장 C', eta: day(5), stage: '발주', late: false }] }),
    week: ok({ year: 2026, week: '46-01', kpi: { totalSales: 12500000, totalWithVat: 13750000, custCount: 18, orderCount: 37, lowStockCount: 0, unfixedCount: 4 } }),
    receivables: ok({ asOf: today, source: '연습 자료', totals: { total: 8200000, d0_30: 6000000, d31_60: 1400000, d61_90: 800000, d90p: 0 }, rows: [] }),
    creditLimit: ok({ rows: [{ signboard: '연습꽃집 가', limitKRW: 5000000, balance: 1200000, pct: 24, status: 'ok' }] }),
  }, { today, isAdmin: true });
  return { success: true, ownerId: owner, ...projectBriefing({ success: true, ownerId: owner, generatedAt: new Date().toISOString(), ...built }) };
}
module.exports = { practiceBriefing };
