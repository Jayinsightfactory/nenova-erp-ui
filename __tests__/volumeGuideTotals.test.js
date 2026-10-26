import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildDutchQuantitySummaryValues } from '../lib/dutchSheetQuantityEdit.js';
import { buildChinaVolumeWorkbookRows } from '../lib/chinaVolumeBoard.js';
import { dutchGuideStep, dutchGuideEnabled } from '../lib/dutchVolumeGuide.js';
const XLSX = createRequire(import.meta.url)('xlsx');
for (const year of [2025, 2026]) {
  const name = `${year} 네덜란드`;
  const sheet = XLSX.utils.aoa_to_sheet([[],[],['꽃','품목명','칼라','업체A','업체B','주문','입고','재고','잔량'],['수국','Blue','',5,2,7,20,3,16],['수국','White','',0,0,0,8,0,8],['합계','','',5,2,7,28,3,24]]);
  sheet.F4.f='SUM(D4:E4)';sheet.I4.f='G4-F4+H4';sheet.F6.f='SUM(F4:F5)';
  const before=JSON.stringify(sheet);
  for(const qty of [0, 1.25, 30]) {
    const values=buildDutchQuantitySummaryValues(XLSX,sheet,name,[{sheetName:name,sourceRow:3,sourceColumn:3,layoutVersion:3,quantity:qty}]);
    assert.equal(values.get('F4'),qty+2);assert.equal(values.get('I4'),21-qty);
    assert.equal(values.get('I5'),8);assert.equal(values.get('I6'),29-qty);
    assert.equal(values.get('F6'),qty+2);assert.equal(values.get('D6'),qty);
    assert.equal(JSON.stringify(sheet),before,'source/formulas untouched');
    const china=buildChinaVolumeWorkbookRows({year,week:'43-01',rows:[{prodKey:1,prodName:'Blue',totalIncoming:20,ordersByCustKey:{1:5}}],customers:[{custKey:1,custName:'A'}],cells:{'1:1':{quantity:qty,orderQuantity:999,boxNumbers:['99']}}});
    assert.deepEqual(china[4].slice(1,5),[qty||'',qty||'',20,20-qty]);
  }
}
assert.equal(dutchGuideEnabled(null),true);assert.equal(dutchGuideEnabled('false'),false);assert.equal(dutchGuideEnabled('obsolete'),true);
const s={hasWork:true,editReady:true,saved:true,reviewed:true,validationCurrent:true,canApply:true};
assert.equal(dutchGuideStep({}).id,'scope');assert.equal(dutchGuideStep({scopeConfirmed:true}).id,'load');
assert.equal(dutchGuideStep({hasWork:true}).id,'edit');assert.equal(dutchGuideStep({...s,saved:false}).id,'save');
assert.equal(dutchGuideStep({...s,validationCurrent:false}).id,'review');assert.equal(dutchGuideStep({...s,canApply:false}).id,'blocked');
assert.equal(dutchGuideStep(s).id,'apply');assert.equal(dutchGuideStep({...s,busy:true}).id,'busy');
assert.equal(dutchGuideStep({...s,applied:true}).id,'done');
console.log('volume guide/totals: formula caches, zero, decimals, shortage, inbound-only, source preservation, year isolation, false/stale/blocked passed');
