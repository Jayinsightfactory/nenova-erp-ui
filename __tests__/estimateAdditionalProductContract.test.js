async function main() {
  const fs = await import('node:fs');
  const {
    applyReferenceCostOnly,
    buildEstimateAdditionalWeek,
    formatReferenceCostLabel,
    rankReferenceCosts,
    shouldSkipFixCycleStockCalc,
    confirmedWeekFixCycleStockFlags,
    validateAdditionalProductSelection,
  } = await import('../lib/estimateAdditionalProduct.js');
  let pass=0, fail=0;
  const assert=(label,cond)=>{if(cond)pass++;else{fail++;console.log(`  ✗ ${label}`);}};
  assert('02차 고정',buildEstimateAdditionalWeek('2026','29')==='2026-29-02');
  const ranked=rankReferenceCosts([{id:'other',customerPriority:0,selectedCount:9,shipmentDate:'2026-07-01'},{id:'cust',customerPriority:1,selectedCount:0,shipmentDate:'2025-01-01'}]);
  assert('거래처 우선 단가',ranked[0].id==='cust');
  let valid=true;try{validateAdditionalProductSelection({cost:1000,costSourceId:'DIRECT',shipmentDate:'2026-07-16'});}catch{valid=false;}
  assert('단가출처·출고일 필수',valid);
  let farmRejected=false;try{validateAdditionalProductSelection({cost:1000,costSourceId:'DIRECT',farmKey:0,shipmentDate:'2026-07-16'});}catch{farmRejected=true;}
  assert('농장은 필수 아님',!farmRejected);
  const picked=applyReferenceCostOnly({id:'SDETAIL:9',cost:1500,custKey:88,customerName:'다른업체'});
  assert('단가만 선택',picked.cost===1500 && picked.costSourceId==='SDETAIL:9' && picked.custKey===undefined);
  const costLabel=formatReferenceCostLabel({cost:1500,year:'2026',week:'29-01',customerName:'다른업체'});
  assert('라벨은 단가 우선',costLabel.includes('원') && costLabel.includes('참고 다른업체') && costLabel.indexOf('원') < costLabel.indexOf('다른업체'));
  assert('기존 수량 변경 없으면 최종 재고계산 생략',shouldSkipFixCycleStockCalc({existingQtyChanged:false})===true);
  assert('기존 수량 변경 있으면 최종 재고계산',shouldSkipFixCycleStockCalc({existingQtyChanged:true})===false);
  const qtyFlags=confirmedWeekFixCycleStockFlags({existingQtyChanged:true});
  assert('수량변경이어도 중간 합산은 생략',qtyFlags.lightStock===true && qtyFlags.skipFinalStockCalc===false);
  const costFlags=confirmedWeekFixCycleStockFlags({existingQtyChanged:false});
  assert('단가만 변경이면 최종 합산도 생략',costFlags.lightStock===true && costFlags.skipFinalStockCalc===true);
  const api=fs.readFileSync('pages/api/estimate/additional-product-context.js','utf8');
  const adjust=fs.readFileSync('pages/api/shipment/adjust.js','utf8');
  const modal=fs.readFileSync('components/estimate/OrderRegisterDistributeModal.js','utf8');
  const page=fs.readFileSync('pages/estimate.js','utf8');
  const helper=fs.readFileSync('lib/estimateAdditionalProduct.js','utf8');
  assert('연도 업무키',api.includes('sm.OrderYear=@yr AND sm.OrderWeek=@wk AND sm.CustKey=@ck'));
  assert('업체단가 원천',api.includes('FROM CustomerProdCost cpc'));
  assert('응답에 업체키 없음',!api.includes('custKey:r.CustKey') && !api.includes('custKey: r.CustKey'));
  assert('농장 후보 조회 없음',!api.includes('FARM_CANDIDATE_SCOPE_SQL') && !api.includes('farms:'));
  assert('출고일 모호성 중단',api.includes('SHIPMENT_DATE_AMBIGUOUS'));
  assert('모달은 담기만',modal.includes('onQueue') && modal.includes('목록에 담기') && !modal.includes('runEditWithFixCycle'));
  assert('추가 품목 단위 선택 가능',modal.includes('<select') && modal.includes('onChange={(e) => updateLine(line.id, { unit: normalizeOrderUnit(e.target.value) })}'));
  assert('추가 품목 표준 단위 3종',modal.includes('<option value="박스">박스</option>') && modal.includes('<option value="단">단</option>') && modal.includes('<option value="송이">송이</option>'));
  assert('추가 품목 단위 읽기전용 금지',!modal.includes('value={line.unit}\n                      readOnly'));
  assert('통합 저장',page.includes('pendingAdds') && page.includes("mode: 'PIVOT_DISTRIBUTION'") && page.includes('estimateAdditional: true'));
  assert('한 번 사이클',page.includes('skipFinalStockCalc') && page.includes('confirmedWeekFixCycleStockFlags'));
  assert('force 금지',page.includes("force: false") && !modal.includes('force: true'));
  assert('확정 사이클',page.includes('runEditWithFixCycle') && page.includes('orderYear: yearStr') && page.includes('applyAllEdits'));
  assert('출고일 서버 대조',adjust.includes('출고일 불일치'));
  assert('농장 생략 보존',adjust.includes('농장배정을 생략한 수량 변경은 기존') && helper.includes('applyReferenceCostOnly'));
  console.log(`estimate additional product: ${pass} passed, ${fail} failed`);
  process.exit(fail?1:0);
}
main().catch(e=>{console.error(e);process.exit(1);});
