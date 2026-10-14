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
import { readEstimateVisibility } from '../../../lib/estimateVisibilityRead.js';
import { normalizeOrderWeek, resolveActiveOrderYear } from '../../../lib/orderUtils';

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ success: false, error: 'GET only' });
  const q = String(req.query.q || '').trim();
  // week 또는 weeks(콤마) 지원 — 여러 차수 비교
  const rawWeeks = String(req.query.weeks || req.query.week || '').split(',').map(w => normalizeOrderWeek(w.trim())).filter(Boolean);
  const year = resolveActiveOrderYear(rawWeeks[0], req.query.year || '');
  if (rawWeeks.length === 0) return res.status(400).json({ success: false, error: 'week 필요' });
  if (!q) return res.status(400).json({ success: false, error: '검색어 필요' });


  try {
    const r = await readEstimateVisibility(query, sql, { year, weeks: rawWeeks, q });

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
