// GET /api/ecount/week-compare?year=2026&week=35 — ECOUNT 판매현황(스크랩) vs 전산 매출(확정 출고 + 차감·판매요청 견적)을
//   차수 단위·거래처×품목 라인 단위로 대조. 읽기 전용(ERP 테이블 SELECT만).
//   비교 규칙은 사장님 대사 스크립트(ecount-vs-estimate/_work/gap.js)의 거래처 별칭표·품목 정규화·차감유형 처리와 동일.
import { query, sql } from '../../../lib/db';
import { withAuth } from '../../../lib/auth';

// ── 정규화 (gap.js n()/np() 그대로) ─────────────────────────────────────────────
const n = (s) => String(s || '').toLowerCase().replace(/[\s()\[\]（）\/.,·\-_]/g, '');
// 품목: 괄호 안 제거 후 정규화. 차감 유형명(CodeInfo EstimateType Descr)과 같으면 유형명 전체를 키로 사용(유형 단위 묶음).
const makeNp = (typeNameSet) => (s) => {
  const full = n(s);
  if (typeNameSet.has(full)) return full;
  return n(String(s || '').replace(/\([^)]*\)|（[^）]*）|\[[^\]]*\]/g, ''));
};

// ── 거래처 별칭(gap.js alias 그대로). 이카운트·전산 양쪽에 적용 ───────────────────
const alias = {
  '아이엠（미우）': '아이엠', '아이엠 (I am)': '아이엠', '인터넷공판장 (영남가빈)': '인터넷공판장 (원협가빈)',
  '동산(꽃동산)': '동산', '(주)꽃동산': '동산', '대전 꽃부리영': '대전 봄날', '대전 봄날(대전 꽃부리영)': '대전 봄날',
  '신라호텔 발주용 코드': '신라호텔', '날마다, 꽃（매일）': '날마다, 꽃', '탑플라워（청목）': '탑플라워',
  '구백의 천사': '레바논 꽃방', '화사랑': '수아레', '청목소재': '탑플라워', '농업회사법인 주식회사 로뎀': '로뎀농원',
  '경남꽃도매': '경남꽃도매(영남4호)', '경향': '경향농원', '주식회사 에이스화훼무역': '에이스플라워',
};
const custAlias = (x) => alias[String(x || '').trim()] || String(x || '').trim();

// ── 차수 → 이카운트 매출일(화요일). 2026 = 01-06 + 7×(w−1). 다른 연도 = 그 해 첫 화요일 기준 ──
const pad2 = (v) => String(v).padStart(2, '0');
function saleDateOfWeek(year, week) {
  let d;
  if (year === 2026) d = new Date(Date.UTC(2026, 0, 6, 12));
  else {
    d = new Date(Date.UTC(year, 0, 1, 12));
    while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1); // 첫 화요일
  }
  d.setUTCDate(d.getUTCDate() + 7 * (week - 1));
  return `${d.getUTCFullYear()}/${pad2(d.getUTCMonth() + 1)}/${pad2(d.getUTCDate())}`; // '2026/09/01'
}

// DB datetime(UTC 저장) → 한국시간 'YYYY-MM-DD HH:mm'
const kst = (v) => (v ? new Date(new Date(v).getTime() + 9 * 3600e3).toISOString().slice(0, 16).replace('T', ' ') : '');
// Estimate.EstimateDtm 은 날짜값(자정) → 'YYYY-MM-DD'
const dateOnly = (v) => (v ? new Date(v).toISOString().slice(0, 10) : '');

export default withAuth(async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const year = Number(req.query.year || 2026);
  const week = Number(req.query.week);
  if (!Number.isInteger(year) || !Number.isInteger(week) || week < 1 || week > 53) {
    return res.status(400).json({ success: false, error: 'year, week(1~53) 필요' });
  }
  const yearWeek = `${year}${pad2(week)}`;
  const saleDate = saleDateOfWeek(year, week); // '2026/09/01'
  const saleDateIso = saleDate.replace(/\//g, '-');
  const cutoff = new Date(`${saleDateIso}T23:59:59+09:00`); // 업로드 기준시각: 매출일 23:59 KST

  try {
    // ── 차감 유형명 (CodeInfo)
    const etRes = await query(`SELECT DetailCode, Descr FROM CodeInfo WHERE Category='EstimateType'`);
    const ET = {}; for (const r of etRes.recordset) ET[r.DetailCode] = r.Descr;
    const ETN = new Set(Object.values(ET).map(n));
    const np = makeNp(ETN);

    // ── ECOUNT: 매출일을 포함한 가장 최신 스냅샷 하나
    const snapRes = await query(
      `SELECT TOP 1 r.SnapshotKey, s.TakenAt
         FROM WebEcountRow r JOIN WebEcountSnapshot s ON s.SnapshotKey = r.SnapshotKey
        WHERE r.Dataset='sales' AND LEFT(r.RefDate,10) = @d
        ORDER BY r.SnapshotKey DESC`,
      { d: { type: sql.NVarChar, value: saleDate } });
    const snap = snapRes.recordset[0] || null;
    let ecRows = [];
    if (snap) {
      const r = await query(
        `SELECT RowKey, CustName, ProdName, Payload FROM WebEcountRow
          WHERE SnapshotKey = @sk AND Dataset='sales' AND ISNULL(IsSubtotal,0)=0 AND LEFT(RefDate,10) = @d
          ORDER BY RowKey`,
        { sk: { type: sql.Int, value: snap.SnapshotKey }, d: { type: sql.NVarChar, value: saleDate } });
      ecRows = r.recordset;
    }

    // ── 전산: 확정 출고 라인 (Customer/Product 는 삭제 코드 포함 LEFT JOIN)
    const sdRes = await query(
      `SELECT sd.SdetailKey, sm.ShipmentKey, sm.CustKey, c.CustName, ISNULL(c.isDeleted,0) custDel,
              sd.ProdKey, p.ProdName, ISNULL(p.isDeleted,0) prodDel,
              sd.EstQuantity qty, sd.Amount amt, sd.ShipmentDtm
         FROM ShipmentDetail sd
         JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
         LEFT JOIN Customer c ON c.CustKey = sm.CustKey
         LEFT JOIN Product p ON p.ProdKey = sd.ProdKey
        WHERE sm.OrderYearWeek = @yw AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.isFix,0)=1 AND sd.Amount <> 0
        ORDER BY sd.SdetailKey`,
      { yw: { type: sql.NVarChar, value: yearWeek } });

    // ── 전산: 차감·판매요청 견적 라인
    const estRes = await query(
      `SELECT e.EstimateKey, e.EstimateType, e.Quantity qty, e.Amount amt, e.EstimateDtm, e.Descr,
              sm.ShipmentKey, sm.CustKey, c.CustName, p.ProdName
         FROM Estimate e
         JOIN ShipmentMaster sm ON sm.ShipmentKey = e.ShipmentKey
         LEFT JOIN Customer c ON c.CustKey = sm.CustKey
         LEFT JOIN Product p ON p.ProdKey = e.ProdKey
        WHERE sm.OrderYearWeek = @yw AND ISNULL(sm.isDeleted,0)=0
        ORDER BY e.EstimateKey`,
      { yw: { type: sql.NVarChar, value: yearWeek } });

    // ── 전산 수정 이력 (해당 차수 출고 라인의 ShipmentHistory)
    const histRes = await query(
      `SELECT h.ShipHistoryKey, h.SdetailKey, h.ChangeDtm, h.ChangeID, h.ChangeType, h.ShipmentDtm, h.BeforeValue, h.AfterValue, h.Descr
         FROM ShipmentHistory h
         JOIN ShipmentDetail sd ON sd.SdetailKey = h.SdetailKey
         JOIN ShipmentMaster sm ON sm.ShipmentKey = sd.ShipmentKey
        WHERE sm.OrderYearWeek = @yw AND ISNULL(sm.isDeleted,0)=0
        ORDER BY h.ChangeDtm`,
      { yw: { type: sql.NVarChar, value: yearWeek } });
    const HM = {};
    for (const h of histRes.recordset) (HM[h.SdetailKey] = HM[h.SdetailKey] || []).push(h);

    // ── 라인 구성: 거래처(별칭→정규화) × 품목(np)
    const custs = new Map(); // key → { name, lines: Map(prodKey → line) }
    const ensureCust = (rawName) => {
      const display = custAlias(rawName) || '(거래처 없음)';
      const k = n(display) || '_none';
      if (!custs.has(k)) custs.set(k, { key: k, name: display, lines: new Map() });
      return custs.get(k);
    };
    const ensureLine = (cust, rawProd, isType) => {
      const display = String(rawProd || '').trim() || '(품명 없음)';
      const k = (isType ? n(display) : np(display)) || '_none';
      if (!cust.lines.has(k)) {
        cust.lines.set(k, {
          key: k, name: display, isType: !!isType || ETN.has(n(display)),
          ecQty: 0, ecAmt: 0, erpQty: 0, erpAmt: 0, ecLines: [], erpLines: [], lateChanges: [],
        });
      }
      return cust.lines.get(k);
    };

    for (const r of ecRows) {
      let o; try { o = JSON.parse(r.Payload); } catch { continue; }
      const cust = ensureCust(r.CustName || o.custName);
      const line = ensureLine(cust, r.ProdName || o.prodName, false);
      const qty = Number(o.qty || 0), amt = Number(o.supplyAmt || 0);
      line.ecQty += qty; line.ecAmt += amt;
      line.ecLines.push({ rowKey: r.RowKey, prod: r.ProdName || o.prodName, qty, unitPrice: Number(o.unitPrice || 0), supplyAmt: amt, memo: o.memo || '' });
    }
    for (const r of sdRes.recordset) {
      const cust = ensureCust(r.CustName);
      const line = ensureLine(cust, r.ProdName, false);
      const qty = Number(r.qty || 0), amt = Number(r.amt || 0);
      line.erpQty += qty; line.erpAmt += amt;
      const late = (HM[r.SdetailKey] || []).filter((h) => new Date(h.ChangeDtm) > cutoff).map((h) => ({
        sdetailKey: r.SdetailKey, at: kst(h.ChangeDtm), changeId: h.ChangeID, changeType: h.ChangeType,
        shipDate: dateOnly(h.ShipmentDtm), before: h.BeforeValue, after: h.AfterValue, descr: h.Descr || '',
      }));
      line.lateChanges.push(...late);
      line.erpLines.push({
        kind: 'sd', sdetailKey: r.SdetailKey, shipmentKey: r.ShipmentKey, prod: r.ProdName, qty, amt,
        shipDate: dateOnly(r.ShipmentDtm), custDel: !!r.custDel, prodDel: !!r.prodDel, lateCount: late.length,
      });
    }
    for (const r of estRes.recordset) {
      const cust = ensureCust(r.CustName);
      const typeName = ET[r.EstimateType] || r.EstimateType || '(유형 없음)';
      const line = ensureLine(cust, typeName, true);
      const qty = Number(r.qty || 0), amt = Number(r.amt || 0);
      line.erpQty += qty; line.erpAmt += amt;
      const estDate = dateOnly(r.EstimateDtm);
      const lateEst = estDate && estDate > saleDateIso; // 매출일(업로드일) 이후 등록 견적 = 업로드 후 변경
      if (lateEst) {
        line.lateChanges.push({
          estimateKey: r.EstimateKey, at: estDate, changeId: '', changeType: '견적 등록', before: null, after: amt,
          descr: `${typeName}${r.ProdName ? ' ' + r.ProdName : ''}${r.Descr ? ' "' + r.Descr + '"' : ''}`,
        });
      }
      line.erpLines.push({
        kind: 'est', estimateKey: r.EstimateKey, shipmentKey: r.ShipmentKey, prod: typeName, refProd: r.ProdName || '',
        qty, amt, estDate, descr: r.Descr || '', lateCount: lateEst ? 1 : 0,
      });
    }

    // ── 유형 판정 & 집계
    const R = (v) => Math.round(Number(v || 0));
    const classify = (l) => {
      const hasEc = l.ecLines.length > 0, hasErp = l.erpLines.length > 0;
      if (hasEc && !hasErp) return '이카운트에만';
      if (!hasEc && hasErp) return '전산에만';
      if (Math.abs(l.ecAmt - l.erpAmt) < 1) return '일치';
      if (Math.abs(l.ecQty - l.erpQty) >= 0.01) return '수량 차이';
      return '단가 차이(수량 동일)';
    };
    let ecTotal = 0, erpTotal = 0, diffLines = 0, lateLines = 0, totalLines = 0;
    const byCust = [...custs.values()].map((c) => {
      const lines = [...c.lines.values()].map((l) => {
        const type = classify(l);
        const diff = R(l.ecAmt - l.erpAmt);
        const lateChanged = l.lateChanges.length > 0;          // 업로드 후 전산 변경 이력 있음
        const needUpload = lateChanged && Math.abs(diff) >= 1;   // 변경 뒤 이카운트와 아직 다름 → 반영 필요
        totalLines++;
        if (Math.abs(diff) >= 1) diffLines++;
        if (needUpload) lateLines++;
        return {
          key: l.key, name: l.name, isType: l.isType, type,
          ecQty: l.ecQty, ecAmt: R(l.ecAmt), erpQty: l.erpQty, erpAmt: R(l.erpAmt),
          qtyDiff: Math.round((l.ecQty - l.erpQty) * 100) / 100, diff, needUpload, lateChanged,
          lateChanges: l.lateChanges, ecLines: l.ecLines, erpLines: l.erpLines,
        };
      }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name));
      const ec = R(lines.reduce((a, l) => a + l.ecAmt, 0)), erp = R(lines.reduce((a, l) => a + l.erpAmt, 0));
      ecTotal += ec; erpTotal += erp;
      return {
        key: c.key, name: c.name, ec, erp, diff: ec - erp,
        diffLines: lines.filter((l) => Math.abs(l.diff) >= 1).length,
        needUpload: lines.some((l) => l.needUpload),
        lines,
      };
    }).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff) || a.name.localeCompare(b.name));

    return res.status(200).json({
      success: true,
      year, week, yearWeek, saleDate,
      noEcount: !snap,
      snapshotKey: snap ? snap.SnapshotKey : null,
      takenAt: snap ? kst(snap.TakenAt) : null,
      cutoff: `${saleDateIso} 23:59 KST`,
      summary: {
        ecTotal, erpTotal, diff: ecTotal - erpTotal, diffLines, lateLines, totalLines,
        custCount: byCust.length, ecRowCount: ecRows.length, sdCount: sdRes.recordset.length, estCount: estRes.recordset.length,
      },
      byCust,
    });
  } catch (e) {
    console.error('[ecount/week-compare]', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});
