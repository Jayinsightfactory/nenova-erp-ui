'use strict';
const crypto=require('node:crypto');
const shared=require('./ecountWorkspaceClient.cjs');
const observed=require('./ecountObservedCoverage.cjs');
const {scopeOf,date,sanitizeRows,fail}=shared;
function prepareImport(input) {
  if(shared.READ_ONLY_DATASETS.includes(scopeOf(input).dataset)) fail('IMPORT_NOT_VERIFIED');
  const scope=scopeOf(input), periodFrom=date(input.periodFrom),periodTo=date(input.periodTo);
  if((periodFrom===null)!==(periodTo===null) || (periodFrom && periodFrom>periodTo)) fail('INVALID_PERIOD');
  if(['stock','whStock','stkBalance','bomStock','relStock'].includes(scope.dataset)&&(!periodFrom||periodFrom!==periodTo))fail('INVALID_SNAPSHOT_DATE');
  if(['stockMove','stkLedger','stkDaily','stkMonth'].includes(scope.dataset)&&!periodFrom)fail('INVALID_SNAPSHOT_PERIOD');
  const rows=sanitizeRows(scope.dataset,input.rows);
  if(['stkDaily','stkMonth','taxStat','buyTaxStat','whStock','stockMove','stkLedger','stkBalance','bomStock','relStock'].includes(scope.dataset)&&rows.length===0)fail('EMPTY_IMPORT');
  if(['salesTax','buyTax','taxStat','buyTaxStat'].includes(scope.dataset)&&rows.some(row=>['supplyAmt','vat','total'].some(key=>row[key]===null)))fail('MISSING_REQUIRED_AMOUNT');
  if(scope.dataset!=='ordEmpty'&&Object.hasOwn(input,'coverage'))fail('INVALID_OBSERVED_EMPTY');
  const coverage=scope.dataset==='ordEmpty'?observed.validateCoverage(input.coverage,{...scope,periodFrom,periodTo,rows}):null;
  const data={...scope,periodFrom,periodTo,completeness:'unknown',rows,...(coverage?{coverage}:{})};
  return {...data,hash:crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex')};
}
function encodeVersionRows(data){return JSON.stringify(data.coverage?{formatVersion:1,rows:data.rows,coverage:data.coverage}:data.rows);}
function decodeVersionRows(scope,stored){
  if(typeof stored==='string')stored=JSON.parse(stored);
  if(Array.isArray(stored)){if(scope.dataset==='ordEmpty')fail('INVALID_OBSERVED_EMPTY');return {rows:sanitizeRows(scope.dataset,stored)};}
  if(!stored||stored.formatVersion!==1||Object.keys(stored).sort().join(',')!=='coverage,formatVersion,rows')fail('INVALID_OBSERVED_EMPTY');
  const rows=sanitizeRows(scope.dataset,stored.rows),coverage=observed.validateCoverage(stored.coverage,{...scope,rows});return {rows,coverage};
}
module.exports={...shared,prepareImport,encodeVersionRows,decodeVersionRows,validateObservedCriteria:observed.validateCriteria};
