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
