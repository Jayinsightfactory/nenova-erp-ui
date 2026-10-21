// Read-only preparation and scoped review notes. Never substitutes an expected value into a source.
export function storedShillaSource(db, year) {
  const rows=db.filter(r=>String(r.year)===String(year));
  if(!rows.length) throw new Error('선택 연도에 저장된 신라 손익자료가 없습니다. 원본 엑셀을 첨부해 주세요.');
  const periods=[...new Set(rows.map(r=>r.period))].map(period=>{
    const items=rows.filter(r=>r.period===period);
    const dates=[...new Set(items.map(r=>r.quoteDate).filter(Boolean))];
    return {period,date:dates.length===1?dates[0]:null,count:items.length,warnings:dates.length===1?[]:[`${period}차 기준일 확인 필요`]};
  });
  return {rows,periods};
}
export function shillaDefaultRange(periods,year,today) {
  if(!/^20\d{2}$/.test(String(year))||String(year)>today.slice(0,4)) throw new Error('조회 가능한 결산 연도를 선택하세요.');
  const dates=periods.map(p=>p.date).filter(d=>typeof d==='string'&&d.startsWith(`${year}-`)).sort();
  const first=dates[0]||`${year}-01-01`,last=dates.at(-1)||`${year}-12-31`;
  const end=new Date(Date.UTC(Number(year),Number(last.slice(5,7)),0)).toISOString().slice(0,10);
  return {from:`${first.slice(0,7)}-01`,to:end>today?today:end};
}
const sum=(rows,key)=>rows.length&&rows.every(r=>r[key]!=null&&Number.isFinite(Number(r[key])))?rows.reduce((s,r)=>s+Number(r[key]),0):null;
export function shillaReviewStatus(line,known=[]) {
  if(line.conflict) return '추가 확인';
  const note=known.find(k=>Number(k.prodKey)===Number(line.prodKey)&&k.period===line.period);
  if(note) {
    // A DB/receipt case note cannot certify a changed workbook baseline.
    if(note.status==='확인 기준 일치'&&(line.excel?.qty!==note.expected||line.excel?.amount!==note.expected*note.price)) return '추가 확인';
    return note.status;
  }
  return line.salesExplained?'판매요청 정상':line.status==='세 자료 수치 일치 후보'?'일치 후보':'추가 확인';
}
export function shillaKnownReviews({scope,db,receipts}) {
  if(String(scope.year)!=='2026') return [];
  const cases=[
    {id:'sinensis-40',period:'40',prodKey:2158,name:'시네신스',from:'2026-10-05',to:'2026-10-09',code:'50103916',expected:647,price:9200,pending:220,note:'사용자 확인: 신라 입고에 있는 220단의 수정이 아직 반영되지 않은 건. 차이 원본을 유지하고 수정 대기로 추적합니다.'},
    {id:'white-39',period:'39',prodKey:3074,name:'호접 화이트',from:'2026-09-30',to:'2026-09-30',code:'50040599',expected:485,price:13000,note:'사용자 확인 기준 485개. 39-2차 16개와 별개로 확인합니다. 저장 수량을 자동으로 바꾸지 않습니다.'},
  ];
  return cases.filter(c=>scope.periods.includes(c.period)).map(c=>{
    const saved=db.filter(r=>String(r.year)===String(scope.year)&&r.period===c.period&&Number(r.prodKey)===c.prodKey);
    const actual=receipts.filter(r=>r.date>=c.from&&r.date<=c.to&&String(r.code)===c.code);
    const covered=scope.from<=c.from&&scope.to>=c.to;
    const savedQty=sum(saved,'qty'),receiptQty=covered?sum(actual,'qty'):null;
    const unique=new Set(actual.map(r=>JSON.stringify([r.date,r.site,r.receiptNo,r.receiptItem]))).size===actual.length;
    const pricesOK=unique&&actual.length>0&&actual.every(r=>r.unit===(c.pending?'PK':'EA')&&Number(r.price)===c.price&&Number(r.amount)===Number(r.qty)*c.price);
    const savedOK=saved.length>0&&saved.every(r=>r.unit===(c.pending?'단':'8스팀')&&Number(r.price)===c.price&&Number(r.amount)===Number(r.qty)*c.price);
    let status='추가 확인';
    if(covered&&pricesOK&&savedOK) {
      if(savedQty===c.expected&&receiptQty===c.expected) status='확인 기준 일치';
      else if(c.pending&&savedQty===c.expected&&receiptQty===c.expected-c.pending) status='수정 대기';
      else if(!c.pending&&receiptQty===c.expected&&savedQty===501) status='수정 필요';
    }
    const savedAmount=sum(saved,'amount'),receiptAmount=covered?sum(actual,'amount'):null;
    return {...c,status,savedQty,receiptQty,amountDifference:savedAmount!=null&&receiptAmount!=null?savedAmount-receiptAmount:null,
      sources:actual.map(r=>`${r.date} ${r.receiptNo}/${r.receiptItem}`),covered};
  });
}
