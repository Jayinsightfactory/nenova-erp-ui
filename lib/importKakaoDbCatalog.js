// lib/importKakaoDbCatalog.js
// 수입부 카톡 발주 · 국가별 발주서 전용 MSSQL DB 농장 마스터 & 품종·품목군→국가·품목군 학습 카탈로그
// - GET 조회 시점 읽기 전용(SELECT) 5분 메모리 캐시
// - 1) 카톡 농장명을 DB 정식 농장 레코드(FarmKey/FarmName/CounName)로 정규화 (비농장/품종 오인 차단)
// - 2) 국가 생략 발주("볼오브크림 80스팀", "줄링 10단", "더글라스 50박스", "스키미아 60단" 등)의 국가·품목군 자동 확정

import { getDisplayName, getEnglishOf, tokenizeForMatch } from './displayName.js';
import { canonicalImportCountry } from './importToolsDisplay.js';
import { resolveKakaoProductAlias } from './importKakaoDbProductAliases.js';

const clean = (value) => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const fold = (value) => clean(value).toLowerCase();

export const CANONICAL_IMPORT_COUNTRIES = new Set([
  '콜롬비아',
  '중국',
  '네덜란드',
  '에콰도르',
  '태국',
  '베트남',
  '호주',
  '미국',
  '뉴질랜드',
  '일본',
  '이스라엘',
  '에티오피아',
  '케냐',
]);

const COUNTRY_SYNONYMS = new Map([
  ['콜롬비아', '콜롬비아'], ['콜', '콜롬비아'], ['colombia', '콜롬비아'], ['col', '콜롬비아'],
  ['중국', '중국'], ['중국total', '중국'], ['중국(배)', '중국'], ['중국(항공)', '중국'], ['china', '중국'], ['cn', '중국'],
  ['네덜란드', '네덜란드'], ['화란', '네덜란드'], ['netherlands', '네덜란드'], ['holland', '네덜란드'], ['nl', '네덜란드'],
  ['에콰도르', '에콰도르'], ['에콰', '에콰도르'], ['ecuador', '에콰도르'], ['ec', '에콰도르'],
  ['태국', '태국'], ['thailand', '태국'], ['th', '태국'],
  ['베트남', '베트남'], ['vietnam', '베트남'], ['vn', '베트남'],
  ['호주', '호주'], ['australia', '호주'], ['au', '호주'],
  ['미국', '미국'], ['usa', '미국'], ['us', '미국'], ['united states', '미국'],
  ['뉴질랜드', '뉴질랜드'], ['뉴질', '뉴질랜드'], ['new zealand', '뉴질랜드'], ['newzealand', '뉴질랜드'], ['nz', '뉴질랜드'],
  ['일본', '일본'], ['japan', '일본'], ['jp', '일본'],
  ['이스라엘', '이스라엘'], ['israel', '이스라엘'], ['il', '이스라엘'],
  ['에티오피아', '에티오피아'], ['ethiopia', '에티오피아'], ['et', '에티오피아'],
  ['케냐', '케냐'], ['kenya', '케냐'],
]);

export function normalizeCatalogCountry(raw) {
  const s = clean(raw);
  if (!s || s === '국내' || s === '사용금지' || s === '미상' || s === '국가 미상') return '';
  const hit = COUNTRY_SYNONYMS.get(fold(s));
  if (hit) return hit;
  const canonical = canonicalImportCountry(s);
  if (CANONICAL_IMPORT_COUNTRIES.has(canonical)) return canonical;
  return COUNTRY_SYNONYMS.get(fold(canonical)) || '';
}

const FLOWER_GROUP_SYNONYMS = new Map([
  ['수국', '수국'], ['hydrangea', '수국'],
  ['장미', '장미'], ['스프레이장미', '장미'], ['미니장미', '장미'], ['rose', '장미'], ['spray rose', '장미'],
  ['카네이션', '카네이션'], ['미니카네이션', '카네이션'], ['carnation', '카네이션'], ['minicarnation', '카네이션'],
  ['알스트로', '알스트로'], ['알스트로메리아', '알스트로'], ['alstroemeria', '알스트로'], ['alstromeria', '알스트로'],
  ['루스커스', '루스커스'], ['ruscus', '루스커스'],
  ['튤립', '튤립'], ['tulip', '튤립'], ['tulipa', '튤립'],
  ['히야신스', '히야신스'], ['히아신스', '히야신스'], ['hyacinth', '히야신스'], ['hyacinthus', '히야신스'],
  ['아스틸베', '아스틸베'], ['astilbe', '아스틸베'],
  ['카라', '카라'], ['칼라', '카라'], ['calla', '카라'], ['zantedeschia', '카라'],
  ['거베라', '거베라'], ['gerbera', '거베라'],
  ['국화', '국화'], ['소국', '국화'], ['대국', '국화'], ['퐁퐁', '국화'], ['퐁퐁 pong pong', '국화'], ['chrysanthemum', '국화'],
  ['안개', '안개'], ['안개꽃', '안개'], ['gypsophila', '안개'],
  ['안시리움', '안시리움'], ['안스리움', '안시리움'], ['anthurium', '안시리움'],
  ['스키미아', '스키미아'], ['스키미야', '스키미아'], ['skimmia', '스키미아'],
  ['유칼립투스', '유칼립투스'], ['유칼리', '유칼립투스'], ['eucalyptus', '유칼립투스'], ['eucaluptus', '유칼립투스'],
  ['작약', '작약'], ['피오니', '작약'], ['peony', '작약'], ['paeonia', '작약'],
  ['다알리아', '다알리아'], ['달리아', '다알리아'], ['dahlia', '다알리아'],
  ['호접', '호접'], ['호접란', '호접'], ['호접난', '호접'], ['호접난 orchid', '호접'], ['phalaenopsis', '호접'],
  ['덴파레', '덴파레'], ['덴드륨', '덴파레'], ['dendrobium', '덴파레'],
  ['모카라', '모카라'], ['mokara', '모카라'],
  ['아란', '아란'], ['아란테라', '아란'], ['aranthera', '아란'],
  ['스타티스', '스타티스'], ['스타티체', '스타티스'], ['statice', '스타티스'],
  ['리모늄', '리모늄'], ['리모니움', '리모늄'], ['시네신스', '리모늄'], ['limonium', '리모늄'],
  ['라넌큘러스', '라넌큘러스'], ['라넌', '라넌큘러스'], ['ranunculus', '라넌큘러스'],
  ['클레마티스', '클레마티스'], ['clematis', '클레마티스'],
  ['수선화', '수선화'], ['나르시스', '수선화'], ['daffodil', '수선화'], ['narcissus', '수선화'],
  ['네리네', '네리네'], ['nerine', '네리네'],
  ['아이리스', '아이리스'], ['iris', '아이리스'],
  ['스위트피', '스위트피'], ['스윗피', '스위트피'], ['sweet pea', '스위트피'], ['sweetpea', '스위트피'],
  ['더글라스', '상록수'], ['douglas', '상록수'], ['douglas fir', '상록수'],
  ['펀', '펀'], ['코알라펀', '펀'], ['딩고펀', '펀'], ['엄브렐라펀', '펀'], ['씨스타펀', '펀'], ['레인보우펀', '펀'], ['fern', '펀'],
  ['부쉬', '부쉬'], ['울리부쉬', '부쉬'], ['반커부쉬', '부쉬'], ['스모크부쉬', '부쉬'], ['사파이어부쉬', '부쉬'], ['bush', '부쉬'],
  ['오니소갈룸', '오니소갈룸'], ['오니소겔륨', '오니소갈룸'], ['오니소칼륨', '오니소갈룸'], ['ornithogalum', '오니소갈룸'],
  ['디디스커스', '디디스커스'], ['didiscus', '디디스커스'],
  ['스카비오사', '스카비오사'], ['스카비오사 scabiosa', '스카비오사'], ['scabiosa', '스카비오사'],
  ['아스트란시아', '아스트란시아'], ['아스트란티아', '아스트란시아'], ['astrantia', '아스트란시아'],
  ['아가판서스', '아가판서스'], ['아가판투스', '아가판서스'], ['agapanthus', '아가판서스'],
  ['레우코취', '레우코취'], ['류코토에', '레우코취'], ['leucothoe', '레우코취'],
  ['줄맨드라미', '줄맨드라미'], ['줄맨드라미 (amaranthus)', '줄맨드라미'], ['amaranthus', '줄맨드라미'],
  ['에린지움', '에린지움'], ['eryngium', '에린지움'],
  ['마트리카리아', '마트리카리아'], ['마가렛', '마트리카리아'], ['matricaria', '마트리카리아'],
  ['헬레보루스', '헬레보루스'], ['helleborus', '헬레보루스'],
  ['프로테아', '프로테아'], ['킹프로테아', '프로테아'], ['protea', '프로테아'],
  ['핀쿠션', '핀쿠션'], ['leucospermum', '핀쿠션'],
  ['왁스', '왁스'], ['왁스플라워', '왁스'], ['waxflower', '왁스'],
  ['목화', '목화'], ['cotton', '목화'],
  ['레몬잎', '레몬잎'], ['salal', '레몬잎'],
]);

export function normalizeCatalogFlowerGroup(raw) {
  const s = clean(raw);
  if (!s) return '';
  const hit = FLOWER_GROUP_SYNONYMS.get(fold(s));
  if (hit) return hit;
  if (s === '기타') return '기타';
  return s;
}

const CANONICAL_FLOWER_GROUPS = new Set([
  '기타',
  ...[...FLOWER_GROUP_SYNONYMS.keys()].map((k) => fold(k)),
  ...[...FLOWER_GROUP_SYNONYMS.values()].map((v) => fold(v)),
]);

export function dbFarmLookupKey(value) {
  const base = clean(value)
    .normalize('NFKC')
    .replace(/^[\[【〔<(（■▶▷◆●▣★☆\-·•:：\s]+|[\]】〕>)）\s:：\-]+$/g, '')
    .toLowerCase();
  if (!base) return '';
  const stripped = base
    .replace(
      /\b(?:the|la|el|los|las|grupo|agroindustrial|agricola|agrícola|c\.?i\.?|s\.?a\.?s\.?|ltda|export|investments?|group|corporation|corp|inc|co|farms?|flowers?|flora|roses?|rosas|follajes|floral|colombian)\b/gi,
      ' ',
    )
    .replace(/(?:농장|플라워|화훼)$/g, ' ')
    .replace(/[\s·_*☆★※△()（）[\]<>.,\-/\\'"`&]/g, '');
  return stripped || base.replace(/[\s·_*☆★※△()（）[\]<>.,\-/\\'"`&]/g, '');
}

// CounKey=0 등으로 국가가 비어 있는 dbo.Farm 레코드의 검증된 원산지 보강
const DB_FARM_FALLBACK_COUNTRIES = new Map([
  ['nzblooms', '뉴질랜드'],
  ['nzbloom', '뉴질랜드'],
  ['aviv', '이스라엘'],
  ['avivflower', '이스라엘'],
  ['greengenie', '콜롬비아'],
  ['expobloom', '콜롬비아'],
  ['picacho', '콜롬비아'],
  ['ossimo', '콜롬비아'],
  ['elite', '콜롬비아'],
  ['aguaclara', '콜롬비아'],
  ['unique', '콜롬비아'],
]);

// 카톡 한글/약칭 → DB 정식 농장명 매핑 (반드시 DB Farm / WarehouseMaster 실존 농장으로 귀결)
const KOREAN_AND_ABBR_FARM_ALIASES = [
  { canonicalName: 'The Elite Flowers', country: '콜롬비아', aliases: ['엘리떼', '엘리테', '플로라컨셉', '플로라 컨셉', 'floraconcept', 'flora concept', 'elite', 'theeliteflowers'] },
  { canonicalName: 'FLORES Tiba', country: '콜롬비아', aliases: ['티바', 'tiba', 'florestiba'] },
  { canonicalName: 'Antioquia', country: '콜롬비아', aliases: ['안티오퀴아', '안티오키아', 'antioquia'] },
  { canonicalName: 'Florentina', country: '콜롬비아', aliases: ['플로렌티나', '플로렌티아', '플로렌스', 'florentina', 'florence', 'fl'] },
  { canonicalName: 'Balverde', country: '콜롬비아', aliases: ['발베르데', '발베르드', 'balverde', 'ba'] },
  { canonicalName: 'Ayura', country: '콜롬비아', aliases: ['아유라', 'ayura'] },
  { canonicalName: 'Natuflora', country: '콜롬비아', aliases: ['나투', '나투플로라', '네추럴', '내추럴', 'natuflora', 'natural'] },
  { canonicalName: 'Kikuyal', country: '콜롬비아', aliases: ['키쿠얄', 'kikuyal'] },
  { canonicalName: 'Matina', country: '콜롬비아', aliases: ['마티나', '젤렉타', '아구아클라라', '아과클라라', 'matina', 'zelecta', 'aguaclara', 'agua clara'] },
  { canonicalName: 'Varietta', country: '콜롬비아', aliases: ['바리에타', 'varietta', 'varieta'] },
  { canonicalName: 'Grupo Valores', country: '콜롬비아', aliases: ['발로레스', 'valores', 'grupovalores'] },
  { canonicalName: 'Invos', country: '콜롬비아', aliases: ['인보스', 'invos'] },
  { canonicalName: 'Milagro', country: '콜롬비아', aliases: ['밀라그로', 'milagro'] },
  { canonicalName: 'Don Eusebio', country: '콜롬비아', aliases: ['돈에우세비오', '에우세비오', 'doneusebio', 'eusebio'] },
  { canonicalName: 'Teucali', country: '콜롬비아', aliases: ['테우칼리', 'teucali'] },
  { canonicalName: 'Turflor', country: '콜롬비아', aliases: ['투르플로르', '투르플로라', 'turflor'] },
  { canonicalName: 'La Gaitana', country: '콜롬비아', aliases: ['가이타나', '라가이타나', 'gaitana', 'lagaitana'] },
  { canonicalName: 'El Zorro', country: '콜롬비아', aliases: ['엘조로', '조로', 'zorro', 'elzorro'] },
  { canonicalName: 'Circasia', country: '콜롬비아', aliases: ['시르카시아', 'circasia'] },
  { canonicalName: 'Ecoflor', country: '콜롬비아', aliases: ['에코플로르', 'ecoflor'] },
  { canonicalName: 'Esperance', country: '콜롬비아', aliases: ['에스페란스', 'esperance'] },
  { canonicalName: 'Maxiflores', country: '콜롬비아', aliases: ['막시플로레스', '맥시플로레스', 'maxiflores'] },
  { canonicalName: 'San Juan', country: '콜롬비아', aliases: ['산후안', 'sanjuan'] },
  { canonicalName: 'San Marino', country: '콜롬비아', aliases: ['산마리노', 'sanmarino'] },
  { canonicalName: 'Capiro', country: '콜롬비아', aliases: ['카피로', 'capiro'] },
  { canonicalName: 'Daflor', country: '콜롬비아', aliases: ['다플로르', '다플로러', 'daflor'] },
  { canonicalName: 'Colibri', country: '콜롬비아', aliases: ['콜리브리', 'colibri', 'colibrí'] },
  { canonicalName: 'Lorzate', country: '콜롬비아', aliases: ['로자떼', '로자르테', '로르자테', 'lorzate', 'rozate'] },
  { canonicalName: 'Verdnatura', country: '콜롬비아', aliases: ['베르나투라', '베르드나투라', 'verdnatura'] },
  { canonicalName: 'Inverpalmas', country: '콜롬비아', aliases: ['인베르팔마스', 'inverpalmas'] },
  { canonicalName: 'Bogota', country: '콜롬비아', aliases: ['보고타', 'bogota'] },
  { canonicalName: 'Medellin', country: '콜롬비아', aliases: ['메데진', '메데인', 'medellin'] },
  { canonicalName: 'Melody', country: '중국', aliases: ['멜로디', 'melody', 'yunnanmelody'] },
  { canonicalName: 'CLOUD', country: '중국', aliases: ['클라우드', 'cloud', 'cloudland', '클라우드(항공)', '클라우드항공'] },
  { canonicalName: 'HUBFRESH', country: '중국', aliases: ['허브프레시', '허브프레쉬', '허브', 'hubfresh', 'hub2', '허브(해상)', '허브해상'] },
  { canonicalName: 'Kunming', country: '중국', aliases: ['쿤밍', 'kunming', 'yunnanhengge', 'hengge'] },
  { canonicalName: 'Holex', country: '네덜란드', aliases: ['홀렉스', 'holex', '알스미어', 'aalsmeer'] },
  { canonicalName: 'EZ Flowers', country: '네덜란드', aliases: ['이지플라워', 'ezflowers', 'ez'] },
  { canonicalName: 'Florca', country: '네덜란드', aliases: ['플로르카', 'florca'] },
  { canonicalName: 'La Rosaleda', country: '에콰도르', aliases: ['로살레다', '로사레다', '라로살레다', 'rosaleda', 'larosaleda'] },
  { canonicalName: 'Fagua Flowers', country: '에콰도르', aliases: ['파구아', 'fagua', 'faguaflowers'] },
  { canonicalName: 'Esmeralda', country: '에콰도르', aliases: ['에스메랄다', 'esmeralda', '키토', 'quito'] },
  { canonicalName: 'Floramar', country: '에콰도르', aliases: ['플로라마', 'floramar'] },
  { canonicalName: 'Nivalia', country: '에콰도르', aliases: ['니발리아', 'nivalia'] },
  { canonicalName: 'Mystic', country: '에콰도르', aliases: ['미스틱', 'mystic'] },
  { canonicalName: 'Super Fresh', country: '태국', aliases: ['슈퍼프레쉬', '슈퍼프레시', 'superfresh'] },
  { canonicalName: 'Krung', country: '태국', aliases: ['크룽', 'krung'] },
  { canonicalName: 'Lee and U', country: '태국', aliases: ['리앤유', 'leeandu', 'lee&u'] },
  { canonicalName: 'Premium Greens', country: '호주', aliases: ['프리미엄그린', '프리미엄그린스', 'premiumgreens', 'premiumgreen'] },
  { canonicalName: 'Hood Canal', country: '미국', aliases: ['후드캐널', '후드카날', 'hoodcanal'] },
  { canonicalName: 'NZ Blooms', country: '뉴질랜드', aliases: ['엔제이블룸', '엔제이블룸스', 'nzbloom', 'nzblooms'] },
  { canonicalName: 'Aviv Flower', country: '이스라엘', aliases: ['아비브', 'aviv', 'avivflower'] },
];

const GENERIC_COUNTRY_FARM_CODES = new Set(['col', 'nl', 'th', 'et', 'au', 'us', 'ecu', 'chn', 'cn', 'vn', 'jp', 'nz', 'il']);
const CL_CODE_NOT_FARM_RE = /^(?!(?:CLOUD|CLOUDLAND)\b)[A-Z]{0,3}CL(?:[-_]?\d+[A-Z0-9_-]*|[A-Z]{1,2})$/i;
const DUMMY_OR_AWB_FARM_RE = /^(?:DDDD|ＱＱＱＱ|QQQQ|.*AWB)$/i;

// 품목군 단독 → 기본 수입국 (DB Product + 실발주 이력과 결합되는 안전 기본선)
const DEFAULT_GROUP_TO_COUNTRY = new Map([
  ['수국', '콜롬비아'],
  ['장미', '콜롬비아'],
  ['카네이션', '콜롬비아'],
  ['알스트로', '콜롬비아'],
  ['루스커스', '콜롬비아'],
  ['스키미아', '네덜란드'],
  ['히야신스', '네덜란드'],
  ['튤립', '네덜란드'],
  ['아스틸베', '네덜란드'],
  ['안시리움', '네덜란드'],
  ['카라', '네덜란드'],
  ['아스트란시아', '네덜란드'],
  ['아가판서스', '네덜란드'],
  ['레우코취', '네덜란드'],
  ['클레마티스', '네덜란드'],
  ['수선화', '네덜란드'],
  ['네리네', '네덜란드'],
  ['아이리스', '네덜란드'],
  ['헬레보루스', '네덜란드'],
  ['덴파레', '태국'],
  ['모카라', '태국'],
  ['아란', '태국'],
  ['더글라스', '미국'],
  ['펀', '호주'],
  ['부쉬', '호주'],
  ['작약', '뉴질랜드'],
  ['스위트피', '일본'],
  ['안개', '에콰도르'],
  ['호접', '중국'],
  ['리모늄', '중국'],
  ['디디스커스', '중국'],
  ['오니소갈룸', '중국'],
  ['라넌큘러스', '중국'],
  ['스카비오사', '중국'],
  ['마트리카리아', '중국'],
]);

// DB 품종/별칭 빠른 보강 사전 (한영 표기 차이를 메워 DB Product 매칭 정확도를 극대화)
const CURATED_VARIETY_HINTS = [
  { tokens: ['볼오브크림', 'bowlofcream', 'bowlfocream'], country: '뉴질랜드', group: '작약' },
  { tokens: ['코랄선셋', 'coralsunset', 'coralsunet'], country: '뉴질랜드', group: '작약' },
  { tokens: ['사라번하트', '사하라번하트', 'sarahbernhardt', 'saharabernhardt', 'sarabernhardt'], country: '뉴질랜드', group: '작약' },
  { tokens: ['레드참', 'redcharm'], country: '뉴질랜드', group: '작약' },
  { tokens: ['마담클로드테인', 'madamecludetain', 'madamclaudetain', 'madameclaudetain'], country: '뉴질랜드', group: '작약' },
  { tokens: ['줄링', '쥬링', 'juling'], country: '태국', group: '아란' },
  { tokens: ['아지마', 'azima', 'azimah'], country: '태국', group: '아란' },
  { tokens: ['진다스윗', '진다스위트', '진다스윗트', 'jindasweet', 'bluechidchom', '블루치드촘'], country: '태국', group: '덴파레' },
  { tokens: ['살라야', 'salaya', 'boonlong'], country: '태국', group: '모카라' },
  { tokens: ['더글라스', 'douglas', 'douglasfir'], country: '미국', group: '상록수' },
  { tokens: ['딩고펀', 'dingofern', '코알라펀', 'koalafern', '엄브렐라펀', '엄브렐러펀', 'umbrellafern', '씨스타펀', '시스타펀', 'seastarfern', '레인보우펀', 'rainbowfern', '스타펀', 'starfern'], country: '호주', group: '펀' },
  { tokens: ['울리부쉬', 'woollybush', 'wollybush', '반커부쉬', '바커부쉬', '뱅커부쉬', 'bankerbush', 'bunkerbush', '구아나클로우', '고아나클로우', 'goannaclaw', '쿠퍼글로우', '코퍼글로우', 'copperglow', '스모크부쉬', 'smokebush', '사파이어부쉬', 'sapphirebush', '스틸그라스', 'steelgrass', '에뮤페더', 'emufeather', '에뮤그라스', 'emugrass', 'stirlingia'], country: '호주', group: '부쉬' },
  { tokens: ['오데사', '오데사블랙', 'odessa', 'odessablack'], country: '네덜란드', group: '카라' },
  { tokens: ['그라시오사', 'graciosa', 'gracioasa', 'terrasol', '테라솔', 'jesolo'], country: '네덜란드', group: '안시리움' },
  { tokens: ['루벨라', 'rubella', 'kewgreen', 'confkewgergreen'], country: '네덜란드', group: '스키미아' },
  { tokens: ['델프트블루', 'delftblue', 'polargiant', '폴라자이언트', 'fondant', 'skyjacket'], country: '네덜란드', group: '히야신스' },
  { tokens: ['리버스타', 'liberstar', 'liberster', 'antarctica', '안타티카', 'dynasty', '다이너스티', 'royalvirgin', 'royalvirgen', '로얄버진', 'kantika', 'katinka', 'foxtrot', 'adrem'], country: '네덜란드', group: '튤립' },
  { tokens: ['유로파', 'europa', 'washingtonwhite', 'paulgaarder'], country: '네덜란드', group: '아스틸베' },
  { tokens: ['빌리언스타', 'billionstar', 'billionstars', 'starofafrica'], country: '네덜란드', group: '아스트란시아' },
  { tokens: ['weigelia', 'leucothoe', 'agapanthus', 'eyfori'], country: '네덜란드', group: '기타' },
  { tokens: ['시네신스', 'sinensis'], country: '중국', group: '리모늄' },
  { tokens: ['시네리아', '유칼리튭스시네리아', '유킬립툽스시네리아', 'cinerea'], country: '중국', group: '기타' },
  { tokens: ['안슬레이', 'annesley', '블랙뷰티', 'blackbeauty', '블랙잭', 'blackjack', '카푸치노', 'cappuccino', '솔로미오', 'solomio'], country: '중국', group: '장미' },
  { tokens: ['오니소갈룸', '오니소칼륨', 'ornithogalum', 'onisogalum', '코치아', 'kochia'], country: '중국', group: '오니소갈룸' },
  { tokens: ['디디스커스', 'didiscus'], country: '중국', group: '디디스커스' },
  { tokens: ['미디오', 'midio'], country: '중국', group: '기타' },
  { tokens: ['엑셀런트', 'xlence', 'x-lence', '밀리언스타', 'millionstar'], country: '에콰도르', group: '안개' },
  { tokens: ['레드팬서', '레드펜서', 'redpanther', '플라야블랑카', 'playablanca', '스노우플레이크', 'snowflake', '퀵샌드', 'quicksand', '하츠', 'hearts', 'harts', '몬디알', '핑크몬디알', 'mondial', '익스플로러', 'explorer', '프리덤', 'freedom', '쉬머', 'shimmer', '아틀라스', 'atlas', '스위트비트', '아키토', 'akito'], country: '콜롬비아', group: '장미' },
  { tokens: ['카라멜', 'caramel', '돈셀', '돈설', 'doncel', '문라이트', 'moonlight', '노비아', 'novia', '폴림니아', 'polimnia', 'polimia', '지오지아', 'giogia', '카오리', 'kaori', '마루치', 'maruchi', '로다스', '로다스크림', 'rodas', '유카리', 'yukari', '쥬리고', 'zurigo', '체리오', 'cherrio', '마제스타', 'majesta', '로얄다마스커스', 'royaldamascus', '비제', 'bizet', '메건', 'megan', '프라도민트', 'pradomint', '레게핑크', '애플티', 'appletea', '고블린', 'goblin', '엠마', 'emma'], country: '콜롬비아', group: '카네이션' },
  { tokens: ['버건디', 'burgundy', '앤틱', '엔틱', '로즈우드', 'rosewood'], country: '콜롬비아', group: '수국' },
  { tokens: ['두바이', 'dubai', '휘슬러', 'whistler', '피피', 'fifi'], country: '콜롬비아', group: '알스트로' },
];

const GENERIC_VARIETY_STOP_TOKENS = new Set([
  '화이트', '레드', '핑크', '옐로우', '그린', '블루', '퍼플', '오렌지', '피치', '크림',
  '연핑크', '진핑크', '핫핑크', '라이트핑크', '다크핑크', '연그린', '진그린', '연보라', '진보라',
  '바이올렛', '라벤더', '블랙', '브라운', '실버', '골드', '믹스', '혼합', '단색', '복색',
  '흰색', '적색', '분홍', '노랑', '자주색', '보라', '주황',
  'white', 'red', 'pink', 'yellow', 'green', 'blue', 'purple', 'orange', 'peach', 'cream',
  'light', 'dark', 'hot', 'soft', 'deep', 'bright', 'pale', 'pastel', 'bicolor',
  'violet', 'lavender', 'black', 'brown', 'silver', 'gold', 'mix', 'mixed', 'assorted',
  'mini', 'big', 'jumbo', 'large', 'medium', 'small', 'short', 'long',
  'select', 'fancy', 'standard', 'std', 'premium', 'super', 'extra', 'grade',
  'xl', 'xxl', 'xxxl', '2l', '3l', '미니', '대륜', '중륜', '소륜', '특상', '특', '상', '보통',
]);

const varietyCompactKey = (value) =>
  clean(value)
    .toLowerCase()
    .replace(/\b(?:\d{2,3}(?:\s*[~-]\s*\d{2,3})?\s*cm|\d+\s*g|select|fancy|standard|std|premium|extra|super|aaa|aa|xl|2l|3l|ll|xxxl|xxl)\b/gi, ' ')
    .replace(/(?:\s+|\()(?:l|m|s)(?=$|[\s/)\]])/gi, ' ')
    .replace(/\([^()]*\)|\[[^[\]]*\]/g, ' ')
    .replace(/([가-힣]{2,})(?:은|는)(?=\s|$)/g, '$1')
    .replace(/[^0-9a-z가-힣]/g, '');

function inferBotanicalOrchidGroup(prodName = '', country = '') {
  const s = clean(prodName);
  if (!s) return '';
  if (/^(?:den\.?\b|dendrobium\b)/i.test(s)) return '덴파레';
  if (/^(?:aran\.?\b|aranthera\b)/i.test(s)) return '아란';
  if (/^(?:mok\.?\b|mokara\b)/i.test(s)) return '모카라';
  if (country === '태국' && /\bvanda\b/i.test(s)) return '모카라';
  return '';
}

const KO_PHONETIC_STEM_ENTRIES = [
  ['화이트', ['white']],
  ['옐로우', ['yellow']],
  ['옐로', ['yellow']],
  ['라이트', ['light']],
  ['스위트', ['sweet']],
  ['스윗', ['sweet']],
  ['프린세스', ['princess']],
  ['프린스', ['prince']],
  ['다이아몬드', ['diamond']],
  ['다이아', ['diamond']],
  ['크리스탈', ['crystal']],
  ['블라썸', ['blossom']],
  ['블로썸', ['blossom']],
  ['레인보우', ['rainbow']],
  ['파라다이스', ['paradise']],
  ['자이언트', ['giant']],
  ['버건디', ['burgundy']],
  ['라벤더', ['lavender']],
  ['바이올렛', ['violet']],
  ['오렌지', ['orange']],
  ['실버', ['silver']],
  ['골든', ['golden']],
  ['골드', ['gold']],
  ['브라운', ['brown']],
  ['퍼플', ['purple']],
  ['블랙', ['black']],
  ['그린', ['green']],
  ['블루', ['blue']],
  ['핑크', ['pink']],
  ['레드', ['red']],
  ['피치', ['peach']],
  ['크림', ['cream']],
  ['코랄', ['coral']],
  ['다크', ['dark']],
  ['스노우', ['snow']],
  ['아이스', ['ice']],
  ['파이어', ['fire']],
  ['드림', ['dream']],
  ['뷰티', ['beauty']],
  ['매직', ['magic']],
  ['샤인', ['shine']],
  ['글로우', ['glow']],
  ['로얄', ['royal']],
  ['로열', ['royal']],
  ['벨벳', ['velvet']],
  ['실크', ['silk']],
  ['캔디', ['candy']],
  ['허니', ['honey']],
  ['슈가', ['sugar']],
  ['베이비', ['baby']],
  ['레이디', ['lady']],
  ['미스', ['miss']],
  ['미니', ['mini']],
  ['점보', ['jumbo']],
  ['스프링', ['spring']],
  ['썸머', ['summer']],
  ['서머', ['summer']],
  ['어텀', ['autumn']],
  ['윈터', ['winter']],
  ['클라우드', ['cloud']],
  ['스카이', ['sky']],
  ['판타지', ['fantasy']],
  ['글로리', ['glory']],
  ['그레이스', ['grace']],
  ['스마일', ['smile']],
  ['엔젤', ['angel']],
  ['베리', ['berry']],
  ['체리', ['cherry']],
  ['레몬', ['lemon']],
  ['라임', ['lime']],
  ['애플', ['apple']],
  ['로즈', ['rose']],
  ['릴리', ['lily']],
  ['립스', ['lips']],
  ['러브', ['love']],
  ['하트', ['heart']],
  ['스타', ['star']],
  ['터치', ['touch']],
  ['키스', ['kiss']],
  ['위시', ['wish']],
  ['조이', ['joy']],
  ['피스', ['peace']],
  ['댄스', ['dance']],
  ['웨이브', ['wave']],
  ['레인', ['rain']],
  ['레이', ['ray']],
  ['붐', ['boom', 'bom']],
  ['퀸', ['queen']],
  ['킹', ['king']],
  ['벨', ['bell', 'belle']],
  ['볼', ['ball']],
  ['문', ['moon']],
  ['썬', ['sun']],
  ['선', ['sun']],
  ['펄', ['pearl']],
  ['참', ['charm']],
  ['송', ['song']],
  ['핫', ['hot']],
].sort((a, b) => b[0].length - a[0].length);

export function expandKoreanPhoneticKeys(rawText) {
  const compoundKeys = new Set();
  const stemTokens = new Set();
  const colorEnTokens = new Set();
  const cleaned = clean(rawText)
    .replace(/\b(?:\d{2,3}(?:\s*[~-]\s*\d{2,3})?\s*cm|\d+\s*g|select|fancy|standard|std|premium|extra|super|aaa|aa|xl|2l|3l|ll|xxxl|xxl)\b/gi, ' ')
    .replace(/(?:\s+|\()(?:l|m|s)(?=$|[\s/)\]])/gi, ' ')
    .trim();
  if (!cleaned) return { compoundKeys: [], stemTokens: [], colorEnTokens: [] };

  const words = cleaned.split(/[\s/()[\]·,._-]+/).filter(Boolean);
  const perWordAlts = [];
  let allWordsSegmented = words.length > 0;

  for (const word of words) {
    if (/^[A-Za-z0-9]+$/.test(word)) {
      const lw = word.toLowerCase();
      perWordAlts.push([lw]);
      if (!GENERIC_VARIETY_STOP_TOKENS.has(lw) && lw.length >= 2) stemTokens.add(lw);
      continue;
    }
    const hangulOnly = word.replace(/[^가-힣]/g, '');
    if (!hangulOnly) {
      allWordsSegmented = false;
      continue;
    }
    let pos = 0;
    const segments = [];
    while (pos < hangulOnly.length) {
      const slice = hangulOnly.slice(pos);
      const hit = KO_PHONETIC_STEM_ENTRIES.find(([ko]) => slice.startsWith(ko));
      if (!hit) {
        segments.length = 0;
        break;
      }
      segments.push(hit);
      pos += hit[0].length;
    }
    if (!segments.length) {
      allWordsSegmented = false;
      continue;
    }
    let wordCombos = [''];
    for (const [koStem, enAlts] of segments) {
      if (KO_COLOR_TO_EN.has(koStem)) colorEnTokens.add(KO_COLOR_TO_EN.get(koStem));
      for (const alt of enAlts) {
        if (!GENERIC_VARIETY_STOP_TOKENS.has(alt) && alt.length >= 2) {
          stemTokens.add(alt);
        }
      }
      const nextCombos = [];
      for (const prefix of wordCombos) {
        for (const alt of enAlts) {
          if (nextCombos.length < 12) nextCombos.push(prefix + alt);
        }
      }
      wordCombos = nextCombos;
    }
    if (segments.length >= 2) {
      for (const c of wordCombos) {
        if (c.length >= 3 && !GENERIC_VARIETY_STOP_TOKENS.has(c)) compoundKeys.add(c);
      }
    }
    perWordAlts.push(wordCombos);
  }

  if (allWordsSegmented && perWordAlts.length >= 1) {
    let fullCombos = [''];
    for (const alts of perWordAlts) {
      const next = [];
      for (const p of fullCombos) {
        for (const a of alts) {
          if (next.length < 16) next.push(p + a);
        }
      }
      fullCombos = next;
    }
    for (const fc of fullCombos) {
      if (fc.length >= 4 && !GENERIC_VARIETY_STOP_TOKENS.has(fc)) compoundKeys.add(fc);
    }
  }

  return {
    compoundKeys: [...compoundKeys],
    stemTokens: [...stemTokens],
    colorEnTokens: [...colorEnTokens],
  };
}

function cleanProductVarietyCandidates(prod = {}, country = '', group = '') {
  const out = new Set();
  const rawFlower = clean(prod.FlowerName || '');
  const extraFlowerCandidate = rawFlower && rawFlower !== '기타' && fold(rawFlower) !== fold(group) ? rawFlower : '';
  for (const rawText of [prod.ProdName, prod.DisplayName || getDisplayName(prod), extraFlowerCandidate]) {
    const s = clean(rawText);
    if (!s) continue;
    // Strip leading country/flower prefixes like "Peony / New Zealand. ", "ARAN.", "Den.", "ROSE / "
    let stripped = s
      .replace(/^[A-Za-z가-힣 .]+\s*\/\s*(?:New\s*Zealand\.?\s*|CHINA\s*|VIETNAM\s*)?/i, '')
      .replace(/^(?:ARAN\.?|DEN\.?|DENDROBIUM|MOK\.?|MOKARA|VANDA|HYDRANGEA|CARNATION|ROSE|SPRAY\s+ROSE|ALSTROEMERIA|ALSTROMERIA|TULIP|PEONY|ANTHURIUM|SKIMMIA|ASTILBE|HYACINTHUS)\s*/i, '')
      .trim();
    for (let pass = 0; pass < 2; pass += 1) {
      stripped = stripped.replace(new RegExp(`^(?:${country || '(?!)'}|${group || '(?!)'})\\s+`, 'i'), '').trim();
    }
    for (const v of [stripped, s]) {
      const k = varietyCompactKey(v);
      if (k.length >= 2 && !/^\d+$/.test(k) && !GENERIC_VARIETY_STOP_TOKENS.has(k)) out.add(k);
      const phon = expandKoreanPhoneticKeys(v);
      for (const ck of phon.compoundKeys) out.add(ck);
    }
    for (const tok of tokenizeForMatch(stripped)) {
      if (tok.length >= 2 && tok !== fold(country) && tok !== fold(group)) {
        const tk = tok.replace(/[^0-9a-z가-힣]/g, '');
        if (tk.length >= 2 && !GENERIC_VARIETY_STOP_TOKENS.has(tk)) out.add(tk);
        const en = getEnglishOf(tok);
        if (en) {
          const ek = en.replace(/[^0-9a-z가-힣]/g, '');
          if (ek.length >= 2 && !GENERIC_VARIETY_STOP_TOKENS.has(ek)) out.add(ek);
        }
      }
    }
  }
  return [...out].filter((k) => k.length >= 2 && !GENERIC_VARIETY_STOP_TOKENS.has(k));
}

function cleanEnglishDbProductName(rawProdName) {
  const raw = clean(rawProdName);
  if (!raw || !/[A-Za-z]{2}/.test(raw)) return '';
  let out = raw
    // Remove parenthetical annotations that contain Korean (e.g. "Hydrangea Burgundy (버건디)")
    .replace(/\s*\([^()]*[가-힣][^()]*\)/g, ' ')
    // Unwrap pure-Latin parentheticals left after Korean label removal (e.g. "화이트 (Rosita 3 Type white)" -> "Rosita 3 Type white")
    .replace(/[가-힣][가-힣0-9\s·_-]*\(\s*([A-Za-z0-9][A-Za-z0-9\s./_-]*)\s*\)/g, ' $1 ')
    // Remove standalone Korean words when English cultivar text already exists
    .replace(/[가-힣]+/g, ' ')
    .replace(/\(\s*\)|\[\s*\]/g, ' ')
    .replace(/\s*\/\s*\/\s*/g, ' / ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s/·\-.,]+|[\s/·\-,]+$/g, '')
    .trim();
  return /[A-Za-z]{2}/.test(out) ? out : '';
}

function extractLengthCmToken(text) {
  const m = String(text || '').match(/(?:^|[\s/(\[])(\d{2,3}(?:\s*[~-]\s*\d{2,3})?)\s*cm(?=$|[\s/)\]])/i);
  return m ? `${m[1].replace(/\s+/g, '')}cm`.toLowerCase() : '';
}

function extractGradeToken(text) {
  const m = String(text || '').match(/(?:^|[\s/(\[])(AAA|AA|XXXL|XXL|XL|2L|3L|LL|Select|Fancy|Standard|Super|Premium|Extra|L|M|S)(?=$|[\s/)\]])/i);
  return m ? m[1].toUpperCase() : '';
}

const SIZE_GRADE_TOKENS = new Set(['S', 'M', 'L', 'LL', 'XL', 'XXL', 'XXXL', '2L', '3L']);

const KO_COLOR_TO_EN = new Map([
  ['화이트', 'white'], ['흰색', 'white'],
  ['레드', 'red'], ['적색', 'red'],
  ['핑크', 'pink'], ['분홍', 'pink'], ['연핑크', 'light pink'], ['진핑크', 'dark pink'],
  ['옐로우', 'yellow'], ['노랑', 'yellow'],
  ['그린', 'green'], ['연그린', 'light green'], ['진그린', 'dark green'],
  ['블루', 'blue'],
  ['퍼플', 'purple'], ['보라', 'purple'],
  ['오렌지', 'orange'], ['주황', 'orange'],
  ['피치', 'peach'],
  ['크림', 'cream'],
  ['버건디', 'burgundy'],
  ['골드', 'gold'],
]);

const KO_EN_VARIETY_SYNONYM_GROUPS = [
  ['볼오브크림', 'bowlofcream', 'bowlfocream'],
  ['코랄선셋', 'coralsunset', 'coralsunet'],
  ['사라번하트', '사하라번하트', 'sarahbernhardt', 'saharabernhardt', 'sarabernhardt'],
  ['레드참', 'redcharm'],
  ['마담클로드테인', 'madamecludetain', 'madamclaudetain', 'madameclaudetain'],
  ['줄링', '쥬링', 'juling'],
  ['아지마', 'azima', 'azimah'],
  ['진다스윗', '진다스위트', '진다스윗트', 'jindasweet'],
  ['살라야', 'salaya'],
  ['더글라스', 'douglas', 'douglasfir'],
  ['딩고펀', 'dingofern'],
  ['코알라펀', 'koalafern'],
  ['엄브렐라펀', '엄브렐러펀', 'umbrellafern'],
  ['씨스타펀', '시스타펀', 'seastarfern'],
  ['레인보우펀', 'rainbowfern'],
  ['울리부쉬', 'woollybush', 'wollybush'],
  ['반커부쉬', '바커부쉬', '뱅커부쉬', 'bankerbush', 'bunkerbush'],
  ['구아나클로우', '고아나클로우', 'goannaclaw'],
  ['쿠퍼글로우', '코퍼글로우', 'copperglow'],
  ['오데사', 'odessa'],
  ['오데사블랙', 'odessablack'],
  ['그라시오사', 'graciosa', 'gracioasa'],
  ['테라솔', 'terrasol'],
  ['루벨라', 'rubella'],
  ['델프트블루', 'delftblue'],
  ['폴라자이언트', 'polargiant'],
  ['리버스타', 'liberstar', 'liberster'],
  ['안타티카', 'antarctica'],
  ['다이너스티', 'dynasty'],
  ['로얄버진', 'royalvirgin', 'royalvirgen'],
  ['유로파', 'europa'],
  ['빌리언스타', 'billionstar', 'billionstars'],
  ['시네신스', 'sinensis'],
  ['시네리아', 'cinerea'],
  ['안슬레이', 'annesley'],
  ['블랙뷰티', 'blackbeauty'],
  ['블랙잭', 'blackjack'],
  ['카푸치노', 'cappuccino'],
  ['솔로미오', 'solomio'],
  ['오니소갈룸', '오니소칼륨', 'ornithogalum', 'onisogalum'],
  ['디디스커스', 'didiscus'],
  ['미디오', 'midio'],
  ['엑셀런트', 'xlence', 'xlence'],
  ['밀리언스타', 'millionstar'],
  ['레드팬서', '레드펜서', 'redpanther'],
  ['플라야블랑카', 'playablanca'],
  ['스노우플레이크', 'snowflake'],
  ['퀵샌드', 'quicksand'],
  ['하츠', 'hearts', 'harts'],
  ['몬디알', 'mondial'],
  ['핑크몬디알', 'pinkmondial'],
  ['익스플로러', 'explorer'],
  ['프리덤', 'freedom'],
  ['쉬머', 'shimmer'],
  ['아틀라스', 'atlas'],
  ['아키토', 'akito'],
  ['카라멜', 'caramel'],
  ['돈셀', '돈설', 'doncel'],
  ['문라이트', 'moonlight'],
  ['노비아', 'novia'],
  ['폴림니아', 'polimnia', 'polimia'],
  ['지오지아', 'giogia'],
  ['카오리', 'kaori'],
  ['마루치', 'maruchi'],
  ['로다스', 'rodas'],
  ['유카리', 'yukari'],
  ['쥬리고', 'zurigo'],
  ['체리오', 'cherrio'],
  ['마제스타', 'majesta'],
  ['로얄다마스커스', 'royaldamascus'],
  ['비제', 'bizet'],
  ['메건', 'megan'],
  ['프라도민트', 'pradomint'],
  ['애플티', 'appletea'],
  ['고블린', 'goblin'],
  ['엠마', 'emma'],
  ['로지타', 'rosita'],
  ['버건디', 'burgundy'],
  ['로즈우드', 'rosewood'],
  ['두바이', 'dubai'],
  ['휘슬러', 'whistler'],
  ['피피', 'fifi'],
  ['니나', 'nina'],
  ['캔들라이트', 'candlelight'],
  ['아망떼', '아만테', 'amante'],
  ['바벨론', 'babylon'],
  ['아발란체', 'avalanche'],
  ['피치아발란체', 'peachavalanche'],
];

const VARIETY_SYNONYM_MAP = (() => {
  const map = new Map();
  for (const grp of KO_EN_VARIETY_SYNONYM_GROUPS) {
    const norm = grp.map(s => s.toLowerCase().replace(/[^0-9a-z가-힣]/g, '')).filter(Boolean);
    for (const k of norm) {
      if (!map.has(k)) map.set(k, new Set());
      for (const peer of norm) map.get(k).add(peer);
    }
  }
  return map;
})();

const THAI_ORCHID_GROUPS = new Set(['덴파레', '아란', '모카라']);

export function buildImportKakaoDbCatalog({ farms = [], warehouseFarms = [], products = [] } = {}) {
  const canonicalFarmsByKey = new Map(); // lookupKey -> Array<{ farmKey, farmName, farmCode, country, priority }>
  const knownFarmsList = [];
  const seenCanonicalNames = new Set();

  const registerFarm = ({ farmKey = null, farmName, farmCode = '', country = '', aliases = [], priority = 1 }) => {
    const name = clean(farmName);
    if (!name || DUMMY_OR_AWB_FARM_RE.test(name)) return;
    const baseKey = dbFarmLookupKey(name);
    const resolvedCountry = normalizeCatalogCountry(country) || DB_FARM_FALLBACK_COUNTRIES.get(baseKey) || '';
    const entry = {
      FarmKey: farmKey ? Number(farmKey) : null,
      FarmName: name,
      FarmCode: clean(farmCode),
      CounName: resolvedCountry,
      priority,
    };

    const nameDedupKey = `${fold(name)}|${resolvedCountry}`;
    if (!seenCanonicalNames.has(nameDedupKey)) {
      seenCanonicalNames.add(nameDedupKey);
      knownFarmsList.push(entry);
    }

    const keysToIndex = new Set([baseKey, fold(name).replace(/[^0-9a-z가-힣]/g, '')]);
    const codeClean = fold(farmCode).replace(/[^0-9a-z가-힣]/g, '');
    if (codeClean.length >= 3 && !GENERIC_COUNTRY_FARM_CODES.has(codeClean)) {
      keysToIndex.add(codeClean);
    }
    for (const al of aliases) {
      const ak = dbFarmLookupKey(al);
      if (ak) keysToIndex.add(ak);
      const rawAk = fold(al).replace(/[^0-9a-z가-힣]/g, '');
      if (rawAk) keysToIndex.add(rawAk);
    }

    for (const k of keysToIndex) {
      if (!k) continue;
      if (!canonicalFarmsByKey.has(k)) canonicalFarmsByKey.set(k, []);
      const bucket = canonicalFarmsByKey.get(k);
      const existing = bucket.find((b) => fold(b.FarmName) === fold(entry.FarmName) && b.CounName === entry.CounName);
      if (existing) {
        if (entry.FarmKey && !existing.FarmKey) existing.FarmKey = entry.FarmKey;
        if (entry.priority > existing.priority) existing.priority = entry.priority;
      } else {
        bucket.push({ ...entry });
      }
      bucket.sort((a, b) => b.priority - a.priority || Number(Boolean(b.FarmKey)) - Number(Boolean(a.FarmKey)));
    }
  };

  // 1) MSSQL dbo.Farm 정식 마스터 우선 적재 (CounName 있는 정식 레코드 가중치 우위)
  const dbFarmByNormName = new Map();
  for (const f of farms || []) {
    const rawName = clean(f.FarmName || f.name || '');
    if (!rawName || DUMMY_OR_AWB_FARM_RE.test(rawName)) continue;
    const country = normalizeCatalogCountry(f.CounName || f.country || '');
    // 중복 ELITE(CounName=null) vs The Elite Flowers(콜롬비아) 등 정리
    if (!country && /^(?:ELITE|AGUA CLARA|UNIQUE)$/i.test(rawName)) continue;
    const priority = country ? 100 : 60;
    registerFarm({
      farmKey: f.FarmKey || null,
      farmName: rawName,
      farmCode: f.FarmCode || f.code || '',
      country,
      priority,
    });
    dbFarmByNormName.set(dbFarmLookupKey(rawName), {
      farmKey: f.FarmKey || null,
      farmName: rawName,
      farmCode: f.FarmCode || '',
      country: country || DB_FARM_FALLBACK_COUNTRIES.get(dbFarmLookupKey(rawName)) || '',
    });
  }

  // 2) 검증된 한글/약칭 별칭을 DB 정식 레코드(있으면 해당 FarmKey·FarmName 그대로!)에 연결
  for (const spec of KOREAN_AND_ABBR_FARM_ALIASES) {
    const dbHit = dbFarmByNormName.get(dbFarmLookupKey(spec.canonicalName));
    registerFarm({
      farmKey: dbHit?.farmKey || null,
      farmName: dbHit?.farmName || spec.canonicalName,
      farmCode: dbHit?.farmCode || '',
      country: dbHit?.country || spec.country,
      aliases: [spec.canonicalName, ...spec.aliases],
      priority: dbHit ? 110 : 85,
    });
  }

  // 3) WarehouseMaster 실입고 농장 보강 (이미 등록된 정식 농장은 덮어쓰지 않고 미등록 실입고 산지만 추가)
  for (const wf of warehouseFarms || []) {
    const wfName = clean(wf.FarmName || '');
    const wfCountry = normalizeCatalogCountry(wf.CounName || '');
    if (!wfName || !wfCountry || DUMMY_OR_AWB_FARM_RE.test(wfName)) continue;
    const lk = dbFarmLookupKey(wfName);
    if (!lk || canonicalFarmsByKey.has(lk)) continue;
    registerFarm({
      farmKey: null,
      farmName: wfName,
      country: wfCountry,
      priority: 50,
    });
  }

  // 4) Product 마스터 + 실발주 이력 기반 품종/품목군 → 국가·품목군·영문품목명 학습 인덱스
  const varietyStats = new Map(); // key -> Map<`${country}|${group}`, weight>
  const groupCountryStats = new Map(); // group -> Map<country, weight>
  const knownVarietyKeys = new Set();
  const productsByKey = new Map(); // key -> Array<ProductCandidate>
  const productsByCountryGroup = new Map(); // `${country}|${group}` -> Array<ProductCandidate>
  const searchableProducts = [];

  const addVarietyWeight = (vKey, country, group, weight) => {
    if (!vKey || !country) return;
    knownVarietyKeys.add(vKey);
    if (!varietyStats.has(vKey)) varietyStats.set(vKey, new Map());
    const bucket = varietyStats.get(vKey);
    const cg = `${country}|${group || ''}`;
    bucket.set(cg, (bucket.get(cg) || 0) + weight);
  };

  const addProductIndex = (idxKey, candidate) => {
    if (!idxKey) return;
    if (!productsByKey.has(idxKey)) productsByKey.set(idxKey, []);
    productsByKey.get(idxKey).push(candidate);
  };

  for (const [grp, cntry] of DEFAULT_GROUP_TO_COUNTRY.entries()) {
    groupCountryStats.set(grp, new Map([[cntry, 50]]));
  }

  for (const hint of CURATED_VARIETY_HINTS) {
    for (const tok of hint.tokens) {
      const k = tok.toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
      addVarietyWeight(k, hint.country, hint.group, 500);
    }
  }

  for (const p of products || []) {
    const prodName = clean(p.ProdName || '');
    if (!prodName || /운송료|박스비|수수료|통관비|할인|차감|사용\s*금지|사용\s*중지|단종/.test(`${prodName} ${p.DisplayName || ''}`)) {
      continue;
    }
    const country = normalizeCatalogCountry(p.CounName);
    if (!country) continue;
    const rawFlower = clean(p.FlowerName || '');
    const rawProdGroup = clean(p.ProdGroup || '');
    const flowerIsCanonical = Boolean(rawFlower && CANONICAL_FLOWER_GROUPS.has(fold(rawFlower)));
    const prodGroupCanonical = rawProdGroup && CANONICAL_FLOWER_GROUPS.has(fold(rawProdGroup))
      ? normalizeCatalogFlowerGroup(rawProdGroup)
      : '';
    const botanicalGroup = inferBotanicalOrchidGroup(prodName, country);
    const group = flowerIsCanonical
      ? normalizeCatalogFlowerGroup(rawFlower)
      : (prodGroupCanonical || botanicalGroup || normalizeCatalogFlowerGroup(rawFlower || rawProdGroup));
    const isCustomFlowerGroup = Boolean(rawFlower && !flowerIsCanonical && !prodGroupCanonical && !botanicalGroup);
    const seasonOrders = Number(p.RecentSeasonOrders || 0);
    const recentOrders = Number(p.RecentOrders || 0);
    const totalOrders = Number(p.TotalOrders || 0);
    const weight = 1 + seasonOrders * 25 + recentOrders * 4 + Math.min(totalOrders, 40);

    if (group && group !== '기타' && !isCustomFlowerGroup) {
      if (!groupCountryStats.has(group)) groupCountryStats.set(group, new Map());
      const gm = groupCountryStats.get(group);
      gm.set(country, (gm.get(country) || 0) + weight);
    }

    const vKeys = cleanProductVarietyCandidates(p, country, group);
    for (const vKey of vKeys) {
      addVarietyWeight(vKey, country, isCustomFlowerGroup ? '' : group, weight);
    }

    const englishName = cleanEnglishDbProductName(prodName);
    const displayName = clean(p.DisplayName || getDisplayName(p) || '');
    const prodCode = clean(p.ProdCode || '');
    searchableProducts.push({
      prodKey: p.ProdKey ? Number(p.ProdKey) : null,
      prodCode,
      prodName,
      englishName: englishName || prodName,
      hasPureEnglish: Boolean(englishName),
      displayName,
      flowerName: rawFlower,
      country,
      group: isCustomFlowerGroup ? '' : group,
      lengthCm: extractLengthCmToken(prodName),
      gradeUpper: extractGradeToken(prodName),
      weight,
      vKeySet: new Set(vKeys),
      searchBlob: fold(`${prodName} ${englishName} ${displayName} ${rawFlower} ${prodCode} ${country} ${group}`),
    });

    if (englishName) {
      const candidate = {
        prodKey: p.ProdKey ? Number(p.ProdKey) : null,
        prodName,
        englishName,
        englishLower: englishName.toLowerCase(),
        flowerName: rawFlower,
        country,
        group,
        isCustomFlowerGroup,
        lengthCm: extractLengthCmToken(prodName),
        gradeUpper: extractGradeToken(prodName),
        weight,
        vKeySet: new Set(vKeys),
      };
      for (const vKey of vKeys) {
        addProductIndex(vKey, candidate);
      }
      const cgKey = `${country}|${group || ''}`;
      if (!productsByCountryGroup.has(cgKey)) productsByCountryGroup.set(cgKey, []);
      productsByCountryGroup.get(cgKey).push(candidate);
    }
  }

  return {
    isDbCatalog: true,
    knownFarms: knownFarmsList,
    canonicalFarmsByKey,
    varietyStats,
    groupCountryStats,
    knownVarietyKeys,
    productsByKey,
    productsByCountryGroup,
    searchableProducts,
  };
}

export function matchDbFarm(rawFarm, catalog, { hintCountry = '' } = {}) {
  const cleaned = clean(rawFarm)
    .replace(/^[\[【〔<(（■▶▷◆●▣★☆\-·•:：\s]+|[\]】〕>)）\s:：\-]+$/g, '')
    .replace(/^(?:수신\s*)?(?:농장(?:명)?|farm(?:\s*name)?)\s*[:：\-]?\s*/i, '')
    .trim();
  if (!cleaned) return { matched: false, reason: 'empty', farmName: '', country: '', farmKey: null };
  if (CL_CODE_NOT_FARM_RE.test(cleaned)) {
    return { matched: false, reason: 'cl_code', raw: cleaned, farmName: '', country: '', farmKey: null };
  }
  if (/^(?:지정\s*농장|특정\s*농장|xx\s*농장|좋은\s*농장|가능한\s*농장|아무\s*농장|추천\s*농장|미상|미지정|없음|-)$/i.test(cleaned)) {
    return { matched: false, reason: 'generic_note', raw: cleaned, farmName: '', country: '', farmKey: null };
  }
  if (/^\d+\s*(?:박스|단|송이|스팀|스템|cm|g|kg|st|b)$/i.test(cleaned)) {
    return { matched: false, reason: 'spec_or_qty', raw: cleaned, farmName: '', country: '', farmKey: null };
  }

  if (!catalog?.canonicalFarmsByKey) {
    return { matched: false, reason: 'no_catalog', raw: cleaned, farmName: '', country: '', farmKey: null };
  }

  const lk = dbFarmLookupKey(cleaned);
  const rawCompact = fold(cleaned).replace(/(?:농장|farms?)$/i, '').replace(/[^0-9a-z가-힣]/g, '');
  const candidates = catalog.canonicalFarmsByKey.get(lk) || catalog.canonicalFarmsByKey.get(rawCompact) || null;

  if (candidates && candidates.length > 0) {
    const normHint = normalizeCatalogCountry(hintCountry);
    const exactNameHit = candidates.find((c) => fold(c.FarmName) === fold(cleaned) && (!normHint || !c.CounName || c.CounName === normHint));
    const picked = exactNameHit || (normHint && candidates.find((c) => c.CounName === normHint)) || candidates[0];
    return {
      matched: true,
      farmKey: picked.FarmKey,
      farmName: picked.FarmName,
      country: picked.CounName || '',
    };
  }

  // 접두 일치 (4글자 이상 고유 농장명 예: "플로렌티" -> Florentina, "프리미엄그린" -> Premium Greens)
  if (lk.length >= 4) {
    for (const [indexedKey, bucket] of catalog.canonicalFarmsByKey.entries()) {
      if (indexedKey.length >= 4 && (indexedKey.startsWith(lk) || lk.startsWith(indexedKey))) {
        const picked = bucket[0];
        return {
          matched: true,
          farmKey: picked.FarmKey,
          farmName: picked.FarmName,
          country: picked.CounName || '',
        };
      }
    }
  }

  // 농장이 아니라 DB 품종/품목군명인 경우 판별 (예: "아지마" -> 태국 아란 품종!)
  const vKey = varietyCompactKey(cleaned);
  if (vKey && (catalog.knownVarietyKeys?.has(vKey) || FLOWER_GROUP_SYNONYMS.has(fold(cleaned)))) {
    return { matched: false, reason: 'product_variety', raw: cleaned, farmName: '', country: '', farmKey: null };
  }

  return { matched: false, reason: 'unmatched_farm', raw: cleaned, farmName: '', country: '', farmKey: null };
}

const BOTANICAL_DUTCH_HINTS = /\b(?:agapanthus|leucothoe|weigelia|skimmia|astilbe|anthurium|hyacinthus|tulipa|hippeastrum|amaryllis|viburnum|ilex|helleborus|astrantia|clematis|fritillaria|muscari|nerine)\b/i;

export function inferCountryAndGroupFromDb(item = {}, catalog = null) {
  let country = normalizeCatalogCountry(item.country);
  let group = normalizeCatalogFlowerGroup(item.group);

  if (!catalog?.isDbCatalog) {
    return { country, group, inferredCountry: false, inferredGroup: false };
  }

  const origCountry = country;
  const origGroup = group;

  // 1) DB 농장 → 국가 확정
  if (item.farm) {
    const fm = matchDbFarm(item.farm, catalog, { hintCountry: country });
    if (fm.matched && !country && fm.country) {
      country = fm.country;
    }
  }

  // 2) 품종(baseName / product / 토큰 / 영문 동의어) → DB Product 학습 분포 조회
  const rawProd = clean(item.product || '');
  const baseProd = clean(item.baseName || rawProd);
  const queryKeys = [];
  for (const candidateText of [baseProd, rawProd]) {
    const ck = varietyCompactKey(candidateText);
    if (ck.length >= 2 && !GENERIC_VARIETY_STOP_TOKENS.has(ck)) queryKeys.push({ key: ck, boost: 4 });
    const enFull = getEnglishOf(candidateText);
    if (enFull) {
      const ek = varietyCompactKey(enFull);
      if (ek.length >= 2 && !GENERIC_VARIETY_STOP_TOKENS.has(ek)) queryKeys.push({ key: ek, boost: 3 });
    }
    const phon = expandKoreanPhoneticKeys(candidateText);
    for (const pk of phon.compoundKeys) {
      if (pk.length >= 3 && !GENERIC_VARIETY_STOP_TOKENS.has(pk)) queryKeys.push({ key: pk, boost: 3 });
    }
  }
  for (const tok of tokenizeForMatch(baseProd)) {
    const tk = tok.replace(/[^0-9a-z가-힣]/g, '');
    if (tk.length >= 2 && !GENERIC_VARIETY_STOP_TOKENS.has(tk)) queryKeys.push({ key: tk, boost: 1 });
    const enTok = getEnglishOf(tok);
    if (enTok) {
      const etk = enTok.replace(/[^0-9a-z가-힣]/g, '');
      if (etk.length >= 2 && !GENERIC_VARIETY_STOP_TOKENS.has(etk)) queryKeys.push({ key: etk, boost: 1 });
    }
  }

  const aggregatedScores = new Map(); // `${country}|${group}` -> score
  for (const { key, boost } of queryKeys) {
    const bucket = catalog.varietyStats.get(key);
    if (!bucket) continue;
    for (const [cg, w] of bucket.entries()) {
      const [candCountry, candGroup] = cg.split('|');
      if (country && candCountry !== country) continue;
      if (group && group !== '기타' && candGroup && candGroup !== '기타' && candGroup !== group) continue;
      aggregatedScores.set(cg, (aggregatedScores.get(cg) || 0) + w * boost);
    }
  }

  if (aggregatedScores.size > 0) {
    const ranked = [...aggregatedScores.entries()].sort((a, b) => b[1] - a[1]);
    const [bestCountry, bestGroup] = ranked[0][0].split('|');
    if (!country && bestCountry) country = bestCountry;
    if ((!group || group === '기타') && bestGroup && bestGroup !== '기타') {
      group = bestGroup;
    }
  }

  // 3) 품목군(Flower Group) → 지배적 수입국 확정
  if (!country && group && group !== '기타') {
    const gm = catalog.groupCountryStats.get(group);
    if (gm && gm.size > 0) {
      const topCountry = [...gm.entries()].sort((a, b) => b[1] - a[1])[0][0];
      if (topCountry) country = topCountry;
    } else if (DEFAULT_GROUP_TO_COUNTRY.has(group)) {
      country = DEFAULT_GROUP_TO_COUNTRY.get(group);
    }
  }

  // 4) 영문 학명 보강 (Agapanthus / Leucothoe / Weigelia 등 네덜란드 직수입 소재)
  if (!country && BOTANICAL_DUTCH_HINTS.test(rawProd)) {
    country = '네덜란드';
  }

  return {
    country,
    group,
    inferredCountry: Boolean(country && !origCountry),
    inferredGroup: Boolean(group && !origGroup),
  };
}

export function matchDbEnglishProductName(item = {}, catalog = null, options = {}) {
  const rawProd = clean(item.product || '');
  if (!rawProd) return { dbProdKey: null, dbProdName: '' };

  if (options?.productAliases) {
    const manualHit = resolveKakaoProductAlias(options.productAliases, item);
    if (manualHit && clean(manualHit.dbProdName)) {
      return {
        dbProdKey: manualHit.dbProdKey || null,
        dbProdName: clean(manualHit.dbProdName),
        isManualDbAlias: true,
      };
    }
  }

  if (!catalog?.isDbCatalog || !catalog.productsByKey) {
    return { dbProdKey: null, dbProdName: '' };
  }

  const country = normalizeCatalogCountry(item.country);
  const group = normalizeCatalogFlowerGroup(item.group);
  const baseProd = clean(item.baseName || rawProd);
  const itemLengthCm = extractLengthCmToken(`${rawProd} ${item.spec || ''}`);
  const itemGrade = extractGradeToken(`${rawProd} ${item.spec || ''}`);

  const addFullKey = (k) => {
    if (!k || k.length < 2 || GENERIC_VARIETY_STOP_TOKENS.has(k)) return;
    fullKeys.add(k);
    for (const syn of VARIETY_SYNONYM_MAP.get(k) || []) fullKeys.add(syn);
  };
  const addTokenKey = (k) => {
    if (!k || k.length < 2 || GENERIC_VARIETY_STOP_TOKENS.has(k)) return;
    tokenKeys.add(k);
    for (const syn of VARIETY_SYNONYM_MAP.get(k) || []) tokenKeys.add(syn);
  };

  const fullKeys = new Set();
  const colorHintsEn = new Set();
  const tokenKeys = new Set();

  for (const text of [baseProd, rawProd]) {
    addFullKey(varietyCompactKey(text));
    const en = getEnglishOf(text);
    if (en) addFullKey(varietyCompactKey(en));
    const phon = expandKoreanPhoneticKeys(text);
    for (const ck of phon.compoundKeys) addFullKey(ck);
    for (const st of phon.stemTokens) addTokenKey(st);
    for (const ce of phon.colorEnTokens) colorHintsEn.add(ce);
  }

  for (const tok of tokenizeForMatch(baseProd)) {
    const tk = tok.replace(/[^0-9a-z가-힣]/g, '');
    if (!tk) continue;
    if (KO_COLOR_TO_EN.has(tk)) colorHintsEn.add(KO_COLOR_TO_EN.get(tk));
    if (/^(?:white|red|pink|yellow|green|blue|purple|orange|peach|cream|burgundy|gold)$/i.test(tk)) {
      colorHintsEn.add(tk.toLowerCase());
    }
    addTokenKey(tk);
    const enTok = getEnglishOf(tok);
    if (enTok) addTokenKey(enTok.replace(/[^0-9a-z가-힣]/g, ''));
  }

  const candidatePool = new Map();
  for (const k of [...fullKeys, ...tokenKeys]) {
    for (const cand of catalog.productsByKey.get(k) || []) {
      candidatePool.set(cand.prodKey ?? cand.prodName, cand);
    }
  }

  // Fallback pool for group+color orders (e.g. "스키미아 그린" -> product="그린", group="스키미아", country="네덜란드")
  // or single-species groups (e.g. "더글라스" -> group="상록수", country="미국")
  if (candidatePool.size === 0 && country && group) {
    for (const cand of catalog.productsByCountryGroup?.get(`${country}|${group}`) || []) {
      candidatePool.set(cand.prodKey ?? cand.prodName, cand);
    }
  }

  if (candidatePool.size === 0) {
    return { dbProdKey: null, dbProdName: '' };
  }

  let best = null;
  let bestScore = 0;

  for (const cand of candidatePool.values()) {
    if (country && cand.country !== country) continue;
    if (group && group !== '기타' && cand.group && cand.group !== '기타' && !cand.isCustomFlowerGroup && cand.group !== group) {
      const compatibleThaiOrchid = country === '태국' && THAI_ORCHID_GROUPS.has(group) && THAI_ORCHID_GROUPS.has(cand.group);
      if (!compatibleThaiOrchid) continue;
    }

    let score = 0;
    let hasSpecificMatch = false;

    for (const fk of fullKeys) {
      if (cand.vKeySet.has(fk)) {
        score += 10000;
        hasSpecificMatch = true;
      }
    }
    for (const tk of tokenKeys) {
      if (cand.vKeySet.has(tk) || cand.englishLower.includes(tk)) {
        score += 2600;
        hasSpecificMatch = true;
      }
    }
    for (const cEn of colorHintsEn) {
      if (cand.englishLower.includes(cEn)) {
        score += 3200;
        if (group && cand.group === group) hasSpecificMatch = true;
      }
    }
    if (!hasSpecificMatch && fold(rawProd) === fold(group) && cand.group === group) {
      score += 2000;
      hasSpecificMatch = true;
    }
    if (!hasSpecificMatch) continue;

    if (itemLengthCm) {
      if (cand.lengthCm === itemLengthCm) score += 5000;
      else if (cand.lengthCm && cand.lengthCm !== itemLengthCm) score -= 4500;
    }
    if (itemGrade) {
      if (cand.gradeUpper === itemGrade) {
        score += 3200;
      } else if (SIZE_GRADE_TOKENS.has(itemGrade) && SIZE_GRADE_TOKENS.has(cand.gradeUpper) && cand.gradeUpper !== itemGrade) {
        score -= 2800;
      } else if (!SIZE_GRADE_TOKENS.has(itemGrade) && cand.englishName.toUpperCase().includes(itemGrade)) {
        score += 2200;
      }
    }
    score += Math.min(cand.weight, 1800);

    if (score > bestScore) {
      bestScore = score;
      best = cand;
    }
  }

  if (!best || bestScore <= 0) {
    return { dbProdKey: null, dbProdName: '' };
  }

  let resolvedName = best.englishName;
  let resolvedProdKey = best.prodKey;
  // Never emit a conflicting stem length if Kakao specified e.g. 70cm while closest DB row was 50cm
  if (itemLengthCm && best.lengthCm && best.lengthCm !== itemLengthCm) {
    resolvedName = resolvedName.replace(new RegExp(best.lengthCm.replace('cm', '\\s*cm'), 'i'), itemLengthCm);
    resolvedProdKey = null;
  }
  if (
    itemGrade &&
    best.gradeUpper &&
    SIZE_GRADE_TOKENS.has(itemGrade) &&
    SIZE_GRADE_TOKENS.has(best.gradeUpper) &&
    best.gradeUpper !== itemGrade
  ) {
    resolvedName = resolvedName.replace(new RegExp(`(^|\\s)${best.gradeUpper}(?=\\s|$)`, 'i'), `$1${itemGrade}`);
    resolvedProdKey = null;
  }

  return {
    dbProdKey: resolvedProdKey,
    dbProdName: resolvedName,
  };
}

export function searchCatalogProducts(
  catalog,
  { query = '', country = '', allCountries = false, limit = 40 } = {},
) {
  const list = Array.isArray(catalog?.searchableProducts) ? catalog.searchableProducts : [];
  if (!list.length) return [];

  const normCountry = normalizeCatalogCountry(country);
  const qRaw = clean(query);
  const qFold = fold(qRaw);
  const qCompact = varietyCompactKey(qRaw);
  const qLengthCm = extractLengthCmToken(qRaw);
  const qGrade = extractGradeToken(qRaw);
  const phon = expandKoreanPhoneticKeys(qRaw);
  const qFullKeys = new Set(
    [qCompact, ...(getEnglishOf(qRaw) ? [varietyCompactKey(getEnglishOf(qRaw))] : []), ...phon.compoundKeys].filter(
      (k) => k && k.length >= 2,
    ),
  );
  const qTokens = new Set(
    [
      ...tokenizeForMatch(qRaw).map((t) => t.replace(/[^0-9a-z가-힣]/g, '')),
      ...phon.stemTokens,
      ...phon.colorEnTokens,
    ].filter((t) => t && t.length >= 2),
  );

  const maxLimit = Math.max(1, Math.min(Number(limit) || 40, 100));

  const scoreCandidate = (cand) => {
    const sameCountry = normCountry && cand.country === normCountry;
    if (!allCountries && normCountry && !sameCountry && !qFold) return -1;

    let score = 0;
    if (!qFold) {
      score = (sameCountry ? 10000 : 0) + (cand.hasPureEnglish ? 500 : 0) + Math.min(cand.weight, 3000);
      return score;
    }

    let matched = false;
    if (cand.searchBlob.includes(qFold)) {
      score += fold(cand.englishName).startsWith(qFold) || fold(cand.prodName).startsWith(qFold) ? 12000 : 8000;
      matched = true;
    }
    for (const fk of qFullKeys) {
      if (cand.vKeySet.has(fk)) {
        score += 10000;
        matched = true;
      }
    }
    for (const tk of qTokens) {
      if (cand.vKeySet.has(tk) || cand.searchBlob.includes(tk)) {
        score += 2400;
        matched = true;
      }
    }
    if (!matched) return -1;

    if (sameCountry) score += 6000;
    else if (!allCountries && normCountry) score -= 3500;

    if (qLengthCm && cand.lengthCm === qLengthCm) score += 2000;
    if (qGrade && cand.gradeUpper === qGrade) score += 2000;
    if (cand.hasPureEnglish) score += 400;
    score += Math.min(cand.weight, 2000);
    return score;
  };

  const primary = [];
  const crossCountry = [];
  for (const cand of list) {
    const sameCountry = !normCountry || cand.country === normCountry;
    if (!allCountries && normCountry && !sameCountry && !qFold) continue;
    const sc = scoreCandidate(cand);
    if (sc < 0) continue;
    const entry = {
      prodKey: cand.prodKey,
      prodCode: cand.prodCode,
      prodName: cand.prodName,
      englishName: cand.englishName,
      displayName: cand.displayName,
      flowerName: cand.flowerName,
      country: cand.country,
      group: cand.group,
      otherCountry: Boolean(normCountry && cand.country !== normCountry),
      _score: sc,
    };
    if (sameCountry || allCountries) primary.push(entry);
    else crossCountry.push(entry);
  }

  primary.sort((a, b) => b._score - a._score || a.englishName.localeCompare(b.englishName, 'en'));
  const combined = primary.slice(0, maxLimit);
  if (!allCountries && combined.length < 5 && crossCountry.length > 0) {
    crossCountry.sort((a, b) => b._score - a._score || a.englishName.localeCompare(b.englishName, 'en'));
    combined.push(...crossCountry.slice(0, Math.min(10, maxLimit - combined.length)));
  }

  return combined.map(({ _score, ...rest }) => rest);
}

export function isKnownCatalogProductLine(rawText, catalog) {
  const s = clean(rawText);
  if (!s || !catalog?.isDbCatalog) return false;
  if (BOTANICAL_DUTCH_HINTS.test(s)) return true;
  for (const tok of tokenizeForMatch(s)) {
    const tk = tok.replace(/[^0-9a-z가-힣]/g, '');
    if (tk.length >= 2 && (catalog.knownVarietyKeys.has(tk) || FLOWER_GROUP_SYNONYMS.has(tok))) {
      return true;
    }
    const en = getEnglishOf(tok);
    if (en) {
      const ek = en.replace(/[^0-9a-z가-힣]/g, '');
      if (ek.length >= 2 && catalog.knownVarietyKeys.has(ek)) return true;
    }
  }
  return false;
}

// ───────────────────── 5분 TTL 읽기 전용 MSSQL 카탈로그 로더 ─────────────────────
const CATALOG_TTL_MS = 5 * 60 * 1000;
let cachedCatalog = null;
let cachedAtMs = 0;
let pendingLoadPromise = null;

export async function loadImportKakaoDbCatalog({ queryFn = null, force = false } = {}) {
  const now = Date.now();
  if (!force && cachedCatalog && now - cachedAtMs < CATALOG_TTL_MS) {
    return cachedCatalog;
  }
  if (!force && pendingLoadPromise) {
    return pendingLoadPromise;
  }

  pendingLoadPromise = (async () => {
    try {
      if (typeof queryFn !== 'function') {
        const offline = buildImportKakaoDbCatalog();
        if (!cachedCatalog) {
          cachedCatalog = offline;
          cachedAtMs = Date.now();
        }
        return cachedCatalog;
      }
      const execQuery = queryFn;
      const [farmsRes, whFarmsRes, productsRes] = await Promise.all([
        execQuery(`
          SELECT f.FarmKey, f.FarmCode, f.FarmName, c.CounName
          FROM dbo.Farm f
          LEFT JOIN dbo.Country c ON c.CounKey = f.CounKey
          WHERE ISNULL(f.isDeleted, 0) = 0
        `),
        execQuery(`
          SELECT LTRIM(RTRIM(wm.FarmName)) AS FarmName, p.CounName, COUNT_BIG(*) AS Cnt
          FROM dbo.WarehouseMaster wm
          LEFT JOIN dbo.WarehouseDetail wd ON wd.WarehouseKey = wm.WarehouseKey
          LEFT JOIN dbo.Product p ON p.ProdKey = wd.ProdKey
          WHERE ISNULL(wm.isDeleted, 0) = 0 AND ISNULL(wm.FarmName, '') <> ''
          GROUP BY LTRIM(RTRIM(wm.FarmName)), p.CounName
          ORDER BY COUNT_BIG(*) DESC
        `).catch(() => ({ recordset: [] })),
        execQuery(`
          SELECT p.ProdKey, p.ProdCode, p.ProdName, p.DisplayName, p.ProdGroup, p.FlowerName, p.CounName,
                 ISNULL(u.RecentSeasonOrders, 0) AS RecentSeasonOrders,
                 ISNULL(u.RecentOrders, 0) AS RecentOrders,
                 ISNULL(u.TotalOrders, 0) AS TotalOrders
          FROM dbo.Product p
          LEFT JOIN (
            SELECT od.ProdKey,
                   COUNT_BIG(*) AS TotalOrders,
                   SUM(CASE WHEN om.OrderDtm >= DATEADD(year, -2, GETDATE()) THEN 1 ELSE 0 END) AS RecentOrders,
                   SUM(CASE WHEN om.OrderDtm >= DATEADD(day, -90, GETDATE()) THEN 1 ELSE 0 END) AS RecentSeasonOrders
            FROM dbo.OrderDetail od
            JOIN dbo.OrderMaster om ON om.OrderMasterKey = od.OrderMasterKey AND ISNULL(om.isDeleted, 0) = 0
            WHERE ISNULL(od.isDeleted, 0) = 0
            GROUP BY od.ProdKey
          ) u ON u.ProdKey = p.ProdKey
          WHERE ISNULL(p.isDeleted, 0) = 0
        `),
      ]);

      const built = buildImportKakaoDbCatalog({
        farms: farmsRes?.recordset || [],
        warehouseFarms: whFarmsRes?.recordset || [],
        products: productsRes?.recordset || [],
      });
      cachedCatalog = built;
      cachedAtMs = Date.now();
      return built;
    } catch {
      // DB 미연결 환경(단위테스트/오프라인)에서도 내장 검증 농장·품종 사전으로 무중단 동작 보장
      const fallback = buildImportKakaoDbCatalog();
      if (!cachedCatalog) {
        cachedCatalog = fallback;
        cachedAtMs = Date.now();
      }
      return cachedCatalog;
    } finally {
      pendingLoadPromise = null;
    }
  })();

  return pendingLoadPromise;
}
