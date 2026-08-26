async function main() {
  const fs = await import('node:fs');
  const {
    ADDITIONAL_PRODUCT_CONTEXT_RELOAD_MESSAGE,
    buildAdditionalProductContextRequest,
    canApplyAdditionalProductContext,
    invalidateAdditionalProductContextLine,
  } = await import('../lib/estimateAdditionalProductContext.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, condition) => {
    if (condition) pass += 1;
    else { fail += 1; console.log(`  ✗ ${label}`); }
  };

  const request = buildAdditionalProductContextRequest({
    sessionId: 7,
    requestId: 3,
    lineId: 'line-a',
    open: true,
    yearStr: '2026',
    weekNum: '29',
    custKey: 101,
    prodKey: 501,
  });
  const current = {
    open: true,
    sessionId: 7,
    requestId: 3,
    lineId: 'line-a',
    scope: request.scope,
  };
  assert('A 업체·품목 같은 scope 응답 적용', canApplyAdditionalProductContext(request, current));
  assert('B 업체 전환 후 A context 차단', !canApplyAdditionalProductContext(request, {
    ...current,
    scope: { ...request.scope, custKey: '202' },
  }));
  assert('다른 품목 전환 후 A context 차단', !canApplyAdditionalProductContext(request, {
    ...current,
    scope: { ...request.scope, prodKey: '502' },
  }));
  assert('모달 닫힘 후 응답 차단', !canApplyAdditionalProductContext(request, { ...current, open: false }));
  assert('재열림 session 응답 차단', !canApplyAdditionalProductContext(request, { ...current, sessionId: 8 }));
  assert('같은 line의 새 요청이 이전 응답을 차단', !canApplyAdditionalProductContext(request, { ...current, requestId: 4 }));

  const originalLine = {
    id: 'line-a', prodKey: 501, prodName: 'A 품목', unit: '단', qty: '2', action: 'ADD',
    prodSearch: 'A 품목', prodOpen: true, context: { shipmentDate: '2026-07-16' },
    contextError: '', costSourceId: 'CUSTPROD:1', cost: 1500,
  };
  const invalidated = invalidateAdditionalProductContextLine(originalLine);
  assert('범위 변경 시 입력 행 id/product/qty 보존', invalidated.id === 'line-a'
    && invalidated.prodKey === 501 && invalidated.prodName === 'A 품목'
    && invalidated.qty === '2' && invalidated.unit === '단');
  assert('범위 변경 시 A context·단가·출고일 제거', invalidated.context === null
    && invalidated.costSourceId === '' && invalidated.cost === ''
    && invalidated.contextError === ADDITIONAL_PRODUCT_CONTEXT_RELOAD_MESSAGE);

  const modal = fs.readFileSync('components/estimate/OrderRegisterDistributeModal.js', 'utf8');
  assert('모달이 request scope guard를 사용', modal.includes('canApplyAdditionalProductContext')
    && modal.includes('buildAdditionalProductContextRequest'));
  assert('selectedShip 업체키가 render scope에서 우선', modal.includes('custKey: selectedShip?.CustKey ?? cust?.CustKey'));
  assert('모달이 명시적 재조회 필요 문구를 사용', modal.includes('ADDITIONAL_PRODUCT_CONTEXT_RELOAD_MESSAGE'));
  assert('모달은 여전히 즉시 저장하지 않고 queue만 사용', modal.includes('onQueue')
    && modal.includes('목록에 담기') && !modal.includes("fetch('/api/shipment/adjust"));

  console.log(`estimate additional product context: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}

main().catch((error) => { console.error(error); process.exit(1); });
