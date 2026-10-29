import {parseBaseStockQuantityLine, isBaseStockHeaderLine} from './pasteStockProjection.js';

const clean = n => Math.round(n * 1e6) / 1e6;
export const normalizeName = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase();
export function validLedgerWeek(week) {
  const m = /^(20\d{2})-(\d{2})-(\d{2})$/.exec(week || '');
  return !!m && +m[2] >= 1 && +m[2] <= 53 && +m[3] >= 1 && +m[3] <= 99;
}
export function parseLedgerBase(text) {
  const seen = new Set();
  return String(text).split(/\r?\n/).map((raw, index) => {
    if (!raw.trim() || isBaseStockHeaderLine(raw.trim())) return {raw, index};
    const row = parseBaseStockQuantityLine(raw);
    if (!row) return {raw, index}; // Section headings remain literal.
    const key = normalizeName(row.name);
    if (seen.has(key)) throw new Error(`${index + 1}줄: ${row.name} 품목명이 중복됩니다. 구분할 이름으로 입력하세요.`);
    if (row.qty < 0 || !Number.isFinite(row.qty)) throw new Error(`${row.name}: 시작재고는 0 이상이어야 합니다.`);
    seen.add(key);
    return {...row, raw, index, key, detailQty: row.detailQty ?? 0};
  });
}
export function calculateLedger(baseText, events = []) {
  const lines = parseLedgerBase(baseText);
  const rows = new Map(lines.filter(r => r.key).map(r => [r.key, {...r, remaining:r.qty, remainingDetail:r.detailQty, customers:{}, history:[]} ]));
  for (const event of events) {
    if (event.voided) continue;
    const row = rows.get(event.product);
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
export function analyzeLedgerText(text, baseText, week) {
  const rows = parseLedgerBase(baseText).filter(r => r.key), changes = [], errors = [];
  let customer = '';
  const lines = String(text).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  for (let i=0;i<lines.length;i++) {
    const line=lines[i];
    if (/^[-_=─ㅡ]{3,}$/.test(line)) continue;
    const header=/^(?:(20\d{2})-)?(\d{1,2})-(\d{1,2})(?:\s|차|$)/.exec(line);
    if (header) {
      const full=`${header[1] || week.slice(0,4)}-${header[2].padStart(2,'0')}-${header[3].padStart(2,'0')}`;
      if(full!==week) errors.push(`${i+1}줄: 원문 차수 ${full}가 재고장 ${week}와 다릅니다.`);
      continue;
    }
    const match=/^(.+?)\s+([0-9]+(?:\.[0-9]+)?)\s*(박스|단|송이|개)?\s*(추가|취소|변경)$/.exec(line);
    if (match) {
      const hits=rows.filter(r=>r.key===normalizeName(match[1]));
      if(hits.length!==1 || !customer) {errors.push(`${i+1}줄: 업체 또는 품목을 확인하세요 — ${line}`);continue;}
      changes.push({product:hits[0].key,name:hits[0].name,customer,qty:Number(match[2]),unit:match[3] || hits[0].unit || '박스',mode:({'추가':'ADD','취소':'CANCEL','변경':'SET'})[match[4]],memo:''});
    } else if(!/\d|추가|취소|변경/.test(line) && /^.+\s+[0-9]/.test(lines[i+1] || '')) customer=line;
    else errors.push(`${i+1}줄: 직접 입력에서 확인하세요 — ${line}`);
  }
  if(!changes.length) errors.push('인식된 변경이 없습니다. 업체명 다음 줄에 “문라이트 1추가”처럼 입력하세요.');
  return {changes,errors};
}
