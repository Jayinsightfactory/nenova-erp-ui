import { boxEquivalent, roundBoxes, FREIGHT_ROUNDING } from './estimateFreightPolicy.js';

const FREIGHT_NAME_RE = /운송료|운송비|항공료|항공비|freight|shipping|service fee|현지상차운임/i;

export function isFreightProductName(name) {
  return FREIGHT_NAME_RE.test(String(name || ''));
}

function categoryKey(row) {
  const country = String(row?.CounName || row?.country || '').trim();
  const flower = String(row?.FlowerName || row?.flower || '').trim();
  return `${country}\u0000${flower}`;
}

export function freightCategoryLabel(row) {
  const country = String(row?.CounName || row?.country || '').trim();
  const flower = String(row?.FlowerName || row?.flower || '').trim();
  return country && flower ? `${country} ${flower}` : (country || flower || '기타');
}

export function buildFreightApplyPlan({ sourceRows = [], existingRows = [], products = [], rounding = FREIGHT_ROUNDING.CEIL,
  loadingUnitPrice = 0, transportUnitPrice = 0 }) {
  const byWeek = new Map();
  for (const row of sourceRows) {
    if (isFreightProductName(row.ProdName) || Number(row.Quantity ?? row.OutQuantity ?? 0) <= 0) continue;
    const week = String(row.OrderWeek || row.week || '').trim();
    if (!week) continue;
    const raw = boxEquivalent({
      ...row,
      Quantity: row.Quantity ?? row.OutQuantity,
      Unit: row.Unit || row.OutUnit,
      BoxQty: row.BoxQty ?? row.BoxQuantity,
      BunchesPerBox: row.BunchesPerBox ?? row.BunchOf1Box,
      SteamsPerBox: row.SteamsPerBox ?? row.SteamOf1Box,
    });
    if (!(raw > 0)) continue;
    const wk = byWeek.get(week) || { week, rawBoxes: 0, categories: new Map() };
    const key = categoryKey(row);
    const cat = wk.categories.get(key) || {
      key,
      country: String(row.CounName || row.country || '').trim(),
      flower: String(row.FlowerName || row.flower || '').trim(),
      label: freightCategoryLabel(row),
      rawBoxes: 0,
    };
    cat.rawBoxes += raw;
    wk.rawBoxes += raw;
    wk.categories.set(key, cat);
    byWeek.set(week, wk);
  }

  const existing = new Set(existingRows.map((row) => [String(row.OrderWeek || ''), Number(row.ProdKey)].join(':')));
  const planned = [];
  for (const weekRow of byWeek.values()) {
    const loadingBoxes = roundBoxes(weekRow.rawBoxes, rounding);
    if (loadingBoxes > 0) planned.push({
      kind: 'LOADING', week: weekRow.week, category: null,
      boxes: loadingBoxes, unitPrice: Number(loadingUnitPrice) || 0,
    });
    for (const category of weekRow.categories.values()) {
      const boxes = roundBoxes(category.rawBoxes, rounding);
      if (boxes > 0) planned.push({ kind: 'TRANSPORT', week: weekRow.week, category, boxes, unitPrice: Number(transportUnitPrice) || 0 });
    }
  }
  const productByPlan = planned.map((row) => {
    const candidates = products.filter((p) => isFreightProductName(p.ProdName));
    const existingMatch = existingRows.find((existingRow) => String(existingRow.OrderWeek || '') === row.week
      && (row.kind === 'LOADING'
        ? /현지상차운임/i.test(String(existingRow.ProdName || ''))
        : categoryKey(existingRow) === categoryKey(row.category || {})));
    if (existingMatch) {
      const persisted = candidates.find((p) => Number(p.ProdKey) === Number(existingMatch.ProdKey));
      if (persisted) return { ...row, product: persisted, ambiguous: false };
    }
    const scored = candidates.map((p) => ({ product: p, score: scoreFreightProduct(p, row) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score || Number(a.product.ProdKey) - Number(b.product.ProdKey));
    const best = scored[0];
    const tied = best && scored.filter((x) => x.score === best.score);
    return { ...row, product: best?.product || null, ambiguous: Boolean(tied?.length > 1 && tied[0].score === best.score) };
  });
  const inserts = productByPlan.filter((row) => row.product && !existing.has(`${row.week}:${Number(row.product.ProdKey)}`));
  const skipped = productByPlan.filter((row) => row.product && existing.has(`${row.week}:${Number(row.product.ProdKey)}`));
  const unresolved = productByPlan.filter((row) => !row.product || row.ambiguous);
  return { planned: productByPlan, inserts, skipped, unresolved };
}

function scoreFreightProduct(product, row) {
  const name = String(product?.ProdName || '').trim();
  if (!name) return 0;
  if (row.kind === 'LOADING') return /현지상차운임/i.test(name) ? 100 : 0;
  if (!/운송료|운송비|freight|shipping|service fee/i.test(name)) return 0;
  const country = String(row.category?.country || '').trim();
  const flower = String(row.category?.flower || '').trim();
  const productCountry = String(product?.CounName || '').trim();
  const productFlower = String(product?.FlowerName || '').trim();
  const lower = name.toLowerCase();
  let score = 10;
  if (country && lower.includes(`${country.toLowerCase()} 운송료`)) score = 95;
  if (flower && lower.includes(`${flower.toLowerCase()} 운송료`)) score = Math.max(score, 90);
  if (country && lower.includes(country.toLowerCase())) score = Math.max(score, 60);
  if (flower && lower.includes(flower.toLowerCase())) score = Math.max(score, 55);
  if (country && productCountry === country) score = Math.max(score, 70);
  if (flower && productFlower === flower) score = Math.max(score, 75);
  if (country && flower && productCountry === country && productFlower === flower) score = Math.max(score, 98);
  return score;
}

export function freightApplyAmounts(row, product, distributeUnits, amountVatFromCostEst) {
  const units = distributeUnits(row.boxes, product);
  const money = amountVatFromCostEst(row.unitPrice, units.estQty);
  return { ...units, ...money };
}
