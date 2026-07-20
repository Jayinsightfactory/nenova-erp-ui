// pages/api/shipment/estimate-visibility.js — 견적서관리 노출 여부 진단 (읽기 전용)
//
//  실제 전산 뷰(ViewShipment / ViewOrder)를 직접 조회해, 확정 출고 품목이 견적서관리에 뜨는 조건을 검사한다.
//  dnSpy(FormEstimateView.GetDetail): 견적 상세는
//     ViewShipment vs  JOIN  ViewOrder vo (같은 주차/업체/품목)  JOIN ShipmentDate JOIN PeriodDay(출고일)
//  → ViewShipment 엔 있어도 ViewOrder 에 없으면(분배만 있고 주문 라인 없음/주문이 뷰에서 탈락) 견적에서 사라진다.
//
//  GET ?week=23-01&q=호접난
import { withAuth } from '../../../lib/auth';
import { query, sql } from '../../../lib/db';
import { normalizeOrderWeek, resolveActiveOrderYear } from '../../../lib/orderUtils';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const q = String(req.query.q || '').trim();
  // week 또는 weeks(콤마) 지원 — 여러 차수 비교
  const rawWeeks = String(req.query.weeks || req.query.week || '').split(',').map(w => normalizeOrderWeek(w.trim())).filter(Boolean);
  const year = resolveActiveOrderYear(rawWeeks[0], req.query.year || '');
  if (rawWeeks.length === 0) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!q) return res.status(400).json({ success: false, error: '검색어 필요' });
  const wkParams = {};
  rawWeeks.forEach((w, i) => { wkParams[`w${i}`] = { type: sql.NVarChar, value: w }; });
  const wkIn = rawWeeks.map((_, i) => `@w${i}`).join(',');

  try {
    const r = await query(
      `SELECT TOP 400
              c.CustName, p.ProdName, p.CounName, p.FlowerName,
              sm.CustKey, sd.ProdKey, sm.OrderWeek,
              ISNULL(sm.isFix,0) AS SmFix, sd.OutQuantity, sd.EstQuantity, sd.SdetailKey,
              CONVERT(NVARCHAR(10), sd.ShipmentDtm, 120) AS ShipDtm,
              -- 실제 전산 뷰에 존재하는지 (해당 업체+품목+주차)
              (SELECT COUNT(*) FROM ViewShipment vs WHERE vs.OrderYear=sm.OrderYear AND vs.CustKey=sm.CustKey AND vs.ProdKey=sd.ProdKey AND vs.OrderWeek=sm.OrderWeek) AS InViewShipment,
              (SELECT COUNT(*) FROM ViewOrder   vo WHERE vo.OrderYear=sm.OrderYear AND vo.CustKey=sm.CustKey AND vo.ProdKey=sd.ProdKey AND vo.OrderWeek=sm.OrderWeek) AS InViewOrder,
              -- 주문 라인 원본 존재(뷰 필터 무시) → '주문 자체 없음' vs '주문은 있는데 뷰에서 탈락' 구분
              (SELECT COUNT(*) FROM OrderMaster om JOIN OrderDetail od ON od.OrderMasterKey=om.OrderMasterKey
                 WHERE om.OrderYear=sm.OrderYear AND om.CustKey=sm.CustKey AND om.OrderWeek=sm.OrderWeek AND od.ProdKey=sd.ProdKey
                   AND ISNULL(om.isDeleted,0)=0 AND ISNULL(od.isDeleted,0)=0) AS OrderDetailRaw,
              (SELECT COUNT(*) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateCnt,
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON pd.BaseYmd=sdt.ShipmentDtm WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodExactCnt,
              (SELECT COUNT(*) FROM ShipmentDate sdt JOIN PeriodDay pd ON CONVERT(date,pd.BaseYmd)=CONVERT(date,sdt.ShipmentDtm) WHERE sdt.SdetailKey=sd.SdetailKey) AS PeriodDateCnt,
              (SELECT TOP 1 CONVERT(NVARCHAR(30), sdt.ShipmentDtm, 121) FROM ShipmentDate sdt WHERE sdt.SdetailKey=sd.SdetailKey) AS ShipDateRaw,
              ISNULL(sm.WebCreated,0) AS WebCreated, sm.OrderYearWeek AS SmYW, sm.OrderYear AS SmYear,
              (SELECT TOP 1 vs.OrderYearWeek2 FROM ViewShipment vs WHERE vs.OrderYear=sm.OrderYear AND vs.SdetailKey=sd.SdetailKey) AS VS_YW2,
              -- 실제 GetDetail 조인(ViewShipment⨝ViewOrder⨝ShipmentDate⨝PeriodDay)을 이 SdetailKey 로 그대로 재현
              (SELECT COUNT(*)
                 FROM ViewShipment vs
                 JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
                 JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
                 JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
                WHERE vs.SdetailKey = sd.SdetailKey) AS InGetDetail,
              (SELECT COUNT(*)
                 FROM ViewShipment vs
                 JOIN ViewOrder vo ON vs.OrderYearWeek2 = vo.OrderYearWeek2
                  AND vs.CustKey = vo.CustKey
                  AND vs.ProdKey = vo.ProdKey
                 JOIN ShipmentDate sdd ON sdd.SdetailKey = vs.SdetailKey
                 JOIN PeriodDay pd ON sdd.ShipmentDtm = pd.BaseYmd
                WHERE vs.SdetailKey = sd.SdetailKey) AS InGetDetailByCustProd,
              -- 전산 구조 위반: 같은 출고+거래처+품목에 ShipmentDetail 이 2건 이상(웹 splitDateDetails 잔재)
              (SELECT COUNT(*)
                 FROM ShipmentDetail z
                WHERE z.ShipmentKey = sm.ShipmentKey
                  AND z.CustKey = sm.CustKey
                  AND z.ProdKey = sd.ProdKey) AS DetailSplitCnt
         FROM ShipmentMaster sm
         JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
         JOIN Product p ON p.ProdKey=sd.ProdKey
         JOIN Customer c ON c.CustKey=sm.CustKey
        WHERE sm.OrderYear=@yr AND sm.OrderWeek IN (${wkIn}) AND ISNULL(sm.isDeleted,0)=0 AND ISNULL(sd.OutQuantity,0)<>0
          AND ( p.ProdName LIKE @q OR ISNULL(p.CounName,'') LIKE @q
                OR ISNULL(p.FlowerName,'') LIKE @q OR c.CustName LIKE @q )
        ORDER BY p.ProdName, sm.OrderWeek, c.CustName`,
      { ...wkParams, yr: { type: sql.NVarChar, value: year }, q: { type: sql.NVarChar, value: `%${q}%` } }
    );

    const rows = (r.recordset || []).map(x => {
      const inVS = Number(x.InViewShipment) > 0;
      const inVO = Number(x.InViewOrder) > 0;
      const ordRaw = Number(x.OrderDetailRaw) > 0;
      const reasons = [];
      if (!inVS) reasons.push('ViewShipment 에 없음(출고마스터/품목/업체 삭제 추정)');
      if (!inVO) {
        if (ordRaw) reasons.push('주문은 있으나 ViewOrder 에서 탈락(Country/Manager 등 INNER JOIN 실패)');
        else reasons.push('이 품목의 주문(OrderDetail)이 없음 → 분배만 있고 주문 없음 → ViewOrder 미존재');
      }
      if (Number(x.ShipDateCnt) === 0) reasons.push('ShipmentDate 행 없음');
      else if (Number(x.PeriodExactCnt) === 0) {
        reasons.push(Number(x.PeriodDateCnt) > 0
          ? `출고일 시각 불일치(ShipmentDate=${x.ShipDateRaw}) — PeriodDay 정확매칭 실패`
          : `출고일 '${x.ShipDtm}' 이 PeriodDay 에 없음`);
      }
      // 실제 견적 조인 재현 결과가 최종 판정
      const getDetailRows = Number(x.InGetDetail || 0);
      const getDetailRowsByCustProd = Number(x.InGetDetailByCustProd || 0);
      const detailSplitCnt = Number(x.DetailSplitCnt || 0);
      const inGetDetail = getDetailRows > 0;
      if (inGetDetail && reasons.length === 0) {
        // 모든 개별 조건 통과 + 실제 조인도 통과
      } else if (!inGetDetail && reasons.length === 0) {
        reasons.push(`실제 견적조인(GetDetail) 탈락 — 개별조건은 통과인데 조인 결과 0 (OrderYearWeek2='${x.VS_YW2}' 로 ViewOrder 매칭 실패 의심)`);
      }
      const visible = inGetDetail;
      return {
        week: x.OrderWeek,
        custName: x.CustName, prodName: x.ProdName, counName: x.CounName,
        outQty: Number(x.OutQuantity || 0), estQty: Number(x.EstQuantity || 0),
        shipDtm: x.ShipDtm, isFix: Number(x.SmFix), sdetailKey: x.SdetailKey,
        inViewShipment: inVS, inViewOrder: inVO, orderDetailRaw: ordRaw, inGetDetail,
        getDetailRows, getDetailRowsByCustProd,
        detailSplitCnt,
        exeStructureBroken: detailSplitCnt > 1,
        webCreated: Number(x.WebCreated), smYW: x.SmYW, vsYW2: x.VS_YW2,
        shipDateCnt: Number(x.ShipDateCnt), periodExactCnt: Number(x.PeriodExactCnt), periodDateCnt: Number(x.PeriodDateCnt),
        visibleInEstimate: visible,
        reason: visible ? '정상(견적 노출)' : reasons.join(' / '),
      };
    });

    return res.status(200).json({
      success: true, year, weeks: rawWeeks, q,
      count: rows.length,
      hiddenCount: rows.filter(x => !x.visibleInEstimate).length,
      rows,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
