import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceDateYear, receiptYearConflict} from '../lib/invoiceReceiptYear.js';
import {receiptScopeIssue} from '../lib/invoiceReceiptWorkflow.js';

test('explicit invoice years including day-first dates are available without a current-year fallback',()=>{
  for(const date of ['2026-10-23','23/10/2026','October 23, 2026'])assert.equal(invoiceDateYear({date}),'2026');
  for(const date of ['', '10/23', '2025 / 2026'])assert.equal(invoiceDateYear({date}),'');
  assert.equal(invoiceDateYear({date:'2026-10-23',extractionIssues:[{code:'DATE_YEAR_CONFLICT'}]}),'');
});
test('cross-year explicit selections require confirmation tied to the selected year',()=>{
  const document={orderYear:'2025',orderWeek:'43-02',reviewedMetadata:{orderYearEvidence:{invoiceYear:'2026',confirmedYear:''}}};
  assert.equal(receiptYearConflict(document),true);
  assert.match(receiptScopeIssue(document),/연도가 다릅니다/);
  document.reviewedMetadata.orderYearEvidence.confirmedYear='2025';
  assert.equal(receiptScopeIssue(document),'');
  document.orderYear='2027';assert.equal(receiptYearConflict(document),true);
  document.orderYear='2026';assert.equal(receiptYearConflict(document),false);
});
