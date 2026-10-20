import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { sqlQuantityPivotGetData } from '../lib/exeQuantityPivotSql.js';
import { buildPivotModel, filterRows, pivotCellKey } from '../lib/pivotExeModel.js';
import { buildPivotExeWorkbook } from '../lib/pivotExeExport.js';

const sql = sqlQuantityPivotGetData();
const orderSql = sql.split("SELECT N'02. 주문'")[1].split('UNION ALL')[0];
assert.match(orderSql, /WHERE vo\.OutQuantity <> 0/);
assert.match(orderSql, /vo\.OrderYearWeek2 = sl\.OrderYearWeek/);
assert.match(sql, /sm\.OrderYearWeek BETWEEN @weekFrom AND @weekTo/);
assert.doesNotMatch(orderSql, /CounName\s*=|44-01|2026/);
assert.match(sql, /WHERE vo\.NoneOutQuantity > 0/);
assert.match(sql, /WHERE sd\.ShipmentQuantity > 0/);

// Same product in different years, countries and subweeks must remain independent.
for (const OrderYear of [2025, 2026]) for (const OrderWeek of ['01-01', '44-01', '44-02']) {
  for (const CounName of ['콜롬비아', '네덜란드', '중국']) {
    const base = {OrderYear, OrderWeek, CounName, ProdName:'same-product', ListType:'02. 주문'};
    const source = [
      {...base, CustName:'positive', Quantity:10}, {...base, CustName:'negative', Quantity:-3},
      {...base, OrderYear:OrderYear+1, Quantity:100},
      {...base, OrderWeek:'45-01', Quantity:200}, {...base, CounName:'other', Quantity:300},
    ];
    const selected = filterRows(source, {fieldFilters:{OrderYear:[OrderYear],OrderWeek:[OrderWeek],CounName:[CounName]}});
    assert.equal(selected.length, 2);
    const model = buildPivotModel(selected, {layout:{row:['ProdName'],column:['CustName'],data:['Quantity']}});
    const totalRow = model.rowAxis.find(axis=>axis.isGrandTotal);
    const totalCol = model.columnAxis.find(axis=>axis.isGrandTotal);
    assert.equal(model.cellMap[pivotCellKey(totalRow.key,totalCol.key)].values['Quantity:sum'],7);
    const negative = model.columnAxis.find(axis=>axis.path[0]==='negative');
    assert.equal(model.cellMap[pivotCellKey(totalRow.key,negative.key)].values['Quantity:sum'],-3);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(await buildPivotExeWorkbook(model));
    const values=[]; book.worksheets[0].eachRow(row=>row.eachCell(cell=>values.push(cell.value)));
    assert.ok(values.includes(-3) && values.includes(7), 'XLSX preserves negative numeric cells and net totals');
  }
}
for (const quantities of [[-5,-2],[3,-3]]) {
  const model=buildPivotModel(quantities.map(Quantity=>({ProdName:'negative-or-zero',Quantity})),
    {layout:{row:['ProdName'],column:[],data:['Quantity']}});
  const row=model.rowAxis.find(axis=>!axis.isGrandTotal);
  assert.ok(row,'negative-only and cancelling orders retain a product row');
  assert.equal(model.cellMap[pivotCellKey(row.key,model.columnAxis[0].key)].values['Quantity:sum'],quantities.reduce((a,b)=>a+b,0));
}
console.log('Signed orders: cross-year/week/country display, net totals and numeric XLSX passed');
