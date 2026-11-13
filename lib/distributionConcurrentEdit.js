// Distribution edits use a field-level compare-and-set, independent of a customer's
// broad estimate-screen presence lease. The transaction still locks native rows.
export function assertDistributionExpected(expected,row){
 if(!expected||!Number.isFinite(expected.outQty)||expected.outQty<0||!Number.isFinite(expected.cost)||expected.cost<0)throw Object.assign(Error('분배 조회 기준값이 없습니다. 다시 조회하세요.'),{code:'DISTRIBUTION_BASELINE_REQUIRED',statusCode:400});
 const qty=Number(row?.OutQuantity||0),cost=Number(row?.Cost||0);
 if(Math.abs(qty-expected.outQty)>1e-8||(row&&Math.abs(cost-expected.cost)>1e-8))throw Object.assign(Error('조회 후 이 업체·품목의 수량 또는 단가가 변경되었습니다. 다시 조회한 뒤 저장하세요.'),{code:'DISTRIBUTION_STALE',statusCode:409});
}
