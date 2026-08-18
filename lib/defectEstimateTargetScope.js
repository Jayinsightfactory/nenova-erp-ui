// FormEstimateAdd는 선택한 ShipmentKey와 선택한 ProdKey를 별도 필드로 저장한다.
// 따라서 견적 차감의 적용 출고는 같은 연도·부모차수·거래처의 실제 확정 출고로
// 판단한다. ViewShipment.DetailFix는 원장 확정 상태와 다를 수 있으므로 사용하지 않는다.
// 불량 원장의 품목은 Estimate.ProdKey와 해당 품목의 단가/단위 조회에만 쓴다.
export function buildDefectEstimateTargetCandidatesSql() {
  return `SELECT
            sm.OrderYear AS TargetOrderYear, sm.CustKey, sd.ProdKey AS ShipmentProdKey,
            sm.ShipmentKey, sm.OrderWeek, sdd.ShipmentDtm,
            ISNULL(sm.isFix,0) AS MasterFix,
            ISNULL(sd.isFix,0) AS ShipmentDetailFix,
            ISNULL(sdd.EstQuantity,0) AS ShipmentDateEstimateQuantity,
            sd.SdetailKey, sdd.SdateKey
       FROM ShipmentMaster sm
       JOIN ShipmentDetail sd ON sd.ShipmentKey=sm.ShipmentKey
       JOIN ShipmentDate sdd ON sd.SdetailKey=sdd.SdetailKey
       JOIN PeriodDay pd ON sdd.ShipmentDtm=pd.BaseYmd
      WHERE sm.OrderYear=@yr AND sm.CustKey=@ck
        AND sm.OrderWeek LIKE @prefix
        AND ISNULL(sm.isDeleted,0)=0
      ORDER BY TRY_CONVERT(INT, RIGHT(sm.OrderWeek,2)),
               sm.ShipmentKey, sd.SdetailKey, sdd.SdateKey`;
}

// 실제 원장 확정 상태가 eligibility 기준이다. 출고일별 EstQuantity는 화면에 0인 행도
// 표시되므로 등록 대상 ShipmentKey 판정 조건으로 사용하지 않는다.
export function isExeEstimateTargetCandidate(row) {
  return Number(row?.MasterFix || 0) === 1
    && Number(row?.ShipmentDetailFix || 0) === 1;
}

export function selectExeEstimateTargetCandidate(rows = []) {
  return rows.find(isExeEstimateTargetCandidate) || null;
}

export function evaluateDefectRegistrationEligibility({ row = {}, context = null, exactExistingEstimate = false } = {}) {
  if (String(row.status || '').toUpperCase() === 'REGISTERED' || Number(row.estimateKey || 0) > 0) return { eligible: false, code: 'ALREADY_REGISTERED', error: '이미 견적서관리에 등록된 행입니다.' };
  if (exactExistingEstimate) return { eligible: false, code: 'EXISTING_ESTIMATE', error: '동일 차수에 같은 품목·수량의 기존 불량차감이 있습니다.' };
  if (!row.importConfirmed) return { eligible: false, code: 'IMPORT_NOT_CONFIRMED', error: '수입부 확정이 필요합니다.' };
  if (row.importReviewRequired) return { eligible: false, code: 'IMPORT_REVIEW_REQUIRED', error: '수입부 보완 필요를 먼저 해결하세요.' };
  if (!context?.shipmentKey) return { eligible: false, code: 'CUSTOMER_SALE_MISSING', error: '선택 차수에 이 업체의 EXE 확정 출고가 없습니다.' };
  if (!(Number(context.cost || 0) > 0)) return { eligible: false, code: 'COST_MISSING', error: '등록할 분배단가를 찾을 수 없습니다.' };
  return { eligible: true, code: 'ELIGIBLE', error: '' };
}
