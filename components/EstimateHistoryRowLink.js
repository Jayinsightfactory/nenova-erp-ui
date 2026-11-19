import React from 'react';
import core from '../lib/estimateChangeHistoryCore.cjs';
export default function EstimateHistoryRowLink({row,year,week,custKey}){
 const key=core.rowKey(row);if(!key||!custKey||!year||!week)return null;
 const href=`/estimate-change-history?year=${encodeURIComponent(year)}&week=${encodeURIComponent(String(week).split('-')[0])}&custKey=${custKey}&rowKey=${encodeURIComponent(key)}&tab=history`;
 return <a className="btn btn-sm no-print" style={{marginLeft:6,whiteSpace:'nowrap'}} href={href} onClick={e=>e.stopPropagation()} aria-label={`${row.ProdName||'품목'} 변경 이력`}>변경 이력</a>;
}
