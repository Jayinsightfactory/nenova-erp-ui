import { ALL_SEED_ALIASES, aliasKey, familyForCatalog } from './importPacking.js';

/** The parent maps original keys to packing.catalog / packing.aliases. */
export const PACKING_STORAGE_KEYS = Object.freeze({
  catalog: 'nenova_catalog', aliases: 'nenova_aliases',
});

export function requirePackingStorage(storage) {
  if (!storage || ['get', 'set', 'delete'].some(k => typeof storage[k] !== 'function')) {
    throw new Error('Shared packing storage is not configured.');
  }
  return storage;
}

export async function writePackingRecord(storage, key, value) {
  requirePackingStorage(storage);
  const result = value === null
    ? await storage.delete(key)
    : await storage.set(key, JSON.stringify(value));
  if (result?.success === false) throw new Error(result.error?.message || result.error || 'Shared save failed.');
  return result;
}

export async function savePackingAliases(storage, aliases) {
  const userOnly = Object.fromEntries(Object.entries(validatePackingAliases(aliases))
    .filter(([key, value]) => ALL_SEED_ALIASES[key] !== value));
  await writePackingRecord(storage, PACKING_STORAGE_KEYS.aliases, userOnly);
}

export function validatePackingAliases(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid shared matches.');
  const out = {};
  for (const [key, name] of Object.entries(value)) {
    if (typeof name !== 'string' || !name.trim() || !aliasKey(key)) throw new Error('Invalid match: ' + key);
    const normalized = aliasKey(key);
    if (Object.prototype.hasOwnProperty.call(out, normalized) && out[normalized] !== name) {
      throw new Error('Conflicting shared matches: ' + key);
    }
    out[normalized] = name;
  }
  return out;
}

export function indexPackingCatalog(value) {
  if (!value || !Array.isArray(value.items)) throw new Error('Invalid shared catalog.');
  const items = value.items.map(item => {
    if (!item || typeof item.name !== 'string' || !item.name.trim() ||
        typeof item.country !== 'string') throw new Error('Invalid catalog product.');
    return { ...item, family: item.family || familyForCatalog(item.name) };
  });
  const byCountry = Object.create(null);
  for (const item of items) (byCountry[item.country] ||= []).push(item);
  return { ...value, items, byCountry };
}

export async function readPackingRecords(storage) {
  requirePackingStorage(storage);
  const [catalog, aliases] = await Promise.all([
    storage.get(PACKING_STORAGE_KEYS.catalog), storage.get(PACKING_STORAGE_KEYS.aliases),
  ]);
  const decode = record => {
    if (record?.success === false) throw new Error(record.error?.message || record.error || 'Shared load failed.');
    if (record == null || record.value == null) return null;
    if (typeof record.value !== 'string') throw new Error('Shared storage must return JSON strings.');
    return JSON.parse(record.value);
  };
  const catalogValue = decode(catalog), aliasValue = decode(aliases);
  return {
    catalog: catalogValue == null ? null : indexPackingCatalog(catalogValue),
    aliases: { ...ALL_SEED_ALIASES, ...(aliasValue == null ? {} : validatePackingAliases(aliasValue)) },
  };
}

/** Block from result facts, never from filenames or a truthy invoice number. */
export function isPackingDownloadBlocked(excel, { pending = [], noMatches = [],
  overrides = new Set(), truncated = false } = {}) {
  if (!excel || truncated || pending.length || noMatches.length ||
      (excel.products || []).some(product => product.unmatched)) return true;
  const mismatch = excel.totalMismatch;
  return !!(mismatch && !overrides.has(mismatch.country + '|' + mismatch.invoice));
}
