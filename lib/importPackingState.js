import { ALL_SEED_ALIASES, aliasKey, familyForCatalog, normalize } from './importPacking.js';

export const PACKING_PDF_MAX_BYTES = 20 * 1024 * 1024;

/** Catalog XLSX already supplies code (stable identity) and name (fallback). */
export function packingCatalogKey(item) {
  const code = String(item.code ?? '').trim();
  return JSON.stringify([item.country, code ? 'code' : 'name', code || normalize(item.name)]);
}

/** Pure preview: preserve existing rows; only duplicate upload rows use last-row wins. */
export function previewPackingCatalog(existing, incoming) {
  const oldCatalog = existing == null ? indexPackingCatalog({ items: [] }) : indexPackingCatalog(existing);
  const uploaded = indexPackingCatalog(incoming);
  if (!uploaded.items.length) throw new Error('Empty catalog.');
  const unique = new Map(uploaded.items.map(item => [packingCatalogKey(item), item]));
  const oldKeyCounts = new Map();
  for (const item of oldCatalog.items) {
    const key = packingCatalogKey(item);
    oldKeyCounts.set(key, (oldKeyCounts.get(key) || 0) + 1);
  }
  for (const [key, item] of unique) {
    if (oldKeyCounts.get(key) > 1) {
      throw new Error(`Catalog upload blocked: ${oldKeyCounts.get(key)} existing products share the key for country ${item.country}, ${String(item.code ?? '').trim() ? 'code ' + item.code : 'name ' + item.name}. Resolve the existing duplicates before uploading this product; no rows were changed.`);
    }
  }
  const oldKeys = new Set(oldKeyCounts.keys());
  const mergedItems = oldCatalog.items.map(item => {
    const uploadedItem = unique.get(packingCatalogKey(item));
    return uploadedItem ? { ...item, ...uploadedItem } : item;
  });
  for (const [key, item] of unique) if (!oldKeys.has(key)) mergedItems.push(item);
  const merge = indexPackingCatalog({ ...oldCatalog, savedAt: uploaded.savedAt, items: mergedItems });
  const replace = indexPackingCatalog({ ...uploaded, items: [...unique.values()] });
  const countries = [...new Set([...oldCatalog.items, ...replace.items].map(item => item.country))].sort()
    .map(country => {
      const items = replace.byCountry[country] || [];
      const added = items.filter(item => !oldKeys.has(packingCatalogKey(item))).length;
      return { country, existing: (oldCatalog.byCountry[country] || []).length,
        incoming: items.length, added, updated: items.length - added,
        mergeResult: (merge.byCountry[country] || []).length,
        replaceResult: items.length };
    });
  return { merge, replace, countries, duplicateRows: uploaded.items.length - unique.size };
}

/** Source descriptions, not generated rows or transformed catalog names. */
export function distinctPackingVarieties(entries = []) {
  const seen = new Set();
  return entries.filter(entry => {
    const key = aliasKey(entry.description);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function packingUnmatchedCounts(excel) {
  const rows = (excel.products || []).filter(product => product.unmatched);
  const decisions = [...(excel.pending || []), ...(excel.noMatches || [])];
  // All current generators expose source decisions; fallback keeps legacy data visible.
  const entries = decisions.length ? decisions : rows.map(product => ({
    description: product.description ?? product.originalDesc ?? product.name,
  }));
  return { varieties: distinctPackingVarieties(entries).length, rows: rows.length };
}

/** Do not display a gateway HTML error page or leak its body to the UI. */
export async function readPackingPdfResponse(response) {
  let data;
  try { data = await response.json(); } catch {
    if (response.status === 413) throw new Error('HTTP 413: PDF request too large. Limit: 20MiB. Split/compress the PDF; if it is already within the limit, ask the administrator to check the server upload limit.');
    throw new Error(`HTTP ${response.status}: server returned a non-JSON response. Retry; if it persists, check the server/proxy upload configuration.`);
  }
  if (!response.ok) {
    if (response.status === 413) throw new Error('HTTP 413: PDF request too large. Limit: 20MiB. Split/compress the PDF or ask the administrator to check the server upload limit.');
    const detail = data?.error?.message ?? data?.error ?? data?.message;
    throw new Error(`HTTP ${response.status}: ${typeof detail === 'string' ? detail : 'PDF processing failed. Retry or contact the administrator.'}`);
  }
  return data;
}

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
