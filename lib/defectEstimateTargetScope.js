// FormEstimateAdd는 선택한 ShipmentKey와 선택한 ProdKey를 별도 필드로 저장한다.
// 따라서 견적 차감의 적용 출고는 같은 연도·부모차수·거래처의 활성 분배 존재로 판단한다.
// 차감 품목과 ShipmentDetail.ProdKey는 달라도 되며, 선택 차수의 업체 ShipmentKey만 연결한다.
// 불량 원장의 품목은 Estimate.ProdKey와 해당 품목의 단가/단위 조회에만 쓴다.
export function buildDefectEstimateTargetCandidatesSql() {
  return `SELECT
            sm.OrderYear AS TargetOrderYear, sm.CustKey, sd.ProdKey AS ShipmentProdKey,
            sd.OutQuantity AS ShipmentOutQuantity,
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
        AND (
          TRY_CONVERT(INT, LEFT(sm.OrderWeek, CHARINDEX(N'-', sm.OrderWeek+N'-')-1))=@week
          OR sm.OrderYearWeek = CONVERT(varchar(4), @yr) + RIGHT('00' + CONVERT(varchar(2), @week), 2)
        )
        AND ISNULL(sm.isDeleted,0)=0
        -- 견적을 연결할 수 있는 것은 실제 분배량이 있는 판매 출고뿐이다.
        -- ShipmentDate.EstQuantity는 화면 표시용이라 0이어도 허용하지만,
        -- ShipmentDetail.OutQuantity가 0인 빈/유령 출고 Master는 제외한다.
        AND ISNULL(sd.OutQuantity,0)>0
      ORDER BY TRY_CONVERT(INT, RIGHT(sm.OrderWeek,2)),
               sm.ShipmentKey, sd.SdetailKey, sdd.SdateKey`;
}

// 활성 Master/Detail/Date/PeriodDay 조인으로 업체 출고가 실제 존재함을 확인한다.
export function isExeEstimateTargetCandidate(row) {
  const distributedQuantity = row?.ShipmentOutQuantity ?? row?.OutQuantity;
  return Number(row?.ShipmentKey || 0) > 0
    && (distributedQuantity == null || Number(distributedQuantity) > 0);
}

export function selectExeEstimateTargetCandidate(rows = []) {
  return rows.find(isExeEstimateTargetCandidate) || null;
}

export function evaluateDefectRegistrationEligibility({ row = {}, context = null, exactExistingEstimate = false } = {}) {
  const status = String(row.status || '').toUpperCase();
  if (status === 'MANUAL_COMPLETED') return { eligible: false, code: 'MANUAL_COMPLETED', error: '수기 처리로 완료 표시된 행입니다.' };
  if (status === 'REGISTERED' || status === 'COMPLETED' || Number(row.estimateKey || 0) > 0) return { eligible: false, code: 'ALREADY_REGISTERED', error: '이미 견적서관리에 등록된 행입니다.' };
  if (exactExistingEstimate) return { eligible: false, code: 'EXISTING_ESTIMATE', error: '동일 차수에 같은 품목·수량의 기존 불량차감이 있습니다.' };
  // ImportConfirmed는 수입부의 업무 진행상태 표시용이다. FormEstimateAdd는
  // 선택한 업체 ShipmentKey와 불량 ProdKey를 독립적으로 저장하므로,
  // 해당 부모차수의 업체 분배와 단가가 확인되면 수입부 확정 여부와 무관하게 등록한다.
  if (!context?.shipmentKey) return { eligible: false, code: 'CUSTOMER_SALE_MISSING', error: '선택 차수에 이 업체의 출고가 없습니다.' };
  if (!(Number(context.cost || 0) > 0)) return { eligible: false, code: 'COST_MISSING', error: '등록할 분배단가를 찾을 수 없습니다.' };
  return { eligible: true, code: 'ELIGIBLE', error: '' };
}
