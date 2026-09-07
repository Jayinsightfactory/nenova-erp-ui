// lib/arrivalCostFxPreview.js — 도착원가 환율 재계산 미리보기 (read-only, DB 저장 없음)
//
// 배경: 업로드된 원가자료(WebArrivalCostLine)의 원가는
//   lib/arrivalCostExcel.js::calculateArrivalCost() 기준
//   cost = (FOB + freightPerUnitUSD) * exchangeRate + customsPerUnitKRW + otherPerUnitKRW
// 로 계산된다. customs/other는 이미 KRW 확정값이라 환율 변화의 영향을 받지 않는다.
//
// 사용자가 "이 차수 원가자료에 다른 차수 환율을 넣으면 얼마가 되나" 를 화면에서만
// 미리 보고 싶을 때, 위 식을 환율에 대해 역산해 FOB+운임(USD) 부분만 분리한 뒤
// 새 환율로 다시 곱한다. FOB/운임 원본 컬럼이 없는 행(basis별 share 미분리)에도
// 동일하게 적용 가능하도록, 이미 표시된 KRW 원가에서 역산하는 방식을 쓴다.

/**
 * @param {{ exchangeRate?: number, selectedArrivalCostKRW?: number, sourceArrivalCostKRW?: number,
 *           customsPerUnitKRW?: number, otherPerUnitKRW?: number }} row
 * @param {number|string} newFx 사용자가 입력한 환율
 * @returns {{ ok: boolean, cost: number|null, origFx: number, reason: string }}
 */
export function recalcArrivalCostWithFx(row, newFx) {
  const fx = Number(newFx);
  const origFx = Number(row?.exchangeRate) || 0;
  const baseCost = Number(row?.selectedArrivalCostKRW ?? row?.sourceArrivalCostKRW ?? 0);
  const customs = Number(row?.customsPerUnitKRW) || 0;
  const other = Number(row?.otherPerUnitKRW) || 0;

  if (!(origFx > 0)) return { ok: false, cost: null, origFx, reason: '원본 환율 정보가 없어 재계산할 수 없습니다.' };
  if (!(fx > 0)) return { ok: false, cost: null, origFx, reason: '환율을 입력하세요.' };

  const usdPortion = (baseCost - customs - other) / origFx;
  const cost = usdPortion * fx + customs + other;
  if (!Number.isFinite(cost)) return { ok: false, cost: null, origFx, reason: '재계산할 수 없는 값입니다.' };
  return { ok: true, cost, origFx, reason: '' };
}
