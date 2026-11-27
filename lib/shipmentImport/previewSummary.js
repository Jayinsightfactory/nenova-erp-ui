import { sameQty } from './matchingEngine.js';

export function sortByExcelOrder(a, b) {
  return (a.sortCust ?? Infinity) - (b.sortCust ?? Infinity)
    || (a.sortRow ?? Infinity) - (b.sortRow ?? Infinity)
    || String(a.prodName || '').localeCompare(String(b.prodName || ''));
}

export function summarizePreviewByCustomer(previewRows) {
  const summaryByCustomer = {};
  for (const r of previewRows) {
    if (!summaryByCustomer[r.custName]) {
      summaryByCustomer[r.custName] = {
        custName: r.custName,
        orderQty: 0,
        currentOutQty: 0,
        uploadQty: 0,
        changeQty: 0,
        shipmentDiffQty: 0,
        changedLines: 0,
        shipmentChangedLines: 0,
      };
    }
    const s = summaryByCustomer[r.custName];
    s.orderQty += r.orderQty;
    s.currentOutQty += r.currentOutQty;
    s.uploadQty += r.uploadQty;
    s.changeQty += r.changeQty;
    s.shipmentDiffQty += r.shipmentDiffQty;
    if (!sameQty(r.orderDiffQty, 0)) s.changedLines += 1;
    if (r.needsShipmentApply || r.status !== '동일') s.shipmentChangedLines += 1;
  }
  return summaryByCustomer;
}

export function appendPreviewDiagnosticLogs({
  logs,
  aliasHits,
  skippedOtherWeek,
  skippedIgnoredCustomerCount,
  missingFromExcelCount,
  previewRows,
  applyRows,
  fixBlockedRows,
  changedRows,
  unmatched,
  skippedProducts,
  replacementProductKeys,
  replacementCategories,
  importMode,
  orderYear,
  week,
}) {
  for (const [alias, hit] of Object.entries(aliasHits)) {
    logs.push(`업체 alias 합산: ${alias} (${hit.count}건, 수량 ${hit.qty})`);
  }
  if (skippedOtherWeek > 0) logs.push(`다른 차수 행 제외: ${skippedOtherWeek}건`);
  if (skippedIgnoredCustomerCount > 0) logs.push(`제외 처리된 업체(농장 등 비거래처) 행 제외: ${skippedIgnoredCustomerCount}건`);
  if (missingFromExcelCount > 0) logs.push(`엑셀에서 빠진 기존 품목: ${missingFromExcelCount}건 (주문등록 유지, 기존 분배는 0으로 반영)`);
  const qtyWarningRows = previewRows.filter(r => r.hasQtyWarning);
  if (qtyWarningRows.length) {
    logs.push(`⚠ 수량 이상 징후 ${qtyWarningRows.length}건 — 적용 전 단위(박스/단/송이)를 확인하세요.`);
    for (const r of qtyWarningRows.slice(0, 8)) {
      const w = (r.qtyWarnings || []).find(x => x.severity === 'critical');
      if (w) logs.push(`  · ${r.custName} / ${r.prodName}: ${w.message}`);
    }
    if (qtyWarningRows.length > 8) logs.push(`  · ... 외 ${qtyWarningRows.length - 8}건`);
  }
  if (fixBlockedRows.length) {
    logs.push(`🔒 확정 품종/라인 차단 ${fixBlockedRows.length}건 — 미확정 품종만 적용 대상 (${orderYear}-${week})`);
    for (const r of fixBlockedRows.slice(0, 6)) {
      logs.push(`  · ${r.custName} / ${r.prodName}: ${r.fixBlockReason || '확정'}`);
    }
    if (fixBlockedRows.length > 6) logs.push(`  · ... 외 ${fixBlockedRows.length - 6}건`);
  }
  logs.push(`매칭 완료: 표시 ${previewRows.length}건, 적용가능 ${applyRows.length}건, 확정차단 ${fixBlockedRows.length}건, 주문변경 ${changedRows.length}건, 미매칭 ${unmatched.length}건`);
  if (skippedProducts.size) logs.push(`명시 건너뛰기 ${skippedProducts.size}품목: 제외 및 파일 밖 품목의 기존 주문·분배 보존. 매칭된 ${replacementProductKeys.size}품목만 적용.`);
  logs.push(importMode === 'REPLACE' ? `최종 분배 교체 범위: ${orderYear}-${week} · ${[...replacementCategories].join(', ')} — 적용 범위 안의 누락 분배만 0`
    : `${importMode === 'ADD' ? '기존 분배 + 파일 추가분' : '최종 합계 파일'}: ${orderYear}-${week} — 표시 셀로 매칭한 업체·품목만 반영, 파일 밖 기존 분배 보존`);
  return qtyWarningRows;
}

export function buildImportDropdownOptions(customers, products) {
  const customerOptions = customers
    .map(c => ({ custKey: c.CustKey, custName: c.CustName, orderCode: c.OrderCode || '', area: c.CustArea || '' }))
    .sort((a, b) => `${a.area}${a.custName}`.localeCompare(`${b.area}${b.custName}`));
  const productOptions = products
    .map(p => ({
      prodKey: p.ProdKey,
      prodName: p.ProdName,
      displayName: p.DisplayName || '',
      countryName: p.CounName || '', flowerName: p.FlowerName || '',
      outUnit: p.OutUnit || '박스',
    }))
    .sort((a, b) => String(a.displayName || a.prodName).localeCompare(String(b.displayName || b.prodName)));
  return { customerOptions, productOptions };
}

export function formatImportPreviewPayload({
  importMode,
  week,
  orderYear,
  productByKey,
  replacementCategories,
  replacementProductKeys,
  skippedProducts,
  earlyMode,
  earlyExclusions,
  earlyScope,
  otherYearWeeks,
  previewRows,
  changedRows,
  applyRows,
  unmatched,
  customerOptions,
  productOptions,
  duplicateProductReviews,
  summaryByCustomer,
  qtyWarningRows,
  fixBlockedRows,
  skippedIgnoredCustomerCount,
  logs,
}) {
  return {
    success: true,
    distributionMode: importMode,
    week,
    replacementCategories: [...replacementCategories],
    replacementScopeLabels: [...new Set([...replacementProductKeys].map(key => {
      const p = productByKey.get(key);
      return [p?.CountryFlower, p?.FlowerName].filter(Boolean).join(' · ');
    }).filter(Boolean))],
    replacementProductKeys: [...replacementProductKeys].sort((a, b) => a - b),
    skippedProducts: [...skippedProducts.values()],
    orderYear: String(orderYear),
    ...(earlyMode ? { earlyImport: { mode: earlyMode, fingerprint: earlyExclusions.fingerprint, scope: earlyScope } } : {}),
    otherYearWeeks,
    rows: previewRows,
    changedRows,
    applyRows,
    unmatched,
    customerOptions,
    productOptions,
    duplicateProductReviews: [...duplicateProductReviews.values()],
    summaryByCustomer: Object.values(summaryByCustomer),
    qtyWarningCount: qtyWarningRows.length,
    fixBlockedCount: fixBlockedRows.length,
    fixBlockedRows: fixBlockedRows.map(r => ({
      custName: r.custName,
      prodName: r.prodName,
      countryFlower: r.countryFlower,
      reason: r.fixBlockReason,
    })),
    qtyWarningRows: qtyWarningRows.map(r => ({
      custName: r.custName,
      prodName: r.prodName,
      orderQty: r.orderQty,
      uploadQty: r.uploadQty,
      excelQty: r.excelQty,
      warnings: r.qtyWarnings,
    })),
    ignoredCustomerCount: skippedIgnoredCustomerCount,
    logs,
  };
}
