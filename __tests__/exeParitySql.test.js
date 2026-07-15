/**
 * nenova.exe dnSpy SQL 모듈 — 구조 검증 (DB 불필요)
 * 실행: node __tests__/exeParitySql.test.js
 */
async function main() {
  const { sqlEstimateGetData, sqlEstimateGetDetail, sqlEstimateGetExcelDetail } = await import('../lib/exeEstimateViewSql.js');
  const { sqlSalesDefectProfitSummary } = await import('../lib/exeSalesDefectViewSql.js');
  const { sqlSalesViewByProduct } = await import('../lib/exeSalesViewSql.js');
  const { sqlShipmentViewGetData } = await import('../lib/exeShipmentViewSql.js');
  const { sqlStockViewGetData } = await import('../lib/exeStockViewSql.js');
  const { sqlCustomerProdCostSelect } = await import('../lib/exeCustomerProdCostSql.js');
  const { sqlWarehouseViewGetData } = await import('../lib/exeWarehouseViewSql.js');
  const { sqlOrderViewGetData } = await import('../lib/exeOrderViewSql.js');
  const { sqlQuantityPivotGetData } = await import('../lib/exeQuantityPivotSql.js');
  const { sqlOrderAddGetDataProduct, sqlOrderAddGetDataFlower, sqlOrderAddGetDataCountry } = await import('../lib/exeOrderAddSql.js');
  const { sqlSalesManagerViewGetData } = await import('../lib/exeSalesManagerViewSql.js');
  const { sqlDistributeGetCustomerList, sqlDistributeGetPivotData, sqlDistributeGetProductShipmentGrid } = await import('../lib/exeShipmentDistributionSql.js');
  const { EXE_FORM_REGISTRY } = await import('../lib/exeParity/registry.js');

  let pass = 0;
  let fail = 0;
  const assert = (label, cond) => {
    if (cond) pass++;
    else { fail++; console.log(`  ✗ ${label}`); }
  };

  console.log('=== FormEstimateView ===');
  assert('GetData DetailFix', sqlEstimateGetData({ orderYearWeek: '202626', custKey: null, weekDayIn: '1,2,3' }).includes('vs.DetailFix = 1'));
  assert('GetDetail ViewShipment', sqlEstimateGetDetail({ orderYearWeek: '202626', custKey: 1 }).includes('ViewShipment'));
  assert('GetExcelDetail GROUP BY', sqlEstimateGetExcelDetail({ orderYearWeek: '202626', custKey: 1, weekDayIn: '1,2,3' }).includes('GROUP BY'));

  console.log('\n=== FormSalesDefectView ===');
  assert('DetailFix', sqlSalesDefectProfitSummary().includes('DetailFix = 1'));

  console.log('\n=== FormSalesView ===');
  assert('PeriodDay YearMonth', sqlSalesViewByProduct().includes('pd.YearMonth'));

  console.log('\n=== FormShipmentView ===');
  assert('ShipmentDetail isFix', sqlShipmentViewGetData({}).includes('isFix = 1'));

  console.log('\n=== FormStockView ===');
  assert('StockMaster CTE', sqlStockViewGetData({}).includes('WITH stock'));

  console.log('\n=== FormCustomerProdCost ===');
  assert('CustomerProdCost', sqlCustomerProdCostSelect().includes('CustomerProdCost'));

  console.log('\n=== FormWarehouseView ===');
  assert('UploadDtm', sqlWarehouseViewGetData().includes('UploadDtm'));

  console.log('\n=== FormOrderView ===');
  assert('ViewOrder', sqlOrderViewGetData({}).includes('ViewOrder'));

  console.log('\n=== FormQuantityPivot ===');
  assert('UNION 전재고', sqlQuantityPivotGetData().includes('01. 전재고'));

  console.log('\n=== FormOrderAdd ===');
  assert('OrderDetail', sqlOrderAddGetDataProduct().includes('OrderDetail'));
  assert('GetDataCountry', sqlOrderAddGetDataCountry().includes('CountryFlower'));
  assert('GetDataFlower', sqlOrderAddGetDataFlower().includes('FlowerKey'));

  console.log('\n=== FormSalesManagerView ===');
  assert('DetailFix', sqlSalesManagerViewGetData({}).includes('DetailFix = 1'));
  assert('BusinessManager', sqlSalesManagerViewGetData({}).includes('BusinessManager'));

  console.log('\n=== FormShipmentDistribution ===');
  assert('GetCustomerList', sqlDistributeGetCustomerList().includes('CustKey'));
  assert('GetPivotData', sqlDistributeGetPivotData().includes('oOutQuantity'));
  assert('ProductShipmentGrid', sqlDistributeGetProductShipmentGrid().includes('oOutQuantity'));

  console.log('\n=== Registry ===');
  assert('registry entries', EXE_FORM_REGISTRY.length >= 12);
  assert('QuantityPivot ported', EXE_FORM_REGISTRY.some((f) => f.form === 'FormQuantityPivot' && f.status === 'ported'));

  console.log(`\n=== 결과: ${pass} pass, ${fail} fail ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
