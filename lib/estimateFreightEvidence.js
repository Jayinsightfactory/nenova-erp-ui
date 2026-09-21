import { isFreightRow } from './estimateFreightPolicy.js';

// User-approved customer default; no master-price writes. Manual edits take precedence.
export function freightPriceSuggestion(rows, prodKey, weekShort, customer, products) {
  const product = products.find(row => Number(row.ProdKey) === Number(prodKey));
  const name = String(customer?.CustName || '').trim();
  if (['(주)영남꽃소재', '영남꽃소재'].includes(name) && product?.OutUnit === '박스') {
    const freightName = String(product.ProdName || '').trim();
    if (freightName === '현지상차운임') return {cost:2000,evidence:'영남꽃소재 지정 기본값 · 상차운임 2,000원/박스 · 수정 가능'};
    if (/^(?:.+ )?운송료$/.test(freightName)) return {cost:1500,evidence:'영남꽃소재 특가 기본값 · 운송료 1,500원/박스 · 수정 가능'};
  }
  return freightPriceEvidence(rows, prodKey, weekShort);
}

// Evidence is a suggestion, never an instruction to create freight or combine weeks.
export function freightEvidenceRows(rows, { year, custKey, parentWeek }) {
  return rows.filter(row => String(row.OrderYear) === String(year)
    && Number(row.CustKey) === Number(custKey)
    && /^\d{2}-0[1-3]$/.test(String(row.OrderWeek))
    && Number(row.OrderWeek.slice(0, 2)) <= Number(parentWeek)
    && isFreightRow(row) && !row.EstimateKey && (!row.EstimateType || row.EstimateType === '정상출고')
    && !/차감/.test(`${row.ProdName || ''} ${row.Descr || ''}`)
    && Number(row.Quantity) > 0 && Number(row.Cost) > 0 && Number.isFinite(Number(row.Cost)) && row.Unit === '박스');
}

export function freightPriceEvidence(rows, prodKey, weekShort) {
  const matches = rows.filter(row => Number(row.ProdKey) === Number(prodKey));
  if (!matches.length) return { cost: '', evidence: '이 업체의 확인된 단가 없음 · 직접 입력' };
  const latest = matches.map(row => row.OrderWeek.slice(0, 2)).sort().at(-1);
  const recent = matches.filter(row => row.OrderWeek.startsWith(latest + '-'));
  const sameSubweek = recent.filter(row => row.OrderWeek.slice(3) === weekShort.slice(3));
  const candidates = sameSubweek.length ? sameSubweek : recent;
  const prices = [...new Set(candidates.map(row => Number(row.Cost)))];
  const source = candidates.map(row => `${row.OrderWeek} ${row.Quantity}박스 × ${row.Cost}원${row.Descr ? ` (${row.Descr})` : ''}`).join(' / ');
  return { cost: prices.length === 1 ? prices[0] : '', evidence: `${prices.length === 1 ? '업체 실적' : '단가 상이 · 선택 필요'}: ${source}` };
}

export function freightCategoryFromEvidence(row, evidence) {
  const countryName = `${row.CounName || ''} 운송료`;
  const varietyName = `${row.FlowerName || row.CounName || ''} 운송료`;
  const names = new Set(evidence.map(item => item.ProdName));
  // Only an actual customer freight product can establish a country-level candidate.
  return names.has(countryName) ? countryName : varietyName;
}
