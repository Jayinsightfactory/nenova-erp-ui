// lib/fixCycleClient.js
// 확정차수 편집 안전 사이클 (확정해제 → 적용 → 재확정) 공용 클라이언트 헬퍼.
// pages/estimate.js 의 runShipmentFixAction/runEditWithFixCycle 과 동일 패턴 —
// docs/CONFIRMED_WEEK_EDIT_SAFETY_CHECKLIST.md C-1 준수 (확정된 값 직접 UPDATE 금지).
// estimate.js 는 이미 검증된 코드라 건드리지 않고, 재고관리 등 신규 화면에서 이 모듈을 공용으로 쓴다.

import { parseJsonResponse } from './parseJsonResponse';

const FIX_UNFIX_FETCH_TIMEOUT_MS = 20 * 60 * 1000;

export function sortWeeksAsc(weeks) {
  return [...new Set((weeks || []).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

export function sortWeeksDesc(weeks) {
  return sortWeeksAsc(weeks).reverse();
}

export async function postShipmentFix(body, { timeoutMs = FIX_UNFIX_FETCH_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch('/api/shipment/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data;
    try {
      data = await parseJsonResponse(res);
    } catch (e) {
      data = { success: false, error: e.message, _ambiguousResponse: true, _httpStatus: res.status };
    }
    return { res, data };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchWeekFixStatus(week) {
  const res = await fetch(
    `/api/shipment/fix-status?fromWeek=${encodeURIComponent(week)}&toWeek=${encodeURIComponent(week)}`,
    { credentials: 'same-origin' },
  );
  const data = await parseJsonResponse(res).catch(() => ({}));
  return (data.weeks || []).find(w => w.OrderWeek === week) || null;
}

export async function runShipmentFixAction(week, action, countryFlowers = [], stockProdKeys = []) {
  const { data: d } = await postShipmentFix({ week, action, force: true, countryFlowers, stockProdKeys });
  if (!d.success) {
    throw new Error(d.error || d.message || `${week} ${action === 'unfix' ? '확정취소' : '재확정'} 실패`);
  }
  return d;
}

// weeks: 대상 차수 목록(중복/순서 무관) · apply: 실제 수정 저장 함수(async () => any)
// 낮은 차수부터 확정해야 하므로 해제는 내림차순(높은 차수부터), 재확정은 오름차순(낮은 차수부터).
// 해제 중 오류 시 이미 해제한 차수는 즉시 원상복구 재확정 후 throw.
// apply() 오류는 재확정까지 마친 뒤 throw (재확정 누락 방지).
export async function runEditWithFixCycle({ weeks, countryFlowers = [], stockProdKeys = [], progress, apply }) {
  const targetWeeks = sortWeeksAsc(weeks);
  const unfixedWeeks = [];
  let applyResult = null;
  let applyError = null;
  try {
    for (const wk of sortWeeksDesc(targetWeeks)) {
      progress?.(`${wk} 확정해제 중`);
      await runShipmentFixAction(wk, 'unfix', countryFlowers, stockProdKeys);
      unfixedWeeks.push(wk);
    }
  } catch (err) {
    progress?.(`확정해제 오류 — ${err.message}`);
    for (const wk of sortWeeksAsc(unfixedWeeks)) {
      progress?.(`${wk} 원상복구 재확정 중`);
      await runShipmentFixAction(wk, 'fix', countryFlowers, stockProdKeys);
    }
    throw err;
  }

  try {
    progress?.('수정값 저장 중');
    applyResult = await apply();
  } catch (err) {
    applyError = err;
    progress?.(`수정 저장 오류 — ${err.message}`);
  }

  for (const wk of sortWeeksAsc(unfixedWeeks)) {
    progress?.(`${wk} 재확정 중`);
    await runShipmentFixAction(wk, 'fix', countryFlowers, stockProdKeys);
  }

  if (applyError) throw applyError;
  return applyResult;
}
