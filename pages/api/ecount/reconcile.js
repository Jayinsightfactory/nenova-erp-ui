// GET /api/ecount/reconcile?month=2026-06 — 웹 순매출 vs ECOUNT 판매현황 자동 대사.
//   웹은 확정일(=ECOUNT 전표일자) 기준 순매출(정상출고 + 차감), ECOUNT는 스크랩된 판매 스냅샷.
//   거래처·품목별로 대조해 차이 큰 항목을 뽑아준다(월 마감 대사 자동화).
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// 거래처/품목명 정규화 — 공백·괄호안·특수문자 제거 후 대문자(양쪽 표기 차이 흡수)
const norm = (s) => String(s || '')
  .replace(/[（(][^)）]*[)）]/g, '')   // 괄호(반각/전각) 안 제거
  .replace(/\s+/g, '')
  .toUpperCase()
  .replace(/[^A-Z0-9가-힣]/g, '');

// 확정일 = 출고일 on-or-after 다음 화요일 (ECOUNT 전표일자 기준). DATEFIRST 무관.
const confirmExpr = (col) => `DATEADD(DAY, (7 - (DATEDIFF(DAY, '19000102', ${col}) % 7)) % 7, CONVERT(DATE, ${col}))`;

// 품목명 → 차이 분류. "설명되는 차이"인지 자동 판정(1.4% 잔차를 오차 아닌 것으로 인식하게).
//   import  = 수입품(호접란 등) 전표 타이밍 — ECOUNT가 출고차수 아닌 결제/정산일에 계상
//   special = ECOUNT 특수입력/조정(판매요청·운송료·단가차감 등) — 웹 출고에 없는 ECOUNT 전용 항목
//   else    = 미설명(진짜 확인 필요) → 0에 가까워야 "실질 일치"
const CAT = {
  import:  /호접란|ORCHID|수입|IMPORT/i,
  special: /판매요청|운송료|운송|단가\s*차감|택배|배송|기타|할인|봉사료|조정/i,
};
const classify = (name) => (CAT.import.test(name || '') ? 'import' : CAT.special.test(name || '') ? 'special' : 'other');
const CAT_LABEL = { import: '수입품 전표 타이밍', special: 'ECOUNT 특수입력·조정', other: '미설명(확인 필요)' };

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const month = String(req.query.month || '').trim(); // 'YYYY-MM'
  const m = month.match(/^(\d{4})-(\d{2})$/);
  if (!m) return res.status(400).json({ success: false, error: 'month=YYYY-MM 필요' });
  const from = `${m[1]}-${m[2]}-01`;
  // 월말: 다음달 1일 미만
  const nextMonth = m[2] === '12' ? `${Number(m[1]) + 1}-01-01` : `${m[1]}-${String(Number(m[2]) + 1).padStart(2, '0')}-01`;
  const ecPfx = `${m[1]}/${m[2]}%`; // ECOUNT RefDate 형식 '2026/06/02 -1'

  try {
    // ── ECOUNT 스냅샷 (지정 또는 최신 sales)
    const snapKey = req.query.snapshotKey
      ? Number(req.query.snapshotKey)
      : (await query(`SELECT TOP 1 SnapshotKey FROM WebEcountSnapshot WHERE Dataset='sales' ORDER BY SnapshotKey DESC`)).recordset[0]?.SnapshotKey;
    if (!snapKey) return res.status(200).json({ success: true, month, noEcount: true, byCust: [], summary: {} });

    const params = { from: { type: sql.Date, value: from }, to: { type: sql.Date, value: nextMonth } };

    // ── 웹: 정상출고(SD) by 거래처+품목 (확정일 기준)
    const sdRes = await query(
      `SELECT c.CustName cust, p.ProdName prod, SUM(ISNULL(sd.Amount,0)) supply
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sm.ShipmentKey = sd.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
         JOIN Product p ON sd.ProdKey = p.ProdKey AND p.isDeleted = 0
        WHERE sm.isDeleted = 0 AND ISNULL(sd.isFix,0) = 1
          AND ${confirmExpr('sd.ShipmentDtm')} >= @from AND ${confirmExpr('sd.ShipmentDtm')} < @to
        GROUP BY c.CustName, p.ProdName`, params);

    // ── 웹: 차감(EST) by 거래처+품목 (관련 마스터 대표 출고일 기준)
    const estRes = await query(
      `SELECT c.CustName cust, ISNULL(p.ProdName, ISNULL(NULLIF(e.Descr,''), e.EstimateType)) prod, SUM(ISNULL(e.Amount,0)) supply
         FROM ShipmentMaster sm
         JOIN Estimate e ON e.ShipmentKey = sm.ShipmentKey
         JOIN Customer c ON sm.CustKey = c.CustKey AND c.isDeleted = 0
         LEFT JOIN Product p ON e.ProdKey = p.ProdKey
         CROSS APPLY (SELECT MIN(sd2.ShipmentDtm) AS d FROM ShipmentDetail sd2 WHERE sd2.ShipmentKey = sm.ShipmentKey) md
        WHERE sm.isDeleted = 0
          AND ${confirmExpr('md.d')} >= @from AND ${confirmExpr('md.d')} < @to
        GROUP BY c.CustName, ISNULL(p.ProdName, ISNULL(NULLIF(e.Descr,''), e.EstimateType))`, params);

    // ── ECOUNT: 스냅샷 행에서 해당 월 (Payload.supplyAmt)
    const ecRes = await query(
      `SELECT CustName, Payload FROM WebEcountRow
        WHERE SnapshotKey = @sk AND ISNULL(IsSubtotal,0) = 0 AND RefDate LIKE @pfx`,
      { sk: { type: sql.Int, value: snapKey }, pfx: { type: sql.NVarChar, value: ecPfx } });

    // ── 거래처별 집계 맵 구성
    // cust: { name, web, ecount, items: Map(prodKey → {name, web, ecount}) }
    const custs = new Map();
    const ensureCust = (displayName) => {
      const k = norm(displayName);
      if (!custs.has(k)) custs.set(k, { name: displayName, web: 0, ecount: 0, items: new Map() });
      return custs.get(k);
    };
    const ensureItem = (cust, displayName) => {
      const k = norm(displayName);
      if (!cust.items.has(k)) cust.items.set(k, { name: displayName, web: 0, ecount: 0 });
      return cust.items.get(k);
    };

    for (const r of sdRes.recordset) {
      const g = ensureCust(r.cust); g.web += Number(r.supply || 0);
      ensureItem(g, r.prod).web += Number(r.supply || 0);
    }
    for (const r of estRes.recordset) {
      const g = ensureCust(r.cust); g.web += Number(r.supply || 0);
      ensureItem(g, r.prod).web += Number(r.supply || 0);
    }
    for (const r of ecRes.recordset) {
      let o; try { o = JSON.parse(r.Payload); } catch { continue; }
      const g = ensureCust(r.CustName || o.custName || ''); const s = Number(o.supplyAmt || 0);
      g.ecount += s;
      ensureItem(g, o.prodName || '').ecount += s;
    }

    const round = (v) => Math.round(Number(v || 0));
    const byCust = [...custs.values()].map((c) => {
      const items = [...c.items.values()]
        .map((it) => ({ name: it.name, web: round(it.web), ecount: round(it.ecount), diff: round(it.ecount - it.web) }))
        .filter((it) => Math.abs(it.diff) >= 1)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      return { name: c.name, web: round(c.web), ecount: round(c.ecount), diff: round(c.ecount - c.web), items };
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    const webTotal = byCust.reduce((a, c) => a + c.web, 0);
    const ecTotal = byCust.reduce((a, c) => a + c.ecount, 0);

    // ── 차이 자동 분류: 총차이 = 수입타이밍 + 특수입력 + 미설명.
    //   기여도는 거래처 단위 순액으로 집계 → 같은 거래처 내 상쇄(불량차감↔품목 등)가 정리돼 미설명이 깨끗해진다.
    const buckets = { import: 0, special: 0, other: 0 };
    const contrib = { import: new Map(), special: new Map(), other: new Map() };
    for (const c of byCust) {
      for (const it of c.items) {
        const cat = classify(it.name);
        buckets[cat] += it.diff;
        contrib[cat].set(c.name, (contrib[cat].get(c.name) || 0) + it.diff);
      }
    }
    const breakdown = ['import', 'special', 'other'].map((k) => ({
      key: k, label: CAT_LABEL[k], amount: Math.round(buckets[k]),
      top: [...contrib[k].entries()]
        .map(([cust, diff]) => ({ cust, diff: Math.round(diff) }))
        .filter((x) => Math.abs(x.diff) >= 1000)
        .sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)).slice(0, 5),
    }));
    const unexplained = Math.round(buckets.other);
    const explained = Math.round(buckets.import + buckets.special);
    const reconciled = Math.abs(unexplained) < Math.max(50000, Math.abs(webTotal) * 0.001); // 미설명<0.1% → 실질 일치

    return res.status(200).json({
      success: true, month, snapshotKey: snapKey,
      summary: {
        web: webTotal, ecount: ecTotal, diff: ecTotal - webTotal,
        explained, unexplained, reconciled,
        matchedCustCount: byCust.filter((c) => Math.abs(c.diff) < 1000).length,
        diffCustCount: byCust.filter((c) => Math.abs(c.diff) >= 1000).length,
      },
      breakdown,
      byCust,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});
