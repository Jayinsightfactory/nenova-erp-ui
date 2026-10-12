'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {pathToFileURL} = require('node:url');
const XLSX = require('xlsx-js-style');

// This helper reads a private workbook only. It has no SQL/connection options.
async function loadChinaInvoiceReceiptScenario(file) {
  if (file === undefined || file === '') return null;
  assert.equal(typeof file,'string','private fixture input must be a local XLSX path');
  assert.ok(path.isAbsolute(file) && !/^(?:\\\\|\/\/)/.test(file),'private fixture path must be absolute and local, not a network URL/share');
  assert.equal(path.extname(file).toLowerCase(),'.xlsx','private fixture input must be .xlsx');
  const resolved = fs.realpathSync(file);
  assert.ok(!/^(?:\\\\|\/\/)/.test(resolved),'resolved private fixture path must remain local');
  const stat = fs.statSync(resolved);
  assert.ok(stat.isFile() && stat.size > 0 && stat.size <= 50*1024*1024,'private fixture XLSX must be a regular file of at most 50MiB');
  const bytes = fs.readFileSync(resolved);
  assert.ok(bytes.length > 0 && bytes.length <= 50*1024*1024,'private fixture XLSX exceeds 50MiB');
  const {parseChinaInvoiceWorkbook} = await import(pathToFileURL(path.resolve(__dirname,'../../lib/importChinaInvoice.js')).href);
  const parsed = parseChinaInvoiceWorkbook(XLSX,bytes.toString('base64'));
  const invoices = JSON.parse(parsed.content[0].text).invoices;
  assert.equal(invoices.length,1);
  const invoice = invoices[0];
  assert.equal(invoice.source_format,'china_invoice_xlsx');
  assert.equal(invoice.products.length,28,'private case is bounded to the approved 41-2 28-row workbook');
  const sum = key => invoice.products.reduce((total,row)=>total+row[key],0);
  for (const [key,value] of Object.entries({pcs:159,total_bunch:2380,total_stems:30900,t_price:57330,gross_weight:1985.94})) {
    assert.ok(Math.abs(sum(key)-value)<0.000001,`actual workbook ${key} total differs from approved source evidence`);
  }
  assert.equal(invoice.currency,'CNY');
  assert.ok(Math.abs(invoice.invoice_total-84844.9)<0.000001);
  assert.ok(Math.abs(invoice.gross_weight-1985.94)<0.000001);
  assert.ok(invoice.vol_weight == null && invoice.chargeable_weight == null,'actual source CW must remain missing');
  const rawInvoiceJson = JSON.stringify(invoice);
  return {
    invoice,rawInvoiceJson,sourceHash:crypto.createHash('sha256').update(bytes).digest('hex'),
    originalFileName:path.basename(resolved),
    documentId:crypto.randomUUID(),operationId:crypto.randomUUID(),receiptPartId:crypto.randomUUID(),
    lines:invoice.products.map((source,index)=>({source,lineId:crypto.randomUUID(),prodKey:7300+index,
      syntheticName:`TEST_ONLY CN41-02 ${index+1}`,lineNo:index+1})),
  };
}

function chinaAirTestOnlyCostInput(costApi,scenario) {
  const formula=costApi.INVOICE_COST_FORMULAS.CN_AIR_WEIGHT_CBM_V1;
  assert.ok(formula,'CN_AIR_WEIGHT_CBM_V1 must be installed before running the private SQL case');
  return {
    formulaId:formula.formulaId,formulaVersion:formula.formulaVersion,formulaSourceHash:formula.formulaSourceHash,
    formulaSourceSheet:formula.formulaSourceSheet,formulaSourceCells:formula.formulaSourceCells,
    formulaApplicabilityConfirmed:true,formulaEffectiveDate:'2026-10-10',
    nativeCurrency:'CNY',freightCurrency:'CNY',exchangeRateKRW:230,exchangeRateType:'TEST_ONLY',exchangeRateDate:'2026-10-10',
    // Source charges are deliberately classified together ONLY for this fixture.
    freightAmount:27514.9,customsTotalKRW:1000,
    costSourceId:`TEST_ONLY:CN_AIR:${scenario.documentId}:${scenario.sourceHash}`,
    allocationScope:'SINGLE_INVOICE',allocationShareNumerator:1,allocationShareDenominator:1,
    lineInputs:scenario.lines.map(line=>({lineId:line.lineId,grossWeightKg:line.source.gross_weight,
      volumeWeightKg:'',tariffRate:0,otherCostPerUnitKRW:0})),
  };
}

module.exports={loadChinaInvoiceReceiptScenario,chinaAirTestOnlyCostInput};
