'use strict';
const report=require('../../lib/ecountDailyReport.cjs');
function rows(){return report.TABLES.flatMap(t=>Array.from({length:t.count},(_,sourceRow)=>{const total=(t.section==='ar'||t.section==='ap'||t.index===50)&&sourceRow===t.count-1;const row={sectionKind:t.section,sourceTable:t.index,sourceRow,rowKind:total?'total':'data'};for(const key of report.FIELDS[t.section])row[key]=sourceRow%2===0?null:'12345678901234567890.12345678';if(t.section==='stock')row.productCode=total?null:'TEST-'+t.index+'-'+sourceRow;if(t.section==='cumulative')Object.assign(row,{category:report.CATEGORIES[Math.floor(sourceRow/3)],periodKind:report.PERIODS[sourceRow%3],periodLabel:report.PERIOD_LABELS[sourceRow%3]});return row;}));}
function input(){return {dataset:'dayAll',menuId:'MENUTREE_000218',periodFrom:'2026-10-20',periodTo:'2026-10-20',rows:rows(),coverage:report.PROFILE,action:'import',expectedRevision:0,reasonCode:'IMPORT'};}
module.exports={rows,input};
