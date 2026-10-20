'use strict';
const safe=require('./ecountWorkspaceClient.cjs');
const DATE_DATASETS=new Set(['cash','sales','quote']);
function fail(code){throw new Error(code);}
function exact(value){const d=safe.decimal(value);if(d===null)return null;const negative=d.startsWith('-'),parts=d.replace(/^-/,'').split('.');return BigInt(parts[0]+(parts[1]||'').padEnd(8,'0'))*(negative?-1n:1n);}
function compareDecimal(a,b){const left=exact(a),right=exact(b);if(left===right)return 0;if(left===null)return 1;if(right===null)return -1;return left<right?-1:1;}
function isoShift(iso,days){safe.date(iso);const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
function monthStart(iso,offset=0){safe.date(iso);const d=new Date(iso+'T00:00:00Z');d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+offset);return d.toISOString().slice(0,10);}
function datePreset(id,todayISO,options={}){
  if(!safe.date(todayISO))fail('TODAY_REQUIRED');
  let from,to=todayISO;
  if(id==='today')from=todayISO;
  else if(id==='yesterday')from=to=isoShift(todayISO,-1);
  else if(id==='thisMonth')from=monthStart(todayISO);
  else if(id==='previousMonth'){from=monthStart(todayISO,-1);to=isoShift(monthStart(todayISO),-1);}
  else if(id==='previousAndThisMonth')from=monthStart(todayISO,-1);
  else if(id==='recent7')from=isoShift(todayISO,-6);
  else if(id==='thisWeek'||id==='previousWeek'){
    if(!Number.isInteger(options.weekStartsOn)||options.weekStartsOn<0||options.weekStartsOn>6)fail('WEEK_START_REQUIRED');
    const offset=(new Date(todayISO+'T00:00:00Z').getUTCDay()-options.weekStartsOn+7)%7;
    from=isoShift(todayISO,-offset);
    if(id==='previousWeek'){to=isoShift(from,-1);from=isoShift(from,-7);}
  }else fail('UNVERIFIED_PRESET');
  return {from,to};
}
function resetSearch(initial){if(!initial||typeof initial!=='object'||Array.isArray(initial))fail('INITIAL_SEARCH_REQUIRED');return structuredClone(initial);}
function keyboardAction(event){if(event?.altKey||event?.ctrlKey||event?.metaKey||event?.isComposing)return null;return event?.key==='F3'?'open-search':event?.key==='F8'?'run-search':null;}
function filterSortRows({dataset,rows,from=null,to=null,flow='all',sortKey=null,direction='asc',numericFilter=null,quoteStatus='all'}){
  const clean=safe.sanitizeRows(dataset,rows),numericFields=safe.FIELDS[dataset];
  from=safe.date(from);to=safe.date(to);
  if(from&&to&&from>to)fail('INVALID_PERIOD');
  if((from||to)&&!DATE_DATASETS.has(dataset))fail('DATE_FILTER_UNAVAILABLE');
  if(!['all','in','out'].includes(flow)||(flow!=='all'&&dataset!=='cash'))fail('INVALID_FLOW_FILTER');
  if(!['asc','desc'].includes(direction))fail('INVALID_SORT_DIRECTION');
  if(!['all',...safe.QUOTE_STATUSES].includes(quoteStatus)||(quoteStatus!=='all'&&dataset!=='quote'))fail('INVALID_QUOTE_STATUS_FILTER');
  const sortable=new Set([...numericFields,'rowNumber',...(DATE_DATASETS.has(dataset)?['refDate','sourceDateLabel']:[]),...(dataset==='cash'?['flow']:[])]);
  if(sortKey&&!sortable.has(sortKey))fail('INVALID_SORT_KEY');
  let minimum=null,maximum=null;
  if(numericFilter){if(!numericFields.includes(numericFilter.key))fail('INVALID_NUMERIC_FILTER');minimum=exact(numericFilter.min);maximum=exact(numericFilter.max);if(minimum!==null&&maximum!==null&&minimum>maximum)fail('INVALID_NUMERIC_RANGE');}
  let excludedUnknownDate=0;
  const unknownStatusCount=dataset==='quote'?clean.filter(row=>!row.quoteStatus).length:0;
  let excludedUnknownStatusCount=0;
  const filtered=clean.filter(row=>{
    if(from||to){if(!row.refDate){excludedUnknownDate++;return false;}if(from&&row.refDate<from||to&&row.refDate>to)return false;}
    if(flow!=='all'&&({입금:'in',출금:'out',in:'in',out:'out'})[row.flow]!==flow)return false;
    if(numericFilter){const number=exact(row[numericFilter.key]);if(number===null||minimum!==null&&number<minimum||maximum!==null&&number>maximum)return false;}
    if(quoteStatus!=='all'&&row.quoteStatus!==quoteStatus){if(!row.quoteStatus)excludedUnknownStatusCount++;return false;}
    return true;
  });
  if(sortKey)filtered.sort((a,b)=>{
    const left=a[sortKey],right=b[sortKey];
    // Unknown values remain last in both directions, stable ties retain original order.
    if(left==null||right==null)return left==null?(right==null?a.rowNumber-b.rowNumber:1):-1;
    let compared=numericFields.includes(sortKey)?compareDecimal(left,right):sortKey==='rowNumber'?left-right:String(left).localeCompare(String(right),'ko');
    return compared===0?a.rowNumber-b.rowNumber:compared*(direction==='desc'?-1:1);
  });
  const statusCoverage=dataset!=='quote'?'not_applicable':!clean.length||unknownStatusCount===clean.length?'unknown':unknownStatusCount?'partial':'known';
  return {rows:filtered,unknownDateCount:excludedUnknownDate,totalRows:clean.length,unknownStatusCount,excludedUnknownStatusCount,statusCoverage};
}
function buildExportModel({dataset,rows,columns,title=''}){
  if(!Array.isArray(columns)||columns.length>50||!columns.every(c=>c&&typeof c.key==='string'&&typeof c.label==='string'&&c.label.length<100))fail('INVALID_COLUMNS');
  if(typeof title!=='string'||title.length>120)fail('INVALID_TITLE');
  const clean=safe.sanitizeRows(dataset,rows).map((row,index)=>({...row,rowNumber:Number.isInteger(rows[index].rowNumber)&&rows[index].rowNumber>0&&rows[index].rowNumber<=20000?rows[index].rowNumber:row.rowNumber}));
  const allowed=new Set([...safe.FIELDS[dataset],'rowNumber','isSubtotal',...(DATE_DATASETS.has(dataset)?['refDate','sourceDateLabel']:[]),...(dataset==='cash'?['flow']:[])]);
  return {title,columns:columns.map(({key,label})=>({key,label})),rows:clean.map(row=>columns.map(column=>allowed.has(column.key)?(row[column.key]??''):'')),format:'safe-projection',sourceLayoutVerified:false};
}
function csvCell(value){let text=String(value??'');if(/^[\s]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text))text="'"+text;return '"'+text.replace(/"/g,'""')+'"';}
function toCsv(model){if(!model||model.format!=='safe-projection'||!Array.isArray(model.columns)||!Array.isArray(model.rows))fail('INVALID_EXPORT_MODEL');return '\uFEFF'+[model.columns.map(c=>csvCell(c.label)).join(','),...model.rows.map(row=>row.map(csvCell).join(','))].join('\r\n');}
module.exports={compareDecimal,datePreset,resetSearch,keyboardAction,filterSortRows,buildExportModel,toCsv};
