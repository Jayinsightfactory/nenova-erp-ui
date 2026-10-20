'use strict';
const {date}=require('./ecountWorkspaceClient.cjs');
function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function renderPrintPreview(model,{company='네노바',periodFrom=null,periodTo=null,title='판매현황',layout=null}={}){
  if(!model||model.format!=='safe-projection'||!Array.isArray(model.columns)||!([4,6,8,9,14].includes(model.columns.length)||(model.columns.length===7&&['quoteStat-detail','orderStat-detail'].includes(layout))||(model.columns.length===5&&['poStat-daily','orderStat-daily'].includes(layout)))||!Array.isArray(model.rows)||model.rows.length>20000)throw Error('INVALID_PRINT_MODEL');
  if(!model.columns.every(c=>c&&typeof c.label==='string'&&c.label.length<=100)||!model.rows.every(row=>Array.isArray(row)&&row.length===model.columns.length&&row.every(v=>v==null||['string','number','boolean'].includes(typeof v))))throw Error('INVALID_PRINT_MODEL');
  if(typeof title!=='string'||title.length>120||typeof company!=='string'||company.length>120)throw Error('INVALID_PRINT_LABEL');
  const from=date(periodFrom),to=date(periodTo);
  if(from&&to&&from>to)throw Error('INVALID_PERIOD');
  const period=from||to?`${from?.replace(/-/g,'/')||'미상'} ~ ${to?.replace(/-/g,'/')||'미상'}`:'조회기간 미상';
  const header=model.columns.map(c=>`<th scope="col">${escapeHtml(c.label)}</th>`).join('');
  const body=model.rows.length?model.rows.map(row=>`<tr>${row.map(value=>`<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${model.columns.length}" class="empty">등록된 데이터가 없습니다.</td></tr>`;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; object-src 'none'; frame-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'; style-src 'unsafe-inline'"><meta name="referrer" content="no-referrer"><title>Print Preview</title>
<style>body{margin:24px;color:#111;background:#fff;font-family:Arial,'Malgun Gothic',sans-serif;font-size:12px}main{width:100%}h1{text-align:center;font-size:25px;margin:20px 0 22px}.meta{display:flex;justify-content:space-between;gap:16px;margin:0 0 5px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:820px;table-layout:fixed}th,td{border:1px solid #d5d8dc;padding:6px 5px;overflow-wrap:anywhere;vertical-align:top}th{background:#f5f6f8;text-align:center;font-weight:600}td{text-align:right}td:nth-child(1),td:nth-child(2),td:nth-child(3),td:nth-child(9){text-align:left}.empty{text-align:center!important}footer{margin-top:8px}@media print{body{margin:0}.table-wrap{overflow:visible}table{min-width:0}thead{display:table-header-group}tr{break-inside:avoid}th{background:#f5f6f8;print-color-adjust:exact}}@page{size:A4 landscape;margin:10mm}</style></head>
<body><main><h1>${escapeHtml(title)}</h1><div class="meta"><span>회사명 : ${escapeHtml(company)}</span><span>${escapeHtml(period)}</span></div><div class="table-wrap"><table aria-label="${escapeHtml(title)}"><thead><tr>${header}</tr></thead><tbody>${body}</tbody></table></div></main></body></html>`;
}
module.exports={renderPrintPreview,escapeHtml};
