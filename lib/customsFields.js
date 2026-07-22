// 그외통관비 국가 입력 필드 — 브라우저 화면과 서버 저장/계산이 공유하는 순수 상수 모듈.
// DB 모듈을 import하지 않도록 분리해 클라이언트 번들에 서버 의존성이 들어가지 않게 한다.
export const VAT_FACTOR = 1.1;

export function vatInclusiveToNet(value) {
  const amount = value == null || Number.isNaN(Number(value)) ? 0 : Number(value);
  return amount === 0 ? 0 : Math.round(amount / VAT_FACTOR);
}

export function vatNetToInclusive(value) {
  const amount = value == null || Number.isNaN(Number(value)) ? 0 : Number(value);
  return amount === 0 ? 0 : Math.round(amount * VAT_FACTOR);
}

export const COUNTRY_SPLIT_GROUPS = [
  { total: 'Customs1', parts: ['Customs1_1', 'Customs1_2', 'Customs1_3'] },
  { total: 'Customs2', parts: ['Customs2_1', 'Customs2_2', 'Customs2_3'] },
  { total: 'SunYul1', parts: ['SunYul1_1', 'SunYul1_2', 'SunYul1_3'] },
  { total: 'SunYul2', parts: ['SunYul2_1', 'SunYul2_2', 'SunYul2_3'] },
];

export const COUNTRY_INPUT_FIELDS = [
  'GW1', 'GW2',
  ...COUNTRY_SPLIT_GROUPS.flatMap((g) => g.parts),
  'WorldFreight1', 'WorldFreight2', 'Quarantine1', 'Quarantine2',
];
