const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const fold = value => clean(value).normalize('NFKC').toLowerCase();
export const todaySeoul = () => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(new Date());

function messageDay(stamp) {
  const m = clean(stamp).match(/^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:일|\b|T)/);
  return m ? [m[1], m[2].padStart(2,'0'), m[3].padStart(2,'0')].join('-') : '';
}

export function readImportDay(values, day) {
  const headers = ['요청번호','항목','원문 시각','원문 작성자','분석 담당자','담당자 카톡','차수','원문 거래처','매칭 거래처','원문 품목','매칭 품목','수량','단위','매칭 판정','품목 후보','처리 상태','확인 필요사항','원문','검토 결과','거래처 수정','품목 수정'];
  if (!headers.every((h,i) => values[0]?.[i] === h)) throw Error('schema');
  const messages = new Map(), seen = new Set();
  for (const r of values.slice(1)) {
    if (messageDay(r[2]) !== day) continue;
    const id = clean(r[0]), key = JSON.stringify([id,clean(r[1])]);
    if (!id || seen.has(key)) throw Error('identity');
    seen.add(key);
    if (!messages.has(id)) messages.set(id,{id,time:clean(r[2]),text:String(r[17] ?? ''),week:clean(r[6]),items:[]});
    const label = clean(r[20] || r[10] || r[9]);
    const group = label.match(/^(.*?(?:수국|장미|카네이션|알스트로메리아|알스트로|루스커스|튤립|카라|거베라|국화))\s+(.+)$/i) || (r[10] && !r[20] && label.match(/^([가-힣]+)\s+([A-Z].*)$/i));
    messages.get(id).items.push({key,group:(group?.[1] || '').replace(/^콜\s*(?=수국|장미|카네이션)/,'콜롬비아').replace(/^(콜롬비아|에콰도르|네덜란드|베트남|태국|호주|중국)\s+/,'$1'),product:group?.[2] || label,
      customer:clean(r[19] || r[8] || r[7]), quantity:clean(r[11]),unit:clean(r[12]),status:clean(r[18] || r[13] || r[15])});
  }
  return [...messages.values()].reverse();
}

export function validItem(row) {
  return Boolean(clean(row.product)) && /^\d+(?:\.\d{1,3})?$/.test(clean(row.quantity)) &&
    Number(row.quantity)>0 && Number(row.quantity)<=1e9;
}

export function farmTotals(items) {
  const groups = new Map();
  for (const item of items) {
    if (!item.checked || !validItem(item)) continue;
    const key = JSON.stringify([item.group,item.product,item.unit].map(fold));
    if (!groups.has(key)) groups.set(key,{key,group:clean(item.group),product:clean(item.product),unit:clean(item.unit),milli:0,customers:new Map()});
    const row = groups.get(key), customer = clean(item.customer), qty = Math.round(Number(item.quantity)*1000);
    row.milli += qty;
    if (customer) row.customers.set(customer,(row.customers.get(customer)||0)+qty);
  }
  return [...groups.values()].map(r=>({key:r.key,group:r.group,product:r.product,unit:r.unit,quantity:r.milli/1000,
    notes:[...r.customers].map(([c,n])=>c+' '+n/1000).join(', ')})).sort((a,b)=>a.group.localeCompare(b.group,'ko')||a.product.localeCompare(b.product,'ko'));
}
