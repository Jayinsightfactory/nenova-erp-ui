// Pure, read-only interpretation of collected or pasted import-room Kakao text. Never an ERP order writer.
import {
  messageDay,
  readImportDay,
  todaySeoul,
  validItem,
  normalizeFarmName,
  inferCountryFromFarm,
  isKnownFarmToken,
  normalizeOrderUnit,
  extractProductSpec,
} from './importKakaoAdditions.js';
import { canonicalImportCountry } from './importToolsDisplay.js';

const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const fold = value => clean(value).toLowerCase();

const flowers = /수국|카네이션|알스트로메리아|알스트로|루스커스|튤립|히야신스|아스틸베|장미|카라|거베라|국화|안개|안시리움|스키미아|유칼립투스|작약|다알리아|달리아|호접|덴파레|모카라|스타티스|라넌큘러스|줄맨드라미|네리네|아이리스|클레마티스|수선화/;
const colombiaGroups = new Set(['수국', '알스트로', '카네이션', '루스커스', '장미']);
const countries = /콜롬비아|네덜란드|에콰도르|중국|태국|베트남|호주|미국|(?:^|\s)콜(?=\s|수국|장미|카네이션)/;
const englishFlowers = [[/hydrangea/i,'수국'],[/carnation/i,'카네이션'],[/alstroemeria/i,'알스트로'],[/ruscus/i,'루스커스'],[/astilbe/i,'아스틸베'],[/tulip/i,'튤립'],[/hyacinth/i,'히야신스'],[/anthurium/i,'안시리움'],[/gypsophil/i,'안개'],[/skimmia/i,'스키미아'],[/rose/i,'장미'],[/clematis/i,'클레마티스'],[/daffodil/i,'수선화'],[/nerine/i,'네리네'],[/\biris\b/i,'아이리스']];
const verifiedGroupAliases = new Map([
  ['중국', new Map([
    ['시네신스 연핑크', '리모늄'], ['시네신스 화이트', '리모늄'],
    ['sinensis light pink', '리모늄'], ['sinensis white', '리모늄'],
    ['시네리아', '기타'], ['유칼리튭스_시네리아', '기타'],
    ['유킬립툽스_시네리아', '기타'], ['안슬레이', '장미'],
  ])],
  ['네덜란드', new Map([
    ['liberstar white', '튤립'], ['liberster white', '튤립'],
    ['tulipa lily flowered white liberstar', '튤립'],
  ])],
]);
const addIntent = /발주|주문|추가|구매|보내\s*주세요|부탁(?:합니다|드립니다)|해\s*주세요/;
const information = /문의|정보\s*요청|사진\s*요청|단가|가격|네고|가능\s*(?:여부|할|한)|있을까요|받아\s*볼|추천|불량|클레임|검품|혼적|입고\s*완료|도착\s*완료|온\s*\d+박스|보내었습니다|이런\s*실수|\bprice\s*:|\bseason\s*:/i;
// Original message-level change vocabulary. A line containing these words that is NOT resolved
// as an item-level cancellation/revision keeps the whole message in review (no silent subtraction).
const change = /취소|대체|정정|변경|반품|넘겨|넘긴|이월|미컨펌|미확보|발주\s*확인|원본이\s*다른|삭제되었습니다|안\s*해주셔도|수정했습니다/;
const codePattern = /\b(?!(?:CLOUD|CLEMATIS|CLASSIC|CLEAR|CLASS)\b)[A-Z]{0,3}CL(?:[-_]?\d+[A-Z0-9_-]*|[A-Z]?)\b/i;
const companyCodeHeading = /^([가-힣A-Za-z][가-힣A-Za-z0-9 .()&]{0,23}?)\s+([A-Z]*CL)\s*-?\s*(\d{1,5})$/i;

const UNIT = 'FB|HB|QB|EB|full\\s*box(?:es)?|half\\s*box(?:es)?|quarter\\s*box(?:es)?|bx|boxes|box|박스|상자|B(?![A-Za-z0-9])|bunches|bunch|bdl|bd|단|속|스팀|스템|송이|본|stems|stem|st(?![A-Za-z0-9])|봉지|봉|개';
const NUM = '\\d+(?:,\\d{3})*(?:\\.\\d{1,3})?';
// Separator between product and quantity: ":" / " - " (dash with spaces) / whitespace. "-1" stays a negative number.
const SEP = '(?:\\s*[:：]\\s*|\\s+[-–]\\s+|\\s*)';
const TAIL = '((?:추가|취소|제외|빼\\s*주세요|빼\\s*주세용|패스|pass|대체|정정|변경|발주|주문|부탁|보내|해주|해주세요|\\(|（|\\[|<|【|[-–]\\s*총|$).*)';
const quantityLine = new RegExp(`^(.*?)${SEP}(\\+\\s*)?(${NUM})\\s*(${UNIT})?\\s*${TAIL}$`, 'i');
const arrowLine = new RegExp(`^(.*?)${SEP}(${NUM})\\s*(${UNIT})?\\s*(?:->|=>|→|➡|에서)\\s*(${NUM}|취소|제외|패스)\\s*(${UNIT})?\\s*(?:으?로\\s*)?(?:변경|수정|정정|조정|교체)?(?:합니다|해\\s*주세요|부탁드립니다|요)?[.!]?\\s*(.*)$`, 'i');
const boxTimesSubUnit = new RegExp(`^(.*?)${SEP}(${NUM})\\s*(FB|HB|QB|EB|bx|boxes|box|박스|상자|B(?![A-Za-z0-9]))\\s*[*x×X]\\s*(${NUM})\\s*(bunches|bunch|bdl|bd|단|속|스팀|스템|송이|본|stems|stem|st(?![A-Za-z0-9]))\\s*${TAIL}$`, 'i');
const unitTimesCount = new RegExp(`^(.*?)${SEP}(${NUM})\\s*(${UNIT})\\s*[*x×X]\\s*(\\d{1,4})\\s*${TAIL}$`, 'i');

const PC_KAKAO_LINE = /^\[([^\]\r\n]{1,30})\]\s*\[((?:오전|오후|AM|PM)\s*\d{1,2}:\d{2}(?::\d{2})?|\d{1,2}:\d{2}(?::\d{2})?)\]\s*(.*)$/i;
const MOBILE_KAKAO_LINE = /^(\d{4}\s*(?:년|[./-])\s*\d{1,2}\s*(?:월|[./-])\s*\d{1,2}\s*(?:일|\.)?\s*(?:[월화수목금토일](?:요일)?)?\s*(?:오전|오후|AM|PM)?\s*\d{1,2}:\d{2}(?::\d{2})?)\s*,\s*([^:：\r\n]{1,30}?)\s*[:：]\s*(.*)$/i;
const DATE_DIVIDER = /^(?:[-=─ㅡ~]{2,}\s*)?\d{4}\s*(?:년|[./-])\s*\d{1,2}\s*(?:월|[./-])\s*\d{1,2}\s*(?:일|\.)?\s*(?:\(?[월화수목금토일](?:요일)?\)?)?\s*(?:[-=─ㅡ~]{2,})?$/;
const MEDIA_OR_SYSTEM = /^(?:사진(?:\s*\d+\s*장)?|동영상|이모티콘|\(이모티콘\)|파일\s*[:：].+|보이스톡.*|페이스톡.*|삭제된\s*메시지입니다\.?|.+님이\s+.+님을\s+초대했습니다\.?|.+님이\s+(?:나갔습니다|들어왔습니다)\.?)$/i;
const CHATTER = new RegExp(
  `^(?:${[
    '네+', '넵+', '넹+', '예+', '응+', 'ㅇㅇ+', 'ㅇㅋ+', '오키', '오케이', 'ok(?:ay)?',
    '확인(?:요|했습니다|하였습니다|감사합니다|완료)?', '알겠습니다', '감사합니다', '감사드립니다', '고맙습니다',
    '수고하세요', '수고하셨습니다', '고생하셨습니다', '좋은\\s*하루\\s*(?:보내세요|되세요)', '안녕하세요', '반갑습니다',
    '[ㅋㅎㅠㅜ^~.!?\\s,]+'
  ].map(p => p.normalize('NFKC')).join('|')}|[\\u1100-\\u11FF\\u3130-\\u318F^~.!?\\s,]+)+$`,
  'i'
);
const SUMMARY_WORD = '(?:총\\s*합계|전체\\s*합계|농장\\s*합계|발주\\s*합계|합\\s*계|총\\s*계|소\\s*계|도\\s*합|총\\s*수량|grand\\s*total|sub\\s*-?\\s*total|total)';
const SUMMARY_LINE = new RegExp(`^[(\\[=─\\-*#▶■\\s]*${SUMMARY_WORD}\\s*(?:[:：=\\-]\\s*)?(?:총\\s*)?${NUM}`, 'i');
const SHORT_TOTAL_LINE = new RegExp(`^[(\\[=─\\-*#\\s]*(?:총|계)\\s*[:：]?\\s*${NUM}\\s*(?:${UNIT}|품목|종|건)?(?:\\s*[/,·+]\\s*(?:총\\s*)?${NUM}\\s*(?:${UNIT})?)*[)\\]\\s=─\\-]*$`, 'i');
const MEMO_HINT = /선적분?|출하분?|도착분|입고분|항공편|색상|컬러|진한|연한|밝은|선명|봉오리|줄기|포장|합포장|마킹|라벨|물올림|신선|위주|선별|특이\s*사항|전달\s*사항|참고|주의|메모\s*[:：]|요망|필수|부탁/;
const ITEM_CANCEL_TAIL = /(?:^|\s|[(\[/-])(?:취소|제외|빼\s*주세요|빼\s*주세용|패스|pass|스킵)(?:입니다|합니다|해\s*주세요|해\s*주세용|요망|요)?[)\].!~]*$/i;
const ITEM_CANCEL_HEAD = /^(?:\[\s*(?:취소|제외|패스)\s*\]|\(\s*(?:취소|제외|패스)\s*\)|(?:취소|제외)\s*[:：])\s*/i;
const NAME_ONLY_CANCEL = /^([A-Za-z가-힣][A-Za-z가-힣0-9 /_-]{0,28}?)\s*(?:은|는|도)?\s*(?:취소|제외|패스|빼\s*주세요|빼\s*주세용|스킵)(?:입니다|합니다|해\s*주세요|해\s*주세용|요)?[.!~]*$/i;

function category(text) { return text.match(flowers)?.[0]?.replace('알스트로메리아','알스트로') || englishFlowers.find(([re])=>re.test(text))?.[1] || ''; }
function country(text) { const c=clean(text.match(countries)?.[0]); return c==='콜'?'콜롬비아':c; }
function week(text) {
  const sub = text.match(/(?:^|\s|\[)(\d{1,2})\s*-\s*(\d{1,2})(?:차|\s|\]|$)/);
  if (sub) return `${Number(sub[1])}-${String(Number(sub[2])).padStart(2, '0')}`;
  const singles = [...text.matchAll(/(?:^|\s|\[)(\d{1,2})차(?!(?:\s*(?:선적|출하|출고|입고|도착|분배|검품|결제)))/g)].map(m => m[1]);
  return singles.find(n => Number(n) >= 10) || singles[0] || '';
}
const unit = text => normalizeOrderUnit(text);
function stripBullet(text) { return clean(text).replace(/^[*★•·▪\->]+\s*/, '').replace(/^\d+[.)]\s+/, ''); }
const number = text => String(text).replace(/,/g, '');

/** Removes KakaoTalk PC/mobile copy envelopes and returns only the business text of one line. */
export function stripKakaoLineEnvelope(rawLine) {
  let line = clean(rawLine);
  if (!line) return { text: '', noise: '' };
  if (DATE_DIVIDER.test(line)) return { text: '', noise: '날짜 구분선', dateLine: line };
  let sender = '', stamp = '';
  const pc = line.match(PC_KAKAO_LINE), mobile = !pc && line.match(MOBILE_KAKAO_LINE);
  if (pc) { sender = clean(pc[1]); stamp = clean(pc[2]); line = clean(pc[3]); }
  else if (mobile) { stamp = clean(mobile[1]); sender = clean(mobile[2]); line = clean(mobile[3]); }
  if (!line) return { text: '', noise: '작성자·시각', sender, stamp };
  if (MEDIA_OR_SYSTEM.test(line)) return { text: '', noise: '사진·이모티콘·시스템', sender, stamp };
  if (CHATTER.test(line)) return { text: '', noise: '인사·단순 답변', sender, stamp };
  return { text: line, noise: '', sender, stamp };
}

/** Lines that only restate a total ("합계 15B", "총 20박스", "Total 10 HB", "계: 5박스") are never items. */
export function isSummaryTotalLine(rawLine) {
  const line = clean(rawLine).replace(/^[*★•·▪>]+\s*/, '');
  return Boolean(line) && (SUMMARY_LINE.test(line) || SHORT_TOTAL_LINE.test(line));
}

function badProduct(product) {
  if (!product || !/[a-z가-힣]/i.test(product)) return true;
  if (/^[A-Z]*CL$/i.test(product)) return true;
  if (new RegExp(`^${SUMMARY_WORD}$`, 'i').test(product) || /^(?:총|계)$/.test(product)) return true;
  // Prose quantities (complaints, prices, received goods) are never product lines.
  return /발주|주문|추가|문의|가격|단가|필요|이번|박스\s*중|총\s*$|사진|ETA|차수|도착|취소|변경|불량|그럼|부탁|보내|차에\s*$|\d\s*(박스|상자|단|속|스팀|스템|송이|본|봉)/.test(product);
}

function leadingFarm(product, knownFarms) {
  let text = clean(product), farm = '', inlineCountry = '';
  for (;;) {
    const tag = text.match(/^(?:\[([^\]]{1,30})\]|<([^>]{1,30})>|【([^】]{1,30})】)\s*[:：-]?\s*(.+)$/);
    if (!tag) break;
    const label = clean(tag[1] || tag[2] || tag[3]);
    const rest = label.replace(countries, '').trim();
    if (country(label)) inlineCountry = country(label);
    if (rest) farm = normalizeFarmName(rest, knownFarms) || farm;
    text = clean(tag[4]);
  }
  if (!farm) {
    const suffix = text.match(/^([A-Za-z가-힣][A-Za-z가-힣0-9 ]{0,18}?)\s*(?:농장|farm)\s*[:：-]?\s+(.+)$/i);
    if (suffix && /[A-Za-z가-힣]/.test(suffix[2])) {
      const name = normalizeFarmName(suffix[1], knownFarms);
      if (name) { farm = name; text = clean(suffix[2]); }
    }
  }
  if (!farm) {
    const tokens = text.split(' ');
    for (const take of [3, 2, 1]) {
      if (tokens.length <= take) continue;
      const head = tokens.slice(0, take).join(' ').replace(/[:：-]+$/, '');
      const tail = tokens.slice(take).join(' ').replace(/^[:：-]+\s*/, '');
      if (!/[A-Za-z가-힣]{2}/.test(tail) || /^\d+(?:[~-]\d+)?\s*cm$/i.test(tail)) continue;
      if (isKnownFarmToken(head, knownFarms)) { farm = normalizeFarmName(head, knownFarms); text = tail; break; }
    }
  }
  return { product: text, farm, inlineCountry };
}

/**
 * Parses one order line. Supports units FB/HB/QB/EB/B/박스/상자, 단/속/bunch/bd, 본/송이/st/stems,
 * multiplication (2박스 x 10단, 100본*5, 50cm * 3B), arrows (3B -> 5B, 3박스에서 5박스로 변경),
 * increments (+2B 추가) and item-level cancellation (취소/제외/빼주세요/패스/0박스/~취소선~).
 */
export function parseOrderItemLine(rawLine, knownFarms = []) {
  let text = clean(rawLine);
  if (!text || isSummaryTotalLine(text)) return null;
  let cancelled = false, cancelReason = '';
  const strike = text.match(/^~+\s*(.+?)\s*~+$/);
  if (strike) { text = clean(strike[1]); cancelled = true; cancelReason = '취소선'; }
  if (!/^[[<【]/.test(text)) text = stripBullet(text);
  if (ITEM_CANCEL_HEAD.test(text)) { text = clean(text.replace(ITEM_CANCEL_HEAD, '')); cancelled = true; cancelReason ||= '취소·제외 표시'; }
  // "50cm * 3B" means length 50cm, quantity 3B: the length is never multiplied.
  text = text.replace(/(\d{2,3}(?:\s*[~-]\s*\d{2,3})?\s*cm)\s*[*x×X]\s*(?=\d)/gi, '$1 ');

  let product = '', quantity = '', parsedUnit = '', tail = '', packSpec = '', previousQuantity = '', revisionNote = '', increment = false;
  const accept = raw => { const p = clean(raw).replace(/[:：]+$/, '').trim(); return /[+\-~→>]\s*$/.test(clean(raw)) || badProduct(p) ? '' : p; };

  const arrow = text.match(arrowLine);
  if (arrow && accept(arrow[1])) {
    product = accept(arrow[1]);
    const fromUnit = unit(arrow[3] || ''), target = clean(arrow[4]);
    parsedUnit = unit(arrow[5] || '') || fromUnit;
    tail = clean(arrow[6]);
    previousQuantity = number(arrow[2]);
    if (/^(?:취소|제외|패스)$/.test(target) || Number(number(target)) === 0) {
      quantity = '0'; cancelled = true; cancelReason = `${previousQuantity}→취소`;
    } else {
      quantity = number(target); revisionNote = `${previousQuantity}→${quantity} 변경`;
    }
  }
  if (!product) {
    const m = text.match(boxTimesSubUnit);
    if (m && accept(m[1])) {
      product = accept(m[1]); quantity = number(m[2]); parsedUnit = unit(m[3]);
      packSpec = `1${parsedUnit === '박스' ? '박스' : parsedUnit}당 ${number(m[4])}${unit(m[5])}`; tail = clean(m[6]);
    }
  }
  if (!product) {
    const m = text.match(unitTimesCount);
    if (m && accept(m[1])) {
      product = accept(m[1]); parsedUnit = unit(m[3]);
      quantity = String(Math.round(Number(number(m[2])) * Number(m[4]) * 1000) / 1000);
      packSpec = `${number(m[2])}${parsedUnit}×${m[4]}`; tail = clean(m[5]);
    }
  }
  if (!product) {
    const m = text.match(quantityLine);
    if (!m || !accept(m[1])) return null;
    product = accept(m[1]); increment = Boolean(m[2]); quantity = number(m[3]); parsedUnit = unit(m[4] || ''); tail = clean(m[5]);
  }
  if (ITEM_CANCEL_TAIL.test(tail)) { cancelled = true; cancelReason ||= '취소·제외 지시'; tail = clean(tail.replace(ITEM_CANCEL_TAIL, '')); }
  if (!cancelled && Number(quantity) === 0) { cancelled = true; cancelReason = '0수량'; }
  let note = tail.replace(/^(?:추가|발주|주문)\s*/, '');
  const located = leadingFarm(product, knownFarms);
  let farm = located.farm;
  if (!farm && note) {
    const explicitParen = note.match(/^[（(\[]\s*(?:농장(?:명)?\s*[:：]\s*([^()\[\]（）]{2,24})|([A-Za-z가-힣0-9 ._-]{2,20}?)\s*(?:농장|farm))\s*[）)\]]\s*(.*)$/i);
    if (explicitParen) {
      const candidate = normalizeFarmName(explicitParen[1] || explicitParen[2], knownFarms);
      if (candidate) {
        farm = candidate;
        note = clean(explicitParen[3]);
      }
    } else {
      const shortBracket = note.match(/^[（(\[<【]\s*([A-Za-z가-힣][A-Za-z가-힣0-9 ._-]{1,19})\s*[）)\]>】]\s*(.*)$/);
      if (shortBracket) {
        const inner = clean(shortBracket[1]);
        const wordCount = inner.split(/\s+/).length;
        const isProseOrNote = /\d|부탁|요청|추가|취소|변경|제외|문의|확인|가능|불가|선적|출하|도착|입고|색상|컬러|진한|연한|밝은|포장|합포장|단가|가격|재고|선출고|유지|대체|보류|필수|요망|위주|좋은|지정|아무|추천|다른|기존|박스|상자|단|속|송이|본|스팀|스템|봉|총|합계|소계|계/.test(inner);
        if (isKnownFarmToken(inner, knownFarms) || (wordCount <= 3 && !isProseOrNote)) {
          const candidate = normalizeFarmName(inner, knownFarms);
          if (candidate) {
            farm = candidate;
            note = clean(shortBracket[2]);
          }
        }
      }
    }
  }
  return {
    product: located.product, quantity, unit: parsedUnit, note, packSpec, previousQuantity, revisionNote,
    increment, cancelled, cancelReason, farm, inlineCountry: located.inlineCountry,
  };
}
const parseLine = (line, knownFarms) => parseOrderItemLine(line, knownFarms);

function contextFreeFarmText(text) {
  return clean(text)
    .replace(/\d{1,2}(?:\s*-\s*\d{1,2})?\s*차?/g, ' ')
    .replace(new RegExp(countries.source, 'g'), ' ')
    .replace(new RegExp(flowers.source, 'g'), ' ')
    .replace(/선?발주|주문|추가|변경사항|요청|전달용?/g, ' ')
    .replace(/[[\]<>【】■▶▷◆●▣:：]/g, ' ')
    .trim();
}

/**
 * Recognises farm/country block headers: "[콜롬비아] 플로렌스 농장", "■ Melody", "▶ CLOUD",
 * "농장명 : Apollo", "<San Marino>", standalone registered farm names and upper-case Latin headers.
 */
export function extractFarmHeader(rawLine, knownFarms = []) {
  const line = clean(rawLine);
  if (!line || isSummaryTotalLine(line) || codePattern.test(line) || parseLine(line, knownFarms)) return null;
  if (information.test(line) || change.test(line)) return null;
  const marked = /^(?:[■▶▷◆●▣]|\[[^\]]{1,40}\]|<[^>]{1,40}>|【[^】]{1,40}】|(?:수신\s*)?(?:농장(?:명)?|farm(?:\s*name)?)\s*[:：])/i.test(line)
    || /[A-Za-z가-힣0-9]\s*(?:농장|farms?)$/i.test(line);
  const plain = line.replace(/^(?:수신\s*)?(?:농장(?:명)?|farm(?:\s*name)?)\s*[:：]\s*/i, '');
  const candidate = contextFreeFarmText(plain);
  const header = { country: country(line), group: category(line), week: week(line), farm: '' };
  if (marked) {
    header.farm = candidate ? normalizeFarmName(candidate, knownFarms) : '';
    return header.farm || header.country || header.group || header.week ? header : null;
  }
  if (/\d/.test(line) || line.length > 32 || addIntent.test(line)) return null;
  if (isKnownFarmToken(line, knownFarms)) return { ...header, farm: normalizeFarmName(line, knownFarms) };
  if (/^[A-Z][A-Z &.'-]{3,28}$/.test(line) && /[A-Z]{4}/.test(line) && !/^(?:ETA|TOTAL|SUBTOTAL|MEMO|NOTE|PASS|OK)$/.test(line)) {
    return { ...header, farm: normalizeFarmName(line, knownFarms) };
  }
  return null;
}

// Only unambiguous raw-customer -> confirmed-customer evidence is reused.
export function importCustomerAliases(values) {
  const candidates=new Map();
  for(const row of values.slice(1)) {
    const name=clean(row[19]||row[8]), raw=clean(row[7]);
    if(!raw||!name)continue;
    for(const key of [raw,raw.match(codePattern)?.[0]].filter(Boolean)) {
      const id=fold(key); if(!candidates.has(id))candidates.set(id,new Set()); candidates.get(id).add(name);
    }
  }
  return new Map([...candidates].filter(([,v])=>v.size===1).map(([k,v])=>[k,[...v][0]]));
}
function customerName(text, aliases) {
  const raw=clean(text), code=raw.match(codePattern)?.[0];
  return aliases.get(fold(raw)) || (code && aliases.get(fold(code))) || raw;
}

// A separate quoted request for product suggestions is not a condition on a preceding order.
function trailingRecommendation(lines) {
  const last = lines.at(-1);
  if (!/^>+/.test(last || '') || !/발주\s*추가|추가\s*발주/.test(lines[0] || '')) return -1;
  const note = stripBullet(last);
  if (!/추천/.test(note) || !/품목|품종/.test(note)
      || !/올려\s*주|보여\s*주|알려\s*주|추천\s*(?:해\s*주|부탁)/.test(note)
      || /발주|주문|취소|대체|변경|보류|확정|기존|위\s*(?:수량|품목|주문)|아니면|없으면|있으면|가능\s*하면|되면|되는\s*경우|조건|보내|받아|전달|단가|가격|답변.*후/.test(note)
      || /\d[\d,.]*\s*(?:박스|단|송이|스팀|스템|봉|개|boxes?|stems?)/i.test(note)) return -1;
  return lines.length - 1;
}

const LLM_COUNTRY_ALIASES = new Map([
  ['colombia', '콜롬비아'], ['col', '콜롬비아'], ['콜롬비아', '콜롬비아'], ['콜', '콜롬비아'],
  ['china', '중국'], ['chn', '중국'], ['cn', '중국'], ['중국', '중국'],
  ['netherlands', '네덜란드'], ['holland', '네덜란드'], ['nld', '네덜란드'], ['nl', '네덜란드'], ['네덜란드', '네덜란드'],
  ['ecuador', '에콰도르'], ['ecu', '에콰도르'], ['ec', '에콰도르'], ['에콰도르', '에콰도르'],
  ['thailand', '태국'], ['tha', '태국'], ['th', '태국'], ['태국', '태국'],
  ['vietnam', '베트남'], ['vnm', '베트남'], ['vn', '베트남'], ['베트남', '베트남'],
  ['australia', '호주'], ['aus', '호주'], ['au', '호주'], ['호주', '호주'],
  ['usa', '미국'], ['united states', '미국'], ['us', '미국'], ['미국', '미국'],
  ['kenya', '케냐'], ['케냐', '케냐'],
  ['ethiopia', '에티오피아'], ['에티오피아', '에티오피아'],
  ['japan', '일본'], ['jp', '일본'], ['일본', '일본'],
]);

function normalizeLlmCountry(rawValue) {
  const trimmed = clean(rawValue);
  if (!trimmed) return '';
  const direct = LLM_COUNTRY_ALIASES.get(fold(trimmed));
  if (direct) return direct;
  const fromRe = country(trimmed);
  if (fromRe) return fromRe;
  const canonical = canonicalImportCountry(trimmed);
  return LLM_COUNTRY_ALIASES.get(fold(canonical)) || clean(canonical);
}

function normalizeLlmCategory(rawValue) {
  const trimmed = clean(rawValue);
  if (!trimmed || /^\d{1,2}\s*차?$/.test(trimmed)) return '';
  return category(trimmed) || trimmed.replace('알스트로메리아', '알스트로');
}

function normalizeLlmWeekAndYear(rawWeek, rawSubGroup, fallbackText, messageTime, defaultWeek, defaultYear) {
  const fallbackYear = clean(messageTime).match(/^\d{4}/)?.[0] || String(defaultYear || '');
  const w = clean(rawWeek);
  if (w) {
    const m = w.match(/^(?:(20\d{2})\s*[/.-]\s*)?w?(\d{1,2})(?:\s*[-_.]\s*(\d{1,2}))?\s*(?:주차|차)?$/i);
    if (m) {
      const yr = m[1] || fallbackYear;
      const maj = Number(m[2]);
      if (m[3] !== undefined) {
        return { year: yr, week: `${maj}-${String(Number(m[3])).padStart(2, '0')}` };
      }
      const textWeek = week(String(fallbackText || ''));
      if (textWeek && textWeek.startsWith(`${maj}-`)) {
        return { year: yr, week: textWeek };
      }
      const subM = clean(rawSubGroup).match(/^0?(\d{1,2})\s*차?$/);
      if (subM && Number(subM[1]) >= 2) {
        return { year: yr, week: `${maj}-${String(Number(subM[1])).padStart(2, '0')}` };
      }
      return { year: yr, week: String(maj) };
    }
  }
  return { year: fallbackYear, week: week(String(fallbackText || '')) || clean(defaultWeek || '') };
}

/**
 * Normalizes a pre-computed `order_parsed` JSONB payload produced by the 3-tier subscription
 * LLM worker (`claude-sub` > `codex-sub` > `antigravity-sub`). Returns `null` when `order_parsed`
 * is absent or invalid so `analyzeImportMessage` seamlessly falls back to the regex parser.
 */
export function normalizeLlmOrderParsed(message, aliases = new Map(), options = {}) {
  if (options.ignoreLlmCache) return null;
  let raw = message?.order_parsed;
  if (typeof raw === 'string' && raw.trim().startsWith('{')) {
    try { raw = JSON.parse(raw); } catch { raw = null; }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const rawKind = fold(raw.kind);
  if (!['addition', 'review', 'cleaned', 'excluded'].includes(rawKind)) return null;

  const knownFarms = options.knownFarms || [];
  const text = String(message?.text || '').normalize('NFKC');
  const llmProvider = clean(raw.provider || raw.model_provider || 'llm');
  const topCountry = normalizeLlmCountry(raw.country) || normalizeLlmCountry(options.defaultCountry);
  const topCategory = normalizeLlmCategory(raw.category) || normalizeLlmCategory(raw.group);
  const topFarm = normalizeFarmName(raw.farm || '', knownFarms);
  const topCustomer = raw.customer ? customerName(raw.customer, aliases) : '';
  const topCycle = normalizeLlmWeekAndYear(raw.week, raw.group, text, message?.time, options.defaultWeek, options.defaultYear);
  const replacesMessageId = raw.replacesMessageId != null ? clean(raw.replacesMessageId) : '';

  if (rawKind === 'cleaned' || rawKind === 'excluded') {
    const cleanReason = clean(raw.cleanReason || raw.reason)
      || (information.test(text) ? '문의·가격·품질 등 발주 외 대화' : 'AI 비발주 대화 분류');
    return {
      kind: 'excluded',
      analysisSource: 'llm',
      llmProvider,
      cleanReason,
      hintCountry: topCountry || country(text),
      hintWeek: topCycle.week || week(text),
      items: [],
      excludedItems: [],
      ignoredTotals: [],
      memos: [],
      noise: [],
    };
  }

  const ignoredTotals = [];
  const items = [];
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  for (let idx = 0; idx < rawItems.length; idx++) {
    const entry = rawItems[idx];
    if (!entry || typeof entry !== 'object') continue;
    const rawProdName = clean(entry.product || '');
    if (!rawProdName) continue;
    if (isSummaryTotalLine(rawProdName)) {
      ignoredTotals.push({
        country: topCountry,
        group: topCategory,
        week: topCycle.week,
        year: topCycle.year,
        farm: topFarm,
        text: rawProdName,
      });
      continue;
    }

    let workingProd = rawProdName.replace(/^\d{1,2}(?:-\d{1,2})?차?\s+/, '').trim() || rawProdName;
    const rawSpec = clean(entry.spec || '');
    let packSpec = clean(entry.packSpec || '');
    if (rawSpec) {
      if (!packSpec && /(?:박스당|×|\*)/.test(rawSpec) && !extractProductSpec(rawSpec).spec) {
        packSpec = rawSpec;
      } else {
        const extraTokens = rawSpec
          .split(/\s*[·,/]\s*|\s+/)
          .filter(tok => tok && !fold(workingProd).includes(fold(tok)));
        if (extraTokens.length) workingProd = clean(`${workingProd} ${extraTokens.join(' ')}`);
      }
    }

    let itemGroup = normalizeLlmCategory(entry.category) || normalizeLlmCategory(entry.group) || category(workingProd) || topCategory;
    let product = workingProd.replace(new RegExp('^' + (itemGroup || '(?!)') + '\\s*[/ ]\\s*', 'i'), '').trim();
    if (!product || /^\d+(?:[~-]\d+)?\s*cm$/i.test(product)) product = workingProd;
    if (/^(문라이트|moon\s*light)$/i.test(product)) product = 'Moon Light';

    const resolvedFarm = normalizeFarmName(entry.farm || topFarm || '', knownFarms);
    const explicitCountry = normalizeLlmCountry(entry.country) || country(workingProd) || topCountry;
    itemGroup ||= verifiedGroupAliases.get(explicitCountry)?.get(fold(product)) || '';
    const inferredCountry = !explicitCountry && resolvedFarm ? inferCountryFromFarm(resolvedFarm, knownFarms) : '';
    const itemCountry = explicitCountry || inferredCountry || (colombiaGroups.has(itemGroup) ? '콜롬비아' : '');
    const cycle = normalizeLlmWeekAndYear(entry.week || raw.week, entry.group || raw.group, text, message?.time, options.defaultWeek, options.defaultYear);
    const parsedUnit = normalizeOrderUnit(entry.unit || entry.rawUnit || '');
    const rawQtyStr = clean(String(entry.quantity ?? '')).replace(/,/g, '');
    const qtyNum = Number(rawQtyStr);
    const qtyStr = rawQtyStr !== '' && Number.isFinite(qtyNum) ? String(Math.round(qtyNum * 1000) / 1000) : rawQtyStr;
    const cancelled = Boolean(entry.cancelled) || (rawQtyStr !== '' && qtyNum === 0);
    const itemCustomer = entry.customer ? customerName(entry.customer, aliases) : topCustomer;
    const itemNote = clean(entry.note || '');
    const revisionNote = clean(entry.revisionNote || '');
    const specInfo = extractProductSpec(product);
    const reviewReason = cancelled
      ? clean(entry.cancelReason || '취소·제외')
      : !parsedUnit
        ? '단위 확인 필요'
        : !cycle.week
          ? '차수 확인 필요'
          : !validItem({ product, quantity: qtyStr })
            ? '수량 확인 필요'
            : '';

    items.push({
      key: JSON.stringify([message.id, 'llm', idx]),
      sourceLine: rawProdName,
      product,
      baseName: specInfo.baseName,
      spec: specInfo.spec,
      packSpec,
      group: itemGroup,
      country: itemCountry,
      farm: resolvedFarm,
      countryInferred: !!itemCountry && !explicitCountry,
      week: cycle.week,
      year: cycle.year,
      quantity: qtyStr,
      unit: parsedUnit,
      customer: itemCustomer,
      note: itemNote,
      revisionNote,
      cancelled,
      reviewReason,
    });
  }

  const excludedItems = [
    ...items.filter(it => it.cancelled).map(it => ({
      product: it.product,
      quantity: it.quantity,
      unit: it.unit,
      farm: it.farm,
      country: it.country,
      group: it.group,
      week: it.week,
      year: it.year,
      reason: it.reviewReason || '취소·제외',
      sourceLine: it.sourceLine,
      key: it.key,
    })),
  ];

  if (Array.isArray(raw.cancelledItems)) {
    for (const c of raw.cancelledItems) {
      if (!c || typeof c !== 'object') continue;
      const prod = clean(c.product || '');
      if (!prod) continue;
      const cFarm = normalizeFarmName(c.farm || topFarm || '', knownFarms);
      const cExplicitCountry = normalizeLlmCountry(c.country) || topCountry;
      const cGroup = normalizeLlmCategory(c.category) || topCategory;
      const cCountry = cExplicitCountry || (cFarm ? inferCountryFromFarm(cFarm, knownFarms) : '') || (colombiaGroups.has(cGroup) ? '콜롬비아' : '');
      const cCycle = normalizeLlmWeekAndYear(c.week || raw.week, raw.group, text, message?.time, options.defaultWeek, options.defaultYear);
      excludedItems.push({
        product: prod,
        quantity: clean(String(c.quantity ?? '')).replace(/,/g, ''),
        unit: normalizeOrderUnit(c.unit || c.rawUnit || ''),
        farm: cFarm,
        country: cCountry,
        group: cGroup,
        week: cCycle.week,
        year: cCycle.year,
        reason: clean(c.reason || '취소·제외'),
      });
    }
  }

  const memos = [];
  if (Array.isArray(raw.memos)) {
    for (const m of raw.memos) {
      const memoText = clean(typeof m === 'string' ? m : m?.text || '');
      if (!memoText) continue;
      const memoFarm = typeof m === 'object' && m?.farm ? normalizeFarmName(m.farm, knownFarms) : topFarm;
      memos.push({
        country: topCountry || (topFarm ? inferCountryFromFarm(topFarm, knownFarms) : '') || (colombiaGroups.has(topCategory) ? '콜롬비아' : ''),
        group: topCategory,
        week: topCycle.week,
        year: topCycle.year,
        farm: memoFarm,
        text: memoText,
      });
    }
  }
  const enrichedItems = memos.length
    ? items.map(it => ({ ...it, memos: memos.filter(m => !m.farm || !it.farm || m.farm === it.farm).map(m => m.text) }))
    : items;

  const live = enrichedItems.filter(it => !it.cancelled);
  if (rawKind === 'review' || !live.length) {
    const reason = clean(raw.reviewReason || raw.reason) || (!live.length ? '취소·변경 내용 확인' : '발주 내용 검토 필요');
    return {
      kind: 'review',
      analysisSource: 'llm',
      llmProvider,
      reason,
      ...(replacesMessageId ? { replacesMessageId } : {}),
      items: enrichedItems.map(it => it.cancelled ? it : { ...it, reviewReason: reason }),
      unparsed: [],
      retained: [],
      excludedItems,
      ignoredTotals,
      memos,
      noise: [],
    };
  }

  const canAutoInclude = live.some(it => !it.reviewReason && validItem(it))
    && live.every(it => !it.reviewReason || it.reviewReason === '단위 확인 필요');
  if (canAutoInclude) {
    return {
      kind: 'addition',
      analysisSource: 'llm',
      llmProvider,
      reason: '',
      ...(replacesMessageId ? { replacesMessageId } : {}),
      items: enrichedItems,
      unparsed: [],
      retained: [],
      excludedItems,
      ignoredTotals,
      memos,
      noise: [],
    };
  }

  const fallbackReason = clean(raw.reviewReason || live.find(it => it.reviewReason)?.reviewReason || '발주 내용 확인 필요');
  return {
    kind: 'review',
    analysisSource: 'llm',
    llmProvider,
    reason: fallbackReason,
    ...(replacesMessageId ? { replacesMessageId } : {}),
    items: enrichedItems.map(it => it.cancelled ? it : { ...it, reviewReason: fallbackReason }),
    unparsed: [],
    retained: [],
    excludedItems,
    ignoredTotals,
    memos,
    noise: [],
  };
}

export function analyzeImportMessage(message, aliases=new Map(), options={}) {
  const llmParsed = normalizeLlmOrderParsed(message, aliases, options);
  if (llmParsed) return llmParsed;
  const knownFarms = options.knownFarms || [];
  const text=String(message.text||'').normalize('NFKC');
  const noise=[];
  const rawLines=[];
  for (const raw of text.split(/\r?\n/)) {
    const line = stripKakaoLineEnvelope(raw);
    if (line.text) rawLines.push(line.text); else if (line.noise) noise.push(line.noise);
  }
  const independentNote=trailingRecommendation(rawLines);
  const kept=rawLines.filter((_,index)=>index!==independentNote);
  const body=kept.join('\n');
  const lines=kept.map(line=>/^[[<【~■▶▷◆●▣]/.test(line)?line:stripBullet(line)).filter(Boolean);
  const explicit=/발주|주문|추가/.test(body);
  const issue=information.test(body);
  let unresolvedChange=false;
  let context={country:options.defaultCountry||'',group:'',week:options.defaultWeek||'',customer:'',farm:''};
  let items=[];
  const unparsed=[], retained=[], ignoredTotals=[], memos=[], nameCancels=[];
  const scopeFields = () => ({country:context.country||(colombiaGroups.has(context.group)?'콜롬비아':''),group:context.group,week:context.week||week(body),year:clean(message.time).match(/^\d{4}/)?.[0]||String(options.defaultYear||''),farm:context.farm});
  for(let index=0;index<lines.length;index++) {
    const line=lines[index], next=lines[index+1]||'';
    if (isSummaryTotalLine(line)) { ignoredTotals.push({...scopeFields(),text:line}); continue; }
    const keep=line.match(/^기존(?:대로|처럼)\s+(.+?)\s*(\d+(?:,\d{3})*)\s*(박스|단|송이|스팀|스템|봉|개)(?:만)?\s*(?:받겠습니다|유지합니다|유지해주세요)[.!]?$/);
    if(keep){retained.push({product:clean(keep[1]),quantity:number(keep[2]),unit:unit(keep[3])});continue;}
    // Header establishes context only inside this message (never across unrelated chats).
    if (/발주|주문|추가|변경사항/.test(line) && !parseLine(line,knownFarms) && (week(line)||country(line)||category(line))) {
      if(change.test(line))unresolvedChange=true;
      context.country=country(line)||context.country;
      context.group=category(line)||context.group;
      context.week=week(line)||context.week;
      const code=line.match(codePattern)?.[0]; if(code)context.customer=customerName(code,aliases);
      const named=line.replace(/\d{1,2}(?:-\d{1,2})?차?/g,'').replace(countries,'').replace(flowers,'').replace(/선?발주|주문|추가|변경사항|요청/g,'').trim();
      if(!code && named && isKnownFarmToken(named,knownFarms))context.farm=normalizeFarmName(named,knownFarms);
      else if(!code && /^[가-힣A-Za-z]{2,12}(?:\s*호텔)?$/.test(named) && !/고정|긴급|확인|수정|취소|완료|선발주/.test(named))context.customer=customerName(named,aliases);
      if(/\d\s*(박스|단|스팀|스템|송이|봉)/.test(line))unparsed.push(line);
      continue;
    }
    const header=extractFarmHeader(line,knownFarms);
    if (header) {
      if (header.farm) context.farm=header.farm;
      if (header.country && header.country!==context.country && !header.group) context.group='';
      context.country=header.country||context.country;
      context.group=header.group||context.group;
      context.week=header.week||context.week;
      continue;
    }
    if (/^(?:ETA|\d{1,2}월|메시지가 삭제|\(?총\s*\d|#.*합계)/i.test(line)) { if(change.test(line))unresolvedChange=true; continue; }
    const companyCode = line.match(companyCodeHeading);
    if (companyCode && !category(companyCode[1]) && !information.test(line) && !change.test(line) && !addIntent.test(line)) {
      const name = companyCode[1].trim(), code = companyCode[2].toUpperCase() + companyCode[3];
      context.customer = aliases.get(fold(line)) || aliases.get(fold(code)) || aliases.get(fold(name)) || `${name} ${code}`;
      continue;
    }
    if (!parseLine(line,knownFarms) && (country(line)||category(line)) && !information.test(line) && !addIntent.test(line) && line.length<25) {
      const rest=line.replace(countries,'').replace(flowers,'').replace(/\d{1,2}-\d{1,2}차?/,'').trim();
      if(!rest){context.country=country(line)||context.country;context.group=category(line)||context.group;context.week=week(line)||context.week;continue;}
    }
    // Quantity-free item cancellation ("블루는 패스", "에린지움 취소입니다") is resolved only when the
    // same message still contains confirmed items; otherwise it remains a message-level review.
    const nameCancel=line.match(NAME_ONLY_CANCEL);
    if (nameCancel && !parseLine(line,knownFarms) && !/^(?:위|전체|전부|오늘|추가|발주|주문)/.test(nameCancel[1])) {
      nameCancels.push({...scopeFields(),product:clean(nameCancel[1]).replace(/\s*[A-Z]*CL\d*\s*/i,' ').trim()||clean(nameCancel[1]),quantity:'',unit:'',reason:'품목 제외 지시',sourceLine:line});
      continue;
    }
    // Quantity-free business memo ("수요일 선적분", "색상 진한걸로 부탁") is kept as a note, never an item.
    if (!parseLine(line,knownFarms) && !/\d\s*(?:박스|상자|단|속|송이|본|스팀|스템|봉|FB|HB|QB|EB|B\b|st\b)/i.test(line) && !codePattern.test(line) && !aliases.has(fold(line)) && MEMO_HINT.test(line) && !information.test(line) && !change.test(line)) {
      memos.push({...scopeFields(),text:line});
      continue;
    }
    // Company heading: CL, confirmed alias, hotel/name heading immediately before an item.
    if (!parseLine(line,knownFarms) && (codePattern.test(line) && line.length<40 || aliases.has(fold(line)) || (parseLine(next,knownFarms) && line.length<=24 && !/[.?!,]/.test(line) && !information.test(line) && !change.test(line) && !addIntent.test(line) && !/차|사진|전산|농장/.test(line)))) {
      const label=line.replace(/\s*건\s*$/, '');
      context.customer=customerName(/에\s*추가|해주세요|해주세용/.test(label)?label.match(codePattern)?.[0]||label:label,aliases);
      if(items.length && (body.match(/\b[A-Z]*CL[A-Z0-9_-]*\b/gi)||[]).length===1 && items.every(i=>!i.customer))items=items.map(i=>({...i,customer:context.customer}));
      continue;
    }
    let value=line, customer=context.customer, farm=context.farm;
    const prefix=line.match(/^([^:：[\]<]{1,30})\s*[:：]\s*(.+)$/) || line.match(/^([A-Za-z가-힣][A-Za-z가-힣0-9 ()]{0,18}?)\s+[-–]\s+(.+)$/);
    if(prefix && parseLine(prefix[2],knownFarms)) {
      const label=clean(prefix[1]);
      const isColon = /^[^:：[\]<]{1,30}\s*[:：]/.test(line);
      if (isKnownFarmToken(label,knownFarms) || /(?:농장|farm)$/i.test(label)) {
        farm=normalizeFarmName(label,knownFarms)||farm;
        value=prefix[2];
      } else if (isColon || codePattern.test(label) || aliases.has(fold(label)) || (!category(label) && !/\b\d+\s*cm$/i.test(label) && /^[가-힣]{2,10}$/.test(label))) {
        customer=customerName(label,aliases);
        value=prefix[2];
      }
    }
    const parsed=parseLine(value,knownFarms);
    if(parsed) {
      if (!parsed.cancelled && !parsed.revisionNote && change.test(parsed.note)) unresolvedChange=true;
      let rawProduct=parsed.product.replace(/^\d{1,2}(?:-\d{1,2})?차?\s+/,'').trim(), group=category(rawProduct)||context.group;
      const resolvedFarm=parsed.farm||farm||'';
      const explicitCountry=parsed.inlineCountry||country(rawProduct)||context.country;
      const source=message.items?.find(item=>fold(item.rawProduct)===fold(rawProduct));
      if (source?.correctedProduct) rawProduct=source.correctedProduct;
      group=category(rawProduct)||group||category(source?.group||'');
      // Remove only the explicit category prefix; retain cultivar, colour, grade and size.
      let product=rawProduct.replace(new RegExp('^'+(group||'(?!)')+'\\s*[/ ]\\s*','i'),'').trim();
      if(!product||/^\d+(?:[~-]\d+)?\s*cm$/i.test(product))product=rawProduct;
      // Verified literal spelling variant, scoped by category in aggregation.
      if (/^(문라이트|moon\s*light)$/i.test(product))product='Moon Light';
      group ||= verifiedGroupAliases.get(explicitCountry)?.get(fold(product)) || '';
      const inferredCountry=!explicitCountry&&resolvedFarm?inferCountryFromFarm(resolvedFarm,knownFarms):'';
      const itemCountry=explicitCountry||inferredCountry||(colombiaGroups.has(group)?'콜롬비아':'');
      const itemWeek=context.week||week(body)||options.defaultWeek||'';
      const spec=extractProductSpec(product);
      items.push({...parsed,key:JSON.stringify([message.id,index]),sourceLine:line,product,baseName:spec.baseName,spec:spec.spec,group,country:itemCountry,
        farm:resolvedFarm,countryInferred:!!itemCountry&&!explicitCountry,week:itemWeek,year:clean(message.time).match(/^\d{4}/)?.[0]||String(options.defaultYear||''),customer:customer||source?.correctedCustomer||source?.customer||'',
        reviewReason:parsed.cancelled?(parsed.cancelReason||'취소·제외'):!parsed.unit?'단위 확인 필요':!itemWeek?'차수 확인 필요':''});
    } else if (/\d\s*(?:박스|상자|단|속|스팀|스템|송이|본|FB|HB|QB|EB|st\b)|[:：]\s*\d/i.test(line) && !information.test(line) && !/^\*/.test(line)) {
      unparsed.push(line);
    } else if (change.test(line)) {
      unresolvedChange=true;
    }
  }
  const active=items.filter(item=>!item.cancelled);
  if (nameCancels.length) {
    if (active.some(item=>validItem(item))) items=items.filter(item=>!nameCancels.some(c=>fold(item.product)===fold(c.product)));
    else unresolvedChange=true;
  }
  const excludedItems=[...items.filter(item=>item.cancelled).map(item=>({product:item.product,quantity:item.quantity,unit:item.unit,farm:item.farm,country:item.country,group:item.group,week:item.week,year:item.year,reason:item.reviewReason,sourceLine:item.sourceLine,key:item.key})),
    ...(active.some(item=>validItem(item))?nameCancels:[])];
  if (memos.length) items=items.map(item=>({...item,memos:memos.filter(m=>!m.farm||!item.farm||m.farm===item.farm).map(m=>m.text)}));
  const onlyCancelled=items.length>0&&items.every(item=>item.cancelled);
  const altered=unresolvedChange||onlyCancelled;
  // A standalone item list is a candidate, but conversations about quantities are not orders.
  const relevant=explicit && (items.length>0||altered||unparsed.length>0||/추가(?:에요|입니다)|발주\s*(?:추가|해주세요|부탁|진행)/.test(body)&&!issue) || items.length>0 && !issue || unparsed.length>0&&addIntent.test(body)&&!issue || altered && /취소|대체|넘겨|이월|제외|패스/.test(body);
  const extra={excludedItems,ignoredTotals,memos,noise,analysisSource:'regex'};
  if(!relevant)return {kind:'excluded',items:[],...extra};
  let reason=altered?'취소·대체·변경·차수 이동 확인':issue?'문의·조건부 요청 확인':unparsed.length?'해석하지 못한 수량 행 확인':!items.length?'연결할 품목·수량 확인':'';
  // Missing heading/intent on a naked list requires confirmation instead of manufacturing intent,
  // unless the caller explicitly pasted an order list (farm-transfer paste mode).
  if(!explicit && !addIntent.test(body) && !reason && !options.pastedOrder)reason='발주 의도 확인';
  // An explicit addition can include a separate item whose unit is missing or an item-level
  // cancellation. Keep those rows unchecked without withholding the fully specified items.
  const live=items.filter(item=>!item.cancelled);
  const partialAddition = !reason
    && live.some(item=>!item.reviewReason&&validItem(item))
    && live.every(item=>!item.reviewReason||item.reviewReason==='단위 확인 필요')
    && (live.every(item=>!item.reviewReason) || /발주\s*추가|추가\s*발주/.test(lines[0]||'') || options.pastedOrder);
  if (partialAddition) return { kind: 'addition', reason: '', items, unparsed, retained, ...extra };
  reason=reason||live.find(i=>i.reviewReason)?.reviewReason||'';
  if(reason)items=items.map(item=>item.cancelled?item:{...item,reviewReason:reason});
  return {kind:reason?'review':'addition',reason,items,unparsed,retained,...extra};
}

const sameLine = (item, other) => item.year===other.year && item.week && item.week===other.week && fold(item.product)===fold(other.product) && item.unit===other.unit
  && (!other.country||!item.country||item.country===other.country||other.countryInferred||item.countryInferred)
  && (!other.group||!item.group||item.group===other.group)
  && (!other.customer||!item.customer||fold(item.customer)===fold(other.customer));

export function classifyImportFeed(feed, aliases=new Map(), {audit=false, ...options}={}) {
  const selected=[], review=[], identities=new Map(), omitted=[], cleaned=[];
  let duplicates=0, excluded=0, llmParsed=0, llmPending=0;
  const providers = new Set();
  // Prefer deleted variants as a review warning; do not count their non-deleted snapshot again.
  const ordered=[...feed.messages].sort((a,b)=>Number(/삭제되었습니다/.test(b.text))-Number(/삭제되었습니다/.test(a.text)));
  for(const message of ordered) {
    const key=JSON.stringify([message.time,message.sender||'',fold(message.text.replace(/메시지가 삭제되었습니다\./g,'')).replace(/\s/g,'')]);
    if(identities.has(key)){
      duplicates++;
      const dupSource = message?.order_parsed && typeof message.order_parsed === 'object' ? 'llm' : 'regex';
      const dupBase={id:message.id,time:message.time,text:message.text,reason:'동일 작성자·시각·원문 중복',duplicateOf:identities.get(key)};
      cleaned.push({...dupBase,analysisSource:dupSource,hintCountry:country(message.text),hintWeek:week(message.text)});
      if(audit)omitted.push(dupBase);
      continue;
    }
    identities.set(key,message.id);
    const result=analyzeImportMessage(message,aliases,options);
    if (result.analysisSource === 'llm') {
      llmParsed++;
      if (result.llmProvider) providers.add(result.llmProvider);
    } else {
      llmPending++;
    }
    if(result.kind==='excluded'){
      excluded++;
      const cleanReason = result.analysisSource === 'llm' && result.cleanReason
        ? result.cleanReason
        : (information.test(message.text)?'문의·가격·품질 등 발주 외 대화':'품목·수량 또는 발주 의도 불명');
      const cleanBase={id:message.id,time:message.time,text:message.text,reason:cleanReason,quantityCandidate:/\d\s*(박스|상자|단|속|송이|본|스팀|스템|st\b|box|FB|HB|QB)/i.test(message.text)};
      cleaned.push({
        ...cleanBase,
        analysisSource: result.analysisSource || 'regex',
        ...(result.llmProvider ? { llmProvider: result.llmProvider } : {}),
        hintCountry: result.hintCountry || country(message.text),
        hintWeek: result.hintWeek || week(message.text),
      });
      if(audit)omitted.push(cleanBase);
      continue;
    }
    const {sender, order_parsed: _rawOrderParsed, ...publicMessage}=message;
    const parsed={...publicMessage,...result};
    (result.kind==='addition'?selected:review).push(parsed);
  }
  // Explicit LLM message replacement (`replacesMessageId`), cancellations in review messages,
  // and item-level cancellations withhold or supersede the matching earlier addition.
  const replacedBy = new Map();
  for (const m of [...selected, ...review]) {
    if (m.replacesMessageId && m.replacesMessageId !== m.id && messageOrderIndex(feed, m.id) < messageOrderIndex(feed, m.replacesMessageId)) {
      replacedBy.set(m.replacesMessageId, m.id);
    }
  }
  const changed=[...review.filter(m=>change.test(m.text)||m.excludedItems?.length).flatMap(m=>[...m.items,...(m.excludedItems||[])].map(item=>({...item,changeId:m.id}))),
    ...[...selected,...review].flatMap(m=>m.items.filter(item=>item.cancelled&&!item.revisionNote).map(item=>({...item,changeId:m.id})))];
  const revisions=selected.flatMap(m=>m.items.filter(item=>item.revisionNote&&!item.cancelled).map(item=>({...item,changeId:m.id})));
  for(let index=selected.length-1;index>=0;index--) {
    const m=selected[index];
    if (replacedBy.has(m.id)) {
      const newerId = replacedBy.get(m.id);
      selected.splice(index, 1);
      const reason = '이후 수정 발주 원문으로 대체';
      review.push({ ...m, kind: 'review', reason, supersededBy: newerId, relatedChanges: [newerId], items: m.items.map(item => item.cancelled ? item : ({ ...item, reviewReason: reason, supersededBy: newerId })) });
      continue;
    }
    const affected=changed.filter(other=>other.changeId!==m.id&&m.items.some(item=>!item.cancelled&&sameLine(item,other)));
    if(affected.length){selected.splice(index,1);const reason='같은 차수·품목의 취소/변경 요청 대조 필요';review.push({...m,kind:'review',reason,relatedChanges:[...new Set(affected.map(r=>r.changeId))].sort(),items:m.items.map(item=>item.cancelled?item:({...item,reviewReason:reason}))});continue;}
    const superseded=revisions.filter(other=>other.changeId!==m.id&&messageOrderIndex(feed,other.changeId)<messageOrderIndex(feed,m.id));
    if(superseded.length){
      selected[index]={...m,items:m.items.map(item=>{
        const later=superseded.find(other=>!item.cancelled&&!item.revisionNote&&sameLine(item,other));
        return later?{...item,reviewReason:`이후 ${later.revisionNote} 요청으로 대체`,supersededBy:later.changeId}:item;
      })};
    }
  }
  const order=new Map(feed.messages.map((m,i)=>[m.id,i]));
  selected.sort((a,b)=>order.get(a.id)-order.get(b.id));
  review.sort((a,b)=>order.get(a.id)-order.get(b.id));
  cleaned.sort((a,b)=>order.get(a.id)-order.get(b.id));
  // A new review reason/related cancellation invalidates previous browser inclusion.
  // Identical refreshes keep keys stable so deliberate review edits remain intact.
  const reviewRows=review.map(m=>({...m,items:m.items.map(item=>({...item,key:JSON.stringify([item.key,m.reason,m.relatedChanges||[]])}))}));
  return {
    ...feed,
    messages:selected,
    review:reviewRows,
    cleaned,
    ...(audit?{audit:omitted.sort((a,b)=>order.get(a.id)-order.get(b.id))}:{}),
    stats:{scanned:feed.messages.length,selected:selected.length,review:review.length,excluded,duplicates},
    llmStats:{parsed:llmParsed,pending:llmPending,providers:[...providers]},
  };
}
// Feed messages are newest first: a smaller index is a later message.
function messageOrderIndex(feed, id) { const index=feed.messages.findIndex(m=>m.id===id); return index<0?Infinity:index; }

/**
 * Splits a raw KakaoTalk PC/mobile chat export into messages and classifies them for farm transfer.
 * Browser-only: nothing is stored, sent or written to ERP.
 */
export function parsePastedKakaoChat(rawText, {year=String(new Date().getFullYear()), week:defaultWeek='', country:defaultCountry='', knownFarms=[], aliases=new Map()}={}) {
  const messages=[]; let current=null, day='', noise=0;
  const flush=()=>{ if(current?.lines.length) messages.push({id:'paste:'+(messages.length+1),time:`${day||year+'년 1월 1일'} ${current.time}`,sender:current.sender,text:current.lines.join('\n'),items:[]}); current=null; };
  for (const raw of String(rawText??'').normalize('NFKC').split(/\r?\n/)) {
    const line=clean(raw);
    if(!line)continue;
    const date=line.match(/(\d{4})\s*(?:년|[./-])\s*(\d{1,2})\s*(?:월|[./-])\s*(\d{1,2})/);
    if (DATE_DIVIDER.test(line)) { flush(); if(date)day=`${date[1]}년 ${Number(date[2])}월 ${Number(date[3])}일`; noise++; continue; }
    const pc=line.match(PC_KAKAO_LINE), mobile=!pc&&line.match(MOBILE_KAKAO_LINE);
    if (pc||mobile) {
      if (mobile&&date) day=`${date[1]}년 ${Number(date[2])}월 ${Number(date[3])}일`;
      const sender=clean(pc?pc[1]:mobile[2]), time=clean((pc?pc[2]:mobile[1]).match(/(?:오전|오후|AM|PM)?\s*\d{1,2}:\d{2}/i)?.[0]||'오전 9:00');
      const body=stripKakaoLineEnvelope(pc?pc[3]:mobile[3]);
      if(!current||current.sender!==sender||current.time!==time){flush();current={sender,time,lines:[]};}
      if(body.text)current.lines.push(body.text);else noise++;
      continue;
    }
    const body=stripKakaoLineEnvelope(line);
    if(!body.text){noise++;continue;}
    current ||= {sender:'붙여넣기',time:'오전 9:00',lines:[]};
    current.lines.push(body.text);
  }
  flush();
  // One chat often spreads a farm header and its lines across several bubbles: carry the
  // last explicit farm/country/week forward within this pasted block only.
  let carry={country:defaultCountry,week:defaultWeek,farm:''};
  const enriched=messages.map(message=>{
    const lines=message.text.split('\n');
    const prefix=[];
    const own=lines.map(line=>extractFarmHeader(line,knownFarms)).find(Boolean);
    if(!own?.farm&&carry.farm)prefix.push(`■ ${carry.farm}`);
    const ownWeek=week(message.text), ownCountry=country(message.text);
    if(!/발주|주문|추가/.test(message.text)||(!ownWeek&&carry.week)||(!ownCountry&&carry.country))
      prefix.push([ownWeek||carry.week?`${ownWeek||carry.week}차`:'',ownCountry?'':carry.country,'발주 추가'].filter(Boolean).join(' '));
    for(const line of lines){const h=extractFarmHeader(line,knownFarms);if(h?.farm)carry.farm=h.farm;if(h?.country||country(line))carry.country=h?.country||country(line);if(week(line))carry.week=week(line);}
    return {...message,original:message.text,text:prefix.length?prefix.join('\n')+'\n'+message.text:message.text};
  });
  const feed=classifyImportFeed({messages:enriched},aliases,{audit:true,knownFarms,defaultYear:year,pastedOrder:true});
  const restore=list=>list.map(({original,...m})=>({...m,text:enriched.find(e=>e.id===m.id)?.original??m.text}));
  return {...feed,messages:restore(feed.messages),review:restore(feed.review),cleaned:restore(feed.cleaned||[]),audit:restore(feed.audit||[]),noise};
}

// Calendar days without orders must not hide the last actual order work.
// Classify before selecting dates so subsequent cancellation/revision evidence is retained.
export function readLatestOrderImports(values, now=new Date(), options={}) {
  const through=todaySeoul(now), aliases=importCustomerAliases(values);
  const messages=readImportDay(values,through,'0000-01-01');
  return latestImportFeed(messages, through, aliases, options);
}

export function latestImportFeed(messages, through, aliases, options={}) {
  const {maxOrderDays=2, windowFrom='', ...classifyOptions}=options;
  const all=classifyImportFeed({messages},aliases,classifyOptions);
  const orders=[...all.messages,...all.review.filter(m=>m.relatedChanges?.length)];
  const orderDays=[...new Set(orders.filter(m=>m.items.some(validItem)).map(m=>messageDay(m.time)))].sort().reverse().slice(0,maxOrderDays);
  let from=orderDays.at(-1)||through;
  if(windowFrom && (!orderDays.length || windowFrom < from)) from=windowFrom;
  const scoped=classifyImportFeed({messages:messages.filter(m=>messageDay(m.time)>=from)},aliases,classifyOptions);
  return {...scoped,orderDays,windowFrom:from,from:windowFrom?from:(orderDays.at(-1)||''),to:orderDays[0]||'',reviewThrough:through,latest:messages[0]?.time||''};
}
