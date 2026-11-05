// Presentation-only evidence. No financial write or alternate allocation is applied.
import { computeColombiaRatios } from './customsForwardingCalc.js';
import { classifyProfitReportCategory } from './profitReportCountryResolver.js';
const num = value => value == null || !Number.isFinite(Number(value)) ? null : Number(value);
const signed = (value, digits = 0) => value == null ? '확인 필요' : `${value > 0 ? '+' : ''}${value.toLocaleString('ko-KR', { maximumFractionDigits: digits })}`;
export function colombiaImpactNotes(payload, displayRows = payload?.rows || []) {
  const weeks = payload?.colombiaAllocationEvidence || [];
  const groups = new Map();
  const lines = [];
  for (const week of weeks) {
    if (String(week.orderYear) !== String(payload.orderYear) || !String(week.orderWeek).startsWith(`${payload.major}-`)) continue;
    const gw = num(week.components?.GW), cw = num(week.components?.CW);
    if (!week.allocation || !week.boxQty || !week.allocationRates || !(gw > 0) || !(cw > 0) || gw > cw + .01 || week.weightState && week.weightState !== 'valid' || !week.forwardingDetected) continue;
    const weight = Math.abs(gw - cw) < .01;
    const ratios = computeColombiaRatios(week.boxQty, week.allocationRates);
    lines.push(`${week.orderWeek}: GW ${gw}kg / CW ${cw}kg → ${weight ? '무게' : 'CBM'} 배분 (${week.gwSource || week.source}); 그외통관비는 항상 무게 배분`);
    for (const [category, allocation] of Object.entries(week.allocation)) {
      if (!(Number(week.boxQty[category]) > 0)) continue;
      const row = displayRows.find(r => r.category === category), rate = num(row?.calc?.R);
      const air = num(week.airTotal), actual = num(allocation.S);
      if (air == null || actual == null || rate == null || !(rate > 0)) continue;
      if (row?.manual?.S != null) { lines.push(`${week.orderWeek} ${category}: 본표 수기 항공료 우선 · 자동배분 비교를 적용 이익으로 표시하지 않습니다.`); continue; }
      const opposite = air * (weight ? ratios.cbmRatio[category] : ratios.weightRatio[category]);
      const group = groups.get(category) || { actual: 0, opposite: 0, delta: 0, row, comparisons: new Set() };
      group.comparisons.add(`${week.orderWeek} ${weight ? '부피(CBM)기준 대비' : '중량기준 대비'}`);
      group.actual += actual * rate; group.opposite += opposite * rate;
      group.delta += (actual - opposite) * rate;
      groups.set(category, group);
    }
  }
  if (!lines.length) return displayRows.some(row => String(row.category).startsWith('콜롬비아') && (row.calc?.S || row.auto?.S || row.calc?.Q))
    ? '[콜롬비아 운임 배분] 세부차수·박스·유효 중량·환율 근거 부족: 비교금액/이익률 영향 확인 필요 (현재 값으로 저장 당시 금액을 역산하지 않음).' : '';
  for (const [category, g] of groups) {
    const calc = g.row?.calc, basis = g.row?.inventoryValuation?.end;
    const matchesApplied = num(calc?.T) != null && Math.abs(calc.T - g.actual) < .01;
    const average = basis?.average;
    // Only the proven category-average recognition path supports a counterfactual.
    // Inventory-retained freight is not a second financial gain.
    const retained = basis?.method === 'category_average' && ['단', '박스', '송이'].includes(basis.unit) && num(basis.quantity) != null && num(average?.purchaseQty) > 0 && num(basis.value) === num(calc?.F)
      ? basis.quantity / average.purchaseQty : basis?.method === 'no_stock' ? 0 : null;
    const override = g.row?.manual?.S != null || g.row?.manual?.AJ != null;
    const profitEffect = retained == null || override || !matchesApplied ? null : -g.delta * (1 - retained);
    const pp = profitEffect == null || !calc?.C ? null : profitEffect / calc.C * 100;
    lines.push(`${category} (${[...g.comparisons].join(', ')}): ${payload.allocationEvidenceCurrent ? '현재 원장 배분 참고' : '실제 항공료'} ${signed(g.actual)}원 / 비교 ${signed(g.opposite)}원 · 실제−비교 운임부담 ${signed(g.delta)}원 · 재고유보 반영 이익효과 ${signed(profitEffect)}원 / 이익률 ${signed(pp, 3)}%p${profitEffect == null ? ' (본표 운임 일치·원가인식·수기조정 근거 확인 필요)' : ''}`);
  }
  return `[콜롬비아 운임 배분 · 중량/부피 비교이며 금액 미반영]\n${lines.join('\n')}`;
}

export function inventoryContinuityNotes(current, previous, next) {
  const lines = [];
  for (const [left, right, label] of [[previous, current, '전차수 기말→당차수 기초'], [current, next, '당차수 기말→다음차수 기초']]) {
    if (!left || !right) { lines.push(`${label}: 비교 보고서 근거 없음`); continue; }
    const y0 = Number(left.orderYear), m0 = Number(left.major), y1 = Number(right.orderYear), m1 = Number(right.major);
    const consecutive = /^\d{4}$/.test(String(left.orderYear)) && /^\d{4}$/.test(String(right.orderYear))
      && m0 >= 1 && m0 <= 53 && m1 >= 1 && m1 <= 53
      && ((y0 === y1 && m1 === m0 + 1) || (y1 === y0 + 1 && [52, 53].includes(m0) && m1 === 1));
    if (!consecutive) { lines.push(`${label}: 인접 연도·차수 근거 불일치 (비교 보류)`); continue; }
    let differences = 0, available = 0;
    for (const row of right.rows || []) {
      const prior = left.rows?.find(r => r.category === row.category);
      const before = num(prior?.calc?.F), after = num(row.calc?.E);
      if (before == null || after == null) continue;
      available += 1;
      if (Math.abs(after - before) > .000001) { differences += 1; lines.push(`${label} ${row.category}: ${signed(before)}원→${signed(after)}원 · 평가차이 ${signed(after - before)}원 (StockHistory 실제 조정과 별개)`); }
    }
    if (!differences) lines.push(`${label}: ${available ? '비교 가능한 품종의 평가차이 없음' : '비교 가능한 평가금액 근거 없음'}`);
  }
  return lines.join('\n');
}

export function stockAdjustmentInlineNotes(items = []) {
  return items.map(item => `${item.country} ${item.flower} / ${item.productName}: 실제 ${item.changeTypes.join('·')} ${signed(item.net, 6)} ${item.unit} · 평가액 ${signed(item.valuationAmount)}원${item.valuationAmount == null ? ' (동일 품목·단위 원가 근거 필요)' : ` (${item.valuationSources?.join(' · ') || '동일 품목·차수 검증원가'})`}`).join('\n');
}

// Reuse the report's applied average; this is a reference valuation, not historical
// StockHistory money nor a second profit adjustment. Physical OutUnit stays intact.
export function valueStockAdjustmentRows(rows, payload, displayRows) {
  return (rows || []).map(event => {
    if (num(event.valuationUnitPrice) != null) return event;
    const category = classifyProfitReportCategory({ counName: event.country, flowerName: event.flower, productName: event.productName });
    const row = displayRows.find(r => r.category === category), basis = row?.inventoryValuation?.end;
    const factor = num(event.valuationQuantityFactor), price = num(basis?.average?.unitCost);
    if (String(event.orderYear) !== String(payload.orderYear) || !String(event.orderWeek).startsWith(`${payload.major}-`)
      || String(basis?.year) !== String(payload.orderYear) || Number(basis?.major) !== Number(payload.major)
      || basis?.method !== 'category_average' || basis.unit !== event.valuationUnit || !(factor > 0)
      || price == null || num(basis.value) !== num(row?.calc?.F)) return event;
    return { ...event, valuationUnitPrice: price * factor,
      valuationSource: `보고서 평균원가 기준 조정평가액 (${payload.orderYear}/${payload.major}, ${price.toLocaleString('ko-KR')}원/${basis.unit})` };
  });
}
