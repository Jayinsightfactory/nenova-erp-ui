import assert from 'node:assert/strict';
import {test} from 'node:test';
import {inspectNzBloomInvoice, packingOriginMismatch} from '../lib/packingOriginEvidence.js';

const pdf = (year, invoice) => {
  const cells = (y, values) => values.map(([x,str]) => ({x,y,str}));
  return {
    text: 'Invoice Number Currency NZD '+invoice+' New Zealand Bloom Ltd wholly grown in New Zealand',
    pages: [{items:[
      ...cells(785,[[20,'Invoice Number']]), ...cells(768,[[20,invoice],[200,year]]),
      ...cells(550,[[20,'Mark'],[83,'Product'],[281,'Variety'],[384,'Boxes'],[424,'Units'],[485,'Price'],[549,'Total']]),
      ...cells(534,[[83,'Peony A'],[281,'Variety A'],[403,'3'],[431,'240'],[489,'7.57'],[537,'1,816.80']]),
      ...cells(518,[[83,'Peony B'],[281,'Variety B'],[403,'2'],[431,'200'],[489,'4.70'],[537,'940.00']]),
      ...cells(501,[[83,'Peony C'],[281,'Variety C'],[403,'3'],[431,'300'],[489,'4.99'],[537,'1,497.00']]),
      ...cells(483,[[83,'Subtotals'],[402,'8'],[450,'Total (NZD)'],[529,'4,253.80']]),
    ]}],
  };
};

test('NZ source preserves issuer, origin, currency and totals without borrowing another year invoice', () => {
  const current = inspectNzBloomInvoice(pdf('2026','210195'));
  assert.deepEqual([current.invoice,current.supplier,current.origin,current.currency,current.total,current.products.length],['210195','New Zealand Bloom Ltd','NZ','NZD','4,253.80',3]);
  assert.equal(inspectNzBloomInvoice(pdf('2025','110195')).invoice,'110195');
});

test('AU mismatch requires explicit country text; AU supplier or NZD alone is insufficient', () => {
  assert.match(packingOriginMismatch(pdf('2026','210195'),'AU'),/품목 매칭은 시작하지/);
  assert.equal(packingOriginMismatch(pdf('2026','210195'),'NZ'),'');
  assert.equal(packingOriginMismatch({text:'Premium Greens Total in AUD$'},'AU'),'');
  assert.equal(packingOriginMismatch({text:'NZD'},'AU'),'');
});

test('do not infer or silently repair missing currency, origin, or inconsistent money', () => {
  for (const [from,to] of [['Total (NZD)','Total (AUD)'],['1,497.00','1,497.01'],['4,253.80','4,253.81']]) {
    const source=pdf('2026','210195');
    source.pages[0].items.find(item=>item.str===from).str=to;
    assert.equal(inspectNzBloomInvoice(source),null);
  }
  const source=pdf('2026','210195');
  source.text=source.text.replace('wholly grown in New Zealand','');
  assert.equal(inspectNzBloomInvoice(source),null);
});
