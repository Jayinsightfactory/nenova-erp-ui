'use strict';
const crypto=require('node:crypto');
const shared=require('./ecountWorkspaceClient.cjs');
const {scopeOf,date,sanitizeRows,fail}=shared;
function prepareImport(input) {
  if(shared.READ_ONLY_DATASETS.includes(scopeOf(input).dataset)) fail('IMPORT_NOT_VERIFIED');
  const scope=scopeOf(input), periodFrom=date(input.periodFrom),periodTo=date(input.periodTo);
  if((periodFrom===null)!==(periodTo===null) || (periodFrom && periodFrom>periodTo)) fail('INVALID_PERIOD');
  if(['stock','whStock','stkBalance'].includes(scope.dataset)&&(!periodFrom||periodFrom!==periodTo))fail('INVALID_SNAPSHOT_DATE');
  if(['stockMove','stkLedger'].includes(scope.dataset)&&!periodFrom)fail('INVALID_SNAPSHOT_PERIOD');
  const rows=sanitizeRows(scope.dataset,input.rows);
  if(['taxStat','buyTaxStat','whStock','stockMove','stkLedger','stkBalance'].includes(scope.dataset)&&rows.length===0)fail('EMPTY_IMPORT');
  if(['salesTax','buyTax','taxStat','buyTaxStat'].includes(scope.dataset)&&rows.some(row=>['supplyAmt','vat','total'].some(key=>row[key]===null)))fail('MISSING_REQUIRED_AMOUNT');
  const data={...scope,periodFrom,periodTo,completeness:'unknown',rows};
  return {...data,hash:crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}
module.exports={...shared,prepareImport};
