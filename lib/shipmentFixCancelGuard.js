/**
 * 출고 확정취소 가드 — nenova.exe CheckFixCancel 과 동일
 * 다음 StockMaster.OrderYearWeek 의 ViewShipment.DetailFix=1 이면 취소 불가.
 * StockMaster.isFix / body.force 로는 우회하지 않는다.
 */

export const LATER_FIXED_CODE = 'LATER_FIXED_EXISTS';
export const STOCK_CALC_FAILED_CODE = 'STOCK_CALC_FAILED';
export const STOCK_CALC_RETRY_DELAYS_MS = [1000, 2000, 4000];

export function toOrderYearWeekKey(orderYear, orderWeek) {
  return `${String(orderYear || '')}${String(orderWeek || '').replace(/-/g, '')}`;
}

/**
 * @param {{ nextWeek: { orderYear: string, orderWeek: string, orderYearWeek: string } | null, products: Array<{ prodKey?: number, prodName?: string }> }} input
 * @returns {{ blocked: boolean, code?: string, nextWeek?: object, products?: object[], error?: string }}
 */
export function evaluateCheckFixCancel({ nextWeek, products } = {}) {
  const rows = Array.isArray(products) ? products.filter(Boolean) : [];
  if (!nextWeek || rows.length === 0) {
    return { blocked: false };
  }
  const names = rows
    .map((r) => String(r.prodName || r.ProdName || '').trim())
    .filter(Boolean);
  const label = `${nextWeek.orderYear} ${nextWeek.orderWeek}`;
  const namePart = names.length ? `\n(${names.join(', ')})` : '';
  return {
    blocked: true,
    code: LATER_FIXED_CODE,
    nextWeek,
    products: rows,
    error:
      `다음차수(${label})에 확정된 제품이 ${rows.length}개 존재합니다. ` +
      `다음차수 확정 취소 후 시도해주세요.${namePart}`,
  };
}

export function evaluateUnfixStockCalcResult({ skipStockCalc = false, stockErrors = [], reconcileStockErrors = [] } = {}) {
  if (skipStockCalc) return { ok: true };
  const errors = [...(stockErrors || []), ...(reconcileStockErrors || [])];
  if (errors.length === 0) return { ok: true };
  return {
    ok: false,
    code: STOCK_CALC_FAILED_CODE,
    error:
      '확정취소는 반영됐지만 재고 재계산에 실패했습니다. ' +
      '잠시 후 같은 차수를 다시 취소하거나 전산에서 재고계산을 실행하세요.',
    stockErrors: errors,
  };
}

export async function retryWithDelays(run, delays = STOCK_CALC_RETRY_DELAYS_MS) {
  let last;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    last = await run(attempt);
    if (last?.ok) return last;
    if (attempt < delays.length) {
      await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
    }
  }
  return last;
}
