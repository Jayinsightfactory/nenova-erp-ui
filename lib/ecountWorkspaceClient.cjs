'use strict';
const menus = require('../data/ecount-workbench/source-menu.json').menus;
const ROOT = 'nenova-ecount';
const PROGRAMS = { cash: 'E010205', ar: 'E040214', ap: 'E040309', sales: 'E040207', quote:'E040202', purchase:'E040304', buyStatus:'E040305', poQuery:'E040302', receipt:'E040217', payment:'E040310', discount:'E040216', buyDisc:'E040313', saleQuery:'E040206', unsold:'E040212', unbought:'E040307', quoteStat:'E040208', orderQuery:'E040204', orderStat:'E040209', poStat:'E040306', journal:'E010701', salesTax:'E040218', buyTax:'E040219', taxStat:'E040223', buyTaxStat:'E040320', stock:'E040701', whStock:'E040711', stockMove:'E040719', stkLedger:'E040702', stkBalance:'E040727', bomStock:'E040726', relStock:'E040728', ordEmpty:'E040209', quoteEmpty:'E040208', poEmpty:'E040306', daySale:'E040708', unpSale:'E040609', stkDaily:'E040719', stkMonth:'E040719' };
const READ_ONLY_DATASETS=Object.freeze(['discount','buyDisc','unsold','unbought','quoteStat','orderQuery','orderStat','poStat']);
const SOURCE_DATASETS=Object.freeze(['cash','ar','ap','sales']);
const QUOTE_STATUSES=Object.freeze(['in_progress','completed']);
const FIELDS = { ordEmpty:[], quoteEmpty:[], poEmpty:[], daySale:[], unpSale:[], stkDaily:['inQuantity','outQuantity','quantity'], stkMonth:['inQuantity','outQuantity','quantity'], cash:['amount','balance'], ar:['salesTotal','receiptTotal','etcDiff','balance'], ap:['openingDebt','stockBuy','acctBuy','payTotal','etcDiff','balance','unbilled'], sales:['qty','unitPrice','supplyAmt','total','vat'], quote:['estimateTotal'], purchase:['amountTotal','foreignTotal','exchangeRate'], buyStatus:['qty','boxQty','unitPrice','foreignAmount','supplyAmt','exchangeRate','total','weight'], poQuery:['orderTotal'], receipt:['amount'], payment:['amount'], discount:['salesAmount','accountingAmount','difference'], buyDisc:['purchaseAmount','accountingAmount','difference'], saleQuery:['amount'], unsold:['qty','unfulfilledQty','supplyAmt','vat'], unbought:['qty','unfulfilledQty','vat'], quoteStat:['qty','unitPrice','supplyAmt','vat','total'], orderQuery:['orderTotal'], orderStat:['qty','unitPrice','supplyAmt','vat','total'], poStat:['unitPrice','foreignAmount','exchangeRate','supplyAmt','qty','vat','total'], journal:['amount'], salesTax:['supplyAmt','vat','total'], buyTax:['supplyAmt','vat','total'], taxStat:['supplyAmt','vat','total'], buyTaxStat:['supplyAmt','vat','total'], stock:['quantity'], whStock:['quantity'], stockMove:['openingQuantity','inQuantity','outQuantity','quantity'], stkLedger:['openingQuantity','inQuantity','outQuantity','quantity'], relStock:['quantity','convertedQuantity'], bomStock:['quantity','convertedQuantity'], stkBalance:['quantity','currentMonthQuantity','previousMonthQuantity','twoMonthsAgoQuantity','threeMonthsAgoQuantity','otherQuantity','unsoldQuantity'] };
function fail(code, status=400) { const e=new Error(code); e.status=status; throw e; }
function authorized(user) { return !!user && Number(user.authority)===1 && user.accountActive!==false && typeof user.userId==='string' && user.userId.length>0; }
function scopeOf(input) {
  const menu=menus.find(m=>m.id===input.menuId);
  if (!Object.hasOwn(PROGRAMS,input.dataset) || !menu || menu.program!==PROGRAMS[input.dataset]) fail('INVALID_SCOPE');
  // Favorites and alternate navigation paths for one program share one workspace.
  const canonical=menus.find(m=>m.program===menu.program && m.path?.[0]!=='MyPage')||menu;
  return {root:ROOT,dataset:input.dataset,menuId:canonical.id,program:menu.program};
}
function date(value) {
  if(value==null || value==='') return null;
  if(typeof value!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('INVALID_DATE');
  const d=new Date(value+'T00:00:00Z');
  if(!Number.isFinite(d.getTime()) || d.toISOString().slice(0,10)!==value) fail('INVALID_DATE');
  return value;
}
function decimal(value) {
  if(value==null || value==='') return null;
  if(typeof value==='number' && (!Number.isFinite(value) || Math.abs(value)>Number.MAX_SAFE_INTEGER)) fail('INVALID_DECIMAL');
  if(!['string','number'].includes(typeof value)) fail('INVALID_DECIMAL');
  const s=String(value).trim();
  if(!/^-?(?:\d{1,3}(?:,\d{3})+|\d{1,24})(?:\.\d{1,8})?$/.test(s)) fail('INVALID_DECIMAL');
  const normalized=s.replace(/,/g,'');
  if(normalized.replace(/^-/,'').split('.')[0].length>24) fail('INVALID_DECIMAL');
  return normalized;
}
function normalizeSourceDate(value,isSubtotal=false) {
  if(value==null||value==='') return {refDate:null,sourceDateLabel:null};
  if(typeof value!=='string'||value.length>64) fail('INVALID_DATE');
  // Preserve only observed date/time/document label grammars, never arbitrary source text.
  const month=/^(\d{4})\/(\d{2}) {1,3}계$/.exec(value);
  if(month) {
    if(!isSubtotal) fail('INVALID_SUBTOTAL_DATE');
    date(`${month[1]}-${month[2]}-01`); // Validate month; never store an invented first day.
    return {refDate:null,sourceDateLabel:value};
  }
  const match=/^(\d{4})([/-])(\d{2})\2(\d{2})(.*)$/.exec(value);
  if(!match) fail('INVALID_DATE');
  const suffix=match[5];
  if(suffix!==''&&suffix!==' 00:00:00'&&!/^ -\d{1,6}$/.test(suffix)) {
    const time=/^ (오전|오후) {1,3}(\d{1,2}):(\d{2}):(\d{2})$/.exec(suffix);
    if(!time||Number(time[2])<1||Number(time[2])>12||Number(time[3])>59||Number(time[4])>59) fail('INVALID_DATE');
  }
  return {refDate:date(`${match[1]}-${match[3]}-${match[4]}`),sourceDateLabel:value};
}
function sourceDate(value) {return normalizeSourceDate(value).refDate;}
function quoteStatusFields(dataset,row) {
  const hasStatus=Object.hasOwn(row,'quoteStatus'),hasEvidence=Object.hasOwn(row,'statusEvidence');
  if(!hasStatus&&!hasEvidence)return {};
  if(dataset!=='quote'||!hasStatus||!hasEvidence||!QUOTE_STATUSES.includes(row.quoteStatus)||!['row_cell','query_filter'].includes(row.statusEvidence)||row.isSubtotal===true||row.isSubtotal===1)fail('INVALID_QUOTE_STATUS');
  return {quoteStatus:row.quoteStatus,statusEvidence:row.statusEvidence};
}
function sanitizeMovementRows(dataset,rows) {
  if(rows.length===0)return [];
  if(rows.length<3||rows.length%2!==1)fail('INVALID_MOVEMENT_GROUPS');
  const seen=new Set(),mode=dataset==='stkDaily'?'daily':'monthly';
  return rows.map((row,index)=>{
    if(!row||typeof row!=='object'||Array.isArray(row))fail('INVALID_ROW');
    if(row.reportMode!==mode)fail('INVALID_REPORT_MODE');
    if(row.refDate!=null||row.sourceDateLabel!=null)fail('UNVERIFIED_SOURCE_DATE');
    const kind=index===rows.length-1?'total':index%2===0?'opening':'group_summary';
    if(row.rowKind!==kind)fail('INVALID_MOVEMENT_GROUPS');
    if(row.isSubtotal!=null&&row.isSubtotal!==(kind!=='opening'))fail('INVALID_SUBTOTAL');
    if(row.rowNumber!=null&&row.rowNumber!==index+1&&row.rowNumber!==String(index+1))fail('INVALID_SOURCE_ORDER');
    if(kind==='total'){if(row.productCode!==null&&row.productCode!=='')fail('INVALID_SOURCE_TOTAL');}
    else {if(typeof row.productCode!=='string'||!/^[A-Za-z0-9._/-]{1,60}$/.test(row.productCode))fail('INVALID_PRODUCT_CODE');if(kind==='opening'){if(seen.has(row.productCode))fail('DUPLICATE_PRODUCT_CODE');seen.add(row.productCode);}else if(row.productCode!==rows[index-1].productCode)fail('MIXED_MOVEMENT_GROUP');}
    if((row.dateLabel===''?null:row.dateLabel)!==(kind==='opening'?'전일재고':null))fail('INVALID_MOVEMENT_LABEL');
    const clean={rowNumber:index+1,reportMode:mode,rowKind:kind,productCode:kind==='total'?null:row.productCode,dateLabel:kind==='opening'?'전일재고':null};
    for(const key of FIELDS[dataset]){if(!Object.hasOwn(row,key))fail('MISSING_QUANTITY');clean[key]=decimal(row[key]);}
    if(kind==='opening'&&clean.quantity===null)fail('MISSING_QUANTITY');
    if(kind!=='opening'&&clean.quantity!==null)fail('UNVERIFIED_MOVEMENT_BALANCE');
    if(FIELDS[dataset].every(key=>clean[key]===null))fail('EMPTY_SAFE_ROW');
    clean.isSubtotal=kind!=='opening';return clean;
  });
}
function sanitizeRows(dataset,rows) {
  if(!Object.hasOwn(FIELDS,dataset) || !Array.isArray(rows) || rows.length>20000) fail('INVALID_ROWS');
  if(['ordEmpty','quoteEmpty','poEmpty','daySale','unpSale'].includes(dataset)){if(rows.length!==0)fail('INVALID_OBSERVED_EMPTY');return [];}
  if(['stkDaily','stkMonth'].includes(dataset))return sanitizeMovementRows(dataset,rows);
  if(dataset==='relStock'&&rows.length!==0&&rows.length!==2)fail('INVALID_SELECTED_SCOPE');
  if(dataset==='bomStock'&&rows.length>1)fail('INVALID_SELECTED_SCOPE');
  const stockCodes=new Set();let balanceMonths=null;
  return rows.map((row,index)=>{
    if(!row || typeof row!=='object' || Array.isArray(row)) fail('INVALID_ROW');
    if((READ_ONLY_DATASETS.includes(dataset)||['stock','whStock','stockMove','stkLedger','stkBalance','bomStock','relStock'].includes(dataset))&&(row.refDate!=null||row.sourceDateLabel!=null)) fail('UNVERIFIED_SOURCE_DATE');
    const clean={rowNumber:index+1};
    if(dataset==='relStock'){const total=row.isSubtotal===true||row.isSubtotal===1;if(index===0){if(total||typeof row.productCode!=='string'||!/^[A-Za-z0-9._/-]{1,60}$/.test(row.productCode))fail('INVALID_SELECTED_SCOPE');clean.productCode=row.productCode;}else{if(!total||row.productCode!==null)fail('INVALID_SOURCE_TOTAL');clean.productCode=null;}}

    if(dataset==='stkBalance'){
      if(!Array.isArray(row.monthLabels)||row.monthLabels.length!==4||row.monthLabels.some(month=>!Number.isInteger(month)||month<1||month>12)||new Set(row.monthLabels).size!==4)fail('INVALID_MONTH_LABELS');
      const labels=JSON.stringify(row.monthLabels);if(balanceMonths!==null&&balanceMonths!==labels)fail('MIXED_MONTH_LABELS');balanceMonths=labels;clean.monthLabels=[...row.monthLabels];
      if(row.isSubtotal===true||row.isSubtotal===1){if(index!==rows.length-1||row.productCode!=null&&row.productCode!=='')fail('INVALID_SOURCE_TOTAL');clean.productCode=null;}
      else{if(typeof row.productCode!=='string'||!/^[A-Za-z0-9._/-]{1,60}$/.test(row.productCode))fail('INVALID_PRODUCT_CODE');if(stockCodes.has(row.productCode))fail('DUPLICATE_PRODUCT_CODE');stockCodes.add(row.productCode);clean.productCode=row.productCode;}
    }
    if(dataset==='whStock'){for(const key of ['productCode','warehouseCode']){if(typeof row[key]!=='string'||!/^[A-Za-z0-9._/-]{1,60}$/.test(row[key]))fail(key==='productCode'?'INVALID_PRODUCT_CODE':'INVALID_WAREHOUSE_CODE');clean[key]=row[key];}const composite=JSON.stringify([row.productCode,row.warehouseCode]);if(stockCodes.has(composite))fail('DUPLICATE_WAREHOUSE_PRODUCT');stockCodes.add(composite);if(row.isSubtotal===true||row.isSubtotal===1)fail('UNVERIFIED_STOCK_SUBTOTAL');if(decimal(row.quantity)===null)fail('MISSING_QUANTITY');}
    if(['stock','stockMove','stkLedger','bomStock'].includes(dataset)){if(typeof row.productCode!=='string'||!/^[A-Za-z0-9._/-]{1,60}$/.test(row.productCode))fail('INVALID_PRODUCT_CODE');if(stockCodes.has(row.productCode))fail('DUPLICATE_PRODUCT_CODE');stockCodes.add(row.productCode);clean.productCode=row.productCode;if(row.isSubtotal===true||row.isSubtotal===1)fail('UNVERIFIED_STOCK_SUBTOTAL');}
    if(dataset==='bomStock'){if(row.upperResult!=null&&!['empty_observed','uncollected'].includes(row.upperResult))fail('INVALID_COVERAGE');clean.upperResult=row.upperResult??'uncollected';}
    for(const field of FIELDS[dataset]) clean[field]=decimal(row[field]);
    if(['stockMove','stkLedger','stkBalance','bomStock','relStock'].includes(dataset)&&FIELDS[dataset].some(key=>clean[key]===null))fail('MISSING_QUANTITY');
    if(row.isSubtotal!=null && ![true,false,0,1].includes(row.isSubtotal)) fail('INVALID_SUBTOTAL');
    clean.isSubtotal=row.isSubtotal===true||row.isSubtotal===1;
    if(dataset==='cash'||dataset==='sales'||dataset==='quote'||dataset==='purchase'||dataset==='buyStatus'||dataset==='poQuery'||dataset==='receipt'||dataset==='payment'||dataset==='saleQuery'||dataset==='journal'||dataset==='salesTax'||dataset==='buyTax'||dataset==='taxStat'||dataset==='buyTaxStat') {
      const original=row.sourceDateLabel==null?row.refDate:row.sourceDateLabel;
      const normalized=normalizeSourceDate(original,clean.isSubtotal);
      if(row.sourceDateLabel!=null&&row.refDate!=null&&row.refDate!==''&&sourceDate(row.refDate)!==normalized.refDate) fail('SOURCE_DATE_MISMATCH');
      Object.assign(clean,normalized);
    }
    if(dataset==='cash') clean.flow=['입금','출금','in','out'].includes(row.flow)?row.flow:null;
    Object.assign(clean,quoteStatusFields(dataset,row));
    if(!FIELDS[dataset].some(f=>clean[f]!==null)) fail('EMPTY_SAFE_ROW');
    return clean;
  });
}
function expectedRevision(value) { if(!Number.isSafeInteger(value)||value<0) fail('INVALID_REVISION'); return value; }
function assertRevision(actual,expected) { if(actual!==expectedRevision(expected)) fail('REVISION_CONFLICT',409); }
function reason(value,action) { const allowed=action==='activate'?['ROLLBACK']:['IMPORT','CORRECTION']; if(!allowed.includes(value)) fail('INVALID_REASON'); return value; }
module.exports={ROOT,PROGRAMS,READ_ONLY_DATASETS,SOURCE_DATASETS,QUOTE_STATUSES,FIELDS,authorized,scopeOf,date,sourceDate,normalizeSourceDate,decimal,sanitizeRows,quoteStatusFields,expectedRevision,assertRevision,reason,fail};
