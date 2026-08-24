const number = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function resolveRaumNenovaPct(value, defaultValue = 80) {
  if (value == null || value === '') return defaultValue;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : defaultValue;
}

function quoteMonth(row) {
  const raw = row?.QuoteDate;
  if (raw) {
    const match = String(raw).match(/^(\d{4})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
  }
  const year = String(row?.OrderYear || '').match(/^\d{4}$/)?.[0] || '연도미정';
  return `${year}-날짜미지정`;
}

/** 차수별 저장 요약을 견적일 월 기준으로 합산한다. DB 쓰기는 없다. */
export function buildRaumPnlMonthlySummary(rows, defaultNenovaPct = 80) {
  const groups = new Map();
  for (const row of rows || []) {
    const month = quoteMonth(row);
    const current = groups.get(month) || {
      month,
      count: 0,
      weeks: [],
      sale: 0,
      consignedSale: 0,
      pnlSale: 0,
      cost: 0,
      profit: 0,
      nenova: 0,
      miu: 0,
      missingCost: 0,
    };
    const sale = number(row.SaleTotal);
    const pnlSale = row.PnlSaleTotal == null ? sale : number(row.PnlSaleTotal);
    const cost = number(row.CostTotal);
    const profit = row.ProfitTotal == null ? pnlSale - cost : number(row.ProfitTotal);
    const nenovaPct = resolveRaumNenovaPct(row.NenovaPct, defaultNenovaPct);
    current.count += 1;
    current.weeks.push(`${row.OrderYear || ''}-${String(row.MajorWeek || '').padStart(2, '0')}`);
    current.sale += sale;
    current.consignedSale += number(row.ConsignedSale);
    current.pnlSale += pnlSale;
    current.cost += cost;
    current.profit += profit;
    current.nenova += profit * (nenovaPct / 100);
    current.miu += profit * ((100 - nenovaPct) / 100);
    current.missingCost += number(row.MissingCost);
    groups.set(month, current);
  }

  return [...groups.values()]
    .map(group => ({ ...group, rate: group.pnlSale !== 0 ? group.profit / group.pnlSale : null }))
    .sort((a, b) => b.month.localeCompare(a.month));
}
