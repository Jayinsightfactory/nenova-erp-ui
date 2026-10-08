const assert = require('node:assert/strict');
const XLSX = require('xlsx-js-style');

async function main() {
  const { genAustralia } = await import('../lib/importPacking.js');
  // Anonymous regression fixture: no private outputs or network required in CI.
  const sourceInvoice = { invoice: 'AU-REGRESSION', products:
    [[500,5],[200,10],[100,10],[50,10],[150,10],[175,10],[350,10]]
      .map(([total_bunch,bunch_st],i)=>({description:`Fixture ${i+1}`,total_bunch,bunch_st})) };
  const sourceBefore = JSON.stringify(sourceInvoice);

  const actual = genAustralia(XLSX, sourceInvoice, '49', '01');
  assert.deepEqual(actual.products.map(product => product.qty),
    [2500, 2000, 1000, 500, 1500, 1750, 3500]);
  assert.equal(JSON.stringify(sourceInvoice), sourceBefore, 'generator must not mutate source input');

  const preview = products => genAustralia(XLSX, { invoice: 'TEST', products }, '49', '01').products;
  assert.equal(preview([{ description: 'absent', total_bunch: 12, bunch_st: 5 }])[0].qty, 60);
  assert.equal(preview([{ description: 'explicit zero', total_stems: 0, total_bunch: 12, bunch_st: 5 }])[0].qty, 0);
  assert.equal(preview([{ description: 'invalid explicit', total_stems: -1, total_bunch: 12, bunch_st: 5 }])[0].qty, -1);
  assert.equal(preview([{ description: 'invalid operands', total_bunch: -1, bunch_st: 5 }])[0].qty, null);

  console.log('PASS Australia preview quantity uses source stems or valid bunch × stems, preserving zero and invalid values');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
