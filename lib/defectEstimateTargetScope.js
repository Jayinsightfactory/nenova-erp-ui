export function buildDefectEstimateTargetCandidatesSql({ customerOnly = false } = {}) {
  return `SELECT
            vs.CustKey, vs.ShipmentKey, vs.OrderWeek, sdd.ShipmentDtm,
            ISNULL(vs.DetailFix,0) AS DetailFix,
            ISNULL(vs.EstQuantity,0) AS ShipmentEstimateQuantity,
            ISNULL(sdd.EstQuantity,0) AS ShipmentDateEstimateQuantity,
            vs.SdetailKey, sdd.SdateKey
       FROM ViewShipment vs
       JOIN ViewOrder vo
         ON vs.OrderYearWeek2=vo.OrderYearWeek2
        AND vs.CustKey=vo.CustKey
        AND vs.ProdKey=vo.ProdKey
       JOIN ShipmentDate sdd ON vs.SdetailKey=sdd.SdetailKey
       JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
      WHERE vs.OrderYear=@yr AND vs.CustKey=@ck
        ${customerOnly ? '' : 'AND vs.ProdKey=@pk'}
        AND vs.OrderWeek LIKE @prefix
      ORDER BY TRY_CONVERT(INT, RIGHT(vs.OrderWeek,2)),
               vs.ShipmentKey, vs.SdetailKey, sdd.SdateKey`;
}

// FormEstimateView.GetDetail의 정상출고 노출 조건이다. 출고일별 EstQuantity는
// 화면에 0인 행도 표시되므로 등록 대상 ShipmentKey 판정 조건으로 사용하지 않는다.
export function isExeEstimateTargetCandidate(row) {
  return Number(row?.DetailFix || 0) === 1
    && Number(row?.ShipmentEstimateQuantity || 0) > 0;
}

export function selectExeEstimateTargetCandidate(rows = []) {
  return rows.find(isExeEstimateTargetCandidate) || null;
}

export function evaluateDefectRegistrationEligibility({ row = {}, context = null, exactExistingEstimate = false } = {}) {
  if (String(row.status || '').toUpperCase() === 'REGISTERED' || Number(row.estimateKey || 0) > 0) return { eligible: false, code: 'ALREADY_REGISTERED', error: '이미 견적서관리에 등록된 행입니다.' };
  if (exactExistingEstimate) return { eligible: false, code: 'EXISTING_ESTIMATE', error: '동일 차수에 같은 품목·수량의 기존 불량차감이 있습니다.' };
  if (!row.importConfirmed) return { eligible: false, code: 'IMPORT_NOT_CONFIRMED', error: '수입부 확정이 필요합니다.' };
  if (row.importReviewRequired) return { eligible: false, code: 'IMPORT_REVIEW_REQUIRED', error: '수입부 보완 필요를 먼저 해결하세요.' };
  if (!context?.shipmentKey) return { eligible: false, code: 'EXACT_PRODUCT_SALE_MISSING', error: '선택 차수에 이 업체·품목키의 확정 판매행이 없습니다. 원차수 영업입력에서 현재 품목으로 수정한 뒤 수입부 재확정하세요.' };
  if (!(Number(context.cost || 0) > 0)) return { eligible: false, code: 'COST_MISSING', error: '등록할 분배단가를 찾을 수 없습니다.' };
  return { eligible: true, code: 'ELIGIBLE', error: '' };
}
