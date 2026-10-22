const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const code = fs.readFileSync(require('node:path').join(__dirname, '../lib/packingIssueReview.js'), 'utf8');
const { packingRowReviewState: state } = new Function(code.replace('export function', 'function') + ';return {packingRowReviewState}')();
const entry = { invoiceIndex: 0, row: { lineIndex: 0, sourceSnapshotId: '2026-42-01', values: {pcs: 4, total_bunch:40,total_stems:400}, reviewRequired:false, reviewReasons:[] } };
test('normal rows stay out of issue queue without changing BOX/bunch/stem', () => {
  const before = JSON.stringify(entry);
  assert.equal(state(entry, null, 'Ammi').hasIssue,false);
  assert.equal(JSON.stringify(entry),before);
});
test('advisory may hide, but missing product and numeric errors cannot', () => {
  const row = {...entry,row:{...entry.row,reviewReasons:['POSITIONED_EVIDENCE_UNAVAILABLE']}};
  assert.equal(state(row,null,'Ammi').canDismiss,true);
  assert.equal(state(row,null,null).canDismiss,false);
  assert.equal(state(row,null,'Ammi',[{invoiceIndex:0,lineIndex:0,text:'박스 누락'}]).canDismiss,false);
});
test('carton warnings and unknown failures fail closed', () => {
  for(const reason of ['CARTON_NUMBER_WARNING','PRICE_OR_AMOUNT_MISSING','UNKNOWN']) {
    assert.equal(state({...entry,row:{...entry.row,reviewReasons:[reason]}},null,'Ammi').canDismiss,false);
  }
});
test('an invoice without optional carton numbering does not demand reviewing every valid row', () => {
  assert.equal(state({...entry,row:{...entry.row,reviewRequired:true,reviewReasons:['CARTON_AUDIT_UNAVAILABLE']}},null,'Ammi').hasIssue,false);
  assert.equal(state({...entry,row:{...entry.row,quantityWarning:'원문 단당송이와 총송이 상이',reviewReasons:['CARTON_AUDIT_UNAVAILABLE']}},null,'Ammi').canDismiss,true);
});
test('value, source and year changes invalidate advisory acknowledgement', () => {
  const baseline=state(entry,null,'Ammi').signature;
  assert.notEqual(state(entry,{values:{...entry.row.values,pcs:5}},'Ammi').signature,baseline);
  assert.notEqual(state({...entry,row:{...entry.row,sourceSnapshotId:'2025-42-01'}},null,'Ammi').signature,baseline);
});
