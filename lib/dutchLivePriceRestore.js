import { dutchCustomerIdentity, dutchPriceKey, normalizeDutchBulkPriceConfig } from './dutchVolumePrice.js';

const prefix = 'nenova.dutch-live-price.v1:';
const validPrice = value => value === '' || (value !== null && value !== undefined && ['number', 'string'].includes(typeof value) && String(value).trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1e9);
const samePrice = (a, b) => a === '' || b === '' ? a === b : Number(a) === Number(b);
const normalize = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
const sourceIdentity = entry => JSON.stringify([entry.sourceFlower || entry.product, entry.sourceItem || entry.color, entry.sourceColor || '', entry.sourceCustomer || entry.customer].map(normalize));
const keys = (entry, matches) => {
  const match = matches?.[entry.id];
  return { custKey: Number(entry.custKey || entry.sourceCustKey || (match?.status === 'matched' ? match.custKey : 0)), prodKey: Number(entry.prodKey || (match?.status === 'matched' ? match.prodKey : 0)) };
};
const positive = value => Number.isSafeInteger(value) && value > 0;

export function dutchCurrentPrices(preview) {
  const values = {};
  for (const row of preview?.rows || []) {
    if (row.currentCost === '' || !validPrice(row.currentCost)) continue;
    for (const id of row.entryIds || []) values[id] = Number(row.currentCost);
  }
  return values;
}

// Only pending edits enter this cache. A displayed DB value must not become a
// stale override of a later DB value after another user updates the shipment.
export function buildDutchPriceCarry({ year, week, entries, prices, bulkPriceConfig, matches = {}, baseline = {} }) {
  const records = [];
  for (const entry of entries || []) {
    const key = dutchPriceKey(entry, bulkPriceConfig);
    if (!Object.hasOwn(prices || {}, key) || !validPrice(prices[key])) continue;
    const price = prices[key];
    if (Object.hasOwn(baseline, entry.id) && samePrice(price, baseline[entry.id])) continue;
    records.push({ ...keys(entry, matches), source: sourceIdentity(entry), price });
  }
  return { version: 1, year: Number(year), week: String(week), records };
}

export function readDutchPriceCarry(storage, year, week) {
  try {
    const value = JSON.parse(storage.getItem(`${prefix}${year}:${week}`));
    return value?.version === 1 && value.year === Number(year) && value.week === String(week) && Array.isArray(value.records) && value.records.length <= 5000 ? value : null;
  } catch { return null; }
}

export function writeDutchPriceCarry(storage, carry) {
  try { storage.setItem(`${prefix}${carry.year}:${carry.week}`, JSON.stringify(carry)); return true; }
  catch { return false; }
}

export function restoreDutchLivePrices({ year, week, entries, preview, carry, bulkPriceConfig }) {
  const baseline = dutchCurrentPrices(preview);
  const values = { ...baseline };
  const matches = Object.fromEntries((preview?.entryMatches || []).map(row => [row.id, row]));
  const records = carry?.version === 1 && carry.year === Number(year) && carry.week === String(week) && Array.isArray(carry.records) && carry.records.length <= 5000 ? carry.records : [];
  const byPair = new Map(), bySource = new Map();
  for (const record of records) {
    if (!validPrice(record?.price)) continue;
    const resolved = positive(record.custKey) && positive(record.prodKey);
    const index = resolved ? byPair : bySource;
    const key = resolved ? `${record.custKey}:${record.prodKey}` : record.source;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(record);
  }
  let restoredCount = 0, conflictCount = 0;
  for (const entry of entries) {
    const target = keys(entry, matches);
    if (matches[entry.id]?.status !== 'matched' || !positive(target.custKey) || !positive(target.prodKey)) continue;
    const candidates = [...(byPair.get(`${target.custKey}:${target.prodKey}`) || []), ...(bySource.get(sourceIdentity(entry)) || [])].filter(record => {
      if (positive(record.custKey) && record.custKey !== target.custKey) return false;
      if (positive(record.prodKey) && record.prodKey !== target.prodKey) return false;
      if (positive(record.custKey) && positive(record.prodKey)) return true;
      return record.source === sourceIdentity(entry);
    });
    if (!candidates.length) continue;
    if (candidates.some(row => !samePrice(row.price, candidates[0].price))) { conflictCount += 1; continue; }
    values[entry.id] = candidates[0].price;
    restoredCount += 1;
  }

  const config = normalizeDutchBulkPriceConfig(bulkPriceConfig, entries);
  const groups = new Map();
  for (const entry of entries) {
    const key = dutchPriceKey(entry, config);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const exclusions = new Set(config.excludedCustomers);
  for (const group of groups.values()) {
    const first = group[0];
    if (group.some(entry => Object.hasOwn(values, entry.id) !== Object.hasOwn(values, first.id)
      || (Object.hasOwn(values, entry.id) && !samePrice(values[entry.id], values[first.id])))) {
      // Never spread one customer's restored price into another customer's
      // blank or different price through a shared uniform-price key.
      for (const entry of group) exclusions.add(dutchCustomerIdentity(entry));
    }
  }
  const nextConfig = { ...config, excludedCustomers: [...exclusions] };
  const prices = {}, blocked = new Set();
  for (const entry of entries) {
    if (!Object.hasOwn(values, entry.id)) continue;
    const key = dutchPriceKey(entry, nextConfig);
    if (blocked.has(key)) continue;
    if (Object.hasOwn(prices, key) && !samePrice(prices[key], values[entry.id])) {
      delete prices[key]; blocked.add(key); conflictCount += 1;
    } else prices[key] = values[entry.id];
  }
  return { prices, bulkPriceConfig: nextConfig, baseline, restoredCount, conflictCount, storedCount: Object.keys(baseline).length, individualized: exclusions.size > config.excludedCustomers.length };
}
