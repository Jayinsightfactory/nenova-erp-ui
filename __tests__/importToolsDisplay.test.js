import test from 'node:test';
import assert from 'node:assert/strict';
import {importCountryLabel,importUnitLabel,importColumnLabel} from '../lib/importToolsDisplay.js';
import {PEDIDOS_COUNTRIES,generatePedidos} from '../lib/importPedidos.js';
import XLSX from 'xlsx-js-style';
test('all selectable country labels are Korean without changing identifiers',()=>{
 const before=JSON.stringify(PEDIDOS_COUNTRIES);
 for(const country of PEDIDOS_COUNTRIES)assert.match(importCountryLabel(country),/[가-힣]/);
 assert.equal(JSON.stringify(PEDIDOS_COUNTRIES),before);
 assert.equal(importCountryLabel('Custom Farm'),'Custom Farm');
});
test('units and known headers translate but customer/product names remain intact',()=>{
 assert.equal(importUnitLabel('bunches'),'단');assert.equal(importUnitLabel('stems'),'송이');
 assert.equal(importColumnLabel('Total (boxes)'),'합계(박스)');
 assert.equal(importColumnLabel('Cambios'),'변경량');
 for(const value of ['YCL23','Holex Blue','장미','K01 [123]'])assert.equal(importColumnLabel(value),value);
});
test('display translation never changes zero-quantity downloadable workbook',()=>{
 const wb=XLSX.utils.book_new();
 XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([['품목명(색상)','거래처명','수량'],['Thailand Orchid','A',0]]),'Orders');
 const results=generatePedidos(wb,'Thailand','40-1',{year:2026});
 for(const output of results){
  const before=JSON.stringify(output.workbook);
  output.preview.headers.map(importColumnLabel);importUnitLabel(output.unit);
  assert.equal(JSON.stringify(output.workbook),before);assert.equal(output.totalQuantity,0);
 }
 assert.ok(results.length);
});
