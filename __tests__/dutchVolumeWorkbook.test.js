import assert from 'node:assert/strict';
import XLSX from 'xlsx-js-style';
import { addDutchInlineCustomer } from '../lib/dutchInlineCustomer.js';
import { parseDutchPivotWorkbook, dutchPriceKey, createDutchBulkPriceConfig } from '../lib/dutchVolumePrice.js';
import { buildDutchPreviewEntries } from '../lib/dutchVolumeDraft.js';
import { prepareDutchVolumeWorkbook, exportDutchVolumeWorkbook, importDutchVolumeWorkbook } from '../lib/dutchVolumeWorkbook.js';

const name = '네덜란드';
const sheet = XLSX.utils.aoa_to_sheet([
  ['43-02','','','경부선','','지방'], ['','','','월','','화'],
  ['꽃','품목명','칼라','주광\nCL1','품목명','기존업체\nCL2','주문','입고','재고','잔량'],
  ['백합','Lily White','화이트',5,'Lily White',3,8,30,0,22],
  ['백합','Lily Pink','핑크',2,'Lily Pink','',2,20,0,18],
  ['합계','','',7,'',3,10,50,0,40],
]);
sheet.J4 = { t:'n', v:22, f:'H4+I4-G4' };
sheet['!cols'] = Array.from({length:10}, () => ({wch:10}));
const wb = {SheetNames:[name,'참고'],Sheets:{[name]:sheet,'참고':XLSX.utils.aoa_to_sheet([[1]])}};
wb.Sheets['참고'].A1 = {t:'n',v:8,f:"SUM('네덜란드'!D4:F4)"};
let entries = parseDutchPivotWorkbook(XLSX,wb).entries.map(e => ({...e,custKey:e.sourceColumn === 3 ? 1:2,prodKey:e.sourceRow===3?50:51,unit:'송이',quantity:e.sourceColumn===3&&e.sourceRow===3?7:e.quantity}));
entries = addDutchInlineCustomer(XLSX,wb,entries,name,{custKey:3,custName:'새업체',area:'경부선',orderCode:'CL3'}).entries;
entries = entries.map(e => e.added ? {...e,quantity:e.sourceRow===3?12.5:0} : e);
const config = createDutchBulkPriceConfig(false);
config.enabled = false;
const prices = Object.fromEntries(entries.filter(e=>e.added).map(e=>[dutchPriceKey(e,config),e.sourceRow===3?15000:0]));
const baseline = JSON.stringify(wb);
const normalized = rows => rows.map(({id,...e})=>e).sort((a,b)=>`${a.custKey}:${a.prodKey}`.localeCompare(`${b.custKey}:${b.prodKey}`));
const payload = (rows,p,c)=>normalized(buildDutchPreviewEntries(rows,p,e=>dutchPriceKey(e,c)));
for (const year of [2025,2026]) {
  const scope = {year,week:'43-02'};
  const prepared = prepareDutchVolumeWorkbook(XLSX,wb,entries,prices,config,scope);
  const out = prepared.workbook.Sheets[name];
  assert.equal(out.E3.v,'새업체');
  assert.equal(out.E4.v,'CL3');
  assert.equal(out.E5.v,12.5);
  assert.equal(out.E6.v,0);
  assert.equal(out.D5.v,7);
  assert.equal(out.H5.v,22.5);
  assert.equal(out.H7.v,24.5);
  assert.equal(out.E7.v,12.5);
  assert.equal(out.K5.f,'I5+J5-H5');
  assert.equal(prepared.workbook.Sheets['참고'].A1.f,"SUM('네덜란드'!D5:G5)");
  const bytes = await exportDutchVolumeWorkbook(XLSX,wb,entries,prices,config,scope);
  const disk = XLSX.read(bytes,{type:'array',cellStyles:true,cellFormula:true});
  const imported = importDutchVolumeWorkbook(XLSX,disk,scope);
  assert.deepEqual(payload(imported.entries,imported.prices,imported.bulkPriceConfig),payload(entries,prices,config));
  assert.equal(disk.Sheets[name].E5.t,'n','price decoration never replaces quantity');
  const twice = await exportDutchVolumeWorkbook(XLSX,disk,imported.entries,imported.prices,imported.bulkPriceConfig,scope);
  const again = importDutchVolumeWorkbook(XLSX,XLSX.read(twice,{type:'array'}),scope);
  assert.deepEqual(payload(again.entries,again.prices,again.bulkPriceConfig),payload(entries,prices,config));
  assert.throws(()=>importDutchVolumeWorkbook(XLSX,disk,{year:year+1,week:'43-02'}),/차수/);
  disk.Sheets[name].E5.v=16;
  assert.equal(importDutchVolumeWorkbook(XLSX,disk,scope).entries.find(e=>e.cellAddress==='E5').quantity,16,'visible cell is quantity source');
  disk.Sheets[name].E5.v=-1;
  assert.throws(()=>importDutchVolumeWorkbook(XLSX,disk,scope),/수량 셀/);
  disk.Sheets[name].E5.v=12.5;
  disk.Sheets[name].E3.v='다른 업체';
  assert.throws(()=>importDutchVolumeWorkbook(XLSX,disk,scope),/위치가 변경/);
}
assert.equal(JSON.stringify(wb),baseline,'export does not mutate original');
const legacy = {...wb,SheetNames:[...wb.SheetNames,'ERP적용초안'],Sheets:{...wb.Sheets,ERP적용초안:XLSX.utils.aoa_to_sheet([['old']])}};
assert.throws(()=>importDutchVolumeWorkbook(XLSX,legacy,{year:2026,week:'43-02'}),/이전 형식/);
console.log('Dutch XLSX visible added-customer/edit/zero/decimal/price/unit/key/scope/formula/double-roundtrip checks passed');
