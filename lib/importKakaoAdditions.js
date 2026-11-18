const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const fold = value => clean(value).normalize('NFKC').toLowerCase();
export const todaySeoul = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);

function messageDay(stamp) {
  const m = clean(stamp).match(/^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:일|\b|T)/);
  return m ? [m[1], m[2].padStart(2,'0'), m[3].padStart(2,'0')].join('-') : '';
}

function messageOrder(stamp) {
  const day = messageDay(stamp);
  const time = clean(stamp).match(/(?:(오전|오후)\s*)?(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!time) return day + ' 00:00:00';
  let hour = Number(time[2]);
  if (time[1]) hour = hour % 12 + (time[1] === '오후' ? 12 : 0);
  return `${day} ${String(hour).padStart(2, '0')}:${time[3]}:${time[4] || '00'}`;
}

export function readImportDay(values, day, from = day) {
  const headers = ['요청번호','항목','원문 시각','원문 작성자','분석 담당자','담당자 카톡','차수','원문 거래처','매칭 거래처','원문 품목','매칭 품목','수량','단위','매칭 판정','품목 후보','처리 상태','확인 필요사항','원문','검토 결과','거래처 수정','품목 수정'];
  if (!headers.every((h,i) => values[0]?.[i] === h)) throw Error('schema');
  const messages = new Map(), seen = new Set();
  for (const r of values.slice(1)) {
    const date = messageDay(r[2]);
    if (!date || date < from || date > day) continue;
    const id = clean(r[0]), key = JSON.stringify([id,clean(r[1])]);
    if (!id || seen.has(key)) throw Error('identity');
    seen.add(key);
    if (!messages.has(id)) messages.set(id,{id,time:clean(r[2]),text:String(r[17] ?? ''),week:clean(r[6]),items:[]});
    const label = clean(r[20] || r[10] || r[9]);
    const group = label.match(/^(.*?(?:수국|장미|카네이션|알스트로메리아|알스트로|루스커스|튤립|카라|거베라|국화))\s+(.+)$/i) || (r[10] && !r[20] && label.match(/^([가-힣]+)\s+([A-Z].*)$/i));
    messages.get(id).items.push({key,group:(group?.[1] || '').replace(/^콜\s*(?=수국|장미|카네이션)/,'콜롬비아').replace(/^(콜롬비아|에콰도르|네덜란드|베트남|태국|호주|중국)\s+/,'$1'),product:group?.[2] || label,
      customer:clean(r[19] || r[8] || r[7]), quantity:normalizeImportQuantity(r[11]),unit:clean(r[12]),status:clean(r[18] || r[13] || r[15]),
      reviewReason: importReviewReason(r)});
  }
  return [...messages.values()].reverse().sort((a, b) => messageOrder(b.time).localeCompare(messageOrder(a.time)));
}

export function readRecentImports(values, now = new Date()) {
  const to = todaySeoul(now);
  const from = new Date(Date.parse(to + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  const messages = readImportDay(values, to, from);
  const latest = values.slice(1).map(row => clean(row[2])).filter(value => messageDay(value) && messageDay(value) <= to)
    .sort((a, b) => messageOrder(b).localeCompare(messageOrder(a)))[0] || '';
  return { messages, from, to, latest };
}

export function validItem(row) {
  return Boolean(clean(row.product)) && /^\d+(?:\.\d{1,3})?$/.test(clean(row.quantity)) &&
    Number(row.quantity)>0 && Number(row.quantity)<=1e9;
}

function normalizeImportQuantity(value) {
  const quantity = clean(value);
  return /^\d{1,3}(?:,\d{3})+(?:\.\d{1,3})?$/.test(quantity) ? quantity.replace(/,/g, '') : quantity;
}

function importReviewReason(row) {
  const state = clean(row[15]);
  if (/cancelled|superseded|archived/i.test(state)) return '취소·대체된 요청 확인 필요';
  if (/취소|수량\s*(?:변경|정정)|반품/.test(String(row[17] || '') + ' ' + clean(row[18]))) return '취소·변경 내용 확인 필요';
  return '';
}

export function importItemView(item, edits = {}) {
  const row = { ...item, ...edits };
  const automatic = validItem(row) && !item.reviewReason;
  return { ...row, checked: edits.checked ?? automatic };
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
