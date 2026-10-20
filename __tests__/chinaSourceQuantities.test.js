const test = require('node:test');
const assert = require('node:assert/strict');
const XLSX = require('xlsx-js-style');
const ready = Promise.all([import('../lib/importChinaSourceQuantities.js'), import('../lib/importPacking.js'), import('../lib/importPackingPrompt.js')]);

test('explicit invoice box/bunch/stem totals survive matching and generated workbook in both years', async () => {
  const [, {genChina}] = await ready;
  for (const year of [2025, 2026]) {
    const product = {description:'Invoice Flower', pcs:4, total_bunch:40, total_stems:400, u_price:2, t_price:80};
    let book;
    const output = genChina({...XLSX,write:wb=>{book=wb;return [];}}, {
      invoice:'CN-41-01',supplier:'Cloudland',date:`${year}/10/04`,products:[product],total_value:80,
    },'41','01',{catalog:{byCountry:{CN:[{name:'Invoice Flower',code:'CN1'}]}}});
    const sheet = book.Sheets[book.SheetNames[0]];
    assert.equal(sheet.F6.v,4);assert.equal(sheet.I6.v,40);assert.equal(sheet.J6.v,400);
    assert.equal(sheet.G6.v,10);assert.equal(sheet.H6.v,100);
    assert.equal(output.totalMismatch,null);
    assert.equal(output.products[0].boxes,4);assert.equal(output.products[0].stems,400);
    assert.equal(product.total_stems,400);
  }
});
test('source quantities preserve zero, contradiction and absence without fabricated one', async () => {
  const [{chinaSourceQuantities:q}] = await ready;
  assert.deepEqual(q({total_bunch:40}),{pcs:null,total_bunch:40,total_stems:null,bunch_st:null,steam_box:null});
  assert.equal(q({total_bunch:40,bunch_st:10}).total_stems,400);
  assert.equal(q({total_bunch:40,bunch_st:10,total_stems:390}).total_stems,390);
  assert.equal(q({total_bunch:40,bunch_st:10,total_stems:0}).total_stems,0);
  assert.equal(q({pcs:0}).pcs,0);
  assert.equal(q({pcs:4,steam_box:100}).total_stems,400);
});
test('China extraction explicitly distinguishes printed PCS from legacy box field', async () => {
  const [,,{buildPrompt}] = await ready;
  const prompt = buildPrompt('CN');
  assert.match(prompt,/Order -> pcs \(boxes\)/);
  assert.match(prompt,/Unit PCS -> total_stems/);
  assert.match(prompt,/null, NOT 0 or 1/);
  assert.doesNotMatch(prompt,/total_bunch = quantity ordered/);
  assert.doesNotMatch(buildPrompt('CO'),/Order -> pcs \(boxes\)/);
});
