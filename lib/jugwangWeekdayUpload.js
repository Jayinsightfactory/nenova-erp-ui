// Source quantities are positive absolute targets. Blank/zero never means deletion.
const text = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const family = value => text(value).replace(/\s/g, '').match(/카네이션|장미|수국|알스트로(?:메리아)?/)?.[0]?.replace('알스트로메리아', '알스트로') || '';
const isTotal = value => /합계|소계/.test(text(value).replace(/\s/g, ''));
function fail(message) { throw new Error(message); }
export function jugwangUploadScope(year, week) {
  const match = String(week).match(/^(?:(\d{4})-)?(\d{2})-(0[12])$/);
  if (!match || !/^20\d{2}$/.test(String(year)) || Number(year) < 2026 || (match[1] && match[1] !== String(year))) fail('명시 연도와 01/02 세부차수를 확인하세요.');
  return { year: String(year), orderWeek: `${match[2]}-${match[3]}`, custKey: 533 };
}
function date(year, month, day) {
  const value = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10) !== value) fail('원본 날짜를 확인하세요.');
  return value;
}
export function parseJugwangWeekdaySheet(XLSX, book, sheetName, scope) {
  const ws = book.Sheets[sheetName];
  if (!ws || book.Workbook?.Sheets?.[book.SheetNames.indexOf(sheetName)]?.Hidden) fail('표시된 원본 시트를 선택하세요.');
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
  if (range.e.r > 5000 || range.e.c > 128) fail('원본 시트 크기를 확인하세요.');
  const cell = (r,c) => ws[XLSX.utils.encode_cell({r,c})];
  const value = (r,c) => text(cell(r,c)?.v);
  const warnings = [], rows = [];
  const positive = (r,c) => {
    const raw = cell(r,c);
    if (!raw || raw.v === '' || raw.v == null) return null;
    if (raw.f) { warnings.push(`${XLSX.utils.encode_cell({r,c})}: 수식 수량은 원본 확인 필요`); return null; }
    const q = typeof raw.v === 'number' ? raw.v : /^[\d,.]+$/.test(text(raw.v)) ? Number(text(raw.v).replace(/,/g,'')) : NaN;
    if (!Number.isFinite(q) || q < 0) { warnings.push(`${XLSX.utils.encode_cell({r,c})}: 숫자 수량 확인 필요`); return null; }
    return q > 0 ? q : null;
  };
  const push = (r,label,category,dates,unit) => {
    if (!label || isTotal(label) || !category || !dates.length) return;
    rows.push({ id: `${sheetName}!${r+1}`, label, category, sourceUnit: unit || '', dates, sourceRow: r+1 });
  };
  // Web export: only the explicit subweek; ignore baseline, remainder, and totals.
  const web = /주광 발주내역/.test(value(0,0));
  if (web) {
    if (!value(0,0).includes('주광')) fail('주광 원본이 아닙니다.');
    const target = scope.orderWeek.replace('-0','-');
    const starts = Array.from({length:range.e.c+1},(_,c)=>c).filter(c => value(1,c) === target);
    if (starts.length !== 1) fail('선택 세부차수의 원본 열이 없거나 중복입니다.');
    const start = starts[0], columns = [];
    for (let c=start;c<=range.e.c;c++) {
      if (c>start && value(1,c)) break;
      const header=value(2,c), md=header.match(/(\d{1,2})\/(\d{1,2})/);
      if (!md || /합계|선출고|기출고|사용/.test(header)) continue;
      columns.push({c,date:date(scope.year,md[1],md[2])});
    }
    let category=family(value(1,0));
    for(let r=3;r<=range.e.r;r++) {
      if (value(r,0)) category=family(value(r,0));
      const label=value(r,1);
      if (!label || label==='품목' || scope.category && category !== scope.category || isTotal(label)) continue;
      const byDate=new Map();
      for(const col of columns) { const q=positive(r,col.c); if(q!=null) { const old=byDate.get(col.date)||{date:col.date,quantity:0,cells:[]};old.quantity+=q;old.cells.push(XLSX.utils.encode_cell({r,c:col.c}));byDate.set(col.date,old); } }
      // Sunday sum is a check, not another input. A mismatch blocks that file.
      for(let c=start;c<=range.e.c && (c===start||!value(1,c));c++) {
        const h=value(2,c), md=h.match(/(\d{1,2})\/(\d{1,2})/);
        if(md && /합계/.test(h) && cell(r,c)?.v != null && cell(r,c)?.v !== '') {
          const sum=Number(cell(r,c).v), expected=byDate.get(date(scope.year,md[1],md[2]))?.quantity||0;
          if(!Number.isFinite(sum)||Math.abs(sum-expected)>1e-6) warnings.push(`${XLSX.utils.encode_cell({r,c})}: 일요일 합계 불일치`);
        }
      }
      push(r,label,category,[...byDate.values()],'');
    }
  } else {
    // Native customer workbook: Sunday title anchors month/year. Other weekdays
    // must be explicit scheduled dates; usage notes and earlier shipments excluded.
    const title=value(0,0), anchor=title.match(/(20\d{2})년\s*(\d{1,2})월\s*(\d{1,2})일.*출고/);
    if(!anchor || anchor[1]!==scope.year) fail('시트 제목의 출고 연도·월·일을 확인하세요.');
    const anchorDate=date(...anchor.slice(1)), weekday=new Date(`${anchorDate}T00:00:00Z`).getUTCDay();
    if(weekday!==0) fail('지원 원본의 일요일 출고 제목과 다릅니다. 날짜를 추정하지 않습니다.');
    let category='', columns=[], unit='';
    for(let r=1;r<=range.e.r;r++) {
      const headers=Array.from({length:Math.min(range.e.c+1,30)},(_,c)=>value(r,c));
      if(headers.some(h=>/발주수량/.test(h))) {
        category=family(headers[0]); columns=[];
        const orderCols=headers.map((h,c)=>({h,c})).filter(x=>/발주수량/.test(x.h));
        const order=orderCols.find(x=>/박스/.test(x.h)) || orderCols[0];
        unit=order && /단/.test(order.h)?'단':order && /박스/.test(order.h)?'박스':'';
        if(scope.orderWeek.endsWith('01') && order) {
          columns.push({c:order.c,date:anchorDate});
          const wilson=headers.findIndex(h=>/부산윌슨/.test(h));
          if(wilson>=0) columns.push({c:wilson,date:anchorDate});
        }
        if(scope.orderWeek.endsWith('02')) headers.forEach((h,c)=>{
          const d=h.match(/(\d{1,2})일/);
          if(!d||!/출고 예정|출고예정/.test(h)||/선출고|기출고|사용/.test(h))return;
          const candidates=[-1,0,1].map(offset=>{const dt=new Date(`${anchorDate}T00:00:00Z`);dt.setUTCMonth(dt.getUTCMonth()+offset,Number(d[1]));return dt.toISOString().slice(0,10);}).filter(v=>v>anchorDate && (Date.parse(v)-Date.parse(anchorDate))/86400000<=3);
          if(candidates.length!==1) fail('원본 출고예정 날짜가 모호합니다.');
          columns.push({c,date:candidates[0]});
        });
        continue;
      }
      if (!value(r,1) || isTotal(value(r,1)) || scope.category && category !== scope.category) continue;
      const byDate=new Map();
      for(const col of columns) {const q=positive(r,col.c);if(q!=null){const old=byDate.get(col.date)||{date:col.date,quantity:0,cells:[]};old.quantity+=q;old.cells.push(XLSX.utils.encode_cell({r,c:col.c}));byDate.set(col.date,old);}}
      push(r,value(r,1),category,[...byDate.values()],unit);
    }
  }
  return {rows,warnings:[...new Set(warnings)],sheetName,scope};
}

export function checkJugwangExisting(change, actual, orderQuantity) {
  const total=change.dates.reduce((sum,d)=>sum+d.quantity,0);
  if(!(orderQuantity>0) || total>orderQuantity+1e-6) fail('활성 주문이 없거나 요일합이 기존 주문수량을 초과합니다. 주문은 변경하지 않습니다.');
  if(actual.detailRows) {
    const existing=actual.shipmentDates||[];
    if(existing.length!==change.dates.length || change.dates.some(d=>!existing.some(e=>e.date===d.date&&Math.abs(e.shipmentQuantity-d.quantity)<1e-6)) || Math.abs(Number(actual.shipmentOutQuantity)-total)>1e-6) fail('기존 분배와 원본이 다릅니다. 기존 분배를 덮어쓰지 않았습니다.');
    return 'UNCHANGED';
  }
  if(actual.master?.MasterIsFix) fail('확정된 출고에는 신규 요일분배를 추가하지 않습니다.');
  return 'NEW';
}
