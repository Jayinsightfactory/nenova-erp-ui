'use strict';
const menus = require('../data/ecount-workbench/source-menu.json').menus;
const ROOT = 'nenova-ecount';
const PROGRAMS = { cash: 'E010205', ar: 'E040214', ap: 'E040309', sales: 'E040207', quote:'E040202', purchase:'E040304' };
const SOURCE_DATASETS=Object.freeze(['cash','ar','ap','sales']);
const QUOTE_STATUSES=Object.freeze(['in_progress','completed']);
const FIELDS = { cash:['amount','balance'], ar:['salesTotal','receiptTotal','etcDiff','balance'], ap:['openingDebt','stockBuy','acctBuy','payTotal','etcDiff','balance','unbilled'], sales:['qty','unitPrice','supplyAmt','total','vat'], quote:['estimateTotal'], purchase:['amountTotal','foreignTotal','exchangeRate'] };
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
function sanitizeRows(dataset,rows) {
  if(!Object.hasOwn(FIELDS,dataset) || !Array.isArray(rows) || rows.length>20000) fail('INVALID_ROWS');
  return rows.map((row,index)=>{
    if(!row || typeof row!=='object' || Array.isArray(row)) fail('INVALID_ROW');
    const clean={rowNumber:index+1};
    for(const field of FIELDS[dataset]) clean[field]=decimal(row[field]);
    if(row.isSubtotal!=null && ![true,false,0,1].includes(row.isSubtotal)) fail('INVALID_SUBTOTAL');
    clean.isSubtotal=row.isSubtotal===true||row.isSubtotal===1;
    if(dataset==='cash'||dataset==='sales'||dataset==='quote'||dataset==='purchase') {
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
module.exports={ROOT,PROGRAMS,SOURCE_DATASETS,QUOTE_STATUSES,FIELDS,authorized,scopeOf,date,sourceDate,normalizeSourceDate,decimal,sanitizeRows,quoteStatusFields,expectedRevision,assertRevision,reason,fail};
