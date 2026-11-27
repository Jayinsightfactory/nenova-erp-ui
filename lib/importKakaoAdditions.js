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
  ['Teucali', ['teucali', '테우칼리']],
  ['Don Eusebio', ['doneusebio', 'eusebio']],
  ['안티오퀴아', ['antioquia', '안티오키아', '안티오퀴아']],
  ['보고타', ['bogota', '보고타']],
  ['메데진', ['medellin', '메데진', '메데인']],
  ['Melody', ['melody', '멜로디']],
  ['CLOUD', ['cloud', '클라우드']],
  ['HUBFRESH', ['hubfresh', '허브프레시', '허브프레쉬']],
];

const FARM_ORIGIN_COUNTRIES = new Map([
  ['theeliteflowers', '콜롬비아'], ['elite', '콜롬비아'], ['엘리떼', '콜롬비아'], ['엘리테', '콜롬비아'],
  ['florestiba', '콜롬비아'], ['tiba', '콜롬비아'], ['티바', '콜롬비아'],
  ['natuflora', '콜롬비아'], ['나투', '콜롬비아'],
  ['ayura', '콜롬비아'], ['아유라', '콜롬비아'],
  ['kikuyal', '콜롬비아'], ['키쿠얄', '콜롬비아'],
  ['matina', '콜롬비아'], ['마티나', '콜롬비아'],
  ['daflor', '콜롬비아'], ['다플로르', '콜롬비아'], ['다플로러', '콜롬비아'],
  ['varietta', '콜롬비아'], ['varieta', '콜롬비아'], ['바리에타', '콜롬비아'],
  ['valores', '콜롬비아'], ['grupovalores', '콜롬비아'], ['발로레스', '콜롬비아'],
  ['invos', '콜롬비아'], ['인보스', '콜롬비아'],
  ['sanmarino', '콜롬비아'], ['산마리노', '콜롬비아'],
  ['florence', '콜롬비아'], ['florentina', '콜롬비아'], ['플로렌스', '콜롬비아'], ['플로렌티나', '콜롬비아'], ['플로렌티아', '콜롬비아'],
  ['balverde', '콜롬비아'], ['발베르데', '콜롬비아'],
  ['capiro', '콜롬비아'], ['카피로', '콜롬비아'],
  ['turflor', '콜롬비아'], ['투르플로르', '콜롬비아'],
  ['milagro', '콜롬비아'], ['밀라그로', '콜롬비아'],
  ['doneusebio', '콜롬비아'], ['eusebio', '콜롬비아'], ['teucali', '콜롬비아'], ['테우칼리', '콜롬비아'],
  ['colibri', '콜롬비아'], ['콜리브리', '콜롬비아'], ['lorzate', '콜롬비아'], ['로자떼', '콜롬비아'], ['로자르테', '콜롬비아'],
  ['verdnatura', '콜롬비아'], ['베르나투라', '콜롬비아'], ['inverpalmas', '콜롬비아'],
  ['antioquia', '콜롬비아'], ['안티오퀴아', '콜롬비아'], ['안티오키아', '콜롬비아'],
  ['bogota', '콜롬비아'], ['보고타', '콜롬비아'],
  ['medellin', '콜롬비아'], ['메데진', '콜롬비아'], ['메데인', '콜롬비아'],
  ['melody', '중국'], ['멜로디', '중국'], ['yunnanmelody', '중국'],
  ['cloud', '중국'], ['cloudland', '중국'], ['클라우드', '중국'],
  ['hubfresh', '중국'], ['hub2', '중국'], ['허브프레시', '중국'], ['허브프레쉬', '중국'],
  ['kunming', '중국'], ['쿤밍', '중국'],
  ['holex', '네덜란드'], ['홀렉스', '네덜란드'], ['florca', '네덜란드'], ['ezflowers', '네덜란드'], ['aalsmeer', '네덜란드'], ['알스미어', '네덜란드'],
  ['esmeralda', '에콰도르'], ['에스메랄다', '에콰도르'], ['rosaleda', '에콰도르'], ['larosaleda', '에콰도르'], ['로살레다', '에콰도르'],
  ['fagua', '에콰도르'], ['faguaflowers', '에콰도르'], ['floramar', '에콰도르'], ['nivalia', '에콰도르'], ['quito', '에콰도르'], ['키토', '에콰도르'],
  ['superfresh', '태국'], ['슈퍼프레쉬', '태국'], ['슈퍼프레시', '태국'], ['krung', '태국'], ['leeandu', '태국'],
  ['premiumgreens', '호주'], ['premiumgreen', '호주'], ['프리미엄그린', '호주'], ['프리미엄그린스', '호주'],
  ['hoodcanal', '미국'], ['후드캐널', '미국'],
  ['nzblooms', '뉴질랜드'], ['nzbloom', '뉴질랜드'], ['엔제이블룸', '뉴질랜드'],
  ['aviv', '이스라엘'], ['avivflower', '이스라엘'],
]);

const DB_FARM_SYNONYM_KEYS = new Map([
  ['안티오퀴아', 'antioquia'], ['안티오키아', 'antioquia'],
  ['플로라컨셉', 'elite'], ['floraconcept', 'elite'],
  ['젤렉타', 'matina'], ['zelecta', 'matina'], ['아구아클라라', 'matina'], ['아과클라라', 'matina'], ['aguaclara', 'matina'],
  ['산마리노', 'sanmarino'],
  ['플로렌티나', 'florentina'], ['플로렌티아', 'florentina'], ['플로렌스', 'florentina'], ['florence', 'florentina'], ['fl', 'florentina'],
  ['발베르데', 'balverde'], ['ba', 'balverde'],
  ['로살레다', 'rosaleda'], ['로사레다', 'rosaleda'], ['라로살레다', 'rosaleda'],
  ['네추럴', 'natuflora'], ['나투플로라', 'natuflora'],
  ['발로레스', 'valores'],
  ['로자떼', 'lorzate'], ['로자르테', 'lorzate'], ['로르자테', 'lorzate'],
  ['콜리브리', 'colibri'],
  ['베르나투라', 'verdnatura'], ['베르드나투라', 'verdnatura'],
  ['슈퍼프레쉬', 'superfresh'], ['슈퍼프레시', 'superfresh'],
  ['프리미엄그린', 'premiumgreens'], ['프리미엄그린스', 'premiumgreens'],
  ['후드캐널', 'hoodcanal'], ['후드커낼', 'hoodcanal'],
  ['엔제이블룸', 'nzblooms'], ['엔제이블룸스', 'nzblooms'],
  ['홀렉스', 'holex'],
]);

export function inferCountryFromFarm(rawFarm, knownFarms = []) {
  const trimmed = clean(rawFarm);
  if (!trimmed) return '';
  const resolved = (knownFarms && knownFarms.length) ? (normalizeFarmName(trimmed, knownFarms) || trimmed) : trimmed;
  const key = farmMatchKey(resolved);
  const rawKey = farmMatchKey(trimmed);
  const synKey = DB_FARM_SYNONYM_KEYS.get(rawKey) || DB_FARM_SYNONYM_KEYS.get(fold(trimmed).replace(/\s+/g, '')) || '';
  const compact = fold(trimmed).replace(/\s+/g, '');
  for (const candidate of knownFarms || []) {
    if (typeof candidate !== 'object' || !candidate) continue;
    const candCountry = clean(candidate.CounName || candidate.country || '');
    if (!candCountry) continue;
    const candKey = farmMatchKey(candidate.FarmName || candidate.name || '');
    const codeKey = farmMatchKey(candidate.FarmCode || candidate.code || '');
    if (
      (candKey && (candKey === key || candKey === rawKey || (synKey && candKey === synKey))) ||
      (codeKey && (codeKey === key || codeKey === rawKey))
    ) {
      return canonicalImportCountry(candCountry) || candCountry;
    }
  }
  return FARM_ORIGIN_COUNTRIES.get(key) || FARM_ORIGIN_COUNTRIES.get(rawKey) || (synKey && FARM_ORIGIN_COUNTRIES.get(synKey)) || FARM_ORIGIN_COUNTRIES.get(compact) || '';
}

const GENERIC_NON_FARM_RE = /^(?:지정|좋은|아무|가능한|추천|다른|기존|동일|같은|선호|일반|기본|확인|발주|주문|추가|취소|변경|합계|소계|총계|전체|수입방|농장|특정|xx|farm|farms)$/i;
const CL_NOT_FARM_RE = /^(?!(?:CLOUD|CLOUDLAND)\b)[A-Z]{0,3}CL(?:[-_]?\d+[A-Z0-9_-]*|[A-Z]{1,2})$/i;

export function farmMatchKey(value) {
  const base = clean(value)
    .normalize('NFKC')
    .replace(/^[\[【〔<(（■▶◆●▣★☆\-·•:：\s]+|[\]】〕>)）\s:：\-]+$/g, '')
    .toLowerCase();
  if (!base) return '';
  const stripped = base
    .replace(/\b(?:the|la|el|los|las|grupo|agroindustrial|agricola|agrícola|c\.?i\.?|farms?|flowers?|flora|roses?|rosas|follajes|floral|export|ltda|s\.?a\.?s\.?|inc|co|corp)\b/gi, '')
    .replace(/(?:농장|플라워|화훼)$/g, '')
    .replace(/[\s·_*☆★※△()（）[\]<>.,\-/\\'"`&]/g, '');
  return stripped || base.replace(/[\s·_*☆★※△()（）[\]<>.,\-/\\'"`&]/g, '');
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
  if (!trimmed || GENERIC_NON_FARM_RE.test(trimmed) || CL_NOT_FARM_RE.test(trimmed)) return false;
  const strippedGeneric = trimmed.replace(/\s*(?:농장|farms?)$/i, '').trim();
  if (!strippedGeneric || GENERIC_NON_FARM_RE.test(strippedGeneric) || CL_NOT_FARM_RE.test(strippedGeneric)) return false;
  const key = farmMatchKey(trimmed);
  const rawCompact = fold(strippedGeneric).replace(/\s+/g, '');
  const dbSynKey = DB_FARM_SYNONYM_KEYS.get(key) || DB_FARM_SYNONYM_KEYS.get(rawCompact) || '';
  if (!key) return false;
  if (BUILTIN_FARM_BY_KEY.has(key) || BUILTIN_FARM_BY_KEY.has(rawCompact)) return true;
  if (dbSynKey && (knownFarms || []).length > 0) return true;
  const genericCountryCodes = new Set(['col', 'nl', 'th', 'et', 'au', 'us', 'ecu', 'chn', 'cn']);
  for (const candidate of knownFarms || []) {
    const candName = typeof candidate === 'string' ? candidate : candidate?.FarmName || candidate?.name || '';
    const rawCode = typeof candidate === 'object' ? candidate?.FarmCode || candidate?.code || '' : '';
    const candCode = genericCountryCodes.has(fold(rawCode)) ? '' : rawCode;
    for (const target of [candName, candCode]) {
      const targetKey = farmMatchKey(target);
      if (!targetKey) continue;
      if (
        targetKey === key ||
        (dbSynKey && targetKey === dbSynKey) ||
        (key.length >= 4 && targetKey.startsWith(key)) ||
        (targetKey.length >= 4 && key.startsWith(targetKey))
      ) {
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
  if (!raw || GENERIC_NON_FARM_RE.test(raw) || CL_NOT_FARM_RE.test(raw)) return '';
  const withoutSuffix = raw.replace(/\s*(?:농장|farms?)$/i, '').trim();
  if (!withoutSuffix || GENERIC_NON_FARM_RE.test(withoutSuffix) || CL_NOT_FARM_RE.test(withoutSuffix)) return '';

  const key = farmMatchKey(withoutSuffix);
  const rawCompact = fold(withoutSuffix).replace(/\s+/g, '');
  const builtin = BUILTIN_FARM_BY_KEY.get(key) || BUILTIN_FARM_BY_KEY.get(rawCompact);
  const builtinKey = builtin ? farmMatchKey(builtin) : '';
  const synKey = DB_FARM_SYNONYM_KEYS.get(key) || DB_FARM_SYNONYM_KEYS.get(rawCompact) || DB_FARM_SYNONYM_KEYS.get(builtinKey) || '';
  const genericCountryCodes = new Set(['col', 'nl', 'th', 'et', 'au', 'us', 'ecu', 'chn', 'cn']);

  // Match against screen-provided / server-loaded DB Farm Master records first so official ERP master names win.
  const exactHits = [];
  const fuzzyHits = [];
  for (const candidate of knownFarms || []) {
    const candName = clean(typeof candidate === 'string' ? candidate : candidate?.FarmName || candidate?.name || '');
    const rawCode = clean(typeof candidate === 'object' ? candidate?.FarmCode || candidate?.code || '' : '');
    const candCode = genericCountryCodes.has(fold(rawCode)) ? '' : rawCode;
    if (!candName) continue;
    const candKey = farmMatchKey(candName);
    const codeKey = farmMatchKey(candCode);
    if (
      candKey &&
      (candKey === key ||
        (builtinKey && candKey === builtinKey) ||
        (synKey && candKey === synKey) ||
        (codeKey && codeKey === key))
    ) {
      exactHits.push(candName);
    } else if (
      candKey &&
      ((key.length >= 4 && candKey.startsWith(key)) ||
        (builtinKey.length >= 4 && candKey.startsWith(builtinKey)) ||
        (synKey.length >= 4 && candKey.startsWith(synKey)))
    ) {
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
  if (/^(?:st|stems?|스팀|스템|송이|본|대|개)$/i.test(u)) return '송이';
  if (/^(?:봉지?|bags?)$/i.test(u)) return '봉';
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

export function formatUnitDisplay(quantity, unit, lang = 'en') {
  const normalized = normalizeOrderUnit(unit);
  if (lang === 'en') {
    if (['FB', 'HB', 'QB', 'EB'].includes(normalized)) return `${quantity} box (${normalized})`;
    if (normalized === '박스') return `${quantity} box`;
    if (normalized === '단') return `${quantity} bunches`;
    if (normalized === '송이') return `${quantity} stems`;
    if (normalized === '봉') return `${quantity} bags`;
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

export function isCancelItem(row) {
  if (!row || typeof row !== 'object') return false;
  return Boolean(row.cancelled || row.isCancel || row.sign === -1);
}

const LOCAL_ISSUE_REASON_RE =
  /(?:현지\s*이슈|이슈|소트|쇼트|\bshort(?:age)?\b|미\s*컨펌|노\s*컨펌|결품|품절|없음|없습니다|없답니다|모자랍?니다|모자름|출하\s*불가|선적\s*불가|수출\s*불가|공급\s*불가|발주\s*불가|생산\s*불가|못\s*보내|못보냄|못\s*실었|수출\s*허가|작황|농장.*취소|감량)/i;

export function resolveMinusKind(row) {
  if (!row || typeof row !== 'object') return '취소';
  if (row.minusKind === '현지이슈' || row.minusKind === '취소') return row.minusKind;
  const combined = `${clean(row.cancelReason)} ${clean(row.reviewReason)} ${clean(row.note)}`;
  return LOCAL_ISSUE_REASON_RE.test(combined) ? '현지이슈' : '취소';
}

export function validSignedItem(row) {
  if (!row || !clean(row.product)) return false;
  if (!isCancelItem(row)) return validItem(row);
  const rawQty = clean(row.quantity).replace(/^\-/, '');
  return /^\d+(?:\.\d{1,3})?$/.test(rawQty) && Number(rawQty) > 0 && Number(rawQty) <= 1e9;
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

const BLOCKING_CANCEL_REASON_RE =
  /^(?:단위|차수|수량|음수 수량)\s*확인 필요$|이후 수정 발주 원문으로 대체|같은 차수·품목의 취소|취소·대체 여부 질문 확인 필요|직전 취소 요청의 처리 회신 확인 필요/;

export function importItemView(item, edits = {}, options = {}) {
  const row = { ...item, ...edits };
  const isCancel = isCancelItem(row);
  const sign = isCancel ? -1 : 1;
  const minusKind = isCancel ? resolveMinusKind(row) : '';
  const rawAbsQty = clean(row.quantity).replace(/^\-/, '');
  const absQtyNum = /^\d+(?:\.\d{1,3})?$/.test(rawAbsQty) ? Number(rawAbsQty) : NaN;
  const signedQty = Number.isFinite(absQtyNum) && absQtyNum > 0 ? sign * absQtyNum : 0;
  const valid = isCancel ? validSignedItem(row) : validItem(row);
  const rawReason = clean(item.reviewReason);
  const cancelReasonIgnorable = isCancel
    && options?.autoCheckCancel === true
    && !BLOCKING_CANCEL_REASON_RE.test(rawReason);
  const netMatchedIgnorable = !isCancel
    && options?.netMatchedAddition === true
    && rawReason === '같은 차수·품목의 취소/변경 요청 대조 필요';
  const hasBlockingReview = Boolean(rawReason) && !cancelReasonIgnorable && !netMatchedIgnorable;
  const hasValidCycleAndUnit = !isCancel || !options?.autoCheckCancel || (Boolean(normalizeOrderUnit(row.unit)) && /^\d{1,2}(?:-\d{1,2})?$/.test(clean(row.week)));
  const automatic = valid && !hasBlockingReview && hasValidCycleAndUnit;
  return {
    ...row,
    isCancel,
    sign,
    signedQty,
    ...(minusKind ? { minusKind } : {}),
    checked: edits.checked ?? automatic,
  };
}

export function resolveImportFeedRows(feed, edits = {}, options = {}) {
  const knownFarms = options?.knownFarms || [];
  const messages = [...(feed?.messages || []), ...(feed?.review || [])];
  const msgById = new Map(messages.map(m => [m.id, m]));
  const firstPass = new Map();
  for (const m of messages) {
    const autoCheckCancel = m.kind !== 'addition';
    for (const raw of m.items || []) {
      if (!raw?.key) continue;
      firstPass.set(raw.key, importItemView(raw, edits[raw.key], { autoCheckCancel }));
    }
  }
  const byKey = new Map();
  const rows = [];
  for (const m of messages) {
    const autoCheckCancel = m.kind !== 'addition';
    const netMatchedAddition = m.kind === 'review'
      && clean(m.reason) === '같은 차수·품목의 취소/변경 요청 대조 필요'
      && Array.isArray(m.relatedChanges)
      && m.relatedChanges.length > 0
      && m.relatedChanges.every(relId => {
        const rel = msgById.get(relId);
        if (!rel || rel.unparsed?.length || !Array.isArray(rel.items) || rel.items.length === 0) return false;
        const cancelRows = rel.items.filter(isCancelItem);
        return cancelRows.length > 0 && cancelRows.every(ci => Boolean(firstPass.get(ci.key)?.checked));
      });
    for (const raw of m.items || []) {
      if (!raw?.key) continue;
      const viewed = netMatchedAddition
        ? importItemView(raw, edits[raw.key], { autoCheckCancel, netMatchedAddition: true })
        : firstPass.get(raw.key);
      const normalized = viewed.farm && knownFarms.length
        ? { ...viewed, farm: normalizeFarmName(viewed.farm, knownFarms) || viewed.farm }
        : viewed;
      byKey.set(raw.key, normalized);
      rows.push(normalized);
    }
  }
  return { byKey, rows };
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
  if (major !== scopeMajor) return false;
  // Kakao orders written with major week only (e.g. "49차 수국 발주 추가") belong to that major week
  // and must remain visible instead of vanishing when a subweek (e.g. "49-01") is selected.
  if (minor === undefined || Number.isNaN(minor)) return true;
  return minor === scopeMinor;
}

export function matchesCleanedScope(entry, scope) {
  if (!scope?.country) return true;
  if (entry?.hintCountry && canonicalImportCountry(entry.hintCountry) !== canonicalImportCountry(scope.country)) {
    return false;
  }
  if (!scope.year || !scope.majorWeek) return true;
  const entryYear = messageDay(entry?.time).slice(0, 4);
  if (entryYear && entryYear !== String(scope.year)) return false;
  if (entry?.hintWeek) {
    const major = Number(fold(entry.hintWeek).match(/^(\d{1,2})/)?.[1]);
    if (Number.isFinite(major) && major !== Number(scope.majorWeek)) return false;
  }
  return true;
}

export function formatCleanedSingleLine(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .split(/\r?\n/)
    .map(line => clean(line))
    .filter(Boolean)
    .join(' · ');
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

function computeMinusBreakdownNote(addedMilli, cancelledMilli, minusKinds) {
  if (!(cancelledMilli > 0)) return '';
  const hasCancel = minusKinds.has('취소');
  const hasIssue = minusKinds.has('현지이슈');
  const kindLabel = hasCancel && hasIssue ? '취소·현지이슈' : (hasIssue ? '현지이슈' : '취소');
  if (addedMilli > 0) {
    return `+${formatNumber(addedMilli / 1000)} / -${formatNumber(cancelledMilli / 1000)} (${kindLabel})`;
  }
  return kindLabel;
}

export function farmTotals(items, options = {}) {
  const knownFarms = options?.knownFarms || [];
  const farmCache = new Map();
  const resolveFarm = raw => {
    const key = String(raw ?? '');
    if (farmCache.has(key)) return farmCache.get(key);
    const resolved = normalizeFarmName(key, knownFarms);
    farmCache.set(key, resolved);
    return resolved;
  };
  const groups = new Map();
  for (const item of items) {
    if (!item.checked || !validSignedItem(item)) continue;
    const cancel = isCancelItem(item);
    const absMilli = Math.round(Math.abs(Number(clean(item.quantity).replace(/^\-/, ''))) * 1000);
    if (!(absMilli > 0)) continue;
    const signedMilli = cancel ? -absMilli : absMilli;
    const farm = resolveFarm(item.farm);
    const unit = normalizeOrderUnit(item.unit);
    const baseTuple = [
      fold(item.year),
      fold(item.week),
      fold(item.country),
      fold(item.group),
      canonicalProductFold(item.product),
      fold(unit),
    ];
    if (farm) baseTuple.push(farmMatchKey(farm));
    const key = JSON.stringify(baseTuple);
    if (!groups.has(key)) {
      const spec = extractProductSpec(item.product);
      groups.set(key, {key, year:clean(item.year), week:clean(item.week), country:clean(item.country), farm, group:clean(item.group),
        product:clean(item.product), baseName:spec.baseName, spec:spec.spec, packSpec:clean(item.packSpec),
        dbProdName:clean(item.dbProdName || ''), dbProdKey:item.dbProdKey || null, unit, milli:0, addedMilli:0, cancelledMilli:0,
        minusKinds:new Set(), customers:new Map(), requests:new Set(), requestNotes:new Set(), revisions:new Set(), memos:new Set(), sourceKeys:[]});
    }
    const row = groups.get(key), customer = clean(item.customer);
    row.milli += signedMilli;
    if (cancel) {
      row.cancelledMilli += absMilli;
      row.minusKinds.add(resolveMinusKind(item));
    } else {
      row.addedMilli += absMilli;
    }
    row.sourceKeys.push(item.key);
    if (!row.dbProdName && clean(item.dbProdName)) {
      row.dbProdName = clean(item.dbProdName);
      if (item.dbProdKey) row.dbProdKey = item.dbProdKey;
    }
    if (customer) row.customers.set(customer,(row.customers.get(customer)||0)+signedMilli);
    if (!cancel && clean(item.note)) { row.requests.add((customer?customer+': ':'')+clean(item.note)); row.requestNotes.add(clean(item.note)); }
    if (clean(item.revisionNote)) row.revisions.add(clean(item.revisionNote));
    if (!row.packSpec && clean(item.packSpec)) row.packSpec = clean(item.packSpec);
    for (const memo of item.memos || []) if (clean(memo)) row.memos.add(clean(memo));
  }
  return [...groups.values()].filter(r=>r.milli!==0).map(r=>{
    const breakdownNote = computeMinusBreakdownNote(r.addedMilli, r.cancelledMilli, r.minusKinds);
    return {key:r.key,year:r.year,week:r.week,country:r.country,farm:r.farm,group:r.group,product:r.product,
      baseName:r.baseName,spec:r.spec,packSpec:r.packSpec,dbProdName:r.dbProdName||'',dbProdKey:r.dbProdKey||null,unit:r.unit,quantity:r.milli/1000,
      addedQuantity:r.addedMilli/1000,cancelledQuantity:r.cancelledMilli/1000,minusKinds:[...r.minusKinds],breakdownNote,
      note:breakdownNote,sourceKeys:r.sourceKeys,
      notes:[...r.customers].filter(([,n])=>n!==0).map(([c,n])=>c+' '+n/1000).join(', '),requests:[...r.requests].join(' / '),
      requestNotes:[...r.requestNotes],revisions:[...r.revisions].join(', '),memos:[...r.memos]};
  })
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
    if (milli === 0) continue;
    const prev = exact.get(unit) || { netMilli: 0, posMilli: 0, negMilli: 0 };
    prev.netMilli += milli;
    if (milli > 0) prev.posMilli += milli;
    else prev.negMilli += Math.abs(milli);
    exact.set(unit, prev);
  }
  const units = [...exact]
    .filter(([, st]) => st.netMilli !== 0 || st.posMilli > 0 || st.negMilli > 0)
    .sort((a, b) => unitRank(a[0]) - unitRank(b[0]) || a[0].localeCompare(b[0], 'ko'))
    .map(([unit, st]) => ({ unit, quantity: st.netMilli / 1000, posMilli: st.posMilli, negMilli: st.negMilli }));
  const parts = [];
  const boxes = units.filter(u => BOX_UNITS.has(u.unit));
  if (boxes.length) {
    const total = boxes.reduce((sum, u) => sum + Math.round(u.quantity * 1000), 0) / 1000;
    const boxPosMilli = boxes.reduce((sum, u) => sum + u.posMilli, 0);
    const boxNegMilli = boxes.reduce((sum, u) => sum + u.negMilli, 0);
    const sized = boxes.some(u => u.unit !== '박스');
    const mixedSigns = boxPosMilli > 0 && boxNegMilli > 0;
    if (total !== 0 || sized || mixedSigns) {
      const sizeDetail = sized
        ? boxes.map(u => {
            if (lang === 'en') {
              return u.unit === '박스' ? `${formatNumber(u.quantity)} box` : `${formatNumber(u.quantity)} ${u.unit}`;
            }
            return formatUnitDisplay(formatNumber(u.quantity), u.unit, lang);
          }).join(' · ')
        : '';
      const signDetail = mixedSigns ? `+${formatNumber(boxPosMilli / 1000)} / -${formatNumber(boxNegMilli / 1000)}` : '';
      const detail = [sizeDetail, signDetail].filter(Boolean).join(', ');
      parts.push({ family: '박스', quantity: total, detail,
        text: lang === 'en' ? `${formatNumber(total)} box${detail ? ` (${detail})` : ''}` : `${formatNumber(total)}박스${detail ? ` (${detail})` : ''}` });
    }
  }
  for (const u of units.filter(u => !BOX_UNITS.has(u.unit))) {
    const mixedSigns = u.posMilli > 0 && u.negMilli > 0;
    const signSuffix = mixedSigns ? ` (+${formatNumber(u.posMilli / 1000)} / -${formatNumber(u.negMilli / 1000)})` : '';
    parts.push({
      family: u.unit,
      quantity: u.quantity,
      detail: mixedSigns ? `+${formatNumber(u.posMilli / 1000)} / -${formatNumber(u.negMilli / 1000)}` : '',
      text: `${formatUnitDisplay(formatNumber(u.quantity), u.unit, lang)}${signSuffix}`,
    });
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

const COUNTRY_EN_LABEL = new Map([
  ['콜롬비아', 'Colombia'], ['중국', 'China'], ['네덜란드', 'Netherlands'], ['에콰도르', 'Ecuador'],
  ['태국', 'Thailand'], ['베트남', 'Vietnam'], ['호주', 'Australia'], ['미국', 'USA'],
  ['뉴질랜드', 'New Zealand'], ['이스라엘', 'Israel'],
  ['케냐', 'Kenya'], ['에티오피아', 'Ethiopia'], ['일본', 'Japan'],
]);
const GROUP_EN_LABEL = new Map([
  ['수국', 'Hydrangea'], ['장미', 'Rose'], ['카네이션', 'Carnation'], ['알스트로', 'Alstroemeria'],
  ['루스커스', 'Ruscus'], ['튤립', 'Tulip'], ['히야신스', 'Hyacinth'], ['아스틸베', 'Astilbe'],
  ['카라', 'Calla'], ['거베라', 'Gerbera'], ['국화', 'Chrysanthemum'], ['안개', 'Gypsophila'],
  ['안시리움', 'Anthurium'], ['스키미아', 'Skimmia'], ['유칼립투스', 'Eucalyptus'], ['작약', 'Peony'],
  ['다알리아', 'Dahlia'], ['달리아', 'Dahlia'], ['호접', 'Phalaenopsis'], ['덴파레', 'Dendrobium'],
  ['모카라', 'Mokara'], ['스타티스', 'Statice'], ['라넌큘러스', 'Ranunculus'], ['리모늄', 'Limonium'],
  ['클레마티스', 'Clematis'], ['수선화', 'Daffodil'], ['네리네', 'Nerine'], ['아이리스', 'Iris'],
  ['기타', 'Other'],
]);

function englishNormalHeading(card) {
  const canonicalCountry = canonicalImportCountry(card.country);
  const countryEn = COUNTRY_EN_LABEL.get(canonicalCountry) || clean(card.country);
  const hideGroup = canonicalCountry === '태국' || canonicalCountry === '미국';
  const groupEn = hideGroup
    ? ''
    : (card.groups || []).map(g => GROUP_EN_LABEL.get(g) || g).filter(Boolean).join(' · ');
  return [countryEn, groupEn].filter(Boolean).join(' · ') || 'Order Summary';
}

/**
 * Builds the order-transfer view: normal orders (no farm specified, the standard default) are
 * grouped by exact cycle + country + category; special farm-designated orders get their own card.
 */
export function buildFarmSummary(totals, { knownFarms = [], excludedItems = [], ignoredTotals = [], memos = [], reviewCount = 0 } = {}) {
  const cards = new Map();
  for (const row of totals || []) {
    const farm = normalizeFarmName(row.farm, knownFarms);
    const country = clean(row.country);
    const countryLabel = country || '일반';
    const standardTitle = importCategoryLabel(row) || '일반 발주';
    const cycle = row.year && row.week ? `${row.year}/${row.week}차` : row.week ? `${row.week}차` : '차수 미상';
    const key = farm
      ? JSON.stringify([row.year, row.week, canonicalImportCountry(country), 'farm', farmMatchKey(farm)])
      : JSON.stringify([row.year, row.week, canonicalImportCountry(country), 'std', fold(standardTitle)]);
    if (!cards.has(key)) cards.set(key, { key, year: clean(row.year), week: clean(row.week), cycle, country, countryLabel, farm,
      title: farm ? (country ? `${country} · ${farm}` : farm) : standardTitle, groups: new Set(), lines: new Map(), memos: new Set() });
    const card = cards.get(key);
    if (row.group) card.groups.add(row.group);
    for (const memo of row.memos || []) card.memos.add(memo);
    const lineKey = JSON.stringify([fold(row.group), canonicalProductFold(row.product), normalizeOrderUnit(row.unit)]);
    if (!card.lines.has(lineKey)) {
      const spec = extractProductSpec(row.product);
      card.lines.set(lineKey, { key: row.key, totalKeys: [], product: clean(row.product), baseName: spec.baseName, spec: spec.spec,
        packSpec: row.packSpec || '', dbProdName: clean(row.dbProdName || ''), dbProdKey: row.dbProdKey || null,
        group: clean(row.group), unit: normalizeOrderUnit(row.unit), milli: 0, addedMilli: 0, cancelledMilli: 0,
        minusKinds: new Set(), sourceKeys: [],
        customers: [], requestNotes: new Set(), revisions: new Set() });
    }
    const line = card.lines.get(lineKey);
    line.totalKeys.push(row.key);
    line.milli += Math.round(Number(row.quantity || 0) * 1000);
    if (Number(row.addedQuantity) > 0) line.addedMilli += Math.round(Number(row.addedQuantity) * 1000);
    else if (Number(row.quantity) > 0 && !(Number(row.cancelledQuantity) > 0)) line.addedMilli += Math.round(Number(row.quantity) * 1000);
    if (Number(row.cancelledQuantity) > 0) line.cancelledMilli += Math.round(Number(row.cancelledQuantity) * 1000);
    else if (Number(row.quantity) < 0) line.cancelledMilli += Math.round(Math.abs(Number(row.quantity)) * 1000);
    for (const mk of row.minusKinds || []) if (mk) line.minusKinds.add(mk);
    if (Number(row.quantity) < 0 && line.minusKinds.size === 0) line.minusKinds.add(resolveMinusKind(row));
    line.sourceKeys.push(...(row.sourceKeys || []));
    if (!line.dbProdName && clean(row.dbProdName)) {
      line.dbProdName = clean(row.dbProdName);
      if (row.dbProdKey) line.dbProdKey = row.dbProdKey;
    }
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
    const items = [...card.lines.values()].filter(line => line.milli !== 0).map(line => {
      const breakdownNote = computeMinusBreakdownNote(line.addedMilli, line.cancelledMilli, line.minusKinds);
      return {
        key: line.key, totalKeys: line.totalKeys, product: line.product, baseName: line.baseName, spec: line.spec, packSpec: line.packSpec,
        dbProdName: line.dbProdName || '', dbProdKey: line.dbProdKey || null,
        group: line.group, unit: line.unit, quantity: line.milli / 1000,
        addedQuantity: line.addedMilli / 1000, cancelledQuantity: line.cancelledMilli / 1000,
        minusKinds: [...line.minusKinds], breakdownNote, note: breakdownNote,
        sourceKeys: [...new Set(line.sourceKeys)],
        customers: line.customers.join(', '), requestNotes: [...line.requestNotes], revisions: [...line.revisions].join(', '),
      };
    }).sort((a, b) => a.group.localeCompare(b.group, 'ko') || compareItems(a, b));
    return { key: card.key, year: card.year, week: card.week, cycle: card.cycle, country: card.country, countryLabel: card.countryLabel,
      farm: card.farm, isNamedFarm: Boolean(card.farm), title: card.title, groups: [...card.groups].sort((a, b) => a.localeCompare(b, 'ko')),
      items, itemCount: items.length, units: summarizeUnitQuantities(items), unitsEn: summarizeUnitQuantities(items, { lang: 'en' }),
      memos: [...card.memos] };
  }).filter(card => card.items.length > 0).sort((a, b) => a.year.localeCompare(b.year) || a.week.localeCompare(b.week, undefined, { numeric: true })
    || a.countryLabel.localeCompare(b.countryLabel, 'ko') || Number(a.isNamedFarm) - Number(b.isNamedFarm)
    || a.title.localeCompare(b.title, 'ko', { numeric: true }));
  const allItems = list.flatMap(card => card.items);
  const standardCount = list.filter(c => !c.isNamedFarm).length;
  return {
    cards: list,
    bundleCount: list.length,
    standardCount,
    farmCount: new Set(list.filter(c => c.isNamedFarm).map(c => farmMatchKey(c.farm))).size,
    unassignedCount: standardCount,
    itemCount: allItems.length,
    units: summarizeUnitQuantities(allItems),
    unitsEn: summarizeUnitQuantities(allItems, { lang: 'en' }),
    excludedItems, ignoredTotals, memos: memoList, reviewCount: Number(reviewCount) || 0,
  };
}

/**
 * Order-ready text: "[국가 · 품목군] (차수)" for standard orders or "[국가 · 농장] (차수)" for
 * farm-designated orders, numbered English DB ProdName (fallback to Kakao product) + lowercase English units by default.
 */
export function formatFarmCardText(card, { format = 'concise', lang = 'en', memo = true } = {}) {
  if (!card?.items?.length) return '';
  const en = lang === 'en';
  const groupSuffix = !en && card.isNamedFarm && card.groups.length === 1 ? ` · ${card.groups[0]}` : '';
  const mixedGroups = card.groups.length > 1;
  const heading = card.isNamedFarm ? (en ? card.farm : card.title) : (en ? englishNormalHeading(card) : card.title);
  const lines = [`[${heading}] ${card.cycle}${groupSuffix}`];
  card.items.forEach((item, index) => {
    const isStandaloneMinus = Number(item.quantity) < 0 && Boolean(item.breakdownNote);
    const isNettedMinus = Number(item.quantity) > 0 && Boolean(item.breakdownNote);
    if (en) {
      const dbName = clean(item.dbProdName || '');
      const rawName = dbName || clean(item.product);
      const groupEn = !dbName && mixedGroups && item.group ? (GROUP_EN_LABEL.get(item.group) || item.group) : '';
      const prefix = groupEn && !rawName.toLowerCase().includes(groupEn.toLowerCase()) ? `${groupEn} ` : '';
      const packExtra = item.packSpec ? ` (${item.packSpec})` : '';
      const qtyText = `${formatUnitDisplay(formatNumber(item.quantity), item.unit, 'en')}${isStandaloneMinus ? ` (${item.breakdownNote})` : ''}`;
      const extras = format === 'detailed'
        ? [isNettedMinus ? item.breakdownNote : '', item.revisions, item.customers && `customers: ${item.customers}`, ...item.requestNotes].filter(Boolean)
        : [isNettedMinus ? item.breakdownNote : '', ...(memo ? item.requestNotes : [])].filter(Boolean);
      lines.push(`${index + 1}. ${prefix}${rawName}${packExtra} - ${qtyText}${extras.length ? ` / ${extras.join(' · ')}` : ''}`);
      return;
    }
    const name = item.spec ? item.baseName : item.product;
    const prefix = mixedGroups && item.group && !name.includes(item.group) ? `${item.group} ` : '';
    const spec = [item.spec, item.packSpec].filter(Boolean).join(', ');
    const qtyText = `${formatUnitDisplay(formatNumber(item.quantity), item.unit, 'ko')}${isStandaloneMinus ? ` (${item.breakdownNote})` : ''}`;
    const extras = format === 'detailed'
      ? [isNettedMinus ? item.breakdownNote : '', item.revisions, item.customers && `업체 ${item.customers}`, ...item.requestNotes].filter(Boolean)
      : [isNettedMinus ? item.breakdownNote : '', ...(memo ? item.requestNotes : [])].filter(Boolean);
    lines.push(`${index + 1}. ${prefix}${name}${spec ? ` (${spec})` : ''} - ${qtyText}${extras.length ? ` / ${extras.join(' · ')}` : ''}`);
  });
  const total = (en ? card.unitsEn : card.units).totalLine;
  if (total) lines.push(en ? `Total: ${total}` : `합계: ${total}`);
  if (memo && card.memos.length) lines.push(`${en ? 'Note' : '전달 메모'}: ${card.memos.join(' / ')}`);
  return lines.join('\n');
}

export function formatFarmTransferText(summary, options = {}) {
  const effectiveOpts = { lang: 'en', ...options };
  const cards = Array.isArray(summary) ? summary : summary?.cards || [];
  const blocks = cards.map(card => formatFarmCardText(card, effectiveOpts)).filter(Boolean);
  const loose = Array.isArray(summary) ? [] : (summary?.memos || []).filter(m => !m.attached);
  if (effectiveOpts.memo !== false && loose.length) {
    blocks.push(`[${effectiveOpts.lang === 'en' ? 'Notes' : '공통 전달 메모'}]\n${loose.map(m => `- ${m.farm ? `${m.farm}: ` : ''}${m.text}`).join('\n')}`);
  }
  return blocks.join('\n\n');
}
