import { packingSourceKey } from './importPacking.js';
import { PACKING_COUNTRIES } from './importPackingErpMatches.js';
import { invoiceSupplierKey, rankedInvoiceFarmSources, resolveInvoiceHeader } from './invoiceReceiptAutoFill.js';
import { listInvoiceFarmSources } from './invoiceFarmSource.js';
import { readImportTeamRecord, writeImportTeamRecord } from './importTeamStore.js';

export const PACKING_FARM_MATCH_KEY = 'packing.farm-matches';

const fail = message => Object.assign(new Error(message), { statusCode: 400 });
const text = value => String(value ?? '').normalize('NFKC').trim();
const identity = (country, supplier) => JSON.stringify([country, packingSourceKey(supplier)]);
const VALID_CO_REGIONS = new Set(['ANTIOQUIA', 'BOGOTA']);

export function normalizePackingAbbr(value) {
  const cleaned = text(value).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
  if (!/^[A-Z0-9]{3}$/.test(cleaned) || cleaned === 'UNK') return '';
  return cleaned;
}

export function normalizePackingShort(value, fallback = '') {
  const source = text(value || fallback)
    .toUpperCase()
    .replace(/\bC\.?\s*I\.?\b/g, ' ')
    .replace(/\bS\.?\s*A\.?\s*S\.?\b/g, ' ')
    .replace(/\b(?:SAS|SA|LTD|LIMITED|INC|CORPORATION|FLOWERS|FLORES|FARMS|FARM|EXPORT|GRUPO)\b/g, ' ')
    .replace(/[^A-Z0-9가-힣\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const result = (source || text(fallback).toUpperCase()).slice(0, 24).trim();
  return result === 'UNK' ? '' : result;
}

export function suggestColombiaPackingDefaults(supplier, products = []) {
  const short = normalizePackingShort(supplier, supplier) || 'FARM';
  const lettersOnly = short.replace(/[^A-Z]/g, '');
  let abbr = lettersOnly.slice(0, 3);
  if (abbr.length < 3) {
    const rawLetters = text(supplier).toUpperCase().replace(/[^A-Z]/g, '');
    abbr = (lettersOnly + rawLetters).slice(0, 3).padEnd(3, 'X');
  }
  if (abbr === 'UNK') abbr = 'FRM';
  const hasHydrangea = (Array.isArray(products) ? products : []).some(item => {
    const desc = text(item?.matchingDescription || item?.sourceName || item?.description || item?.source_description).toUpperCase();
    return /HYDRANGEA|HORTENSIA|수국/.test(desc);
  });
  return {
    packingAbbr: abbr,
    packingShort: short.slice(0, 16),
    coRegion: hasHydrangea ? 'ANTIOQUIA' : 'BOGOTA',
  };
}

export function validatePackingFarmMatches(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.entries) || value.entries.length > 10000) {
    throw fail('전산 농장 매칭 저장 형식을 확인하세요.');
  }
  const seen = new Set();
  for (const entry of value.entries) {
    if (!entry || !Object.hasOwn(PACKING_COUNTRIES, entry.country)) {
      throw fail('농장 매칭 국가를 확인하세요.');
    }
    if (typeof entry.supplier !== 'string' || !entry.supplier.trim() || entry.supplier.length > 500) {
      throw fail('인보이스 원문 농장명을 확인하세요.');
    }
    const expectedKey = packingSourceKey(entry.supplier);
    if (!expectedKey || entry.supplierKey !== expectedKey) {
      throw fail('농장 매칭 원문 키 형식을 확인하세요.');
    }
    const hasFarmKey = entry.farmKey !== null && entry.farmKey !== undefined;
    const hasWarehouseKey = entry.farmSourceWarehouseKey !== null && entry.farmSourceWarehouseKey !== undefined;
    if (!hasFarmKey && !hasWarehouseKey) {
      throw fail('연결할 전산 농장 또는 기존 입고 농장 이력을 선택하세요.');
    }
    if (hasFarmKey && (!Number.isSafeInteger(entry.farmKey) || entry.farmKey <= 0)) {
      throw fail('전산 농장 번호(FarmKey)를 확인하세요.');
    }
    if (hasWarehouseKey && (!Number.isSafeInteger(entry.farmSourceWarehouseKey) || entry.farmSourceWarehouseKey <= 0)) {
      throw fail('기존 입고 농장 이력 번호(WarehouseKey)를 확인하세요.');
    }
    if (typeof entry.farmName !== 'string' || !entry.farmName.trim() || entry.farmName.length > 300) {
      throw fail('선택한 농장명을 확인하세요.');
    }
    if (entry.country === 'CO') {
      if (!normalizePackingAbbr(entry.packingAbbr) || entry.packingAbbr !== normalizePackingAbbr(entry.packingAbbr)) {
        throw fail('콜롬비아 패킹 약어는 영문/숫자 3자리(UNK 제외)로 입력하세요.');
      }
      if (typeof entry.packingShort !== 'string' || !entry.packingShort.trim() || entry.packingShort.length > 30) {
        throw fail('콜롬비아 패킹 표기명을 확인하세요.');
      }
      if (!VALID_CO_REGIONS.has(entry.coRegion)) {
        throw fail('콜롬비아 패킹 양식(안티오키아 수국 / 보고타 일반)을 선택하세요.');
      }
    } else {
      if (entry.packingAbbr != null && !normalizePackingAbbr(entry.packingAbbr)) {
        throw fail('패킹 약어 형식을 확인하세요.');
      }
      if (entry.coRegion != null && !VALID_CO_REGIONS.has(entry.coRegion)) {
        throw fail('패킹 지역 구분을 확인하세요.');
      }
    }
    const key = identity(entry.country, entry.supplier);
    if (seen.has(key)) throw fail('중복된 농장 매칭 원문입니다.');
    seen.add(key);
  }
  return value;
}

function buildSingleFarmMatchEntry(item, farms) {
  const country = text(item?.country).toUpperCase();
  const supplier = text(item?.supplier);
  if (!Object.hasOwn(PACKING_COUNTRIES, country) || !supplier || supplier.length > 500) {
    throw fail('국가와 인보이스 원문 농장명을 확인하세요.');
  }
  const supplierKey = packingSourceKey(supplier);
  if (!supplierKey) throw fail('인보이스 원문 농장명을 확인하세요.');

  const requestedFarmKey = item?.farmKey == null || item?.farmKey === '' ? null : Number(item.farmKey);
  const requestedWarehouseKey = item?.farmSourceWarehouseKey == null || item?.farmSourceWarehouseKey === ''
    ? null
    : Number(item.farmSourceWarehouseKey);
  if (requestedFarmKey === null && requestedWarehouseKey === null) {
    throw fail(`"${supplier}" 농장에 연결할 전산 농장을 선택하세요.`);
  }

  const activeFarms = (Array.isArray(farms) ? farms : []).filter(f => !f?.isDeleted);
  const target = requestedFarmKey !== null
    ? activeFarms.find(f => Number(f.FarmKey) === requestedFarmKey)
    : activeFarms.find(f => !f.FarmKey && Number(f.WarehouseKey) === requestedWarehouseKey);
  if (!target) {
    throw fail('선택한 농장이 비활성화되었거나 목록에 없습니다. 다시 조회한 뒤 선택하세요.');
  }
  const expectedCountryKr = PACKING_COUNTRIES[country];
  if (target.CounName && text(target.CounName) !== expectedCountryKr) {
    throw fail(`선택한 농장(${target.FarmName})의 국가(${target.CounName})가 현재 국가(${expectedCountryKr})와 다릅니다.`);
  }

  let packingAbbr = null;
  let packingShort = null;
  let coRegion = null;
  if (country === 'CO') {
    const defaults = suggestColombiaPackingDefaults(supplier);
    packingAbbr = normalizePackingAbbr(item?.packingAbbr || defaults.packingAbbr);
    if (!packingAbbr) {
      throw fail(`"${supplier}"의 콜롬비아 패킹 약어(3자리 영문, UNK 제외)를 입력하세요.`);
    }
    packingShort = normalizePackingShort(item?.packingShort, supplier) || normalizePackingShort(target.FarmName, supplier) || packingAbbr;
    coRegion = VALID_CO_REGIONS.has(text(item?.coRegion).toUpperCase())
      ? text(item.coRegion).toUpperCase()
      : defaults.coRegion;
  }

  return {
    country,
    supplier,
    supplierKey,
    normalizedSupplierKey: invoiceSupplierKey(supplier) || supplierKey,
    farmKey: target.FarmKey != null && Number(target.FarmKey) > 0 ? Number(target.FarmKey) : null,
    farmSourceWarehouseKey: target.FarmKey != null && Number(target.FarmKey) > 0
      ? null
      : (Number(target.WarehouseKey) > 0 ? Number(target.WarehouseKey) : null),
    farmName: text(target.FarmName),
    packingAbbr,
    packingShort,
    coRegion,
  };
}

export function upsertPackingFarmMatches(value, request, farms = []) {
  const current = value == null ? { version: 1, entries: [] } : validatePackingFarmMatches(value);
  const items = Array.isArray(request?.entries) ? request.entries : [request];
  if (!items.length || items.length > 200) {
    throw fail('저장할 농장 매칭 항목을 확인하세요.');
  }
  const map = new Map(current.entries.map(entry => [identity(entry.country, entry.supplier), entry]));
  for (const item of items) {
    const built = buildSingleFarmMatchEntry(item, farms);
    const { normalizedSupplierKey: _transient, ...persisted } = built;
    map.set(identity(persisted.country, persisted.supplier), persisted);
  }
  return validatePackingFarmMatches({ version: 1, entries: [...map.values()] });
}

export function findSavedFarmMatch(value, country, supplier) {
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  const docCountry = text(country).toUpperCase();
  const rawSupplier = text(supplier);
  if (!docCountry || !rawSupplier || !entries.length) return null;
  const exactKey = packingSourceKey(rawSupplier);
  const exact = entries.find(entry => entry.country === docCountry && entry.supplierKey === exactKey);
  if (exact) return exact;

  const looseKey = invoiceSupplierKey(rawSupplier);
  if (!looseKey) return null;
  const looseMatches = entries.filter(entry => entry.country === docCountry && invoiceSupplierKey(entry.supplier) === looseKey);
  if (looseMatches.length === 1) return looseMatches[0];
  const uniqueTargets = new Set(looseMatches.map(entry => `${entry.farmKey ?? ''}:${entry.farmSourceWarehouseKey ?? ''}:${entry.packingAbbr ?? ''}:${entry.coRegion ?? ''}`));
  return uniqueTargets.size === 1 ? looseMatches[0] : null;
}

export function resolveInvoiceHeaderWithSavedFarm(document, farms = [], farmMatches = null) {
  const base = resolveInvoiceHeader(document, farms);
  if (base.farm || !farmMatches) return base;
  const meta = document?.reviewedMetadata || {};
  const raw = document?.rawMetadata || {};
  const supplier = text(raw.supplier || meta.farmName);
  const country = text(meta.country || document?.country || '').toUpperCase();
  const saved = findSavedFarmMatch(farmMatches, country, supplier);
  if (!saved) return base;
  const active = rankedInvoiceFarmSources(farms, supplier, country).filter(f => Number(f.FarmKey) > 0 || Number(f.WarehouseKey) > 0);
  const matched = saved.farmKey != null && Number(saved.farmKey) > 0
    ? active.find(f => Number(f.FarmKey) === Number(saved.farmKey))
    : active.find(f => !f.FarmKey && Number(f.WarehouseKey) === Number(saved.farmSourceWarehouseKey));
  if (!matched) return base;
  return {
    ...base,
    farm: {
      farmKey: matched.FarmKey == null ? null : Number(matched.FarmKey),
      farmName: matched.FarmName,
      ...(matched.WarehouseKey ? { farmSourceWarehouseKey: Number(matched.WarehouseKey) } : {}),
    },
    issues: (base.issues || []).filter(issue => issue.code !== 'FARM_MATCH_REQUIRED'),
    source: {
      ...base.source,
      farmSelection: {
        name: matched.FarmName,
        usageCount: Number(matched.UsageCount || 0),
        country: matched.CounName || null,
        rule: 'TEAM_SAVED_FARM_MATCH',
      },
    },
  };
}

export function packingFarmMatchChanges(before, after) {
  const oldMap = new Map((before?.entries ?? []).map(entry => [identity(entry.country, entry.supplier), entry]));
  return (after?.entries ?? [])
    .filter(entry => JSON.stringify(oldMap.get(identity(entry.country, entry.supplier))) !== JSON.stringify(entry))
    .map(entry => ({
      country: entry.country,
      supplier: entry.supplier,
      before: oldMap.get(identity(entry.country, entry.supplier)) ?? null,
      after: entry,
    }));
}

export function createFarmMatchesHandler({ queryFn, root } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.user?.accountActive === false) {
      return res.status(403).json({ success: false, error: '비활성 계정은 농장 매칭 자료에 접근할 수 없습니다.' });
    }
    if (!['GET', 'POST'].includes(req.method)) {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ success: false, error: '지원하지 않는 요청입니다.' });
    }
    const storeOpts = root ? { root } : undefined;
    try {
      if (req.method === 'GET' && req.query?.revisionOnly === '1') {
        const record = await readImportTeamRecord(PACKING_FARM_MATCH_KEY, storeOpts);
        return res.json({ success: true, value: record.value, revision: record.revision, scope: 'team' });
      }
      const [farms, record] = await Promise.all([
        listInvoiceFarmSources(queryFn),
        readImportTeamRecord(PACKING_FARM_MATCH_KEY, storeOpts),
      ]);
      if (req.method === 'GET') {
        return res.json({ success: true, farms, value: record.value, revision: record.revision, scope: 'team' });
      }
      if (!Number.isSafeInteger(req.body?.expectedRevision) || req.body.expectedRevision < 0) {
        return res.status(400).json({ success: false, error: '농장 매칭 자료 버전을 다시 조회하세요.' });
      }
      const value = upsertPackingFarmMatches(record.value, req.body, farms);
      const saved = await writeImportTeamRecord(
        PACKING_FARM_MATCH_KEY,
        { value, expectedRevision: req.body.expectedRevision, actor: req.user },
        storeOpts,
      );
      return res.json({ success: true, farms, value: saved.value, revision: saved.revision, scope: 'team' });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.statusCode ? error.message : '전산 농장·매칭 자료를 읽거나 저장하지 못했습니다. 초안을 유지하고 다시 시도하세요.',
      });
    }
  };
}
