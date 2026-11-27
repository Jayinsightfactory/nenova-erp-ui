import { manualWarehouseMaxRows, manualWarehouseUnits } from './manualWarehouseUpload.js';

export const MANUAL_WAREHOUSE_FAVORITES_KEY = 'warehouse.manual-favorites';
export const MANUAL_WAREHOUSE_FAVORITES_STORAGE_KEY = 'nenova:manual-warehouse-favorites:v1';
export const MAX_MANUAL_FAVORITES = 200;
export const MAX_FARM_AUTOCOMPLETE_ITEMS = 80;

const FORBIDDEN_ENTRY_FIELDS = ['orderYear', 'orderWeek', 'inputDate', 'invoiceNo', 'awb', 'quantity', 'amount'];
const FORBIDDEN_ITEM_FIELDS = ['quantity', 'amount', 'unitPrice', 'totalPrice', 'boxQty', 'bunchQty', 'steamQty', 'orderWeek'];
const VALID_AMOUNT_MODES = ['total', 'perStem'];

const fail = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode, code: 'MANUAL_FAVORITE_INVALID' });
const text = value => String(value ?? '').normalize('NFKC').trim();
const positiveIntegerText = value => {
  const cleaned = text(value);
  if (!cleaned) return '';
  if (!/^[1-9]\d{0,8}$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isSafeInteger(parsed) && parsed > 0 ? String(parsed) : null;
};

export function normalizeFarmSearchKey(value) {
  return text(value).replace(/\s+/gu, '').toLocaleLowerCase('en-US');
}

export function createManualFavoriteId(seed = '') {
  const randomPart = Math.random().toString(36).slice(2, 8);
  const timePart = Date.now().toString(36);
  const slug = text(seed).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24);
  return `fav-${slug ? `${slug}-` : ''}${timePart}-${randomPart}`;
}

export function defaultManualFavoriteName(farmName, items = []) {
  const cleanFarm = text(farmName) || '농장';
  const validItems = Array.isArray(items) ? items : [];
  const firstProd = text(validItems[0]?.prodName);
  if (!firstProd) return cleanFarm.slice(0, 80);
  const suffix = validItems.length > 1
    ? `${firstProd} 외 ${validItems.length - 1}품목`
    : `${firstProd} (${text(validItems[0]?.quantityUnit) || '송이'})`;
  return `${cleanFarm} · ${suffix}`.slice(0, 80);
}

export function buildManualFavoriteDraft({ id, name, farmName, farm, rows, actorUserId = '', now = new Date().toISOString() }) {
  const cleanFarmName = text(farmName || farm?.FarmName);
  if (!cleanFarmName || cleanFarmName.length > 100) {
    throw fail('즐겨찾기에 저장할 입고 농장을 먼저 선택하세요.');
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > manualWarehouseMaxRows) {
    throw fail(`품목 행을 1개부터 ${manualWarehouseMaxRows}개까지 구성하세요.`);
  }

  const items = rows.map((row, index) => {
    const rowNo = index + 1;
    const product = row?.product ?? null;
    const prodKey = Number(product?.ProdKey ?? row?.prodKey);
    const prodName = text(product?.ProdName ?? row?.prodName);
    const outUnit = text(product?.OutUnit ?? row?.outUnit ?? row?.expectedOutUnit);
    const estUnit = text(product?.EstUnit ?? row?.estUnit ?? row?.expectedEstUnit);
    const countryFlower = text(product?.CountryFlower ?? row?.countryFlower).slice(0, 60);
    if (!Number.isSafeInteger(prodKey) || prodKey <= 0 || !prodName) {
      throw fail(`${rowNo}행의 품목을 먼저 선택하거나 빈 행을 삭제한 뒤 즐겨찾기를 등록하세요.`);
    }
    if (!manualWarehouseUnits.includes(outUnit) || !manualWarehouseUnits.includes(estUnit)) {
      throw fail(`${rowNo}행 품목의 전산 출고·견적 단위를 확인하세요.`);
    }
    const quantityUnit = text(row?.quantityUnit);
    if (!manualWarehouseUnits.includes(quantityUnit)) {
      throw fail(`${rowNo}행의 수량 단위를 선택하세요.`);
    }
    const amountMode = text(row?.amountMode || 'total');
    if (!VALID_AMOUNT_MODES.includes(amountMode)) {
      throw fail(`${rowNo}행의 금액 기준을 확인하세요.`);
    }
    const stemsPerBunch = positiveIntegerText(row?.stemsPerBunch);
    if (stemsPerBunch === null) {
      throw fail(`${rowNo}행의 단당 송이 수는 비워두거나 양의 정수로 입력하세요.`);
    }
    const stemsPerBox = positiveIntegerText(row?.stemsPerBox);
    if (stemsPerBox === null) {
      throw fail(`${rowNo}행의 박스당 송이 수는 비워두거나 양의 정수로 입력하세요.`);
    }
    return {
      prodKey,
      prodName: prodName.slice(0, 200),
      outUnit,
      estUnit,
      ...(countryFlower ? { countryFlower } : {}),
      quantityUnit,
      stemsPerBunch,
      stemsPerBox,
      amountMode,
    };
  });

  const cleanName = (text(name) || defaultManualFavoriteName(cleanFarmName, items)).slice(0, 80);
  const rawFarmKey = farm?.FarmKey ?? farm?.farmKey ?? null;
  const farmKey = rawFarmKey != null && Number.isSafeInteger(Number(rawFarmKey)) && Number(rawFarmKey) > 0
    ? Number(rawFarmKey)
    : null;
  const countryName = text(farm?.CounName ?? farm?.countryName).slice(0, 60);
  const cleanId = text(id) && /^[a-z0-9][a-z0-9_-]{1,79}$/i.test(text(id))
    ? text(id)
    : createManualFavoriteId(cleanFarmName);

  return {
    id: cleanId,
    name: cleanName,
    farmName: cleanFarmName,
    farmKey,
    ...(countryName ? { countryName } : {}),
    items,
    updatedAt: typeof now === 'string' && now ? now : new Date().toISOString(),
    updatedBy: text(actorUserId).slice(0, 80) || 'web',
  };
}

export function validateManualWarehouseFavorites(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || !Array.isArray(value.entries)) {
    throw fail('수기입고 즐겨찾기 저장 형식을 확인하세요.');
  }
  if (value.entries.length > MAX_MANUAL_FAVORITES) {
    throw fail(`즐겨찾기는 최대 ${MAX_MANUAL_FAVORITES}개까지 저장할 수 있습니다.`);
  }
  const seenIds = new Set();
  for (const entry of value.entries) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw fail('즐겨찾기 항목 형식을 확인하세요.');
    }
    for (const forbidden of FORBIDDEN_ENTRY_FIELDS) {
      if (Object.hasOwn(entry, forbidden)) {
        throw fail('즐겨찾기에는 차수·수량·단가 등 입고 수치 정보를 저장할 수 없습니다.');
      }
    }
    const id = text(entry.id);
    if (!/^[a-z0-9][a-z0-9_-]{1,79}$/i.test(id) || seenIds.has(id)) {
      throw fail('즐겨찾기 식별자가 유효하지 않거나 중복되었습니다.');
    }
    seenIds.add(id);
    const name = text(entry.name);
    const farmName = text(entry.farmName);
    if (!name || name.length > 80 || !farmName || farmName.length > 100) {
      throw fail('즐겨찾기 이름과 농장명을 확인하세요.');
    }
    if (entry.farmKey !== null && entry.farmKey !== undefined && (!Number.isSafeInteger(entry.farmKey) || entry.farmKey <= 0)) {
      throw fail('즐겨찾기 농장 키 형식을 확인하세요.');
    }
    if (entry.countryName !== undefined && (typeof entry.countryName !== 'string' || entry.countryName.length > 60)) {
      throw fail('즐겨찾기 국가 정보 형식을 확인하세요.');
    }
    if (typeof entry.updatedAt !== 'string' || !entry.updatedAt || typeof entry.updatedBy !== 'string' || !entry.updatedBy.trim()) {
      throw fail('즐겨찾기 수정 시각과 작성자 정보를 확인하세요.');
    }
    if (!Array.isArray(entry.items) || entry.items.length === 0 || entry.items.length > manualWarehouseMaxRows) {
      throw fail(`즐겨찾기 품목 행은 1개부터 ${manualWarehouseMaxRows}개까지 저장할 수 있습니다.`);
    }
    for (const item of entry.items) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) {
        throw fail('즐겨찾기 품목 행 형식을 확인하세요.');
      }
      for (const forbidden of FORBIDDEN_ITEM_FIELDS) {
        if (Object.hasOwn(item, forbidden)) {
          throw fail('즐겨찾기 품목 행에는 수량·금액 숫자를 저장할 수 없습니다.');
        }
      }
      if (!Number.isSafeInteger(item.prodKey) || item.prodKey <= 0 || typeof item.prodName !== 'string' || !item.prodName.trim() || item.prodName.length > 200) {
        throw fail('즐겨찾기 품목 정보를 확인하세요.');
      }
      if (!manualWarehouseUnits.includes(item.outUnit) || !manualWarehouseUnits.includes(item.estUnit) || !manualWarehouseUnits.includes(item.quantityUnit)) {
        throw fail('즐겨찾기 품목 단위 정보를 확인하세요.');
      }
      if (!VALID_AMOUNT_MODES.includes(item.amountMode)) {
        throw fail('즐겨찾기 금액 기준 조건을 확인하세요.');
      }
      if (typeof item.stemsPerBunch !== 'string' || positiveIntegerText(item.stemsPerBunch) === null) {
        throw fail('즐겨찾기 단당 송이 수 조건을 확인하세요.');
      }
      if (typeof item.stemsPerBox !== 'string' || positiveIntegerText(item.stemsPerBox) === null) {
        throw fail('즐겨찾기 박스당 송이 수 조건을 확인하세요.');
      }
    }
  }
}

export function manualWarehouseFavoriteChanges(before, after) {
  const prevMap = new Map((before?.entries ?? []).map(entry => [entry.id, entry]));
  const nextMap = new Map((after?.entries ?? []).map(entry => [entry.id, entry]));
  const ids = [...new Set([...prevMap.keys(), ...nextMap.keys()])];
  return ids
    .filter(id => JSON.stringify(prevMap.get(id)) !== JSON.stringify(nextMap.get(id)))
    .map(id => ({
      id,
      name: (nextMap.get(id) ?? prevMap.get(id))?.name ?? id,
      farmName: (nextMap.get(id) ?? prevMap.get(id))?.farmName ?? '',
      beforeItemCount: prevMap.get(id)?.items?.length ?? 0,
      afterItemCount: nextMap.get(id)?.items?.length ?? 0,
    }));
}

export function upsertManualFavoriteValue(currentValue, draft) {
  const baseEntries = Array.isArray(currentValue?.entries) ? currentValue.entries : [];
  const filtered = baseEntries.filter(entry => entry.id !== draft.id);
  const next = {
    version: 1,
    entries: [draft, ...filtered].slice(0, MAX_MANUAL_FAVORITES),
  };
  validateManualWarehouseFavorites(next);
  return next;
}

export function deleteManualFavoriteValue(currentValue, id) {
  const cleanId = text(id);
  if (!cleanId) throw fail('삭제할 즐겨찾기를 선택하세요.');
  const baseEntries = Array.isArray(currentValue?.entries) ? currentValue.entries : [];
  const next = {
    version: 1,
    entries: baseEntries.filter(entry => entry.id !== cleanId),
  };
  validateManualWarehouseFavorites(next);
  return next;
}

export function mergeManualFavoriteLists(serverEntries = [], localEntries = []) {
  const merged = new Map();
  for (const source of [localEntries, serverEntries]) {
    if (!Array.isArray(source)) continue;
    for (const entry of source) {
      if (!entry?.id) continue;
      try {
        validateManualWarehouseFavorites({ version: 1, entries: [entry] });
      } catch {
        continue;
      }
      const existing = merged.get(entry.id);
      if (!existing || String(entry.updatedAt || '') >= String(existing.updatedAt || '')) {
        merged.set(entry.id, entry);
      }
    }
  }
  return [...merged.values()]
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')))
    .slice(0, MAX_MANUAL_FAVORITES);
}

export function applyManualFavoriteToForm(favorite, catalogProducts = [], allocateRowId = () => 1) {
  if (!favorite || !Array.isArray(favorite.items) || favorite.items.length === 0) {
    throw fail('불러올 즐겨찾기 품목이 없습니다.');
  }
  const byKey = new Map();
  const byName = new Map();
  for (const product of Array.isArray(catalogProducts) ? catalogProducts : []) {
    if (product?.ProdKey != null) byKey.set(Number(product.ProdKey), product);
    const nameKey = text(product?.ProdName).toLowerCase();
    if (nameKey && !byName.has(nameKey)) byName.set(nameKey, product);
  }
  const hasCatalog = byKey.size > 0;
  const missingProducts = [];

  const rows = favorite.items.map(item => {
    const matched = byKey.get(Number(item.prodKey))
      ?? byName.get(text(item.prodName).toLowerCase())
      ?? (hasCatalog ? null : {
        ProdKey: item.prodKey,
        ProdName: item.prodName,
        OutUnit: item.outUnit,
        EstUnit: item.estUnit,
        ...(item.countryFlower ? { CountryFlower: item.countryFlower } : {}),
      });
    if (!matched) missingProducts.push(item.prodName);
    return {
      id: allocateRowId(),
      product: matched,
      quantity: '',
      quantityUnit: manualWarehouseUnits.includes(item.quantityUnit) ? item.quantityUnit : '송이',
      stemsPerBunch: typeof item.stemsPerBunch === 'string' ? item.stemsPerBunch : '',
      stemsPerBox: typeof item.stemsPerBox === 'string' ? item.stemsPerBox : '',
      amountMode: VALID_AMOUNT_MODES.includes(item.amountMode) ? item.amountMode : 'total',
      amount: '',
    };
  });

  return {
    farmName: text(favorite.farmName),
    rows,
    missingProducts,
  };
}

export function rankManualWarehouseFarms({
  farms = [],
  recentManualFarms = [],
  favorites = [],
  query = '',
  limit = MAX_FARM_AUTOCOMPLETE_ITEMS,
} = {}) {
  const favoriteCounts = new Map();
  for (const fav of Array.isArray(favorites) ? favorites : []) {
    const key = text(fav?.farmName);
    if (key) favoriteCounts.set(key, (favoriteCounts.get(key) || 0) + 1);
  }
  const recentByFarm = new Map();
  for (const rec of Array.isArray(recentManualFarms) ? recentManualFarms : []) {
    const name = text(rec?.farmName ?? rec?.FarmName);
    if (!name) continue;
    recentByFarm.set(name, {
      useCount: Number(rec?.useCount ?? rec?.UseCount ?? 0) || 0,
      lastWarehouseKey: Number(rec?.lastWarehouseKey ?? rec?.LastWarehouseKey ?? 0) || 0,
    });
  }

  const uniqueFarms = [];
  const seenNames = new Set();
  for (const raw of Array.isArray(farms) ? farms : []) {
    const farmName = typeof raw === 'string' ? text(raw) : text(raw?.FarmName ?? raw?.farmName);
    if (!farmName || seenNames.has(farmName)) continue;
    seenNames.add(farmName);
    const recent = recentByFarm.get(farmName);
    const favoriteCount = favoriteCounts.get(farmName) || 0;
    uniqueFarms.push({
      farmName,
      farmKey: raw?.FarmKey ?? raw?.farmKey ?? null,
      countryName: text(raw?.CounName ?? raw?.countryName),
      favoriteCount,
      manualUseCount: recent?.useCount || 0,
      lastWarehouseKey: recent?.lastWarehouseKey || 0,
      searchKey: normalizeFarmSearchKey(farmName),
      lowerName: farmName.toLocaleLowerCase('en-US'),
    });
  }

  const normalizedQuery = normalizeFarmSearchKey(query);
  const rawLowerQuery = text(query).toLocaleLowerCase('en-US');

  const filtered = !normalizedQuery
    ? uniqueFarms
    : uniqueFarms.filter(item =>
      item.searchKey.includes(normalizedQuery) || (rawLowerQuery && item.lowerName.includes(rawLowerQuery))
    );

  const ranked = [...filtered].sort((a, b) => {
    if (normalizedQuery) {
      const aExact = a.searchKey === normalizedQuery ? 1 : 0;
      const bExact = b.searchKey === normalizedQuery ? 1 : 0;
      if (aExact !== bExact) return bExact - aExact;

      const aPrefix = a.searchKey.startsWith(normalizedQuery) ? 1 : 0;
      const bPrefix = b.searchKey.startsWith(normalizedQuery) ? 1 : 0;
      if (aPrefix !== bPrefix) return bPrefix - aPrefix;
    }

    const aPriority = a.favoriteCount > 0 || a.manualUseCount > 0 ? 1 : 0;
    const bPriority = b.favoriteCount > 0 || b.manualUseCount > 0 ? 1 : 0;
    if (aPriority !== bPriority) return bPriority - aPriority;
    if (a.favoriteCount !== b.favoriteCount) return b.favoriteCount - a.favoriteCount;
    if (a.manualUseCount !== b.manualUseCount) return b.manualUseCount - a.manualUseCount;
    if (a.lastWarehouseKey !== b.lastWarehouseKey) return b.lastWarehouseKey - a.lastWarehouseKey;
    return a.farmName.localeCompare(b.farmName, 'ko-KR');
  });

  const maxItems = Number.isSafeInteger(limit) && limit > 0 ? limit : MAX_FARM_AUTOCOMPLETE_ITEMS;
  return {
    totalMatches: ranked.length,
    totalFarms: uniqueFarms.length,
    items: ranked.slice(0, maxItems).map(({ searchKey: _sk, lowerName: _ln, ...publicItem }) => publicItem),
  };
}
