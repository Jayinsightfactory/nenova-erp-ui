// Estimate edits use EXE CountryFlower scope, never an empty (whole-week) scope.
export function normalizeEstimateEditProdKeys(value) {
  const raw = Array.isArray(value) ? value : String(value ?? '').split(',');
  if (!raw.length || raw.some(v => !['string', 'number'].includes(typeof v) || !/^\d+$/.test(String(v).trim()) || !Number.isSafeInteger(Number(v)) || Number(v) <= 0)) {
    throw new Error('수정할 품목번호가 없습니다. 품목을 다시 조회하세요.');
  }
  return [...new Set(raw.map(Number))];
}

export function resolveEstimateEditCategories(prodKeys, products, requestedCategories) {
  const keys = normalizeEstimateEditProdKeys(prodKeys);
  const byKey = new Map(products.map(p => [Number(p.ProdKey), p]));
  const groups = new Map();
  for (const key of keys) {
    const p = byKey.get(key);
    const cf = String(p?.CountryFlower ?? '').trim();
    if (!p || !cf || Number(p.isDeleted || 0)) throw new Error(`품목번호 ${key}의 전산 품종을 확인할 수 없습니다. 전체 품종으로 대신 처리하지 않습니다.`);
    if (!groups.has(cf)) groups.set(cf, []);
    groups.get(cf).push(key);
  }
  if (requestedCategories !== undefined) {
    if (!Array.isArray(requestedCategories) || requestedCategories.length !== 1 || !groups.has(requestedCategories[0])) {
      throw new Error('수정 품목과 확정 처리 품종이 일치하지 않습니다. 다시 조회하세요.');
    }
    return [{ countryFlower: requestedCategories[0], prodKeys: groups.get(requestedCategories[0]) }];
  }
  return [...groups].map(([countryFlower, ids]) => ({ countryFlower, prodKeys: ids }));
}

export function successfulUnfixSteps(data, step) {
  // Only explicit successful SP results are recoverable. No results or a lost
  // response must never be treated as permission to fix every requested row.
  return (data?.results || []).filter(r => r.ok === true && r.countryFlower === step.countryFlower)
    .map(() => step).slice(0, 1);
}

export async function runScopedEstimateFixCycle({ weeks, orderYear, prodKeys, resolveScope, runAction, apply, progress,
  lightStock = false, skipFinalStockCalc = false }) {
  const year = String(orderYear ?? '');
  if (!/^\d{4}$/.test(year)) throw new Error('수정 연도가 전달되지 않았습니다. 다시 조회하세요.');
  const ordered = [...new Set(weeks)].sort();
  if (!ordered.length || ordered.some(w => !/^\d{2}-\d{2}$/.test(w))) throw new Error('수정 세부차수를 확인하세요.');
  const keys = normalizeEstimateEditProdKeys(prodKeys);
  const groups = await resolveScope(keys);
  // Validate the server response as well as the request before the first write.
  const checked = resolveEstimateEditCategories(keys, groups.flatMap(g => (g.prodKeys || []).map(ProdKey => ({ ProdKey, CountryFlower: g.countryFlower }))));
  const completed = [];
  const skipped = (lightStock || skipFinalStockCalc) ? { skipStockCalc: true } : {};
  const invoke = (step, action, extra = {}) => runAction({ orderYear: year, week: step.week, action,
    countryFlowers: [step.countryFlower], editProdKeys: step.prodKeys, stockProdKeys: step.prodKeys, ...extra });
  const refix = async (recovery) => {
    const sorted = [...completed].sort((a, b) => a.week.localeCompare(b.week) || a.countryFlower.localeCompare(b.countryFlower));
    const failures = [];
    for (let i = 0; i < sorted.length; i++) {
      const step = sorted[i];
      progress?.(`${step.week} ${step.countryFlower} ${recovery ? '원상복구 재확정' : '재확정'} 중`);
      try {
        // 원상복구는 안전 우선 — 재계산을 생략하지 않는다.
        // Recompute each earlier week before a later week consumes its snapshot.
        // Existing quantity changes do not use this cycle; this is for new adds.
        await invoke(step, 'fix', recovery || !skipFinalStockCalc ? {} : skipped);
      } catch (error) {
        failures.push({ week: step.week, countryFlower: step.countryFlower, error: error.message });
        progress?.(`${step.week} ${step.countryFlower} 재확정 실패 — ${error.message}`);
      }
    }
    return failures;
  };
  try {
    for (const week of [...ordered].reverse()) {
      for (const group of checked) {
        const step = { ...group, week };
        progress?.(`${week} ${step.countryFlower} 확정해제 중`);
        try {
          const data = await invoke(step, 'unfix', skipped);
          completed.push(...successfulUnfixSteps(data, step));
        } catch (error) {
          completed.push(...successfulUnfixSteps(error.data, step));
          if (!error.data || error.data._ambiguousResponse) {
            error.message += ' · 해당 품종의 처리 응답을 확인하지 못했습니다. 저장을 반복하지 말고 확정현황을 확인하세요.';
          }
          throw error;
        }
      }
    }
  } catch (error) {
    const failures = await refix(true);
    error.recoveryFailures = failures;
    if (failures.length) error.message += ` · 복구 미완료: ${failures.map(f => `${f.week} ${f.countryFlower} (${f.error})`).join(', ')}`;
    throw error;
  }
  let result, saveError;
  try { progress?.('수정값 저장 중'); result = await apply(); }
  catch (error) { saveError = error; progress?.(`수정 저장 오류 — ${error.message}`); }
  const failures = await refix(Boolean(saveError));
  if (failures.length) {
    const error = saveError || new Error('수정값 저장 후 재확정이 완료되지 않았습니다.');
    error.recoveryFailures = failures;
    error.message += ` · 재확정 필요: ${failures.map(f => `${f.week} ${f.countryFlower} (${f.error})`).join(', ')}`;
    throw error;
  }
  if (saveError) throw saveError;
  return result;
}
