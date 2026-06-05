// lib/salesRevenueConfig.js
// 영업매출관리 공유 설정 (fs 의존 없음 — 서버/클라이언트 양쪽에서 import 가능)
// - 기본 업체 목록(매출비교.xlsx 6월 시트 기준)
// - 비교 차수
// - 이카운트 원본 거래처명 → 네노바 통용명 내장 후보(BUILT_IN_ALIASES)
//
// 주의: 여기에 fs/db 등 서버 전용 모듈을 import 하면 안 된다. 페이지 번들에서 깨진다.

export const COMPARE_WEEKS = ['22', '23', '24', '25', '26'];

// 매출비교.xlsx 기준: 절대 차수(1~26)를 월별 시트로 묶는 구성.
//   1월=1~4차, 2월=5~8차, 3월=9~13차, 4월=14~17차, 5월=18~21차, 6월=22~26차
export const MONTH_WEEK_GROUPS = [
  { month: 1, weeks: ['1', '2', '3', '4'] },
  { month: 2, weeks: ['5', '6', '7', '8'] },
  { month: 3, weeks: ['9', '10', '11', '12', '13'] },
  { month: 4, weeks: ['14', '15', '16', '17'] },
  { month: 5, weeks: ['18', '19', '20', '21'] },
  { month: 6, weeks: ['22', '23', '24', '25', '26'] },
];

// 차수 → 월 역매핑
export const WEEK_TO_MONTH = MONTH_WEEK_GROUPS.reduce((acc, g) => {
  g.weeks.forEach(w => { acc[w] = g.month; });
  return acc;
}, {});

// 매출비교.xlsx 6월 시트 업체 전체 목록 (네노바 통용명 기준) — 양재동 지점
export const BASE_CUSTOMERS = [
  '미우', '소재2호', '그린', '꽃길', '알파', '꽃동산', '레바논', '미카엘', '꿀벌',
  '공주', '성남', '플로르아름', '나래꽃', '경향', '대한꽃집', '송우', '코코도르',
  '청지화원', '존버', '시흥장미', '매일', '남촌', '신초원', '선미', '미소',
  '꽃사레', '유니온', '아이엠', '정원꽃', '청목소재', '코벤트', '파란마을',
  '타우블', '스타일', '녹색', '자연원예', '강남',
];

// 지방(지점) 기준 거래처 — 지방 판매현황 통용명 기준
export const BASE_CUSTOMERS_JIBANG = [
  '유오디아', '희경', '은성아트제단', '울산신화화분', '청화꽃집', '영남꽃소재',
  '경원원예', '울산동산꽃집', '인터넷공판장', '태광플라워', '신라호텔',
];

// 지점(채널) 목록 — 업로드/조회 select 와 base 목록 매핑
export const CHANNELS = ['양재동', '지방'];
export const BASE_CUSTOMERS_BY_CHANNEL = {
  '양재동': BASE_CUSTOMERS,
  '지방': BASE_CUSTOMERS_JIBANG,
};

// 채널별 기준 거래처 목록 — '전체'/미지정이면 전 채널 합집합
export function baseCustomersForChannel(channel) {
  if (!channel || channel === '전체') {
    return [...BASE_CUSTOMERS, ...BASE_CUSTOMERS_JIBANG];
  }
  return BASE_CUSTOMERS_BY_CHANNEL[channel] || BASE_CUSTOMERS;
}

// 이카운트 원본 거래처명 → 네노바 통용명 내장 후보 (자동 후보일 뿐, 확정 저장 아님)
// 사용자가 확정 저장(sales-revenue-customer-mappings.json)한 매핑이 항상 우선한다.
export const BUILT_IN_ALIASES = {
  소재2호: '소재2호',
  아이엠: '미우',
  그린화원: '그린',
  '(주)플라워녹색공간': '녹색',
  꽃길: '꽃길',
  '나래꽃(중매1390)': '나래꽃',
  알파플라워: '알파',
  '(주)미카엘플라워': '미카엘',
  '주식회사 꿀벌원예': '꿀벌',
  '중매1536 (스타일)': '스타일',
  경향농원: '경향',
  '주식회사 송우플라워시스템': '송우',
  '플로르 스터프 오피셜': '플로르아름',
  '중매1453호 유니온': '유니온',
  성남원예: '성남',
  타우블: '타우블',
  '선미원예(중매1484)': '선미',
  '주식회사 매일농원': '매일',
  '코벤트원예 2호': '코벤트',
  꽃사레: '꽃사레',
  존버: '존버',
  남촌원예: '남촌',
  // ── 지방(지점) 거래처 이카운트 원본명 → 통용명 — 2026-06-05
  '유오디아 꽃마을': '유오디아',
  '희경(Hee Kyoung)': '희경',
  '희경': '희경',
  '은성아트제단': '은성아트제단',
  '울산신화화분': '울산신화화분',
  '청화꽃집': '청화꽃집',
  '(주)영남꽃소재': '영남꽃소재',
  '영남꽃소재': '영남꽃소재',
  '경원원예': '경원원예',
  '울산동산꽃집(66호)': '울산동산꽃집',
  '인터넷공판장': '인터넷공판장',
  '태광플라워 양주지점': '태광플라워',
  '신라호텔': '신라호텔',
};

export default {
  COMPARE_WEEKS, BASE_CUSTOMERS, BASE_CUSTOMERS_JIBANG, BASE_CUSTOMERS_BY_CHANNEL,
  CHANNELS, baseCustomersForChannel, BUILT_IN_ALIASES,
};
