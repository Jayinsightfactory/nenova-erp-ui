async function main() {
  const fs = await import('node:fs');
  const { buildEstimateAdditionalWeek, rankReferenceCosts, validateAdditionalProductSelection } = await import('../lib/estimateAdditionalProduct.js');
  let pass=0, fail=0;
  const assert=(label,cond)=>{if(cond)pass++;else{fail++;console.log(`  ✗ ${label}`);}};
  assert('02차 고정',buildEstimateAdditionalWeek('2026','29')==='2026-29-02');
  const ranked=rankReferenceCosts([{id:'other',customerPriority:0,selectedCount:9,shipmentDate:'2026-07-01'},{id:'cust',customerPriority:1,selectedCount:0,shipmentDate:'2025-01-01'}]);
  assert('거래처 우선 단가',ranked[0].id==='cust');
  let valid=true;try{validateAdditionalProductSelection({cost:1000,costSourceId:'DIRECT',farmKey:3,shipmentDate:'2026-07-16'});}catch{valid=false;}
  assert('단가출처·농장·출고일 필수',valid);
  const api=fs.readFileSync('pages/api/estimate/additional-product-context.js','utf8');
  const adjust=fs.readFileSync('pages/api/shipment/adjust.js','utf8');
  const modal=fs.readFileSync('components/estimate/OrderRegisterDistributeModal.js','utf8');
  assert('연도 업무키',api.includes('sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck'));
  assert('공통 농장 범위',api.includes('FARM_CANDIDATE_SCOPE_SQL'));
  assert('출고일 모호성 중단',api.includes('SHIPMENT_DATE_AMBIGUOUS'));
  assert('PIVOT_DISTRIBUTION',modal.includes("mode: 'PIVOT_DISTRIBUTION'"));
  assert('force 금지',modal.includes('force: false'));
  assert('확정 사이클',modal.includes('runEditWithFixCycle')&&modal.includes('orderYear: yearStr'));
  assert('출고일 서버 대조',adjust.includes('출고일 불일치'));
  console.log(`estimate additional product: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
