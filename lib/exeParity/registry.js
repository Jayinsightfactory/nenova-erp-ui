/**
 * nenova.exe (dnSpy export) ↔ nenovaweb 매핑 레지스트리
 * Source: C:\Users\USER\nenova-decompiled\Nenova\
 */
export const EXE_FORM_REGISTRY = [
  {
    form: 'FormEstimateView',
    webRoutes: ['/estimate'],
    webApi: ['/api/estimate'],
    lib: 'lib/exeEstimateViewSql.js',
    status: 'ported',
    methods: ['GetData', 'GetDetail', 'GetPrintDetail', 'GetExcelDetail'],
  },
  {
    form: 'FormSalesDefectView',
    webRoutes: ['/stats/analysis'],
    webApi: ['/api/stats/sales?type=analysis'],
    lib: 'lib/exeSalesDefectViewSql.js',
    status: 'ported',
    methods: ['GetData'],
  },
  {
    form: 'FormSalesView',
    webRoutes: ['/stats/monthly'],
    webApi: ['/api/stats/sales?type=monthly'],
    lib: 'lib/exeSalesViewSql.js',
    status: 'ported',
    methods: ['GetData'],
  },
  {
    form: 'FormShipmentView',
    webRoutes: ['/shipment/view'],
    webApi: ['/api/shipment', '/api/shipment/[id]'],
    lib: 'lib/exeShipmentViewSql.js',
    status: 'ported',
    methods: ['GetData', 'GetDetail'],
  },
  {
    form: 'FormStockView',
    webRoutes: ['/stock'],
    webApi: ['/api/stock'],
    lib: 'lib/exeStockViewSql.js',
    status: 'ported',
    methods: ['GetData', 'StockHistory focus'],
  },
  {
    form: 'FormWarehouseView',
    webRoutes: ['/incoming'],
    webApi: ['/api/warehouse', '/api/warehouse/[id]'],
    lib: 'lib/exeWarehouseViewSql.js',
    status: 'ported',
    methods: ['GetData', 'GetDetail'],
  },
  {
    form: 'FormOrderView',
    webRoutes: ['/orders'],
    webApi: ['/api/orders?view=exe'],
    lib: 'lib/exeOrderViewSql.js',
    status: 'ported',
    methods: ['GetData'],
  },
  {
    form: 'FormSalesManagerView',
    webRoutes: ['/stats/manager'],
    webApi: ['/api/stats/sales?type=manager'],
    lib: 'lib/exeSalesManagerViewSql.js',
    status: 'ported',
    methods: ['GetData'],
  },
  {
    form: 'FormCustomerProdCost',
    webRoutes: ['/master/pricing'],
    webApi: ['/api/master/pricing-matrix'],
    lib: 'lib/exeCustomerProdCostSql.js',
    status: 'ported',
    methods: ['ClassCustomerProdCost.Select', 'Insert', 'Delete'],
  },
  {
    form: 'FormShipmentDistribution',
    webRoutes: ['/shipment/distribute'],
    webApi: ['/api/shipment/distribute?type=products'],
    lib: 'lib/exeShipmentDistributionSql.js',
    status: 'ported',
    methods: ['GetProductList', 'GetCustomerList', 'GetCustWeekGrid', 'GetProductShipmentGrid', 'GetShipmentFarmGrid', 'GetPivotData'],
  },
  {
    form: 'FormQuantityPivot',
    webRoutes: ['/shipment/week-pivot'],
    webApi: ['/api/shipment/stock-status?view=quantityPivot'],
    lib: 'lib/exeQuantityPivotSql.js',
    status: 'ported',
    methods: ['GetData'],
  },
  {
    form: 'FormAreaSalesView',
    webRoutes: ['/stats/area'],
    webApi: ['/api/stats/sales?type=area'],
    lib: 'lib/exeAreaSalesViewSql.js',
    status: 'ported',
    methods: ['GetData'],
  },
  {
    form: 'FormOrderAdd',
    webRoutes: ['/orders/new'],
    webApi: ['/api/orders?orderMasterKey&view=add'],
    lib: 'lib/exeOrderAddSql.js',
    status: 'ported',
    methods: ['GetDataProduct', 'GetDataFlower', 'GetDataCountry'],
  },
];

export function formsByStatus(status) {
  return EXE_FORM_REGISTRY.filter((f) => f.status === status);
}
