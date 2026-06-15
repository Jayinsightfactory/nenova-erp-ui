// 카탈로그 — 도착원가·판매단가 단위 예측 매칭 (EstUnit / OutUnit / displayUnit)

/** 카탈로그 판매단가 표시 단위 — Product.Cost 는 EstUnit 기준인 경우가 많음 */
export function catalogSaleUnit(product) {
  const u = String(product?.EstUnit || product?.OutUnit || '단').trim();
  return u || '단';
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** 큰 단위 → 송이 단가 */
function costToStem(cost, fromUnit, product) {
  const from = String(fromUnit || '').trim();
  const c = num(cost);
  if (!(c > 0)) return null;
  const steamBox = num(product?.SteamOf1Box);
  const bunchBox = num(product?.BunchOf1Box);
  const steamBunch = num(product?.SteamOf1Bunch);

  if (from === '송이') return c;
  if (from === '단') {
    if (steamBunch > 0) return c / steamBunch;
    return null;
  }
  if (from === '박스') {
    if (steamBox > 0) return c / steamBox;
    if (bunchBox > 0 && steamBunch > 0) return c / (bunchBox * steamBunch);
    return null;
  }
  return null;
}

/** 송이 단가 → 목표 단위 */
function stemToUnit(stemCost, toUnit, product) {
  const to = String(toUnit || '').trim();
  const s = num(stemCost);
  if (!(s > 0)) return null;
  const steamBox = num(product?.SteamOf1Box);
  const steamBunch = num(product?.SteamOf1Bunch);
  const bunchBox = num(product?.BunchOf1Box);

  if (to === '송이') return s;
  if (to === '단') {
    if (steamBunch > 0) return s * steamBunch;
    return null;
  }
  if (to === '박스') {
    if (steamBox > 0) return s * steamBox;
    if (bunchBox > 0 && steamBunch > 0) return s * bunchBox * steamBunch;
    return null;
  }
  return null;
}

export function convertArrivalUnitCost(cost, fromUnit, toUnit, product) {
  const from = String(fromUnit || '').trim();
  const to = String(toUnit || '').trim();
  if (!from || !to || from === to) return num(cost) || null;
  const stem = costToStem(cost, from, product);
  if (stem == null) return null;
  return stemToUnit(stem, to, product);
}

/**
 * SQL/운송 도착원가 → 카탈로그 표시용 (판매단가 EstUnit 과 동일 단위)
 * @param {object} product Product row
 * @param {object} arrival { arrivalCost, displayUnit, arrivalPerStem, arrivalPerBunch }
 */
export function resolveCatalogArrivalDisplay(product, arrival = {}) {
  const saleUnit = catalogSaleUnit(product);
  const rawCost = num(arrival.arrivalCost);
  const rawUnit = String(arrival.displayUnit || arrival.arrivalUnit || product?.OutUnit || '단').trim();
  const perStem = num(arrival.arrivalPerStem);
  const perBunch = num(arrival.arrivalPerBunch);

  const base = { saleUnit, rawCost, rawUnit };

  if (saleUnit === '송이' && perStem > 0) {
    return { ...base, arrivalCost: perStem, arrivalUnit: '송이', matchedBy: 'arrivalPerStem' };
  }
  if (saleUnit === '단' && perBunch > 0) {
    return { ...base, arrivalCost: perBunch, arrivalUnit: '단', matchedBy: 'arrivalPerBunch' };
  }
  if (saleUnit === rawUnit && rawCost > 0) {
    return { ...base, arrivalCost: rawCost, arrivalUnit: rawUnit, matchedBy: 'display' };
  }

  if (rawCost > 0 && rawUnit !== saleUnit) {
    const converted = convertArrivalUnitCost(rawCost, rawUnit, saleUnit, product);
    if (converted != null && converted > 0) {
      return { ...base, arrivalCost: converted, arrivalUnit: saleUnit, matchedBy: 'converted' };
    }
  }

  // 판매단가(송이 ~2000) 대비 박스 도착원가(~36000) — SteamOf1Box 등으로 환산 재시도
  const sale = num(product?.Cost);
  if (rawCost > 0 && sale > 0 && rawCost > sale * 3) {
    for (const tryFrom of [rawUnit, '박스', '단']) {
      const hint = convertArrivalUnitCost(rawCost, tryFrom, saleUnit, product);
      if (hint != null && hint > 0 && hint <= sale * 5) {
        return { ...base, arrivalCost: hint, arrivalUnit: saleUnit, matchedBy: 'heuristic' };
      }
    }
  }

  if (rawCost > 0) {
    return {
      ...base,
      arrivalCost: rawCost,
      arrivalUnit: rawUnit,
      matchedBy: 'raw',
      unitMismatch: rawUnit !== saleUnit,
    };
  }

  return { ...base, arrivalCost: 0, arrivalUnit: saleUnit, matchedBy: 'none' };
}
