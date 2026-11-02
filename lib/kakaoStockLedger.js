import {parseBaseStockQuantityLine, isBaseStockHeaderLine} from './pasteStockProjection.js';

const clean = n => Math.round(n * 1e6) / 1e6;
export const normalizeName = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export function validLedgerWeek(week) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(week || '');
  return !!m && +m[2] >= 1 && +m[2] <= 53 && +m[3] >= 1 && +m[3] <= 99;
}
export function parseStockSection(text) {
  const m=/^(?:(20\d{2})\s*-\s*)?(\d{1,2})\s*-\s*(\d{1,2})\s*(?:차)?\s*(.*)$/.exec(String(text).trim());
  if(!m)return null;
  const year=m[1]||'',shortWeek=m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
  if(!validLedgerWeek((year||'2026')+'-'+shortWeek))throw Error('구분 제목의 차수를 확인하세요: '+text);
  const tail=m[4].trim(),flowers=[...tail.matchAll(/카네이션|장미|수국|알스트로(?:메리아)?/g)].map(m=>m[0].startsWith('알스트로')?'알스트로':m[0]);
  if(new Set(flowers).size>1)throw Error('한 구분 제목에는 품종을 하나만 입력하세요: '+text);
  const flower=flowers.length?[null,flowers[0]]:null;
  const category=flower?(flower[1].startsWith('알스트로')?'알스트로':flower[1]):tail.replace(/^콜\s*/,'').replace(/변경사항.*$/,'').trim();
  return {year,shortWeek,category:normalizeName(category),label:String(text).trim()};
}
export function parseLedgerBase(text) {
  const seen=new Set();let section=null;
  return String(text).split(/\r?\n/).map((raw,index)=>{
    const header=parseStockSection(raw);
    if(header){section=header;return {raw,index,sectionHeader:header};}
    if(!raw.trim()||isBaseStockHeaderLine(raw.trim()))return {raw,index};
    const row=parseBaseStockQuantityLine(raw);
    if(!row)return {raw,index};
    const nameKey=normalizeName(row.name);
    const key=section?JSON.stringify(['section',section.year,section.shortWeek,section.category,nameKey]):nameKey;
    if(seen.has(key))throw Error(`${index+1}줄: ${section?.label||'같은 구역'}의 ${row.name} 품목명이 중복됩니다. 같은 차수·품종 안의 중복을 확인하세요.`);
    if(row.qty<0||!Number.isFinite(row.qty))throw Error(row.name+': 시작재고는 0 이상이어야 합니다.');
    seen.add(key);return {...row,raw,index,key,nameKey,section,detailQty:row.detailQty??0};
  });
}
export function ledgerScopeWeeks(base,bookWeek){
  try{const sections=parseLedgerBase(base).filter(r=>r.key&&r.section);return sections.length?[...new Set(sections.map(r=>(r.section.year||bookWeek.slice(0,4))+'-'+r.section.shortWeek))]:[bookWeek];}catch{return [];}
}
export function calculateLedger(baseText, events = []) {
  const lines = parseLedgerBase(baseText);
  const rows = new Map(lines.filter(r => r.key).map(r => [r.key, {...r, remaining:r.qty, remainingDetail:r.detailQty, customers:{}, history:[]} ]));
  for (const event of events) {
    if (event.voided) continue;
    let row = rows.get(event.product);
    if(!row&&!String(event.product).startsWith('["section",')){const matches=[...rows.values()].filter(r=>r.nameKey===normalizeName(event.name||event.product));if(matches.length===1)row=matches[0];else if(matches.length>1)throw Error('기존 변경내역의 차수·품종 구역을 확정할 수 없습니다: '+(event.name||event.product)+'. 이전 기초재고를 유지하거나 새 페이지에서 입력하세요.');}
    if (!row) throw new Error(`변경내역의 품목이 시작재고에 없습니다: ${event.name || event.product}`);
    const customer = String(event.customer || '').trim();
    const qty = Number(event.qty);
    if (!customer || event.qty === '' || !Number.isFinite(qty) || qty < 0 || !['ADD','CANCEL','SET','BASELINE'].includes(event.mode)) throw new Error('업체·수량·변경 방식을 확인하세요.');
    const detail = event.unit === row.detailUnit && !!row.detailUnit;
    if (!detail && event.unit !== (row.unit || '박스')) throw new Error(`${row.name}: 시작재고와 같은 단위를 선택하세요.`);
    const customerKey = JSON.stringify([normalizeName(customer), event.unit]);
    const before = row.customers[customerKey]?.qty ?? 0;
    const after = clean(event.mode === 'ADD' ? before + qty : event.mode === 'CANCEL' ? before - qty : qty);
    if (after < 0) throw new Error(`${customer} ${row.name}: 취소수량이 현재 ${before}${event.unit}보다 큽니다. 기존 주문을 먼저 입력하세요.`);
    const stockBefore = detail ? row.remainingDetail : row.remaining;
    const stockAfter = clean(stockBefore - (after - before));
    row.customers[customerKey] = {customer, unit:event.unit, qty:after};
    if (detail) row.remainingDetail = stockAfter; else row.remaining = stockAfter;
    row.history.push({...event, before, after, stockBefore, stockAfter});
  }
  return {lines, rows:[...rows.values()]};
}
export function ledgerCopy(ledger, withHistory = true) {
  const map = new Map(ledger.rows.map(r => [r.key, r]));
  return ledger.lines.map(line => {
    if (!line.key) return line.raw;
    const row = map.get(line.key);
    const vector = (a,b) => `${a}${row.unit || ''}${row.detailUnit ? ` + ${b}${row.detailUnit}` : ''}`;
    const changes = row.history.filter(e => e.mode !== 'BASELINE').map(e => `${e.customer} ${e.before}>${e.after}${row.detailUnit ? e.unit : ''}(${e.stockBefore}>${e.stockAfter})${e.memo ? ` ${e.memo.replace(/\r?\n/g,' ')}` : ''}`);
    return `${row.name} ${vector(row.remaining,row.remainingDetail)}${withHistory && changes.length ? ` 시작${vector(row.qty,row.detailQty)} ${changes.join(', ')}` : ''}`;
  }).join('\n');
}
// Deliberately bounded grammar: unknown lines are reviewed, never silently applied.
export function analyzeLedgerText(text,baseText,week,options={}) {
  const rows=parseLedgerBase(baseText).filter(r=>r.key),changes=[],errors=[];
  const scoped=rows.some(r=>r.section),baseYear=week.slice(0,4);
  const sourceYear=options.sourceWeek?.slice(0,4)||baseYear;
  let customer='',section=options.sourceWeek?parseStockSection(options.sourceWeek):null;
  const lines=String(text).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const line=lines[i];if(/^[-_=─ㅡ]{3,}$/.test(line))continue;
    let header;try{header=parseStockSection(line);}catch(e){errors.push(e.message);continue;}
    if(header){section={...header,year:header.year||sourceYear};customer='';const full=section.year+'-'+section.shortWeek;if(!scoped&&full!==week)errors.push(`${i+1}줄: 원문 차수 ${full}가 재고장 ${week}와 다릅니다.`);else if(scoped&&!rows.some(r=>r.section&&(r.section.year||baseYear)===section.year&&r.section.shortWeek===section.shortWeek&&(!section.category||r.section.category===section.category)))errors.push(`${i+1}줄: 기초재고에 해당 차수·품종 구역이 없습니다 — ${line}`);continue;}
    const match=/^(.+?)\s+([0-9]+(?:\.[0-9]+)?)\s*(박스|단|송이|개)?\s*(추가|취소|변경)$/.exec(line);
    if(match){
      const hits=rows.filter(r=>r.nameKey===normalizeName(match[1])&&(!scoped||!section||!!r.section&&(r.section.year||baseYear)===(section.year||sourceYear)&&r.section.shortWeek===section.shortWeek&&(!section.category||r.section.category===section.category)));
      if(hits.length!==1||!customer){errors.push(`${i+1}줄: 업체·차수·품종을 확인하세요. 같은 품목이 여러 구역이면 구분 제목을 넣으세요 — ${line}`);continue;}
      changes.push({product:hits[0].key,name:hits[0].name,sectionLabel:hits[0].section?.label||'',customer,qty:Number(match[2]),unit:match[3]||hits[0].unit||'박스',mode:({'추가':'ADD','취소':'CANCEL','변경':'SET'})[match[4]],memo:''});
    }else if(!/\d|추가|취소|변경/.test(line)&&/^.+\s+[0-9]/.test(lines[i+1]||''))customer=line;
    else errors.push(`${i+1}줄: 직접 입력에서 확인하세요 — ${line}`);
  }
  if(!changes.length)errors.push('인식된 변경이 없습니다. 업체명 다음 줄에 “문라이트 1추가”처럼 입력하세요.');
  return {changes,errors};
}
