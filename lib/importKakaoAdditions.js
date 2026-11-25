import { canonicalImportCountry } from './importToolsDisplay.js';

const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const fold = value => clean(value).normalize('NFKC').toLowerCase();
export const todaySeoul = (now = new Date()) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul' }).format(now);

// Verified farm aliases only: the Korean chat spellings already confirmed against FarmName in
// lib/shipmentFarmText.js plus the recipient names used by the country order generator.
// Unverified names are recognised only with an explicit header marker or a registered farm list.
const BUILTIN_FARM_ENTRIES = [
  ['The Elite Flowers', ['theeliteflowers', 'elite', '엘리떼', '엘리테']],
  ['FLORES Tiba', ['florestiba', 'tiba', '티바']],
  ['Natuflora', ['natuflora', '나투']],
  ['Ayura', ['ayura', '아유라']],
  ['Kikuyal', ['kikuyal', '키쿠얄']],
  ['Matina', ['matina', '마티나']],
  ['Daflor', ['daflor', '다플로르', '다플로러']],
  ['Varietta', ['varietta', 'varieta', '바리에타']],
  ['Valores', ['valores', '발로레스']],
  ['Invos', ['invos', '인보스']],
  ['Melody', ['melody', '멜로디']],
  ['CLOUD', ['cloud', '클라우드']],
  ['HUBFRESH', ['hubfresh', '허브프레시', '허브프레쉬']],
];

const GENERIC_NON_FARM_RE = /^(?:지정|좋은|아무|가능한|추천|다른|기존|동일|같은|선호|일반|기본|확인|발주|주문|추가|취소|변경|합계|소계|총계|전체|수입방|농장|farm|farms)$/i;

export function farmMatchKey(value) {
  const base = clean(value)
    .normalize('NFKC')
    .replace(/^[\[【〔<(（■▶◆●▣★☆\-·•:：\s]+|[\]】〕>)）\s:：\-]+$/g, '')
    .toLowerCase();
  if (!base) return '';
  const stripped = base
    .replace(/\b(?:the|farms?|flowers?|flora|ltda|s\.?a\.?s\.?|inc|co|corp)\b/gi, '')
    .replace(/(?:농장|플라워|화훼)$/g, '')
    .replace(/[\s·_*☆★※△()（）[\]<>.,\-/\\'"`]/g, '');
  return stripped || base.replace(/[\s·_*☆★※△()（）[\]<>.,\-/\\'"`]/g, '');
}

const BUILTIN_FARM_BY_KEY = new Map();
for (const [canonical, aliases] of BUILTIN_FARM_ENTRIES) {
  BUILTIN_FARM_BY_KEY.set(farmMatchKey(canonical), canonical);
  for (const alias of aliases) {
    BUILTIN_FARM_BY_KEY.set(farmMatchKey(alias), canonical);
    BUILTIN_FARM_BY_KEY.set(fold(alias).replace(/\s+/g, ''), canonical);
  }
}

export function isKnownFarmToken(value, knownFarms = []) {
  const trimmed = clean(value).replace(/^[\[【〔<(（■▶◆●▣★☆\-·•:：\s]+|[\]】〕>)）\s:：\-]+$/g, '');
  if (!trimmed || GENERIC_NON_FARM_RE.test(trimmed)) return false;
  const strippedGeneric = trimmed.replace(/\s*(?:농장|farms?)$/i, '').trim();
  if (!strippedGeneric || GENERIC_NON_FARM_RE.test(strippedGeneric)) return false;
  const key = farmMatchKey(trimmed);
  const rawCompact = fold(strippedGeneric).replace(/\s+/g, '');
  if (!key) return false;
  if (BUILTIN_FARM_BY_KEY.has(key) || BUILTIN_FARM_BY_KEY.has(rawCompact)) return true;
  for (const candidate of knownFarms || []) {
    const candName = typeof candidate === 'string' ? candidate : candidate?.FarmName || candidate?.name || '';
    const candCode = typeof candidate === 'object' ? candidate?.FarmCode || candidate?.code || '' : '';
    for (const target of [candName, candCode]) {
      const targetKey = farmMatchKey(target);
      if (!targetKey) continue;
      if (targetKey === key || (key.length >= 4 && targetKey.startsWith(key)) || (targetKey.length >= 4 && key.startsWith(targetKey))) {
        return true;
      }
    }
  }
  return false;
}

export function normalizeFarmName(rawFarm, knownFarms = []) {
  const raw = clean(rawFarm)
    .replace(/^[\[【〔<(（■▶◆●▣★☆\-·•:：\s]+|[\]】〕>)）\s:：\-]+$/g, '')
    .replace(/^(?:수신\s*)?(?:농장(?:명)?|farm(?:\s*name)?)\s*[:：\-]?\s*/i, '')
    .trim();
  if (!raw || GENERIC_NON_FARM_RE.test(raw)) return '';
  const withoutSuffix = raw.replace(/\s*(?:농장|farms?)$/i, '').trim();
  if (!withoutSuffix || GENERIC_NON_FARM_RE.test(withoutSuffix)) return '';

  const key = farmMatchKey(withoutSuffix);
  const rawCompact = fold(withoutSuffix).replace(/\s+/g, '');
  const builtin = BUILTIN_FARM_BY_KEY.get(key) || BUILTIN_FARM_BY_KEY.get(rawCompact);
  const builtinKey = builtin ? farmMatchKey(builtin) : '';

  // Match against screen-provided registered farms / PO farms first so official ERP master names win.
  const exactHits = [];
  const fuzzyHits = [];
  for (const candidate of knownFarms || []) {
    const candName = clean(typeof candidate === 'string' ? candidate : candidate?.FarmName || candidate?.name || '');
    const candCode = clean(typeof candidate === 'object' ? candidate?.FarmCode || candidate?.code || '' : '');
    if (!candName) continue;
    const candKey = farmMatchKey(candName);
    const codeKey = farmMatchKey(candCode);
    if (candKey && (candKey === key || (builtinKey && candKey === builtinKey) || (codeKey && codeKey === key))) {
      exactHits.push(candName);
    } else if (candKey && ((key.length >= 4 && candKey.startsWith(key)) || (builtinKey.length >= 4 && candKey.startsWith(builtinKey)))) {
      fuzzyHits.push(candName);
    }
  }
  if (exactHits.length >= 1) return exactHits[0];
  if (fuzzyHits.length === 1) return fuzzyHits[0];
  if (builtin) return builtin;

  // Normalize all-caps multi-word Latin farm names to Title Case while keeping short acronyms (<=8 chars like CLOUD) intact.
  if (/^[A-Z0-9][A-Z0-9 &._-]*$/.test(withoutSuffix)) {
    if (!withoutSuffix.includes(' ') && withoutSuffix.length <= 8) return withoutSuffix;
    return withoutSuffix
      .toLowerCase()
      .replace(/\b([a-z])/g, (_, ch) => ch.toUpperCase());
  }
  return withoutSuffix;
}

export function normalizeOrderUnit(rawUnit) {
  const u = clean(rawUnit).replace(/\.$/, '');
  if (!u) return '';
  if (/^(?:fb|full\s*box(?:es)?)$/i.test(u)) return 'FB';
  if (/^(?:hb|half\s*box(?:es)?)$/i.test(u)) return 'HB';
  if (/^(?:qb|quarter\s*box(?:es)?)$/i.test(u)) return 'QB';
  if (/^(?:eb|eighth\s*box(?:es)?)$/i.test(u)) return 'EB';
  if (/^(?:b|bx|box(?:es)?|박스|상자)$/i.test(u)) return '박스';
  if (/^(?:bunch(?:es)?|bdl?|단|속)$/i.test(u)) return '단';
  if (/^(?:st|stems?|스팀|스템|송이|본|개)$/i.test(u)) return '송이';
  if (/^(?:봉지?)$/i.test(u)) return '봉';
  return u;
}

export function orderUnitFamily(unit) {
  const normalized = normalizeOrderUnit(unit);
  if (['박스', 'FB', 'HB', 'QB', 'EB'].includes(normalized)) return '박스';
  if (normalized === '단') return '단';
  if (normalized === '송이') return '송이';
  if (normalized === '봉') return '봉';
  return normalized || '기타';
}

export function formatUnitDisplay(quantity, unit, lang = 'ko') {
  const normalized = normalizeOrderUnit(unit);
  if (lang === 'en') {
    const qty = Number(quantity);
    const plural = qty !== 1;
    if (['FB', 'HB', 'QB', 'EB'].includes(normalized)) return `${quantity} ${normalized}`;
    if (normalized === '박스') return `${quantity} ${plural ? 'Boxes' : 'Box'}`;
    if (normalized === '단') return `${quantity} ${plural ? 'Bunches' : 'Bunch'}`;
    if (normalized === '송이') return `${quantity} ${plural ? 'Stems' : 'Stem'}`;
    if (normalized === '봉') return `${quantity} ${plural ? 'Bags' : 'Bag'}`;
    return normalized ? `${quantity} ${normalized}` : String(quantity);
  }
  if (['FB', 'HB', 'QB', 'EB'].includes(normalized)) return `${quantity}${normalized}`;
  return normalized ? `${quantity}${normalized}` : String(quantity);
}

const GRADE_CANONICAL = [
  [/\b(?:sel(?:ect)?)\b/i, 'Select'],
  [/\b(?:fancy)\b/i, 'Fancy'],
  [/\b(?:std|standard)\b/i, 'Standard'],
  [/\b(?:prem(?:ium)?)\b/i, 'Premium'],
  [/\b(?:extra)\b/i, 'Extra'],
  [/(?:^|\s)(특상)(?=\s|$|\d)/, '특상'],
  [/(?:^|\s)(특)(?=\s|$|\d)/, '특'],
  [/(?:^|\s)(상)(?=\s|$|\d)/, '상'],
];

export function extractProductSpec(productText) {
  const raw = clean(productText);
  if (!raw) return { baseName: '', spec: '', lengthCm: '', grade: '' };
  let working = raw;
  let lengthCm = '';
  let grade = '';

  const lenMatch = working.match(/(?:^|[\s/(\[])(\d{2,3}(?:\s*[~-]\s*\d{2,3})?)\s*cm(?=$|[\s/)\]])/i);
  if (lenMatch) {
    lengthCm = `${lenMatch[1].replace(/\s+/g, '')}cm`;
    working = working.replace(lenMatch[0], ' ');
  }
  for (const [re, label] of GRADE_CANONICAL) {
    const gm = working.match(re);
    if (gm) {
      grade = label;
      working = working.replace(gm[0], ' ');
      break;
    }
  }
  const baseName = clean(
    working
      .replace(/\(\s*\)/g, '')
      .replace(/\[\s*\]/g, '')
      .replace(/^[\s/\-·]+|[\s/\-·*]+$/g, '')
  );
  const specParts = [grade, lengthCm].filter(Boolean);
  return {
    baseName: baseName || raw,
    spec: specParts.join(' · '),
    lengthCm,
    grade,
  };
}

export function messageDay(stamp) {
  const m = clean(stamp).match(/^(\d{4})\s*(?:년|[-./])\s*(\d{1,2})\s*(?:월|[-./])\s*(\d{1,2})(?:일|\b|T)/);
  return m ? [m[1], m[2].padStart(2,'0'), m[3].padStart(2,'0')].join('-') : '';
}

export function messageOrder(stamp) {
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
    if (!messages.has(id)) messages.set(id,{id,time:clean(r[2]),sender:clean(r[3]),text:String(r[17] ?? ''),week:clean(r[6]),items:[]});
    const label = clean(r[20] || r[10] || r[9]);
    const group = label.match(/^(.*?(?:수국|장미|카네이션|알스트로메리아|알스트로|루스커스|튤립|카라|거베라|국화))\s+(.+)$/i) || (r[10] && !r[20] && label.match(/^([가-힣]+)\s+([A-Z].*)$/i));
    messages.get(id).items.push({key,group:(group?.[1] || '').replace(/^콜\s*(?=수국|장미|카네이션)/,'콜롬비아').replace(/^(콜롬비아|에콰도르|네덜란드|베트남|태국|호주|중국)\s+/,'$1'),product:group?.[2] || label,
      customer:clean(r[19] || r[8] || r[7]), quantity:normalizeImportQuantity(r[11]),unit:normalizeOrderUnit(r[12]),status:clean(r[18] || r[13] || r[15]),
      rawProduct:clean(r[9]),correctedProduct:clean(r[20]),correctedCustomer:clean(r[19]),
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
  const automatic = validItem(row) && !item.reviewReason && !item.cancelled;
  return { ...row, checked: edits.checked ?? automatic };
}

export function matchesCountryOrderScope(row, scope) {
  if (!scope?.country) return true;
  if (canonicalImportCountry(row.country) !== canonicalImportCountry(scope.country)) return false;
  if (!scope.year || !scope.majorWeek) return true;
  const cycleParts = value => fold(value).match(/^(\d{1,2})(?:\s*-\s*(\d{1,2}))?$/)?.slice(1).map(Number) ?? [];
  const [major, minor] = cycleParts(row.week);
  if (fold(row.year) !== String(scope.year) || major !== Number(scope.majorWeek)) return false;
  if (!scope.orderWeek) return true;
  const [scopeMajor, scopeMinor] = cycleParts(scope.orderWeek);
  return major === scopeMajor && minor === scopeMinor;
}

export const kakaoMessagePageSize = 100;
export function visibleKakaoMessages(messages, limit, linkedIds) {
  const linked = messages.filter(message => linkedIds.has(message.id));
  if (!linked.length) return messages.slice(0, limit);
  const chosen = new Set([...linked, ...messages.filter(message => !linkedIds.has(message.id))]
    .slice(0, limit).map(message => message.id));
  return messages.filter(message => chosen.has(message.id));
}

function canonicalProductFold(product) {
  return fold(product)
    .replace(/(\d{2,3})\s+cm\b/g, '$1cm')
    .replace(/\bsel(?:ect)?\.?\b/g, 'select')
    .replace(/\bstd\.?\b/g, 'standard');
}

export const importTotalKey = (item, knownFarms = []) => {
  const normalizedFarm = normalizeFarmName(item.farm, knownFarms);
  const normalizedUnit = normalizeOrderUnit(item.unit);
  const baseTuple = [
    fold(item.year),
    fold(item.week),
    fold(item.country),
    fold(item.group),
    canonicalProductFold(item.product),
    fold(normalizedUnit),
  ];
  if (normalizedFarm) baseTuple.push(farmMatchKey(normalizedFarm));
  return JSON.stringify(baseTuple);
};

export function manualImportReviews(manual, feed) {
  const known=new Set([...(feed?.messages||[]),...(feed?.review||[])].map(m=>m.id));
  return Object.values(manual).filter(m=>!known.has(m.id)&&(!feed?.from||messageDay(m.time)>=feed.from)&&(!feed?.audit||feed.audit.some(a=>a.id===m.id&&a.text===m.text)));
}

export function farmTotals(items, options = {}) {
  const knownFarms = options?.knownFarms || [];
  const groups = new Map();
  for (const item of items) {
    if (!item.checked || !validItem(item)) continue;
    const farm = normalizeFarmName(item.farm, knownFarms);
    const unit = normalizeOrderUnit(item.unit);
    const key = importTotalKey({ ...item, farm, unit }, knownFarms);
    if (!groups.has(key)) {
      const spec = extractProductSpec(item.product);
      groups.set(key, {key, year:clean(item.year), week:clean(item.week), country:clean(item.country), farm, group:clean(item.group),
        product:clean(item.product), baseName:spec.baseName, spec:spec.spec, packSpec:clean(item.packSpec), unit, milli:0,
        customers:new Map(), requests:new Set(), requestNotes:new Set(), revisions:new Set(), memos:new Set(), sourceKeys:[]});
    }
    const row = groups.get(key), customer = clean(item.customer), qty = Math.round(Number(item.quantity)*1000);
    row.milli += qty;
    row.sourceKeys.push(item.key);
    if (customer) row.customers.set(customer,(row.customers.get(customer)||0)+qty);
    if (clean(item.note)) { row.requests.add((customer?customer+': ':'')+clean(item.note)); row.requestNotes.add(clean(item.note)); }
    if (clean(item.revisionNote)) row.revisions.add(clean(item.revisionNote));
    if (!row.packSpec && clean(item.packSpec)) row.packSpec = clean(item.packSpec);
    for (const memo of item.memos || []) if (clean(memo)) row.memos.add(clean(memo));
  }
  return [...groups.values()].map(r=>({key:r.key,year:r.year,week:r.week,country:r.country,farm:r.farm,group:r.group,product:r.product,
    baseName:r.baseName,spec:r.spec,packSpec:r.packSpec,unit:r.unit,quantity:r.milli/1000,sourceKeys:r.sourceKeys,
    notes:[...r.customers].map(([c,n])=>c+' '+n/1000).join(', '),requests:[...r.requests].join(' / '),
    requestNotes:[...r.requestNotes],revisions:[...r.revisions].join(', '),memos:[...r.memos]}))
    .sort((a,b)=>a.year.localeCompare(b.year)||a.week.localeCompare(b.week,undefined,{numeric:true})||a.group.localeCompare(b.group,'ko')||a.product.localeCompare(b.product,'ko')||a.farm.localeCompare(b.farm,'ko'));
}

export function groupFarmTotalsByCycle(totals) {
  const compare = (a, b) => {
    if (!a || !b) return Number(!a) - Number(!b);
    return a.localeCompare(b, 'ko', {numeric: true});
  };
  const ordered = [...totals].sort((a,b)=>compare(a.year,b.year)||compare(a.week,b.week)
    ||compare(a.country,b.country)||compare(a.group,b.group)||compare(a.product,b.product)||compare(a.unit,b.unit)||compare(a.farm,b.farm));
  const cycles = new Map();
  for (const row of ordered) {
    const key = JSON.stringify([row.year,row.week]);
    if (!cycles.has(key)) {
      const label = [row.year || '연도 미상', row.week ? row.week+'차' : '차수 미상'].join('/');
      cycles.set(key,{key,label,rows:[]});
    }
    cycles.get(key).rows.push(row);
  }
  return [...cycles.values()];
}

export function importCategoryLabel(row, {showMissing = false} = {}) {
  const country = row.country || (showMissing ? '국가 미상' : '');
  const canonicalCountry = canonicalImportCountry(country);
  if (canonicalCountry === '태국' || canonicalCountry === '미국') return canonicalCountry;
  const group = row.group || (showMissing ? '품목군 미상' : '');
  return [country, group].filter(Boolean).join(' · ');
}

export function importTotalsText(totals) {
  return totals.map(r=>[r.year&&r.week?`${r.year}/${r.week}차`:'',importCategoryLabel(r),r.farm||''].filter(Boolean).join(' · ')+' · '+r.product+' '+r.quantity+(r.unit?' '+r.unit:'')+(r.notes?' ('+r.notes+')':'')+(r.requests?' · 요청: '+r.requests:'')).join('\n');
}

const UNIT_ORDER = ['FB', 'HB', 'QB', 'EB', '박스', '단', '송이', '봉'];
const BOX_UNITS = new Set(['FB', 'HB', 'QB', 'EB', '박스']);
const unitRank = unit => { const i = UNIT_ORDER.indexOf(unit); return i < 0 ? UNIT_ORDER.length : i; };
const formatNumber = value => Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 3 });

/**
 * Unit totals never mix families: box sizes (FB/HB/QB/EB/박스) are counted as boxes with their
 * size breakdown; bunches and stems are separate totals.
 */
export function summarizeUnitQuantities(rows, { lang = 'ko' } = {}) {
  const exact = new Map();
  for (const row of rows || []) {
    const unit = normalizeOrderUnit(row.unit) || '단위 미상';
    const milli = Math.round(Number(row.quantity || 0) * 1000);
    if (milli > 0) exact.set(unit, (exact.get(unit) || 0) + milli);
  }
  const units = [...exact].sort((a, b) => unitRank(a[0]) - unitRank(b[0]) || a[0].localeCompare(b[0], 'ko'))
    .map(([unit, milli]) => ({ unit, quantity: milli / 1000 }));
  const parts = [];
  const boxes = units.filter(u => BOX_UNITS.has(u.unit));
  if (boxes.length) {
    const total = boxes.reduce((sum, u) => sum + Math.round(u.quantity * 1000), 0) / 1000;
    const sized = boxes.some(u => u.unit !== '박스');
    const detail = sized ? boxes.map(u => formatUnitDisplay(formatNumber(u.quantity), u.unit, lang)).join(' · ') : '';
    parts.push({ family: '박스', quantity: total, detail,
      text: lang === 'en' ? `${formatNumber(total)} ${total === 1 ? 'Box' : 'Boxes'}${detail ? ` (${detail})` : ''}` : `${formatNumber(total)}박스${detail ? ` (${detail})` : ''}` });
  }
  for (const u of units.filter(u => !BOX_UNITS.has(u.unit))) {
    parts.push({ family: u.unit, quantity: u.quantity, detail: '', text: formatUnitDisplay(formatNumber(u.quantity), u.unit, lang) });
  }
  return { units, parts, totalLine: parts.map(p => p.text).join(', ') };
}

const GRADE_RANK = { 특상: 1, 특: 2, Select: 3, Fancy: 4, Premium: 5, Extra: 6, 상: 7, Standard: 8 };
function compareItems(a, b) {
  const base = a.baseName.localeCompare(b.baseName, 'ko', { numeric: true, sensitivity: 'base' });
  if (base) return base;
  const sa = extractProductSpec(a.product), sb = extractProductSpec(b.product);
  return (GRADE_RANK[sa.grade] || 99) - (GRADE_RANK[sb.grade] || 99)
    || (parseInt(sa.lengthCm, 10) || 0) - (parseInt(sb.lengthCm, 10) || 0)
    || unitRank(a.unit) - unitRank(b.unit)
    || a.product.localeCompare(b.product, 'ko', { numeric: true });
}

/**
 * Builds the farm-transfer view: one card per exact cycle + country + farm (or country when the
 * farm is not written in Kakao). Identical product/spec/unit lines inside one card are merged.
 */
export function buildFarmSummary(totals, { knownFarms = [], excludedItems = [], ignoredTotals = [], memos = [], reviewCount = 0 } = {}) {
  const cards = new Map();
  for (const row of totals || []) {
    const farm = normalizeFarmName(row.farm, knownFarms);
    const country = clean(row.country);
    const countryLabel = country || '국가 미상';
    const categoryDisplay = importCategoryLabel(row, { showMissing: true });
    const cycle = row.year && row.week ? `${row.year}/${row.week}차` : row.week ? `${row.week}차` : '차수 미상';
    const key = farm
      ? JSON.stringify([row.year, row.week, canonicalImportCountry(country), farmMatchKey(farm)])
      : JSON.stringify([row.year, row.week, canonicalImportCountry(country), fold(categoryDisplay)]);
    if (!cards.has(key)) cards.set(key, { key, year: clean(row.year), week: clean(row.week), cycle, country, countryLabel, farm,
      title: farm ? (country ? `${country} · ${farm}` : farm) : `${categoryDisplay} · 농장 미지정`, groups: new Set(), lines: new Map(), memos: new Set() });
    const card = cards.get(key);
    if (row.group) card.groups.add(row.group);
    for (const memo of row.memos || []) card.memos.add(memo);
    const lineKey = JSON.stringify([fold(row.group), canonicalProductFold(row.product), normalizeOrderUnit(row.unit)]);
    if (!card.lines.has(lineKey)) {
      const spec = extractProductSpec(row.product);
      card.lines.set(lineKey, { key: row.key, totalKeys: [], product: clean(row.product), baseName: spec.baseName, spec: spec.spec,
        packSpec: row.packSpec || '', group: clean(row.group), unit: normalizeOrderUnit(row.unit), milli: 0, sourceKeys: [],
        customers: [], requestNotes: new Set(), revisions: new Set() });
    }
    const line = card.lines.get(lineKey);
    line.totalKeys.push(row.key);
    line.milli += Math.round(Number(row.quantity || 0) * 1000);
    line.sourceKeys.push(...(row.sourceKeys || []));
    if (row.notes) line.customers.push(row.notes);
    for (const note of row.requestNotes || []) line.requestNotes.add(note);
    if (row.revisions) line.revisions.add(row.revisions);
    if (!line.packSpec && row.packSpec) line.packSpec = row.packSpec;
  }
  const memoList = [];
  for (const memo of memos || []) {
    const text = clean(memo?.text ?? memo);
    if (!text || memoList.some(m => m.text === text)) continue;
    const farm = normalizeFarmName(memo?.farm, knownFarms);
    let attached = [...cards.values()].some(card => card.memos.has(text));
    for (const card of cards.values()) {
      if (farm ? card.farm && farmMatchKey(card.farm) === farmMatchKey(farm) : false) { card.memos.add(text); attached = true; }
    }
    memoList.push({ farm, text, attached });
  }
  const list = [...cards.values()].map(card => {
    const items = [...card.lines.values()].map(line => ({
      key: line.key, totalKeys: line.totalKeys, product: line.product, baseName: line.baseName, spec: line.spec, packSpec: line.packSpec,
      group: line.group, unit: line.unit, quantity: line.milli / 1000, sourceKeys: [...new Set(line.sourceKeys)],
      customers: line.customers.join(', '), requestNotes: [...line.requestNotes], revisions: [...line.revisions].join(', '),
    })).sort((a, b) => a.group.localeCompare(b.group, 'ko') || compareItems(a, b));
    return { key: card.key, year: card.year, week: card.week, cycle: card.cycle, country: card.country, countryLabel: card.countryLabel,
      farm: card.farm, isNamedFarm: Boolean(card.farm), title: card.title, groups: [...card.groups].sort((a, b) => a.localeCompare(b, 'ko')),
      items, itemCount: items.length, units: summarizeUnitQuantities(items), unitsEn: summarizeUnitQuantities(items, { lang: 'en' }),
      memos: [...card.memos] };
  }).sort((a, b) => a.year.localeCompare(b.year) || a.week.localeCompare(b.week, undefined, { numeric: true })
    || a.countryLabel.localeCompare(b.countryLabel, 'ko') || Number(!a.isNamedFarm) - Number(!b.isNamedFarm)
    || a.title.localeCompare(b.title, 'ko', { numeric: true }));
  const allItems = list.flatMap(card => card.items);
  return {
    cards: list,
    farmCount: new Set(list.filter(c => c.isNamedFarm).map(c => farmMatchKey(c.farm))).size,
    unassignedCount: list.filter(c => !c.isNamedFarm).length,
    itemCount: allItems.length,
    units: summarizeUnitQuantities(allItems),
    excludedItems, ignoredTotals, memos: memoList, reviewCount: Number(reviewCount) || 0,
  };
}

/**
 * Farm-ready text: "[국가 · 농장] (차수)" heading, numbered "품목 (규격) - 수량" lines, unit
 * subtotal and optional delivery memo. Customer names are only included in the detailed format.
 */
export function formatFarmCardText(card, { format = 'concise', lang = 'ko', memo = true } = {}) {
  if (!card?.items?.length) return '';
  const en = lang === 'en';
  const mixedGroups = card.groups.length > 1;
  const heading = card.isNamedFarm ? (en ? card.farm : card.title) : (en ? `${card.country || 'Unknown'} · Farm TBD` : card.title);
  const lines = [`[${heading}] ${card.cycle}`];
  card.items.forEach((item, index) => {
    const name = (item.spec ? item.baseName : item.product);
    const prefix = mixedGroups && item.group && !name.includes(item.group) ? `${item.group} ` : '';
    const spec = [item.spec, item.packSpec].filter(Boolean).join(', ');
    const extras = format === 'detailed'
      ? [item.revisions, item.customers && (en ? `customers: ${item.customers}` : `업체 ${item.customers}`), ...item.requestNotes].filter(Boolean)
      : memo ? item.requestNotes : [];
    lines.push(`${index + 1}. ${prefix}${name}${spec ? ` (${spec})` : ''} - ${formatUnitDisplay(formatNumber(item.quantity), item.unit, lang)}${extras.length ? ` / ${extras.join(' · ')}` : ''}`);
  });
  const total = (en ? card.unitsEn : card.units).totalLine;
  if (total) lines.push(en ? `Total: ${total}` : `합계: ${total}`);
  if (memo && card.memos.length) lines.push(`${en ? 'Note' : '전달 메모'}: ${card.memos.join(' / ')}`);
  return lines.join('\n');
}

export function formatFarmTransferText(summary, options = {}) {
  const cards = Array.isArray(summary) ? summary : summary?.cards || [];
  const blocks = cards.map(card => formatFarmCardText(card, options)).filter(Boolean);
  const loose = Array.isArray(summary) ? [] : (summary?.memos || []).filter(m => !m.attached);
  if (options.memo !== false && loose.length) {
    blocks.push(`[${options.lang === 'en' ? 'Notes' : '공통 전달 메모'}]\n${loose.map(m => `- ${m.farm ? `${m.farm}: ` : ''}${m.text}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}
