import { packingSourceKey, familyForCatalog } from './importPacking.js';

export const PACKING_ERP_MATCH_KEY = 'packing.erp-matches';
export const PACKING_COUNTRIES = Object.freeze({ NL:'네덜란드', CO:'콜롬비아', CN:'중국', EC:'에콰도르', TH:'태국', AU:'호주', US:'미국', VN:'베트남' });
export const PACKING_PRODUCT_SCOPE_SQL = `SELECT ProdKey, ProdCode, ProdName, DisplayName, CounName, FlowerName
 FROM Product WHERE isDeleted = 0 AND NULLIF(LTRIM(RTRIM(ProdName)), '') IS NOT NULL`;
const fail = message => Object.assign(new Error(message), { statusCode:400 });
const identity = (country, description) => JSON.stringify([country, packingSourceKey(description)]);

export function packingErpProducts(rows) {
  const counts = new Map();
  const active = rows.filter(p => p.isDeleted == null || Number(p.isDeleted) === 0);
  for (const p of active) {
    const name = String(p.ProdName ?? '').trim().toLowerCase();
    if (name) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return active.flatMap(p => {
    const country = Object.keys(PACKING_COUNTRIES).find(code => PACKING_COUNTRIES[code] === String(p.CounName ?? '').trim());
    const name = String(p.ProdName ?? '').trim();
    if (!country || !name || !Number.isSafeInteger(Number(p.ProdKey)) || Number(p.ProdKey) <= 0) return [];
    return [{ ProdKey:Number(p.ProdKey), ProdName:name, ProdCode:String(p.ProdCode ?? ''),
      DisplayName:String(p.DisplayName ?? ''), CounName:PACKING_COUNTRIES[country], FlowerName:String(p.FlowerName ?? ''), country,
      selectable:counts.get(name.toLowerCase()) === 1,
      reason:counts.get(name.toLowerCase()) === 1 ? '' : '전산에 같은 품목명이 여러 개 있어 선택할 수 없습니다.' }];
  });
}

export function validatePackingErpMatches(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 20000) throw fail('전산 매칭 저장 형식을 확인하세요.');
  const seen = new Set();
  for (const e of value.entries) {
    if (!e || !Object.hasOwn(PACKING_COUNTRIES, e.country) || typeof e.description !== 'string' || !e.description.trim() || e.description.length > 1500 ||
        e.sourceKey !== packingSourceKey(e.description) || !Number.isSafeInteger(e.prodKey) || e.prodKey <= 0 || typeof e.prodName !== 'string' || !e.prodName.trim()) throw fail('전산 매칭 품목과 원문을 확인하세요.');
    const key = identity(e.country, e.description);
    if (seen.has(key)) throw fail('중복된 전산 매칭 원문입니다.');
    seen.add(key);
  }
  return value;
}

export function upsertPackingErpMatch(value, request, products) {
  const current = value == null ? {version:1, entries:[]} : validatePackingErpMatches(value);
  const {country, description, prodKey} = request ?? {};
  if (!Object.hasOwn(PACKING_COUNTRIES, country) || typeof description !== 'string' || !description.trim() || description.length > 1500 || !Number.isSafeInteger(prodKey)) throw fail('국가·원문·전산 품목을 선택하세요.');
  const p = products.find(p => p.ProdKey === prodKey && p.country === country);
  if (!p || !p.selectable) throw fail(p?.reason || '선택한 품목이 삭제되었거나 선택 국가의 품목이 아닙니다. 다시 조회하세요.');
  const entry = {country, description:description.trim(), sourceKey:packingSourceKey(description), prodKey:p.ProdKey, prodName:p.ProdName};
  const entries = current.entries.filter(e => identity(e.country, e.description) !== identity(country, description));
  return validatePackingErpMatches({version:1, entries:[...entries, entry]});
}

export function packingErpCatalog(products) {
  const items = products.filter(p => p.selectable).map(p => ({code:p.ProdCode, prodKey:p.ProdKey, name:p.ProdName,
    country:p.country, countryKr:p.CounName, flowerKr:p.FlowerName, family:familyForCatalog(p.ProdName)}));
  const byCountry = Object.create(null);
  for (const item of items) (byCountry[item.country] ||= []).push(item);
  return {items, byCountry, source:'erp'};
}

export function packingErpAliases(country, legacyAliases, value, products) {
  const aliases = {...legacyAliases};
  for (const e of value?.entries ?? []) {
    if (e.country !== country) continue;
    const p = products.find(p => p.ProdKey === e.prodKey && p.country === country && p.selectable && p.ProdName === e.prodName);
    // An invalid saved identity must not silently fall through to fuzzy matching.
    aliases[e.sourceKey] = p ? p.ProdName : '\u0000ERP_MATCH_REQUIRES_REVIEW';
  }
  return aliases;
}

export function packingErpMatchChanges(before, after) {
  const old = new Map((before?.entries ?? []).map(e => [identity(e.country,e.description),e]));
  return after.entries.filter(e => JSON.stringify(old.get(identity(e.country,e.description))) !== JSON.stringify(e))
    .map(e => ({country:e.country, description:e.description, before:old.get(identity(e.country,e.description)) ?? null, after:e}));
}
