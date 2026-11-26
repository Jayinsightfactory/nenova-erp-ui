// Source-derived suggestions only. Never copy quantities from a past receipt.
import {hasReceiptFarmSource, hasNewReceiptFarm} from './invoiceFarmSource.js';
const text = value => String(value ?? '').normalize('NFKC').trim();
const blank = value => value == null || value === '';
export function isKilogramUnit(value) {
  const normalized = text(value);
  if (!normalized) return false;
  const stripped = normalized.replace(/\((?:grs\.?\s*w(?:ei)?ght|gross(?:\s*w(?:ei)?ght)?|vol(?:ume)?(?:\s*w(?:ei)?ght)?|chg\.?(?:\s*w(?:ei)?ght)?|chargeable(?:\s*w(?:ei)?ght)?|cw|gw|actual(?:\s*gross)?(?:\s*w(?:ei)?ght)?|a\.?g\.?w\.?t\.?)\)/gi, '').trim();
  if (/\b(?:lbs?|pounds?|oz|ounces?|grams?|tons?|tonnes?|cbm|pcs|boxes)\b|(?:^|[^a-z])g(?:$|[^a-z])/i.test(stripped)) {
    return false;
  }
  return /^(?:kg\.?|kgs\.?|kilos?|kilograms?|킬로그램)$/i.test(stripped);
}

// Source evidence can be present even when legacy CO fields are absent.
export function packingWeight(invoice, field) {
  const key = field === 'gw' ? 'gross_weight' : 'vol_weight';
  const review = invoice?.packingReview?.values;
  const proof = invoice?.review_evidence?.[key];
  let value;
  if (review && Object.hasOwn(review, field)) value = review[field];
  else if (proof && Object.hasOwn(proof, 'value')) {
    if (!isKilogramUnit(proof.unit)) return null;
    value = proof.value;
  } else value = invoice?.[key] ?? (field === 'cw' ? invoice?.chargeable_weight : null);
  if (blank(value) || !['number','string'].includes(typeof value)) return null;
  const raw = text(value);
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,8})?$/.test(raw)) return null;
  const number = Number(raw.replaceAll(',', ''));
  return Number.isFinite(number) && number >= 0 && number <= 1e12 ? number : null;
}

export function fillMissingReceiptWeights(record, source) {
  const document = record.document;
  if (!source || document.documentId !== source.documentId || document.sourceHash !== source.sourceHash
    || document.orderYear !== source.orderYear || document.orderWeek !== source.orderWeek
    || record.pendingOperation || record.recoveryRequired || document.warehouseKey || document.receiptStatus === 'COMMITTED'
    || (document.operations || []).some(op => op.status === 'COMMITTED')) return record;
  const meta = document.reviewedMetadata || {}, incoming = source.reviewedMetadata || {}, patch = {};
  for (const field of ['gw','cw']) {
    if (blank(meta[field]) && !meta.weightManual?.[field] && typeof incoming[field] === 'number'
      && Number.isFinite(incoming[field]) && incoming[field] >= 0) patch[field] = incoming[field];
  }
  if (!Object.keys(patch).length) return record;
  return {...record,dirty:true,preview:null,stageProgress:{},document:{...document,
    reviewedMetadata:{...meta,...patch,weightSourceEvidence:{...meta.weightSourceEvidence,
      ...Object.fromEntries(Object.keys(patch).map(field=>[field,incoming.weightSourceEvidence?.[field] || {source:'INVOICE_SOURCE'}]))}}}};
}
export function invoiceSupplierKey(value) {
  return text(value).toUpperCase().replace(/\bC\.?\s*I\.?\b/g, ' ')
    .replace(/\bS\.?\s*A\.?\s*S\.?\b/g, ' ')
    .replace(/\bS\.?\s*A\.?\b/g, ' ')
    .replace(/\b(SAS|SA|LTD|LIMITED|INC|CO|CORPORATION|FLORES|FLOWERS|FLORICOLA|FLORICULTURA)\b/g, ' ')
    .replace(/[^\p{L}\p{N}]/gu, '');
}
// Historical ERP/worksheet pair: docs/CLAUDE_HANDOFF_CATALOG_ARRIVAL_2026-06-15.md.
// Only the documented pair; receiving still checks active record and NZ origin.
export function isNzBloomSupplierMatch(supplier, farmName) {
  return invoiceSupplierKey(supplier)==='NEWZEALANDBLOOM'
    && ['NEWZEALANDBLOOM','NZBLOOMS','NZBLOOM'].includes(invoiceSupplierKey(farmName));
}
export function invoiceCalendarDate(value) {
  let source = text(value).toUpperCase();
  const named = source.match(/^(\d{1,2})[\s-]*(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[\s-]*(\d{4})$/);
  if (named) source = `${named[3]}-${String(['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'].indexOf(named[2])+1).padStart(2,'0')}-${named[1].padStart(2,'0')}`;
  source = source.replaceAll('/', '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(source)) return '';
  const date = new Date(`${source}T00:00:00Z`);
  return Number.isFinite(+date) && date.toISOString().slice(0,10) === source ? source : '';
}
// Receiving defaults to the original upload day in Korea, never the invoice date
// or the day an older saved document happens to be reopened.
export function invoiceUploadCalendarDate(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return invoiceCalendarDate(value);
  if (!(value instanceof Date) && (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return '';
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(+date)) return '';
  const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date).map(p=>[p.type,p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const FARM_COUNTRY_NAMES={CO:'콜롬비아',NL:'네덜란드',CN:'중국',EC:'에콰도르',TH:'태국',AU:'호주',US:'미국',VN:'베트남',NZ:'뉴질랜드'};
// Owner-verified canonical supplier alias groups (country-scoped to avoid cross-country collisions such as Ethiopia [64] Elite).
const CANONICAL_FARM_ALIASES = [
  { group: 'CO_MATINA', countryCode: 'CO', countryName: '콜롬비아', preferredKey: 'MATINA', match: /\b(?:matina|aguaclara|agua\s*clara|zelecta)\b/i },
  { group: 'CO_ELITE', countryCode: 'CO', countryName: '콜롬비아', preferredKey: 'THEELITE', match: /\b(?:flora\s*concept|the\s*elite(?:\s*flowers?)?)\b/i },
  { group: 'EC_ROSALEDA', countryCode: 'EC', countryName: '에콰도르', preferredKey: 'LAROSALEDA', match: /\brosaleda\b/i },
];
export function canonicalFarmAliasGroup(value, country = '') {
  const raw = text(value);
  if (!raw) return null;
  const c = text(country).toUpperCase();
  for (const rule of CANONICAL_FARM_ALIASES) {
    if (c && c !== rule.countryCode && text(country) !== rule.countryName) continue;
    if (rule.match.test(raw)) return rule;
  }
  return null;
}
export function sameCanonicalFarmAlias(a, b, country = '') {
  const ga = canonicalFarmAliasGroup(a, country);
  const gb = canonicalFarmAliasGroup(b, country);
  return Boolean(ga && gb && ga.group === gb.group);
}
export function sameInvoiceSupplier(name, document, canonicalFarmName) {
  const candidate = invoiceSupplierKey(name);
  const docCountry = document?.reviewedMetadata?.country || document?.country || '';
  return Boolean(candidate && [canonicalFarmName, document?.rawMetadata?.supplier, document?.reviewedMetadata?.farmName]
    .some(value => invoiceSupplierKey(value) === candidate || sameCanonicalFarmAlias(name, value, docCountry)));
}
export function rankedInvoiceFarmSources(farms, supplier='', country='') {
  const key=invoiceSupplierKey(supplier),countryName=FARM_COUNTRY_NAMES[country]||country;
  const alias=canonicalFarmAliasGroup(supplier,country);
  const score=farm=>{
    const name=invoiceSupplierKey(farm.FarmName);
    if(alias&&name===alias.preferredKey&&(!farm.CounName||farm.CounName===alias.countryName))return 3;
    if(key&&name===key)return 3;
    if(alias&&sameCanonicalFarmAlias(farm.FarmName,supplier,country)&&(!farm.CounName||farm.CounName===alias.countryName))return 2;
    return key&&name.includes(key)?2:key&&key.includes(name)&&name.length>=5?1:0;
  };
  return farms.filter(farm=>!farm.isDeleted&&(!countryName||!farm.CounName||farm.CounName===countryName))
    .map(farm=>({...farm,matchScore:score(farm)})).sort((a,b)=>b.matchScore-a.matchScore||Number(b.UsageCount||0)-Number(a.UsageCount||0)||String(a.FarmName).localeCompare(String(b.FarmName)));
}
export function resolveInvoiceHeader(document, farms = []) {
  const meta = document?.reviewedMetadata || {}, raw = document?.rawMetadata || {};
  const supplier = text(raw.supplier || meta.farmName);
  const country=meta.country||document?.country||'';
  const active = rankedInvoiceFarmSources(farms,supplier,country).filter(farm => Number(farm.FarmKey)>0||Number(farm.WarehouseKey)>0);
  const exact = active.filter(farm => text(farm.FarmName).toUpperCase() === supplier.toUpperCase());
  const supplierKey = invoiceSupplierKey(supplier);
  const normalized = supplierKey ? active.filter(farm => invoiceSupplierKey(farm.FarmName) === supplierKey) : [];
  const aliasRule = canonicalFarmAliasGroup(supplier, country);
  const aliasPreferredMasters = aliasRule
    ? active.filter(farm => Number(farm.FarmKey) > 0 && invoiceSupplierKey(farm.FarmName) === aliasRule.preferredKey && (!farm.CounName || farm.CounName === aliasRule.countryName))
    : [];
  const aliasCountryMasters = aliasPreferredMasters.filter(farm => farm.CounName === aliasRule.countryName);
  const resolvedAliasMaster = aliasCountryMasters.length === 1 ? aliasCountryMasters : aliasPreferredMasters.length === 1 ? aliasPreferredMasters : [];
  // Historical short supplier names must occur as a complete word, not a fuzzy substring.
  const words = text(supplier).toUpperCase().split(/[^\p{L}\p{N}]+/u);
  const historical = active.filter(farm => farm.WarehouseKey && !farm.FarmKey
    && /^[A-Z0-9]{5,}$/.test(text(farm.FarmName).toUpperCase()) && words.includes(text(farm.FarmName).toUpperCase()));
  const matching = country==='NZ' ? active.filter(farm=>farm.CounName==='뉴질랜드'&&isNzBloomSupplierMatch(supplier,farm.FarmName))
    : resolvedAliasMaster.length ? resolvedAliasMaster
    : normalized.length ? normalized : exact.length ? exact : historical;
  const masters = matching.filter(farm => Number(farm.FarmKey) > 0);
  // A historical spelling of the same supplier is not a second Farm master.
  // Two actual masters remain ambiguous and must never pick the first.
  let candidates = masters.length ? masters : country!=='NZ'&&exact.length ? exact : matching;
  // Only equivalent supplier names with verified same-country evidence can
  // prefer a uniquely most-used historical spelling. Popular unrelated names never auto-match.
  const sameCountry=normalized.filter(farm=>farm.CounName&&(FARM_COUNTRY_NAMES[country]||country)===farm.CounName);
  if(country!=='NZ'&&!resolvedAliasMaster.length&&sameCountry.length&&Number(sameCountry[0].UsageCount)>0){
    const highest=Number(sameCountry[0].UsageCount);
    candidates=sameCountry.filter(farm=>Number(farm.UsageCount)===highest);
  }
  const proposedDate = invoiceUploadCalendarDate(raw.invoiceUploadDate || meta.invoiceUploadDate || document?.createdAt);
  const awb = text(meta.awb || raw.awb).replace(/[\s-]/g, '');
  const verifiedAirWaybill = /^\d{11}$/.test(awb) && Number(awb.slice(3,10)) % 7 === Number(awb[10]);
  return {
    farm: candidates.length === 1 ? { farmKey: candidates[0].FarmKey == null ? null : Number(candidates[0].FarmKey), farmName: candidates[0].FarmName,
      ...(candidates[0].WarehouseKey ? {farmSourceWarehouseKey:Number(candidates[0].WarehouseKey)} : {}) } : null,
    inputDate: proposedDate,
    transportMode: verifiedAirWaybill ? 'AIR' : '',
    issues: [
      ...(!document?.farmKey && !hasReceiptFarmSource(document) && !hasNewReceiptFarm(document) && candidates.length !== 1 ? [{code:'FARM_MATCH_REQUIRED',message:candidates.length ? '공급농장 후보가 여러 개입니다. 농장만 선택해 주세요.' : '등록된 공급농장을 찾지 못했습니다. 농장만 선택해 주세요.'}] : []),
      ...(!meta.inputDate && !proposedDate ? [{code:'INPUT_DATE_REVIEW_REQUIRED',message:'원래 업로드일 근거가 없는 보관 문서입니다. 입고일을 확인하세요.'}] : []),
    ],
    source: {supplier, rawDate: text(raw.rawDate), invoiceDate: text(raw.invoiceDate), invoiceUploadDate:proposedDate, inputDateBasis:'UPLOAD_KST',
      ...(candidates.length===1?{farmSelection:{name:candidates[0].FarmName,usageCount:Number(candidates[0].UsageCount||0),country:candidates[0].CounName||null,rule:Number(candidates[0].UsageCount)>0&&sameCountry.includes(candidates[0])?'SAME_COUNTRY_EQUIVALENT_NAME_USAGE':'EXACT_SUPPLIER'}}:{})},
  };
}
export function applyInvoiceHeader(record, resolution) {
  const document = record.document;
  if (record.pendingOperation || document.receiptStatus === 'COMMITTED' || document.warehouseKey
    || (document.operations || []).some(operation => operation.status === 'COMMITTED')) return record;
  const meta = document.reviewedMetadata || {};
  const farm = !document.farmKey && !meta.farmSourceWarehouseKey && !meta.isNewFarm && resolution.farm;
  const date = !meta.inputDate && resolution.inputDate;
  const transport = !meta.transportMode && resolution.transportMode;
  if (!farm && !date && !transport) return record;
  return {...record,dirty:true,preview:null,stageProgress:{},document:{...document,
    ...(farm ? {farmKey:farm.farmKey} : {}),
    reviewedMetadata:{...meta,...(farm ? {farmName:farm.farmName,farmSourceWarehouseKey:farm.farmSourceWarehouseKey ?? null,...(farm.isNewFarm ? {isNewFarm:true} : {})} : {}),...(date ? {inputDate:date} : {}),...(transport ? {transportMode:transport} : {}),
      autoHeaderEvidence:{source:'INVOICE_SOURCE',...resolution.source,fields:[...(farm?['farmKey']:[]),...(date?['inputDate']:[]),...(transport?['transportMode']:[])]}},
  }};
}
