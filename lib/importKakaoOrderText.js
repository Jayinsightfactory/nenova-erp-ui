// Pure, read-only interpretation of collected or pasted import-room Kakao text. Never an ERP order writer.
import {
  messageDay,
  messageOrder,
  readImportDay,
  todaySeoul,
  validItem,
  normalizeFarmName,
  inferCountryFromFarm,
  isKnownFarmToken,
  normalizeOrderUnit,
  extractProductSpec,
  resolveMinusKind,
} from './importKakaoAdditions.js';
import { canonicalImportCountry } from './importToolsDisplay.js';
import {
  inferCountryAndGroupFromDb,
  isKnownCatalogProductLine,
  matchDbEnglishProductName,
  matchDbFarm,
} from './importKakaoDbCatalog.js';

const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const fold = value => clean(value).toLowerCase();

const flowers = /수국|카네이션|알스트로메리아|알스트로|루스커스|튤립|히야신스|히아신스|아스틸베|장미|카라(?![멜반얀])|거베라|국화|안개|안시리움|스키미아|유칼립투스|작약|다알리아|달리아|호접|덴파레|모카라|아란|스타티스|라넌큘러스|줄맨드라미|네리네|아이리스|클레마티스|수선화|스위트피|스윗피|오니소갈룸|오니소칼륨|아스트란시아|아스트란티아|디디스커스|스카비오사|마트리카리아|마가렛|아가판서스|레우코취|헬레보루스|프로테아|핀쿠션/;
const colombiaGroups = new Set(['수국', '알스트로', '카네이션', '루스커스', '장미']);
const countries = /콜롬비아|네덜란드|화란|에콰도르|에콰|중국|태국|베트남|호주|미국|뉴질랜드|뉴질|일본|이스라엘|에티오피아|케냐|(?:^|\s)콜(?=\s|수국|장미|카네이션)/;
const englishFlowers = [[/hydrangea/i,'수국'],[/carnation/i,'카네이션'],[/\balstro(?:e?meria)?\b/i,'알스트로'],[/ruscus/i,'루스커스'],[/astilbe/i,'아스틸베'],[/tulip/i,'튤립'],[/hyacinth/i,'히야신스'],[/anthurium/i,'안시리움'],[/gypsophil/i,'안개'],[/skimmia/i,'스키미아'],[/\brose\b|roses/i,'장미'],[/clematis/i,'클레마티스'],[/daffodil|narcissus/i,'수선화'],[/nerine/i,'네리네'],[/\biris\b/i,'아이리스'],[/peony|paeonia/i,'작약'],[/sweet\s*pea/i,'스위트피'],[/ornithogalum|onisogalum/i,'오니소갈룸'],[/astrantia/i,'아스트란시아'],[/didiscus/i,'디디스커스'],[/scabiosa/i,'스카비오사'],[/matricaria/i,'마트리카리아'],[/agapanthus/i,'아가판서스'],[/leucothoe/i,'레우코취'],[/helleborus/i,'헬레보루스'],[/protea/i,'프로테아']];
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

export function hasExplicitAdditionIntent(rawText) {
  const s = clean(rawText);
  if (!s) return false;
  return /(?:추가\s*발주|발주\s*추가|추가\s*주문|주문\s*추가|추가\s*요청|추가\s*부탁|추가\s*가능|추가\s*넣어|추가\s*해\s*주|추가\s*진행|더\s*넣어|추가분|추가로\s*\d|추가로\s+[^\n]{1,20}부탁)/i.test(s);
}

function hasExplicitCancelRequest(rawText) {
  const s = clean(rawText)
    .replace(/취소가?\s*불가(?:능)?(?:합니다|해요)?/g, '')
    .replace(/변경\s*(?:없음|없습니다|사항\s*없)/g, '')
    .replace(/대체\s*안\s*함/g, '');
  if (!s) return false;
  return /(?:취소|빼\s*주|제외|대체|정정|감량|캔슬|\bcancel(?:led|ed)?\b|중복입니다|--+>|->|→)/i.test(s);
}

const CONFIRM_POSITIVE_WORD_RE =
  /(?:컨펌|컨펌입[니이]다|confirm(?:ed|ation)?|확정표|확정\s*(?:내역|수량|리스트)|오더\s*확정|발주\s*확정|농장\s*확정|최종\s*확정|출하\s*확정|선적\s*확정)/i;

const CONFIRM_NEGATIVE_OR_ASK_RE =
  /(?:미\s*컨펌|노\s*컨펌|컨펌\s*불가|컨펌\s*(?:부탁|요청|여부|가능|전|안\s*된|안\s*해|할까요|될\s*수))/i;

const MINUS_LINE_MARKER_RE =
  /(?:미\s*컨펌|노\s*컨펌|컨펌\s*불가|쇼트|소트|\bshort(?:age)?\b|결품|품절|없음|없습니다|없답니다|모자랍?니다|모자름|출하\s*불가|선적\s*불가|수출\s*불가|공급\s*불가|발주\s*불가|생산\s*불가|못\s*보내|못보냄|못\s*실었|수출\s*허가|농장.*취소|감량|취소|빼\s*주|제외|캔슬|\bcancel(?:led|ed)?\b|삭제\s*(?:해|요청|부탁|합니다))/i;

export function isConfirmationHeaderLine(rawLine) {
  const line = clean(rawLine).replace(/^[*★•·▪\-[\]<>()【】\s]+|[*★•·▪\-[\]<>()【】\s]+$/g, '');
  if (!line || hasExplicitAdditionIntent(line) || CONFIRM_NEGATIVE_OR_ASK_RE.test(line)) return false;
  if (/\d\s*(?:박스|상자|단|속|스팀|스템|송이|본|봉|box|stems?|st\b|FB|HB|QB|EB)\b/i.test(line)) return false;
  return CONFIRM_POSITIVE_WORD_RE.test(line);
}

function isConfirmedItemLine(rawLine) {
  const line = clean(rawLine);
  if (!line || CONFIRM_NEGATIVE_OR_ASK_RE.test(line) || MINUS_LINE_MARKER_RE.test(line) || hasExplicitAdditionIntent(line)) return false;
  return /(?:컨펌(?:\s*(?:입니다|입이다|됐습니다|되었습니다|완료))?|\bconfirmed\b|출하\s*확정|선적\s*확정)(?:\s*[@(].*|\s*[.!~]*)?$/i.test(line);
}

export function isConfirmationNotice(rawText) {
  const s = clean(rawText);
  if (!s || hasExplicitAdditionIntent(s) || hasExplicitCancelRequest(s)) return false;
  if (/미\s*컨펌|노\s*컨펌|컨펌\s*불가/i.test(s)) return false;
  if (/샘플.*사진.*확인\s*후|어려우시면.*넘기/i.test(s)) return false;
  if (/(?:쇼트|소트|\bshort(?:age)?\b|결품|품절|출하\s*불가|선적\s*불가|못\s*보내|못보냄)/i.test(s)) return false;
  return CONFIRM_POSITIVE_WORD_RE.test(s);
}

function isConfirmationContextWithMixedMinus(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map(l => stripKakaoLineEnvelope(l).text)
    .filter(Boolean);
  if (!lines.length) return false;
  return isConfirmationHeaderLine(lines[0]);
}

function isPureLogisticsDelayNotice(rawText) {
  const s = clean(rawText);
  if (!s || hasExplicitAdditionIntent(s) || hasExplicitCancelRequest(s)) return false;
  if (/(?:이슈|소트|쇼트|\bshort(?:age)?\b|미\s*컨펌|노\s*컨펌|결품|품절|없음|없습니다|출하\s*불가|못\s*보내|못보냄)/i.test(s)) return false;
  return /(?:선적\s*지연|항공\s*지연|입고\s*지연)/i.test(s);
}

export function isLocalIssueNotice(rawText) {
  const s = clean(rawText);
  if (!s || hasExplicitAdditionIntent(s) || hasExplicitCancelRequest(s)) return false;
  return /(?:현지\s*이슈|현지\s*문제|이슈\s*\(|이슈\s*안내|이슈\s*공유|이슈\s*사항|(?:^|[^가-힣A-Za-z0-9])이슈(?=$|[^가-힣A-Za-z0-9]|입니다|예요|에요|네요|사항|안내|공유|발생|있|건|로|가|는|은)|소트|쇼트|\bshort(?:age)?\b|미\s*컨펌|노\s*컨펌|결품|품절|출하\s*불가|선적\s*불가|수출\s*불가|못\s*보내|못보냄|선적\s*지연|항공\s*지연|입고\s*지연)/i.test(s);
}

function isIssueDeductionContext(rawText) {
  const raw = String(rawText || '').normalize('NFKC');
  const s = clean(raw);
  if (!s || hasExplicitAdditionIntent(s) || isPureLogisticsDelayNotice(s)) return false;
  if (/(?:이번에\s*온|입고\s*된.*불량|패킹\s*불량|포장\s*불량|이슈\s*있을까요|이슈\s*사항\s*없는지|이슈는\s*따로\s*없|이슈가\s*발생하는\s*이유|개선\s*요청사항)/i.test(s)) {
    return false;
  }
  const firstLine = clean(raw.split(/\r?\n/).map(l => stripKakaoLineEnvelope(l).text).find(Boolean) || '');
  if (/^(?:[*★•·▪\-[\]<>()\s]*)(?:(?:\d{1,2}(?:\s*-\s*\d{1,2})?\s*차?\s*)?[가-힣A-Za-z0-9 ()/_.-]{0,24}?(?:현지\s*이슈|이슈|소트|쇼트|미\s*컨펌|노\s*컨펌|결품))/i.test(firstLine)) {
    return true;
  }
  return /(?:현지\s*이슈|이슈\s*\(|소트|쇼트|\bshort(?:age)?\b|미\s*컨펌|노\s*컨펌|결품|출하\s*불가|선적\s*불가|수출\s*불가|수출\s*허가.*못\s*보내|못\s*실었)/i.test(s);
}

function isQuestionHoldingConfirmation(rawText) {
  const s = clean(rawText);
  if (!s) return false;
  return /(?:취소|대체|변경|추가|진행|보내\s*도|컨펌)\s*(?:할까요|하실지|될까요|괜찮을까요|괜찮나요)\s*\??/i.test(s);
}
// Original message-level change vocabulary. A line containing these words that is NOT resolved
// as an item-level cancellation/revision keeps the whole message in review (no silent subtraction).
const change = /취소|대체|정정|변경|반품|넘겨|넘긴|이월|미컨펌|미확보|발주\s*확인|원본이\s*다른|삭제되었습니다|안\s*해주셔도|수정했습니다|취소되어야|줄인다고|감량|증량|중복입니다|수정후\s*보내|빼\s*주세/;
const codePattern = /\b(?!(?:CLOUD|CLEMATIS|CLASSIC|CLEAR|CLASS)\b)[A-Z]{0,3}CL(?:[-_]?\d+[A-Z0-9_-]*|[A-Z]?)\b/i;
const companyCodeHeading = /^([가-힣A-Za-z][가-힣A-Za-z0-9 .()&]{0,23}?)\s+([A-Z]*CL)\s*-?\s*(\d{1,5})$/i;

const UNIT = 'FB|HB|QB|EB|full\\s*box(?:es)?|half\\s*box(?:es)?|quarter\\s*box(?:es)?|bx|boxes|box|박스|상자|B(?![A-Za-z0-9])|bunches|bunch|bdl|bd|단|속|스팀|스템|송이|본|대|stems|stem|st(?![A-Za-z0-9])|봉지|봉|개';
const NUM = '\\d+(?:,\\d{3})*(?:\\.\\d{1,3})?';
// Separator between product and quantity: ":" / " - " (dash with spaces) / whitespace. "-1" stays a negative number.
const SEP = '(?:\\s*[:：]\\s*|\\s+[-–]\\s+|\\s*)';
const TAIL = '((?:(?:(?:은|는|이|가|만|도)\\s+)?(?:취소|제외|빼\\s*주세요|빼\\s*주세용|패스|pass|캔슬|cancel(?:led|ed)?|삭제(?:해\\s*주세요|합니다|요청|부탁.*)?|쇼트|소트|short(?:age)?|미\\s*컨펌|노\\s*컨펌|결품|품절|없음|없습니다|없답니다|모자랍?니다|모자름|출하\\s*불가|선적\\s*불가|공급\\s*불가|발주\\s*불가|못\\s*보내.*|못보냄|감량)|추가|대체|정정|변경|발주|주문|부탁|보내|해주|해주세요|찾는\\s*중|\\(|（|\\[|<|【|[-–]\\s*총|$).*)';
const quantityLine = new RegExp(`^(.*?)${SEP}([+\\-]\\s*)?(${NUM})\\s*(${UNIT})?\\s*${TAIL}$`, 'i');
const arrowLine = new RegExp(`^(.*?)${SEP}(${NUM})\\s*(${UNIT})?\\s*(?:--+>|->|==>|=>|→|➡|에서)\\s*(${NUM}|취소|제외|패스)\\s*(${UNIT})?\\s*(?:으?로\\s*)?(?:변경|수정|정정|조정|교체)?(?:합니다|해\\s*주세요|부탁드립니다|요)?[.!]?\\s*(.*)$`, 'i');
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
const ITEM_CANCEL_TAIL = /(?:^|\s|[(\[/-])(?:(?:은|는|이|가|만|도)\s+)?(?:취소|제외|빼\s*주세요|빼\s*주세용|패스|pass|스킵|캔슬|cancel(?:led|ed)?|삭제\s*(?:해\s*주세요|해\s*주세용|합니다|요청|부탁드립니다|부탁합니다))(?:되어야\s*합니다|되어야\s*해요|부탁드립니다|부탁합니다|처리\s*바랍니다|요청드립니다|해\s*줬습니다|했습니다|입니다|합니다|해\s*주세요|해\s*주세용|요망|요)?[)\].!~]*$/i;
const ITEM_CANCEL_HEAD = /^(?:\[\s*(?:취소|제외|패스|캔슬)\s*\]|\(\s*(?:취소|제외|패스|캔슬)\s*\)|(?:취소|제외|캔슬)\s*[:：])\s*/i;
const ITEM_ISSUE_TAIL = /(?:^|\s|[(\[/-])(?:(?:은|는|이|가|만|도)\s+)?(?:쇼트|소트|\bshort(?:age)?\b|미\s*컨펌|노\s*컨펌|컨펌\s*불가|결품|품절|없음|없습니다|없답니다|모자랍?니다|모자름|출하\s*불가|선적\s*불가|수출\s*불가|공급\s*불가|발주\s*불가|못\s*보내[요며]?|못\s*보냅니다|못보냄|감량)(?:입니다|랍니다|예요|에요|네요|처리|건|요)?[)\].!~]*$/i;
const ITEM_ISSUE_HEAD = /^(?:\[\s*(?:현지\s*이슈|쇼트|소트|미\s*컨펌|결품)\s*\]|\(\s*(?:현지\s*이슈|쇼트|소트|미\s*컨펌|결품)\s*\)|(?:현지\s*이슈|쇼트|소트|미\s*컨펌|결품)\s*[:：])\s*/i;
const NAME_ONLY_CANCEL = /^([A-Za-z가-힣][A-Za-z가-힣0-9 /_-]{0,28}?)\s*(?:은|는|도)?\s*(?:취소|제외|패스|빼\s*주세요|빼\s*주세용|스킵|캔슬)(?:입니다|합니다|해\s*주세요|해\s*주세용|요)?[.!~]*$/i;
const NON_ORDER_LOGISTICS_LINE = /^(?:(?:M?AWB|HAWB|B\/L|운송장|송장\s*번호|인보이스|패킹\s*리스트|packing\s*list|invoice)\b.*|\d{3}[-\s]\d{4}\s*\d{4}\b.*|\d{3}[-\s]\d{8}\b.*|\d{2,3}\s*[*x×X]\s*\d{2,3}\s*[*x×X]\s*\d{2,3}(?:\s*(?:cm|mm))?\b.*)$/i;
const HARD_RECALL_CHANGE_RE = /(?:취소|빼\s*주|제외|대체|정정|수량\s*변경|차수\s*변경|으?로\s*변경|줄인다고|감량|증량|중복입니다|수정후\s*보내|미\s*컨펌|노\s*컨펌|쇼트|소트|\bshort(?:age)?\b|결품|품절|출하\s*불가|못\s*보내|못보냄|현지\s*이슈|보류|--+>|->|→)/i;

function normalizeMatchedCategory(raw) {
  const s = clean(raw);
  if (!s) return '';
  if (s === '알스트로메리아') return '알스트로';
  if (s === '히아신스') return '히야신스';
  if (s === '스윗피') return '스위트피';
  if (s === '오니소칼륨') return '오니소갈룸';
  if (s === '아스트란티아') return '아스트란시아';
  if (s === '마가렛') return '마트리카리아';
  if (s === '더글라스') return '상록수';
  if (s === '목화' || s === '왁스') return '기타';
  if (/^(?:딩고펀|코알라펀|엄브렐라펀|씨스타펀)$/.test(s)) return '펀';
  if (/^(?:울리부쉬|반커부쉬)$/.test(s)) return '부쉬';
  return s;
}
function category(text) { return normalizeMatchedCategory(text.match(flowers)?.[0]) || englishFlowers.find(([re])=>re.test(text))?.[1] || ''; }
function country(text) {
  const c = clean(text.match(countries)?.[0]);
  if (c === '콜') return '콜롬비아';
  if (c === '화란') return '네덜란드';
  if (c === '에콰') return '에콰도르';
  if (c === '뉴질') return '뉴질랜드';
  return c;
}
function week(text) {
  const sub = text.match(/(?:^|\s|\[)(\d{1,2})\s*-\s*(\d{1,2})(?:차|\s|\]|$)/);
  if (sub) return `${Number(sub[1])}-${String(Number(sub[2])).padStart(2, '0')}`;
  const singles = [...text.matchAll(/(?:^|\s|\[)(\d{1,2})차(?!(?:\s*(?:선적|출하|출고|입고|도착|분배|검품|결제)))/g)].map(m => m[1]);
  return singles.find(n => Number(n) >= 10) || singles[0] || '';
}
const unit = text => normalizeOrderUnit(text);
function stripBullet(text) { return clean(text).replace(/^\\?-+\s*/, '').replace(/^[*★•·▪\->]+\s*/, '').replace(/^\d+\s*[、.)]\s*/, ''); }
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
  let text = clean(product), farm = '', inlineCountry = '', inlineCustomer = '';
  for (;;) {
    const tag = text.match(/^(?:\[([^\]]{1,30})\]|<([^>]{1,30})>|【([^】]{1,30})】)\s*[:：-]?\s*(.+)$/);
    if (!tag) break;
    const label = clean(tag[1] || tag[2] || tag[3]);
    const rest = label.replace(countries, '').trim();
    if (country(label)) inlineCountry = country(label);
    if (rest && codePattern.test(rest) && !isKnownFarmToken(rest, knownFarms)) {
      inlineCustomer = clean(rest).toUpperCase();
    } else if (rest) {
      farm = normalizeFarmName(rest, knownFarms) || farm;
    }
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
  return { product: text, farm, inlineCountry, inlineCustomer };
}

/**
 * Parses one order line. Supports units FB/HB/QB/EB/B/박스/상자, 단/속/bunch/bd, 본/송이/st/stems,
 * multiplication (2박스 x 10단, 100본*5, 50cm * 3B), arrows (3B -> 5B, 3박스에서 5박스로 변경),
 * increments (+2B 추가) and item-level cancellation (취소/제외/빼주세요/패스/0박스/~취소선~).
 */
export function parseOrderItemLine(rawLine, knownFarms = []) {
  let text = clean(rawLine);
  if (!text || isSummaryTotalLine(text)) return null;
  let cancelled = false, cancelReason = '', minusKind = '', explicitMinus = false;
  const strike = text.match(/^~+\s*(.+?)\s*~+$/);
  if (strike) { text = clean(strike[1]); cancelled = true; cancelReason = '취소선'; minusKind = '취소'; }
  if (!/^[[<【]/.test(text)) text = stripBullet(text);
  if (ITEM_CANCEL_HEAD.test(text)) { text = clean(text.replace(ITEM_CANCEL_HEAD, '')); cancelled = true; cancelReason ||= '취소·제외 표시'; minusKind ||= '취소'; }
  if (ITEM_ISSUE_HEAD.test(text)) { text = clean(text.replace(ITEM_ISSUE_HEAD, '')); cancelled = true; cancelReason ||= '현지이슈'; minusKind = '현지이슈'; }
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
    const prevNum = Number(previousQuantity);
    const targetNum = Number(number(target));
    if (/^(?:취소|제외|패스)$/.test(target) || targetNum === 0) {
      const hasValidPrev = Number.isFinite(prevNum) && prevNum > 0;
      quantity = hasValidPrev ? String(prevNum) : '0';
      cancelled = true;
      minusKind = /(?:감량|소트|쇼트|이슈|미\s*컨펌|결품|품절)/i.test(`${text} ${tail}`) ? '현지이슈' : '취소';
      cancelReason = `${previousQuantity}→${targetNum === 0 ? '0' : '취소'}${minusKind === '현지이슈' ? ' (현지이슈)' : ''}`;
    } else if (Number.isFinite(prevNum) && Number.isFinite(targetNum) && targetNum < prevNum && /(?:감량|소트|쇼트|미\s*컨펌|결품)/i.test(`${text} ${tail}`)) {
      const delta = Math.round((prevNum - targetNum) * 1000) / 1000;
      quantity = String(delta);
      cancelled = true;
      minusKind = '현지이슈';
      cancelReason = `${previousQuantity}→${number(target)} 감량`;
      revisionNote = `${previousQuantity}→${number(target)} 감량 (-${delta})`;
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
    if (m && accept(m[1])) {
      const signStr = clean(m[2] || '');
      product = accept(m[1]);
      increment = signStr.startsWith('+');
      explicitMinus = signStr.startsWith('-');
      quantity = number(m[3]);
      parsedUnit = unit(m[4] || '');
      tail = clean(m[5]);
      if (explicitMinus) {
        cancelled = true;
        cancelReason ||= '차감 수량';
      }
    } else {
      const signedWithNote = text.match(new RegExp(`^([A-Za-z가-힣][A-Za-z가-힣0-9 /_.-]{1,28}?)\\s+(-)\\s*(${NUM})\\s*(${UNIT})?\\s+(?![*x×X~]|cm\\b)(.+)$`, 'i'));
      if (!signedWithNote || !accept(signedWithNote[1])) return null;
      product = accept(signedWithNote[1]);
      explicitMinus = true;
      cancelled = true;
      cancelReason ||= '차감 수량';
      quantity = number(signedWithNote[3]);
      parsedUnit = unit(signedWithNote[4] || '');
      tail = clean(signedWithNote[5]);
    }
  }
  if (ITEM_ISSUE_TAIL.test(tail)) {
    cancelled = true;
    minusKind = '현지이슈';
    cancelReason ||= '현지이슈';
    tail = clean(tail.replace(ITEM_ISSUE_TAIL, ''));
  } else if (ITEM_CANCEL_TAIL.test(tail)) {
    cancelled = true;
    minusKind ||= '취소';
    cancelReason ||= '취소·제외 지시';
    tail = clean(tail.replace(ITEM_CANCEL_TAIL, ''));
  }
  if (!cancelled && Number(quantity) === 0) { cancelled = true; minusKind ||= '취소'; cancelReason = '0수량'; }
  if (cancelled && !minusKind) {
    minusKind = resolveMinusKind({ cancelReason, note: tail });
  }
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
    increment, explicitMinus, cancelled, cancelReason, ...(minusKind ? { minusKind } : {}),
    farm, inlineCountry: located.inlineCountry, inlineCustomer: located.inlineCustomer || '',
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
  ['china', '중국'], ['chn', '중국'], ['cn', '중국'], ['중국', '중국'], ['중국total', '중국'],
  ['netherlands', '네덜란드'], ['holland', '네덜란드'], ['nld', '네덜란드'], ['nl', '네덜란드'], ['네덜란드', '네덜란드'], ['화란', '네덜란드'],
  ['ecuador', '에콰도르'], ['ecu', '에콰도르'], ['ec', '에콰도르'], ['에콰도르', '에콰도르'], ['에콰', '에콰도르'],
  ['thailand', '태국'], ['tha', '태국'], ['th', '태국'], ['태국', '태국'],
  ['vietnam', '베트남'], ['vnm', '베트남'], ['vn', '베트남'], ['베트남', '베트남'],
  ['australia', '호주'], ['aus', '호주'], ['au', '호주'], ['호주', '호주'],
  ['usa', '미국'], ['united states', '미국'], ['us', '미국'], ['미국', '미국'],
  ['new zealand', '뉴질랜드'], ['newzealand', '뉴질랜드'], ['nz', '뉴질랜드'], ['뉴질랜드', '뉴질랜드'], ['뉴질', '뉴질랜드'],
  ['israel', '이스라엘'], ['il', '이스라엘'], ['이스라엘', '이스라엘'],
  ['kenya', '케냐'], ['케냐', '케냐'],
  ['ethiopia', '에티오피아'], ['et', '에티오피아'], ['에티오피아', '에티오피아'],
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

function isNonOrderLogisticsLine(rawLine) {
  const line = clean(rawLine).replace(/^(?:@\S+\s+)+/, '');
  if (!line) return false;
  if (NON_ORDER_LOGISTICS_LINE.test(line)) return true;
  if (/\b(?:KE|OZ|CA|CZ|MU|CI|TG|VN|KL|AF|LH|QR|EK)\s*\d{3,4}\s+\d{10,12}\b/i.test(line)) return true;
  if (/\b(?:KE|OZ|CA|CZ|MU|CI|TG|VN|KL|AF|LH|QR|EK)\s*\d{3,4}\b/i.test(line)
      && !new RegExp(`\\d\\s*(?:${UNIT})`, 'i').test(line)) {
    return true;
  }
  return false;
}

function isDefiniteNonOrderNotice(rawText) {
  const text = clean(rawText);
  if (!text) return true;
  if (MEDIA_OR_SYSTEM.test(text) || CHATTER.test(text)) return true;
  if (isConfirmationNotice(text) || isPureLogisticsDelayNotice(text)) return true;
  if (/톡게시판\s*['"]?공지|발주시\s*참고|실입고\s*수량|부가세\s*포함|부과세\s*포함|발주\s*가능합니다/i.test(text)) return true;
  const textWithoutNoCancelPolicy = text.replace(/취소가?\s*불가(?:능)?(?:합니다|해요)?/g, '');
  if (/오픈\s*판매\s*중|현재\s*가능\s*수량/.test(textWithoutNoCancelPolicy)) return true;
  const hasExplicitCancelOrReplace = /(?:취소|빼\s*주|제외|대체|캔슬|쇼트|소트|\bshort(?:age)?\b|미\s*컨펌|노\s*컨펌|결품|품절|출하\s*불가|못\s*보내|못보냄|현지\s*이슈|--+>|->|→)/i.test(textWithoutNoCancelPolicy);
  if (information.test(text) && !hasExplicitCancelOrReplace) return true;
  if (!hasExplicitCancelOrReplace && !/발주\s*추가|추가\s*발주/.test(text)
      && /\b(?:M?AWB|HAWB)\b|운송장|통관|도착\s*일정|도착\s*예정|출항|선적\s*완료|완성본입니다|전달\s*요청드립니다|\b\d{3}[-\s]\d{8}\b|\b(?:KE|OZ|CA|CZ|MU|CI|TG|VN|KL|AF|LH|QR|EK)\s*\d{3,4}\s+\d{10,12}\b/i.test(text)) {
    return true;
  }
  return false;
}

function parseProseIssueShortageLine(rawLine, knownFarms = []) {
  const line = stripBullet(rawLine);
  if (!line || isSummaryTotalLine(line) || information.test(line)) return null;
  // Pattern 1: "미디오 버건디 2박스를 뒤에 더 찾아서 쇼트는 3박스랍니다"
  const afterShort = line.match(
    new RegExp(`^([A-Za-z가-힣][A-Za-z가-힣0-9 /_.-]{1,28}?)\\s+${NUM}\\s*(?:${UNIT}).*?(?:쇼트|소트|\\bshort(?:age)?\\b|결품|미\\s*컨펌)(?:은|는|이|가|\\s*[:：])?\\s*(${NUM})\\s*(${UNIT})`, 'i'),
  );
  if (afterShort && !badProduct(clean(afterShort[1]))) {
    const loc = leadingFarm(afterShort[1], knownFarms);
    return {
      product: loc.product,
      quantity: number(afterShort[2]),
      unit: unit(afterShort[3]),
      note: '',
      packSpec: '',
      previousQuantity: '',
      revisionNote: '',
      increment: false,
      explicitMinus: false,
      cancelled: true,
      cancelReason: '현지이슈',
      minusKind: '현지이슈',
      farm: loc.farm,
      inlineCountry: loc.inlineCountry,
      inlineCustomer: loc.inlineCustomer || '',
    };
  }
  // Pattern 2: "골드핀치 장미 3박스가 이상기후(...)쇼트입니다."
  const midShort = line.match(
    new RegExp(`^([A-Za-z가-힣][A-Za-z가-힣0-9 /_.-]{1,28}?)\\s+(${NUM})\\s*(${UNIT})(?:이|가|은|는|\\s).*?(?:쇼트|소트|\\bshort(?:age)?\\b|결품|품절|미\\s*컨펌|출하\\s*불가|선적\\s*불가|못\\s*보내|못보냄|모자랍?니다|없습니다|없답니다)`, 'i'),
  );
  if (midShort && !badProduct(clean(midShort[1]))) {
    const loc = leadingFarm(midShort[1], knownFarms);
    return {
      product: loc.product,
      quantity: number(midShort[2]),
      unit: unit(midShort[3]),
      note: '',
      packSpec: '',
      previousQuantity: '',
      revisionNote: '',
      increment: false,
      explicitMinus: false,
      cancelled: true,
      cancelReason: '현지이슈',
      minusKind: '현지이슈',
      farm: loc.farm,
      inlineCountry: loc.inlineCountry,
      inlineCustomer: loc.inlineCustomer || '',
    };
  }
  return null;
}

function hasExplicitQtyAndUnit(rawText) {
  return new RegExp(`(?:^|\\s|:|：)${NUM}\\s*(?:${UNIT})(?=$|\\s|[),.!?~(\\[])`, 'i').test(String(rawText || ''));
}

function shouldRescueFromLlmCleaned(rawText, options = {}) {
  const text = String(rawText || '').normalize('NFKC');
  if (!text || isDefiniteNonOrderNotice(text)) return false;
  if (HARD_RECALL_CHANGE_RE.test(text) && (/\d/.test(text) || flowers.test(text) || codePattern.test(text))) {
    return true;
  }
  if (options.dbCatalog && hasExplicitQtyAndUnit(text) && isKnownCatalogProductLine(text, options.dbCatalog)) {
    return true;
  }
  return false;
}

function enrichItemWithDbCatalog(item, dbCatalog) {
  if (!dbCatalog || !item || typeof item !== 'object') return item;
  let next = { ...item };

  // Axis A: Every non-empty farm in farmTotals must resolve to an actual DB Farm Master entry.
  if (next.farm) {
    const matchedFarm = matchDbFarm(next.farm, dbCatalog, { hintCountry: next.country });
    if (matchedFarm && matchedFarm.matched) {
      next.farm = matchedFarm.farmName;
      if (matchedFarm.country && (!next.country || next.countryInferred)) {
        next.country = matchedFarm.country;
        next.countryInferred = true;
      }
    } else if (matchedFarm?.reason === 'cl_code' || codePattern.test(next.farm) || /^[A-Z]{0,3}CL[A-Z0-9_-]*$/i.test(next.farm)) {
      if (!next.customer) next.customer = clean(next.farm).toUpperCase();
      next.farm = '';
    } else {
      const farmAsProd = inferCountryAndGroupFromDb({ product: next.farm }, dbCatalog);
      const combinedProd = clean(`${next.farm} ${next.product || ''}`);
      const combinedInf = inferCountryAndGroupFromDb({ product: combinedProd }, dbCatalog);
      const prodLooksLikeSpecOnly = /^(?:\d+(?:[~-]\d+)?\s*cm|xl|xxl|l|m|s|select|fancy|standard|grade\s*[ab]|화이트|레드|핑크|옐로우|그린|블루|퍼플|오렌지)$/i.test(clean(next.product));
      if ((matchedFarm?.reason === 'product_variety' || farmAsProd.country || farmAsProd.group || combinedInf.country || prodLooksLikeSpecOnly)
          && !fold(next.product || '').includes(fold(next.farm))) {
        next.product = combinedProd;
        const specInfo = extractProductSpec(next.product);
        next.baseName = specInfo.baseName;
        next.spec = specInfo.spec;
        next.farm = '';
      } else {
        const tag = `(${next.farm})`;
        if (!String(next.note || '').includes(next.farm)) {
          next.note = clean(`${next.note || ''} ${tag}`);
        }
        next.farm = '';
      }
    }
  }

  // Axis B: ERP DB Product + OrderDetail country & flower-group inference.
  const dbInf = inferCountryAndGroupFromDb({
    product: next.product,
    baseName: next.baseName,
    group: next.group,
    country: next.country,
    farm: next.farm,
  }, dbCatalog);
  if (!next.country && dbInf.country) {
    next.country = dbInf.country;
    next.countryInferred = true;
  }
  const verifiedAlias = next.country
    ? (verifiedGroupAliases.get(next.country)?.get(fold(next.product))
      || verifiedGroupAliases.get(next.country)?.get(fold(next.baseName || ''))
      || '')
    : '';
  if (!next.group) {
    next.group = verifiedAlias || dbInf.group || '';
  }
  if (!next.country && next.group && colombiaGroups.has(next.group)) {
    next.country = '콜롬비아';
    next.countryInferred = true;
  }
  const dbProdMatch = matchDbEnglishProductName(next, dbCatalog);
  if (dbProdMatch.dbProdName) {
    next.dbProdName = dbProdMatch.dbProdName;
    if (dbProdMatch.dbProdKey) next.dbProdKey = dbProdMatch.dbProdKey;
  }
  return next;
}

function enrichResultWithDbCatalog(result, options = {}) {
  const dbCatalog = options.dbCatalog;
  if (!dbCatalog || !result || result.kind === 'excluded') return result;
  const items = Array.isArray(result.items)
    ? result.items.map(it => enrichItemWithDbCatalog(it, dbCatalog))
    : result.items;
  const excludedItems = Array.isArray(result.excludedItems)
    ? result.excludedItems.map(it => enrichItemWithDbCatalog(it, dbCatalog))
    : result.excludedItems;
  const memos = Array.isArray(result.memos)
    ? result.memos.map(m => {
        if (!m || !m.farm) return m;
        const mf = matchDbFarm(m.farm, dbCatalog, { hintCountry: m.country });
        return mf && mf.matched
          ? { ...m, farm: mf.farmName, country: m.country || mf.country || '' }
          : { ...m, farm: '' };
      })
    : result.memos;
  return { ...result, items, excludedItems, memos };
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

  if (isConfirmationNotice(text) || isPureLogisticsDelayNotice(text)) {
    const noticeReason = isConfirmationNotice(text)
      ? '컨펌 확인 (농장 확정 회신 · 발주 추가 제외)'
      : '선적·입고 지연 안내 (추가 발주 제외)';
    return {
      kind: 'excluded',
      analysisSource: 'llm',
      llmProvider,
      cleanReason: noticeReason,
      hintCountry: topCountry || country(text),
      hintWeek: topCycle.week || week(text),
      items: [],
      excludedItems: [],
      ignoredTotals: [],
      memos: [],
      noise: [],
    };
  }

  const mixedConfirm = isConfirmationContextWithMixedMinus(text);
  const issueContext = !mixedConfirm && isIssueDeductionContext(text);
  const questionHold = isQuestionHoldingConfirmation(text);

  if (rawKind === 'cleaned' || rawKind === 'excluded') {
    if (issueContext || shouldRescueFromLlmCleaned(text, options)) return null;
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
    const absQtyStr = rawQtyStr !== '' && Number.isFinite(qtyNum) ? String(Math.round(Math.abs(qtyNum) * 1000) / 1000) : rawQtyStr;
    let cancelled = Boolean(entry.cancelled) || (rawQtyStr !== '' && qtyNum <= 0);
    const itemCustomer = entry.customer ? customerName(entry.customer, aliases) : topCustomer;
    const itemNote = clean(entry.note || '');
    const revisionNote = clean(entry.revisionNote || '');
    if (mixedConfirm && !cancelled) {
      if (MINUS_LINE_MARKER_RE.test(`${rawProdName} ${itemNote} ${clean(entry.cancelReason || '')}`)) {
        cancelled = true;
      } else {
        continue;
      }
    }
    if (!hasExplicitAdditionIntent(text) && !cancelled && isConfirmedItemLine(`${rawProdName} ${itemNote}`)) {
      continue;
    }
    const minusKind = cancelled
      ? (entry.minusKind === '현지이슈' || entry.minusKind === '취소'
          ? entry.minusKind
          : issueContext
            ? '현지이슈'
            : resolveMinusKind({ cancelReason: entry.cancelReason, note: itemNote }))
      : '';
    const specInfo = extractProductSpec(product);
    const reviewReason = cancelled
      ? (!parsedUnit
          ? '단위 확인 필요'
          : !cycle.week
            ? '차수 확인 필요'
            : questionHold
              ? '취소·대체 여부 질문 확인 필요'
              : clean(entry.cancelReason || (minusKind === '현지이슈' ? '현지이슈' : '취소·제외')))
      : !parsedUnit
        ? '단위 확인 필요'
        : !cycle.week
          ? '차수 확인 필요'
          : !validItem({ product, quantity: absQtyStr })
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
      quantity: absQtyStr,
      unit: parsedUnit,
      customer: itemCustomer,
      note: itemNote,
      revisionNote,
      cancelled,
      ...(cancelled ? { sign: -1, minusKind } : {}),
      reviewReason,
    });
  }

  const isPureLlmCancelMessage = rawKind === 'review'
    && items.length > 0
    && items.every(it => !it.cancelled)
    && /취소|빼\s*주|캔슬/.test(text)
    && !hasExplicitAdditionIntent(text)
    && !/(?:하고|대체|-->|->|→)/.test(text)
    && !replacesMessageId;
  if (isPureLlmCancelMessage) {
    for (const it of items) {
      it.cancelled = true;
      it.sign = -1;
      it.minusKind = '취소';
      if (!/^(?:단위|차수|수량)\s*확인 필요$/.test(it.reviewReason || '')) {
        it.reviewReason = questionHold ? '취소·대체 여부 질문 확인 필요' : (it.reviewReason || '발주 취소');
      }
    }
  }

  // Runtime guard for cached v1/v2 LLM payloads on local-issue / 미컨펌 deduction messages
  if (issueContext && items.some(it => !it.cancelled)) {
    const firstHeaderLine = clean(text.split(/\r?\n/).map(l => stripKakaoLineEnvelope(l).text).find(Boolean) || '');
    const issueHeaderWeek = week(firstHeaderLine);
    const hasAvailabilityOrMoq = /\bmoq\b|총\s*\d+[^\n]{0,24}중\s*[:：]?|\d+\s*(?:스템|스팀|단|박스|송이|stems?|st|box|bunches?)\s*가능|추가\s*발주\s*가능/i.test(text);
    const hasRolloverOrAdd = hasAvailabilityOrMoq
      || /(?:--+>|->|→).*(?:구해|추가|보내|대체|컨펌|moq|\d)|증량/i.test(text);
    if (!hasRolloverOrAdd) {
      for (const it of items) {
        if (it.cancelled) continue;
        it.cancelled = true;
        it.sign = -1;
        it.minusKind = '현지이슈';
        if (!/^(?:단위|차수|수량)\s*확인 필요$/.test(it.reviewReason || '')) {
          it.reviewReason = questionHold ? '취소·대체 여부 질문 확인 필요' : '현지이슈';
        }
      }
    } else if (issueHeaderWeek && !hasAvailabilityOrMoq && /미\s*컨펌/.test(firstHeaderLine)) {
      for (const it of items) {
        if (!it.cancelled && it.week === issueHeaderWeek) {
          it.cancelled = true;
          it.sign = -1;
          it.minusKind = '현지이슈';
          if (!/^(?:단위|차수|수량)\s*확인 필요$/.test(it.reviewReason || '')) {
            it.reviewReason = questionHold ? '취소·대체 여부 질문 확인 필요' : '현지이슈';
          }
        }
      }
    }
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
    const firstHeaderLine = clean(text.split(/\r?\n/).map(l => stripKakaoLineEnvelope(l).text).find(Boolean) || '');
    const headerWeekHint = issueContext ? week(firstHeaderLine) : '';
    const exposeCancelledInItems = mixedConfirm || issueContext || rawKind === 'review' || items.filter(it => !it.cancelled).length === 0;
    for (let cIdx = 0; cIdx < raw.cancelledItems.length; cIdx++) {
      const c = raw.cancelledItems[cIdx];
      if (!c || typeof c !== 'object') continue;
      const prod = clean(c.product || '');
      if (!prod) continue;
      const cFarm = normalizeFarmName(c.farm || topFarm || '', knownFarms);
      const cExplicitCountry = normalizeLlmCountry(c.country) || topCountry;
      const cGroup = normalizeLlmCategory(c.category) || topCategory;
      const cCountry = cExplicitCountry || (cFarm ? inferCountryFromFarm(cFarm, knownFarms) : '') || (colombiaGroups.has(cGroup) ? '콜롬비아' : '');
      const cCycle = normalizeLlmWeekAndYear(
        c.week || headerWeekHint || raw.week,
        raw.group,
        text,
        message?.time,
        options.defaultWeek,
        options.defaultYear,
      );
      const cQtyStr = clean(String(c.quantity ?? '')).replace(/,/g, '');
      const cUnit = normalizeOrderUnit(c.unit || c.rawUnit || '');
      const cCustomer = c.customer ? customerName(c.customer, aliases) : topCustomer;
      const cMinusKind = c.minusKind === '현지이슈' || c.minusKind === '취소'
        ? c.minusKind
        : issueContext
          ? '현지이슈'
          : resolveMinusKind({ cancelReason: c.reason, note: c.reason });
      const cReason = clean(c.reason || (cMinusKind === '현지이슈' ? '현지이슈' : '취소·제외'));
      excludedItems.push({
        product: prod,
        quantity: cQtyStr,
        unit: cUnit,
        farm: cFarm,
        country: cCountry,
        group: cGroup,
        week: cCycle.week,
        year: cCycle.year,
        reason: cReason,
        minusKind: cMinusKind,
      });
      if (exposeCancelledInItems) {
        const cQtyNum = Math.abs(Number(cQtyStr));
        const alreadyInItems = items.some(it =>
          it.cancelled
          && fold(it.product) === fold(prod)
          && clean(it.quantity) === String(cQtyNum)
          && clean(it.unit) === cUnit
          && fold(it.customer) === fold(cCustomer)
        );
        if (!alreadyInItems && cQtyStr !== '' && Number.isFinite(cQtyNum) && cQtyNum > 0) {
          const specInfo = extractProductSpec(prod);
          items.push({
            key: JSON.stringify([message.id, 'llm-cancel', cIdx]),
            sourceLine: prod,
            product: prod,
            baseName: specInfo.baseName,
            spec: specInfo.spec,
            packSpec: '',
            group: cGroup,
            country: cCountry,
            farm: cFarm,
            countryInferred: !!cCountry && !cExplicitCountry,
            week: cCycle.week,
            year: cCycle.year,
            quantity: String(Math.round(cQtyNum * 1000) / 1000),
            unit: cUnit,
            customer: cCustomer,
            note: cReason,
            revisionNote: '',
            cancelled: true,
            sign: -1,
            minusKind: cMinusKind,
            reviewReason: !cUnit
              ? '단위 확인 필요'
              : !cCycle.week
                ? '차수 확인 필요'
                : questionHold
                  ? '취소·대체 여부 질문 확인 필요'
                  : cReason,
          });
        }
      }
    }
  }

  if (mixedConfirm && items.filter(it => it.cancelled).length === 0) {
    return {
      kind: 'excluded',
      analysisSource: 'llm',
      llmProvider,
      cleanReason: '컨펌 확인 (농장 확정 회신 · 발주 추가 제외)',
      hintCountry: topCountry || country(text),
      hintWeek: topCycle.week || week(text),
      items: [],
      excludedItems: [],
      ignoredTotals: [],
      memos: [],
      noise: [],
    };
  }
  if (issueContext && items.length === 0) {
    const regexFallback = analyzeImportMessage(message, aliases, { ...options, ignoreLlmCache: true });
    if (regexFallback.items?.length > 0) return regexFallback;
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
    return enrichResultWithDbCatalog({
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
    }, options);
  }

  const canAutoInclude = live.some(it => !it.reviewReason && validItem(it))
    && live.every(it => !it.reviewReason || it.reviewReason === '단위 확인 필요');
  if (canAutoInclude) {
    return enrichResultWithDbCatalog({
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
    }, options);
  }

  const fallbackReason = clean(raw.reviewReason || live.find(it => it.reviewReason)?.reviewReason || '발주 내용 확인 필요');
  return enrichResultWithDbCatalog({
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
  }, options);
}

function expandCompoundOrderLines(inputLines) {
  const out = [];
  let compoundAltered = false;
  const replaceArrowRe1 = new RegExp(`^([A-Za-z가-힣][A-Za-z가-힣0-9 ()/_.-]{0,28}?)\\s*(?:--+>|->|==>|=>|→|➡)\\s*([A-Za-z가-힣][A-Za-z가-힣0-9 ()/_.-]{0,28}?)\\s*(?:으?로\\s*)?(?:(?:대체|변경|교체)\\s*(${NUM})\\s*(${UNIT})|(${NUM})\\s*(${UNIT})\\s*(?:으?로\\s*)?(?:대체|변경|교체))\\s*(.*)$`, 'i');
  const replaceArrowRe2 = new RegExp(`^([A-Za-z가-힣][A-Za-z가-힣0-9 ()/_.-]{0,24}?)\\s+(${NUM})\\s*(${UNIT})\\s*(?:--+>|->|==>|=>|→|➡)\\s*([A-Za-z가-힣][A-Za-z가-힣0-9 ()/_.-]{0,24}?)\\s+(${NUM})\\s*(${UNIT})\\s*(.*)$`, 'i');
  const cancelThenAddRe = /^(.+?)\s*(?:취소|제외|패스|빼\s*주세(?:요|용)?)\s*(?:하고|하시고|후|하며)\s*(.+)$/i;
  const multiClCommaRe = new RegExp(`^([A-Za-z가-힣][A-Za-z가-힣0-9 ()/_.-]{0,24}?)\\s+([A-Z]{0,3}CL[-_]?\\d+\\s+${NUM}\\s*(?:${UNIT})(?:\\s*,\\s*[A-Z]{0,3}CL[-_]?\\d+\\s+${NUM}\\s*(?:${UNIT}))+)\\s*(?:모두\\s*|전부\\s*|다\\s*)?(취소|제외|빼\\s*주세요|빼\\s*주세용|패스|추가|발주)?.*$`, 'i');
  const pairAddCancelRe = new RegExp(`^([A-Za-z가-힣][A-Za-z가-힣0-9 ]{0,20}?)(?:은|는)\\s*(${NUM})\\s*(${UNIT})?\\s+([A-Za-z가-힣][A-Za-z가-힣0-9 ]{0,20}?)(?:은|는|도)\\s*(취소|제외|패스|빼\\s*주세요|빼\\s*주세용)[.!~]*$`, 'i');
  const gtPairRe = new RegExp(`([A-Za-z가-힣][A-Za-z가-힣0-9 ]{1,18}?)\\s*>\\s*(${NUM})\\s*(${UNIT})?`, 'gi');

  for (const rawLine of inputLines) {
    const leadWk = rawLine.match(/^(\d{1,2}(?:\s*-\s*\d{1,2})?)\s*차?\s+(.+)$/);
    const line = leadWk ? clean(leadWk[2]) : rawLine;

    const mArrow1 = line.match(replaceArrowRe1);
    if (mArrow1 && !new RegExp(`(?:^|\\s)${NUM}\\s*(?:${UNIT})?$`, 'i').test(clean(mArrow1[1]))) {
      const qty = mArrow1[3] || mArrow1[5];
      const u = mArrow1[4] || mArrow1[6];
      const tail = clean(mArrow1[7] || '');
      out.push(`[취소] ${clean(mArrow1[1])} ${qty}${u} 취소`);
      out.push(clean(`${clean(mArrow1[2])} ${qty}${u} ${tail}`));
      compoundAltered = true;
      continue;
    }

    const mArrow2 = line.match(replaceArrowRe2);
    if (mArrow2 && fold(mArrow2[1]) !== fold(mArrow2[4])) {
      out.push(`[취소] ${clean(mArrow2[1])} ${mArrow2[2]}${mArrow2[3]} 취소`);
      out.push(clean(`${clean(mArrow2[4])} ${mArrow2[5]}${mArrow2[6]} ${clean(mArrow2[7] || '')}`));
      compoundAltered = true;
      continue;
    }

    const mConj = line.match(cancelThenAddRe);
    if (mConj && new RegExp(`${NUM}\\s*(?:${UNIT})`, 'i').test(mConj[2])) {
      const leftRaw = clean(mConj[1]);
      const rightRaw = clean(mConj[2]);
      const subject = clean(
        leftRaw
          .replace(/(?:의\s*)?(?:나머지\s*수량|잔여\s*수량|기존\s*(?:수량|발주분?))(?:\s*(?:은|는|이|가|도|만))?$/i, '')
          .replace(/(?:은|는|이|가|도|만)$/, '')
      );
      if (new RegExp(`${NUM}\\s*(?:${UNIT})`, 'i').test(leftRaw)) {
        out.push(`[취소] ${leftRaw} 취소`);
      } else if (subject) {
        out.push(`[취소] ${subject} 0박스 취소`);
      }
      let rest = rightRaw;
      const wk = week(rest);
      if (wk) {
        out.push(`${wk}차 발주 추가`);
        rest = clean(rest.replace(/^\d{1,2}(?:\s*-\s*\d{1,2})?\s*차\s*/, ''));
      }
      const clDest = rest.match(/\b([A-Z]{0,3}CL[-_]?\d+)\s*에\s*(?:보내\s*주세요|추가\s*해\s*주세요|부탁드립니다|부탁합니다|주세[요용])?[.!~]*$/i);
      let clPrefix = '';
      if (clDest) {
        clPrefix = `${clDest[1].toUpperCase()} : `;
        rest = clean(rest.slice(0, clDest.index));
      }
      if (/^\d/.test(rest) && subject) {
        out.push(`${clPrefix}${subject} ${rest}`);
      } else {
        out.push(`${clPrefix}${rest}`);
      }
      compoundAltered = true;
      continue;
    }

    const mMultiCl = line.match(multiClCommaRe);
    if (mMultiCl) {
      const prod = clean(mMultiCl[1]);
      const action = clean(mMultiCl[3] || '');
      const segRe = new RegExp(`([A-Z]{0,3}CL[-_]?\\d+)\\s+(${NUM})\\s*(${UNIT})`, 'gi');
      let segMatch;
      let count = 0;
      while ((segMatch = segRe.exec(mMultiCl[2])) !== null) {
        out.push(clean(`${segMatch[1].toUpperCase()} : ${prod} ${segMatch[2]}${segMatch[3]} ${action}`));
        count += 1;
      }
      if (count >= 2) {
        if (/취소|제외|빼|패스/.test(action)) compoundAltered = true;
        continue;
      }
    }

    const mPair = line.match(pairAddCancelRe);
    if (mPair) {
      out.push(clean(`${clean(mPair[1])} ${mPair[2]}${mPair[3] || ''}`));
      out.push(clean(`${clean(mPair[4])} ${mPair[5]}`));
      compoundAltered = true;
      continue;
    }

    if (/수정|변경|정정/.test(line) && (line.match(/>/g) || []).length >= 2) {
      const pairs = [...line.matchAll(gtPairRe)];
      if (pairs.length >= 2) {
        for (const pm of pairs) {
          out.push(clean(`${clean(pm[1])} ${pm[2]}${pm[3] || ''}`));
        }
        compoundAltered = true;
        continue;
      }
    }

    out.push(rawLine);
  }
  return { lines: out, compoundAltered };
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
  if (isConfirmationNotice(body) || isPureLogisticsDelayNotice(body)) {
    const cleanReason = isConfirmationNotice(body)
      ? '컨펌 확인 (농장 확정 회신 · 발주 추가 제외)'
      : '선적·입고 지연 안내 (추가 발주 제외)';
    return { kind: 'excluded', items: [], excludedItems: [], ignoredTotals: [], memos: [], noise, cleanReason, analysisSource: 'regex' };
  }
  const mixedConfirm = isConfirmationContextWithMixedMinus(body);
  const issueContext = !mixedConfirm && isIssueDeductionContext(body);
  const questionHold = isQuestionHoldingConfirmation(body);
  const baseLines=kept.map(line=>/^[[<【~■▶▷◆●▣]/.test(line)?line:stripBullet(line)).filter(Boolean);
  const expanded=expandCompoundOrderLines(baseLines);
  const lines=expanded.lines;
  const explicit=/발주|주문|추가/.test(body);
  const issue=information.test(body) && !issueContext;
  let unresolvedChange=expanded.compoundAltered || mixedConfirm || issueContext;
  let context={country:options.defaultCountry||'',group:'',week:options.defaultWeek||'',customer:'',farm:''};
  let items=[];
  const unparsed=[], retained=[], ignoredTotals=[], memos=[], nameCancels=[];
  const scopeFields = () => ({country:context.country||(colombiaGroups.has(context.group)?'콜롬비아':''),group:context.group,week:context.week||week(body),year:clean(message.time).match(/^\d{4}/)?.[0]||String(options.defaultYear||''),farm:context.farm});
  for(let index=0;index<lines.length;index++) {
    const line=lines[index], next=lines[index+1]||'';
    if (isSummaryTotalLine(line)) { ignoredTotals.push({...scopeFields(),text:line}); continue; }
    if (isNonOrderLogisticsLine(line)) { noise.push('운송장·박스규격'); continue; }
    const keep=line.match(/^기존(?:대로|처럼)\s+(.+?)\s*(\d+(?:,\d{3})*)\s*(박스|단|송이|스팀|스템|봉|개)(?:만)?\s*(?:받겠습니다|유지합니다|유지해주세요)[.!]?$/);
    if(keep){retained.push({product:clean(keep[1]),quantity:number(keep[2]),unit:unit(keep[3])});continue;}
    // Header establishes context only inside this message (never across unrelated chats).
    if (/발주|주문|추가|변경|취소|이슈|소트|쇼트|미\s*컨펌|결품|컨펌/.test(line) && !parseLine(line,knownFarms) && (week(line)||country(line)||category(line))) {
      if(change.test(line))unresolvedChange=true;
      context.country=country(line)||context.country;
      context.group=category(line)||context.group;
      context.week=week(line)||context.week;
      const code=line.match(codePattern)?.[0]; if(code)context.customer=customerName(code,aliases);
      const named=line.replace(/\d{1,2}(?:-\d{1,2})?차?/g,'').replace(countries,'').replace(flowers,'').replace(/선?발주|주문|추가|변경사항|변경|취소|현지\s*이슈|이슈|소트|쇼트|미\s*컨펌|품목|컨펌|내역|수량|완료|공유|안내|요청|[*()[\]]/g,'').trim();
      if(!code && named && isKnownFarmToken(named,knownFarms))context.farm=normalizeFarmName(named,knownFarms);
      else if(!code && /^[가-힣A-Za-z]{2,12}(?:\s*호텔)?$/.test(named) && !/고정|긴급|확인|수정|취소|완료|선발주|이슈|쇼트|소트|컨펌|콜카장/.test(named))context.customer=customerName(named,aliases);
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
      const rest=line
        .replace(countries,'')
        .replace(flowers,'')
        .replace(/\b(?:hydrangea|carnation|alstro(?:e?meria)?|ruscus|astilbe|tulip|hyacinth|anthurium|gypsophila|skimmia|roses?|clematis|daffodil|narcissus|nerine|iris|peony|paeonia)\b/gi, '')
        .replace(/\d{1,2}-\d{1,2}차?/,'')
        .trim();
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
    if (!parseLine(line,knownFarms) && (codePattern.test(line) && line.length<40 || aliases.has(fold(line)) || (parseLine(next,knownFarms) && line.length<=24 && !/[.?!,]/.test(line) && !information.test(line) && !change.test(line) && !addIntent.test(line) && !/차|사진|전산|농장|이슈|컨펌|쇼트|소트/.test(line)))) {
      const label=line.replace(/\s*건\s*$/, '');
      context.customer=customerName(/에\s*추가|해주세요|해주세용/.test(label)?label.match(codePattern)?.[0]||label:label,aliases);
      if(items.length && (body.match(/\b[A-Z]*CL[A-Z0-9_-]*\b/gi)||[]).length===1 && items.every(i=>!i.customer))items=items.map(i=>({...i,customer:context.customer}));
      continue;
    }
    if (!hasExplicitAdditionIntent(body) && isConfirmedItemLine(line)) {
      continue;
    }
    let value=line, customer=context.customer, farm=context.farm;
    const prefix=line.match(/^([^:：[\]<]{1,30})\s*[:：]\s*(.+)$/)
      || line.match(/^([A-Za-z가-힣][A-Za-z가-힣0-9 ()]{0,18}?)\s+[-–]\s+(.+)$/)
      || line.match(/^((?!(?:CLOUD|CLEMATIS|CLASSIC|CLEAR|CLASS)\b)[A-Z]{0,3}CL[-_]?\d+)\s+([A-Za-z가-힣]{2}.+)$/i);
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
    const parsed = parseLine(value, knownFarms) || (issueContext ? parseProseIssueShortageLine(value, knownFarms) : null);
    if(parsed) {
      if (mixedConfirm && !parsed.cancelled) {
        if (MINUS_LINE_MARKER_RE.test(line)) {
          parsed.cancelled = true;
          parsed.minusKind = resolveMinusKind({ cancelReason: line, note: line });
          parsed.cancelReason = parsed.minusKind;
        } else {
          continue;
        }
      }
      if (issueContext && !parsed.cancelled && !/(?:추가|증량|가능|구해\s*주|보내\s*주|\bmoq\b|총\s*\d+.*중)/i.test(line)) {
        parsed.cancelled = true;
        parsed.minusKind = '현지이슈';
        parsed.cancelReason = parsed.cancelReason || '현지이슈';
      }
      const unexplainedMinusInAddition = Boolean(parsed.explicitMinus)
        && !issueContext
        && !mixedConfirm
        && !/(?:취소|감량|이슈|소트|쇼트|미\s*컨펌|결품|제외|빼\s*주)/.test(body);
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
      const itemMinusKind = parsed.cancelled
        ? (parsed.minusKind || (issueContext ? '현지이슈' : resolveMinusKind({ cancelReason: parsed.cancelReason, note: parsed.note })))
        : '';
      const itemReviewReason = parsed.cancelled
        ? (unexplainedMinusInAddition
            ? '음수 수량 확인 필요'
            : !parsed.unit
              ? '단위 확인 필요'
              : !itemWeek
                ? '차수 확인 필요'
                : questionHold
                  ? '취소·대체 여부 질문 확인 필요'
                  : (parsed.cancelReason || (itemMinusKind === '현지이슈' ? '현지이슈' : '취소·제외')))
        : !parsed.unit
          ? '단위 확인 필요'
          : !itemWeek
            ? '차수 확인 필요'
            : '';
      items.push({...parsed,key:JSON.stringify([message.id,index]),sourceLine:line,product,baseName:spec.baseName,spec:spec.spec,group,country:itemCountry,
        farm:resolvedFarm,countryInferred:!!itemCountry&&!explicitCountry,week:itemWeek,year:clean(message.time).match(/^\d{4}/)?.[0]||String(options.defaultYear||''),customer:customer||parsed.inlineCustomer||source?.correctedCustomer||source?.customer||'',
        ...(parsed.cancelled ? { sign: -1, minusKind: itemMinusKind } : {}),
        reviewReason:itemReviewReason});
    } else if (/\d\s*(?:박스|상자|단|속|스팀|스템|송이|본|FB|HB|QB|EB|st\b)|[:：]\s*\d/i.test(line) && !information.test(line) && !/^\*/.test(line)) {
      unparsed.push(line);
      if (change.test(line)) unresolvedChange=true;
    } else if (change.test(line)) {
      unresolvedChange=true;
    }
  }
  if (mixedConfirm && items.length === 0) {
    return { kind: 'excluded', items: [], excludedItems: [], ignoredTotals, memos, noise, cleanReason: '컨펌 확인 (농장 확정 회신 · 발주 추가 제외)', analysisSource: 'regex' };
  }
  if (items.length > 0 && items.every(i => !i.cancelled) && /취소|캔슬/.test(body) && !hasExplicitAdditionIntent(body) && !/추가/.test(body) && !/(?:하고|대체|-->|->|→)/.test(body)) {
    items = items.map(item => ({
      ...item,
      cancelled: true,
      sign: -1,
      minusKind: '취소',
      cancelReason: item.cancelReason || '발주 취소',
      reviewReason: !item.unit
        ? '단위 확인 필요'
        : !item.week
          ? '차수 확인 필요'
          : questionHold
            ? '취소·대체 여부 질문 확인 필요'
            : (item.cancelReason || '발주 취소'),
    }));
  }
  const active=items.filter(item=>!item.cancelled);
  if (nameCancels.length) {
    if (active.some(item=>validItem(item))) items=items.filter(item=>!nameCancels.some(c=>fold(item.product)===fold(c.product)));
    else unresolvedChange=true;
  }
  const excludedItems=[...items.filter(item=>item.cancelled).map(item=>({product:item.product,quantity:item.quantity,unit:item.unit,farm:item.farm,country:item.country,group:item.group,week:item.week,year:item.year,reason:item.reviewReason,minusKind:item.minusKind||'취소',sourceLine:item.sourceLine,key:item.key})),
    ...(active.some(item=>validItem(item))?nameCancels:[])];
  if (memos.length) items=items.map(item=>({...item,memos:memos.filter(m=>!m.farm||!item.farm||m.farm===item.farm).map(m=>m.text)}));
  if (issueContext && items.length === 0) {
    return enrichResultWithDbCatalog({ kind: 'review', reason: '현지이슈 · 수량 미기재 확인 필요', items: [], unparsed, retained, excludedItems, ignoredTotals, memos, noise, analysisSource: 'regex' }, options);
  }
  const onlyCancelled=items.length>0&&items.every(item=>item.cancelled);
  const altered=unresolvedChange||onlyCancelled;
  // A standalone item list is a candidate, but conversations about quantities are not orders.
  const relevant=explicit && (items.length>0||altered||unparsed.length>0||/추가(?:에요|입니다)|발주\s*(?:추가|해주세요|부탁|진행)/.test(body)&&!issue)
    || items.length>0 && !issue
    || unparsed.length>0&&addIntent.test(body)&&!issue
    || altered && !isDefiniteNonOrderNotice(body) && /취소|대체|정정|변경|수정|줄인|감량|증량|중복|빼\s*주|보류|미\s*컨펌|노\s*컨펌|쇼트|소트|결품|품절|출하\s*불가|못\s*보내|못보냄|현지\s*이슈|넘겨|이월|제외|패스|캔슬/.test(body);
  const extra={excludedItems,ignoredTotals,memos,noise,analysisSource:'regex'};
  if(!relevant) {
    if (options.dbCatalog && !isDefiniteNonOrderNotice(body) && hasExplicitQtyAndUnit(body) && isKnownCatalogProductLine(body, options.dbCatalog)) {
      return enrichResultWithDbCatalog({kind:'review',reason:'발주·취소·변경 누락 방지 확인',items,unparsed,retained,...extra}, options);
    }
    return {kind:'excluded',items:[],...extra};
  }
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
  if (partialAddition) return enrichResultWithDbCatalog({ kind: 'addition', reason: '', items, unparsed, retained, ...extra }, options);
  reason=reason||live.find(i=>i.reviewReason)?.reviewReason||'';
  if(reason)items=items.map(item=>item.cancelled?item:{...item,reviewReason:reason});
  return enrichResultWithDbCatalog({kind:reason?'review':'addition',reason,items,unparsed,retained,...extra}, options);
}

function parseMessageMinutes(rawTime) {
  const s = clean(rawTime);
  if (!s) return NaN;
  const ko = s.match(/^(\d{4})\s*년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일\s*(오전|오후|AM|PM)?\s*(\d{1,2}):(\d{2})/i);
  if (ko) {
    let hr = Number(ko[5]);
    const ap = (ko[4] || '').toUpperCase();
    if ((ap === '오후' || ap === 'PM') && hr < 12) hr += 12;
    if ((ap === '오전' || ap === 'AM') && hr === 12) hr = 0;
    return Date.UTC(Number(ko[1]), Number(ko[2]) - 1, Number(ko[3]), hr, Number(ko[6])) / 60000;
  }
  const iso = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2}))?/);
  if (iso) {
    return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]), Number(iso[4] || 0), Number(iso[5] || 0)) / 60000;
  }
  return NaN;
}

function applyFeedContextInheritance(selected, review, feed, senderById) {
  const indexMap = new Map(feed.messages.map((m, idx) => [m.id, idx]));
  const combined = [...selected, ...review].sort((a, b) => {
    const ta = parseMessageMinutes(a.time);
    const tb = parseMessageMinutes(b.time);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb;
    return (indexMap.get(b.id) ?? 0) - (indexMap.get(a.id) ?? 0);
  });

  let lastCtx = null;
  const recentWindow = [];
  for (const m of combined) {
    const day = messageDay(m.time);
    const year = clean(m.time).match(/^\d{4}/)?.[0] || '';
    const min = parseMessageMinutes(m.time);
    const sender = senderById.get(m.id) || '';
    const ownWeek = week(m.text || '') || m.items?.find(i => i.week)?.week || m.excludedItems?.find(i => i.week)?.week || '';
    const ownExplicitCountry = country(m.text || '')
      || m.items?.find(i => i.country && !i.countryInferred)?.country
      || '';
    const ownCountry = ownExplicitCountry
      || m.items?.find(i => i.country)?.country
      || m.excludedItems?.find(i => i.country)?.country
      || '';
    const ownGroup = category(m.text || '') || m.items?.find(i => i.group)?.group || '';

    if (lastCtx && day && day === lastCtx.day && year === lastCtx.year && Number.isFinite(min) && Number.isFinite(lastCtx.min)) {
      const gapMin = min - lastCtx.min;
      const sameSender = Boolean(sender && lastCtx.sender && sender === lastCtx.sender);
      const maxWeekGap = sameSender ? 60 : 25;
      const maxCountryGap = sameSender ? 25 : 10;

      if (gapMin >= 0 && gapMin <= maxWeekGap) {
        const findRecentMatchingItem = row => {
          for (let ri = recentWindow.length - 1; ri >= 0; ri--) {
            const prev = recentWindow[ri];
            if (prev.day !== day || prev.year !== year || min - prev.min > maxWeekGap) continue;
            const hit = (prev.items || []).find(pi => !pi.cancelled
              && fold(pi.product) === fold(row.product)
              && (!row.unit || !pi.unit || pi.unit === row.unit));
            if (hit) return hit;
          }
          return null;
        };

        const updateRow = row => {
          if (!row || typeof row !== 'object') return row;
          let next = row;
          const prevHit = (!next.week || !next.country) ? findRecentMatchingItem(next) : null;
          if (!next.week && (prevHit?.week || lastCtx.week)) {
            next = { ...next, week: prevHit?.week || lastCtx.week };
            if (next.reviewReason === '차수 확인 필요') {
              next = { ...next, reviewReason: m.reason && m.reason !== '차수 확인 필요' ? m.reason : '' };
            }
          }
          if (!next.country && (prevHit?.country || (lastCtx.country && gapMin <= maxCountryGap))) {
            next = {
              ...next,
              country: prevHit?.country || lastCtx.country,
              countryInferred: true,
              group: next.group || prevHit?.group || lastCtx.group || '',
            };
          }
          return next;
        };

        if (Array.isArray(m.items) && m.items.length) {
          m.items = m.items.map(updateRow);
          if (m.reason === '차수 확인 필요' && m.items.every(i => i.cancelled || i.week)) {
            const explicitAdd = /발주|주문|추가|보내\s*주세요|부탁/.test(m.text || '');
            if (explicitAdd && m.items.some(i => !i.cancelled && !i.reviewReason && validItem(i))) {
              m.kind = 'addition';
              m.reason = '';
              const rIdx = review.indexOf(m);
              if (rIdx >= 0) {
                review.splice(rIdx, 1);
                selected.push(m);
              }
            } else {
              m.reason = '발주 의도 확인';
              m.items = m.items.map(i => i.cancelled ? i : { ...i, reviewReason: i.reviewReason || '발주 의도 확인' });
            }
          }
        }
        if (Array.isArray(m.excludedItems) && m.excludedItems.length) {
          m.excludedItems = m.excludedItems.map(updateRow);
        }
      }
    }

    const finalWeek = ownWeek || m.items?.find(i => i.week)?.week || '';
    const finalCountry = ownExplicitCountry || ownCountry || m.items?.find(i => i.country)?.country || '';
    const finalGroup = ownGroup || m.items?.find(i => i.group)?.group || '';
    if (day && Number.isFinite(min)) {
      recentWindow.push({ day, year, min, items: m.items || [] });
      if (recentWindow.length > 8) recentWindow.shift();
    }
    if (day && Number.isFinite(min) && (finalWeek || finalCountry)) {
      lastCtx = {
        day,
        year,
        min,
        sender,
        week: finalWeek || (lastCtx?.day === day ? lastCtx.week : ''),
        country: ownExplicitCountry || (lastCtx?.day === day && lastCtx.explicitCountry ? lastCtx.country : finalCountry),
        explicitCountry: Boolean(ownExplicitCountry || (lastCtx?.day === day && lastCtx.explicitCountry)),
        group: ownExplicitCountry ? finalGroup : (lastCtx?.day === day && lastCtx.explicitCountry ? lastCtx.group : finalGroup),
      };
    }
  }
}

const sameLine = (item, other) => item.year===other.year && item.week && item.week===other.week && fold(item.product)===fold(other.product) && item.unit===other.unit
  && (!other.country||!item.country||item.country===other.country||other.countryInferred||item.countryInferred)
  && (!other.group||!item.group||item.group===other.group)
  && (!other.customer||!item.customer||fold(item.customer)===fold(other.customer));

export function classifyImportFeed(feed, aliases=new Map(), {audit=false, ...options}={}) {
  const selected=[], review=[], identities=new Map(), omitted=[], cleaned=[], senderById=new Map();
  let duplicates=0, excluded=0, llmParsed=0, llmPending=0;
  const providers = new Set();
  // Prefer deleted variants as a review warning; do not count their non-deleted snapshot again.
  const ordered=[...feed.messages].sort((a,b)=>Number(/삭제되었습니다/.test(b.text))-Number(/삭제되었습니다/.test(a.text)));
  for(const message of ordered) {
    if (message.sender) senderById.set(message.id, message.sender);
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
      const cleanReason = result.cleanReason
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
  if (options.inheritContext || options.dbCatalog) {
    applyFeedContextInheritance(selected, review, feed, senderById);
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
  // Guard against supplier cancel-completion echo ("100stem 취소 해줬습니다") double-subtracting the same day's cancel request
  for (let i = 0; i < review.length; i++) {
    const m = review[i];
    if (!/취소\s*(?:해\s*줬습니다|했습니다|완료|처리\s*됐습니다)/i.test(m.text || '')) continue;
    const mDay = messageDay(m.time);
    const mMin = parseMessageMinutes(m.time);
    const earlierSameDay = review.slice(i + 1).filter(prev => {
      if (messageDay(prev.time) !== mDay) return false;
      const pMin = parseMessageMinutes(prev.time);
      return Number.isFinite(mMin) && Number.isFinite(pMin) && mMin >= pMin && (mMin - pMin) <= 180;
    });
    if (!earlierSameDay.length) continue;
    const normEchoProd = s => fold(s).replace(/^[a-z]{0,3}cl[-_]?\d+\s+/i, '').replace(new RegExp('^(' + countries.source + ')\\s*', 'i'), '').trim();
    m.items = m.items.map(item => {
      if (!item.cancelled) return item;
      const itemNorm = normEchoProd(item.product);
      const dupCancel = itemNorm && earlierSameDay.some(prev =>
        (prev.items || []).some(pi => {
          const piNorm = normEchoProd(pi.product);
          return pi.cancelled
            && pi.week === item.week
            && clean(pi.quantity) === clean(item.quantity)
            && pi.unit === item.unit
            && piNorm
            && (piNorm.includes(itemNorm) || itemNorm.includes(piNorm));
        })
      );
      return dupCancel ? { ...item, reviewReason: '직전 취소 요청의 처리 회신 확인 필요' } : item;
    });
  }
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
    if (isConfirmationNotice(message.text) || isPureLogisticsDelayNotice(message.text)) {
      return { ...message, original: message.text };
    }
    const lines=message.text.split('\n');
    const prefix=[];
    const own=lines.map(line=>extractFarmHeader(line,knownFarms)).find(Boolean);
    if(!own?.farm&&carry.farm)prefix.push(`■ ${carry.farm}`);
    const ownWeek=week(message.text), ownCountry=country(message.text);
    const isMinusMsg = isConfirmationContextWithMixedMinus(message.text)
      || isIssueDeductionContext(message.text)
      || (/취소|캔슬/.test(message.text) && !hasExplicitAdditionIntent(message.text));
    if (isMinusMsg) {
      const scopeHint = [ownWeek||carry.week?`${ownWeek||carry.week}차`:'', ownCountry?'':carry.country].filter(Boolean).join(' ');
      if (scopeHint && (!ownWeek || !ownCountry)) prefix.push(`${scopeHint} 발주 변경사항`);
    } else if(!/발주|주문|추가/.test(message.text)||(!ownWeek&&carry.week)||(!ownCountry&&carry.country)) {
      prefix.push([ownWeek||carry.week?`${ownWeek||carry.week}차`:'',ownCountry?'':carry.country,'발주 추가'].filter(Boolean).join(' '));
    }
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
