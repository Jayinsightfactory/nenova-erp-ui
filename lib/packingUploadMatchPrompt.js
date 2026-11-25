import { detectCOFarm, packingSourceKey } from './importPacking.js';
import { rankedInvoiceFarmSources, resolveInvoiceHeader } from './invoiceReceiptAutoFill.js';
import { rankProductSuggestions, defaultInvoiceMatchSuggestion } from './invoiceMatchAssist.js';
import { packingMatchReview } from './packingMatchReview.js';
import { effectivePackingMatchReview } from './packingReceiptMatchState.js';
import { packingSourceValueIssues } from './importPackingSourceReview.js';
import { makePackingReviewRows, applyPackingReview } from './importPackingReview.js';
import { packingValidationIssues } from './packingValidationIssues.js';

const text = value => String(value ?? '').normalize('NFKC').trim();
const VALID_CO_REGIONS = new Set(['ANTIOQUIA', 'BOGOTA']);

function findSavedFarmEntry(farmMatches, country, supplier) {
  const entries = Array.isArray(farmMatches?.entries) ? farmMatches.entries : [];
  const docCountry = text(country).toUpperCase();
  const rawSupplier = text(supplier);
  if (!docCountry || !rawSupplier || !entries.length) return null;
  const exactKey = packingSourceKey(rawSupplier);
  return entries.find(entry => entry.country === docCountry && entry.supplierKey === exactKey) || null;
}

function suggestCoDefaults(supplier, products = []) {
  const short = text(supplier)
    .toUpperCase()
    .replace(/\bC\.?\s*I\.?\b/g, ' ')
    .replace(/\bS\.?\s*A\.?\s*S\.?\b/g, ' ')
    .replace(/\b(?:SAS|SA|LTD|LIMITED|INC|CORPORATION|FLOWERS|FLORES|FARMS|FARM|EXPORT|GRUPO)\b/g, ' ')
    .replace(/[^A-Z0-9가-힣\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'FARM';
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
    coRegion: hasHydrangea && VALID_CO_REGIONS.has('ANTIOQUIA') ? 'ANTIOQUIA' : 'BOGOTA',
  };
}

function resolveFarmWithSaved(document, farms = [], farmMatches = null) {
  const base = resolveInvoiceHeader(document, farms);
  if (base.farm || !farmMatches) return base;
  const supplier = text(document?.rawMetadata?.supplier || document?.reviewedMetadata?.farmName);
  const country = text(document?.country || document?.reviewedMetadata?.country).toUpperCase();
  const saved = findSavedFarmEntry(farmMatches, country, supplier);
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
  };
}
const numOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

export function farmChoiceOptionKey(farm) {
  if (!farm) return '';
  if (farm.FarmKey != null && Number(farm.FarmKey) > 0) return `farm:${Number(farm.FarmKey)}`;
  if (farm.WarehouseKey != null && Number(farm.WarehouseKey) > 0) return `wh:${Number(farm.WarehouseKey)}`;
  return '';
}

export function parseFarmChoiceOptionKey(optionKey) {
  const raw = text(optionKey);
  if (raw.startsWith('farm:')) {
    const id = Number(raw.slice(5));
    return Number.isSafeInteger(id) && id > 0 ? { farmKey: id, farmSourceWarehouseKey: null } : null;
  }
  if (raw.startsWith('wh:')) {
    const id = Number(raw.slice(3));
    return Number.isSafeInteger(id) && id > 0 ? { farmKey: null, farmSourceWarehouseKey: id } : null;
  }
  return null;
}

function extractLineEvidenceQuote(line) {
  const ev = line?.source_cells ?? line?.review_evidence ?? line?.evidence ?? {};
  const parts = [];
  for (const field of ['pcs', 'steam_box', 'total_bunch', 'total_stems', 'stems', 'u_price', 'price', 't_price', 'amount']) {
    const quote = text(ev?.[field]?.quote);
    if (quote) parts.push(`${field}: "${quote}"`);
  }
  return parts.join(' · ');
}

/**
 * Collect ONLY unresolved items needing human matching or quantity verification
 * (`errors-only-specific` principle: matched farms/products and valid rows are excluded).
 */
export function collectUploadMatchingNeeds({
  country = '',
  invoices = [],
  excels = [],
  products = [],
  farms = [],
  farmMatches = null,
  receiptMatches = new Map(),
  mismatches = [],
} = {}) {
  const docCountry = text(country).toUpperCase();
  const invoiceList = Array.isArray(invoices) ? invoices : [];
  const excelList = Array.isArray(excels) ? excels : [];
  const activeProducts = Array.isArray(products) ? products : [];
  const activeFarms = Array.isArray(farms) ? farms : [];

  // 1. Unmatched Farms (unlinked ERP supplier OR CO `UNK` packing template when ERP farms exist)
  const farmMap = new Map();
  invoiceList.forEach((inv, invoiceIndex) => {
    const supplier = text(inv?.supplier || inv?.farm);
    if (!supplier) return;
    const supplierKey = packingSourceKey(supplier);
    if (!supplierKey) return;
    const saved = findSavedFarmEntry(farmMatches, docCountry, supplier);
    const headerResolution = activeFarms.length
      ? resolveFarmWithSaved({ country: docCountry, rawMetadata: { supplier } }, activeFarms, farmMatches)
      : { farm: null, issues: [] };
    const coDetected = docCountry === 'CO' ? detectCOFarm(supplier, farmMatches) : null;
    const needsErpFarm = activeFarms.length > 0 && !headerResolution.farm;
    const needsCoPacking = docCountry === 'CO' && activeFarms.length > 0 && coDetected?.abbr === 'UNK' && !headerResolution.farm;
    if (!needsErpFarm && !needsCoPacking) return;

    const existing = farmMap.get(supplierKey);
    const invNo = text(inv?.invoice || `#${invoiceIndex + 1}`);
    if (existing) {
      if (invNo && !existing.invoices.includes(invNo)) existing.invoices.push(invNo);
      return;
    }
    const candidates = rankedInvoiceFarmSources(activeFarms, supplier, docCountry).slice(0, 8);
    const defaults = docCountry === 'CO'
      ? suggestCoDefaults(supplier, inv?.products || [])
      : { packingAbbr: '', packingShort: '', coRegion: null };
    const preselectedFarm = headerResolution.farm
      ? activeFarms.find(f => (headerResolution.farm.farmKey ? Number(f.FarmKey) === Number(headerResolution.farm.farmKey) : Number(f.WarehouseKey) === Number(headerResolution.farm.farmSourceWarehouseKey)))
      : (candidates[0]?.matchScore >= 2 ? candidates[0] : null);

    farmMap.set(supplierKey, {
      supplier,
      supplierKey,
      invoices: invNo ? [invNo] : [],
      needsErpFarm,
      needsCoPacking: docCountry === 'CO' && coDetected?.abbr === 'UNK',
      reasonLabel: needsErpFarm && docCountry === 'CO' && coDetected?.abbr === 'UNK'
        ? '전산 농장 미연결 · 패킹 약어 미지정'
        : needsErpFarm
          ? (candidates.length > 1 && candidates[0]?.matchScore > 0 ? '동일 후보 복수 · 농장 선택 필요' : '전산 농장 미연결')
          : '콜롬비아 패킹 약어·양식 확인',
      candidates,
      defaultOptionKey: saved
        ? (saved.farmKey ? `farm:${saved.farmKey}` : saved.farmSourceWarehouseKey ? `wh:${saved.farmSourceWarehouseKey}` : '')
        : farmChoiceOptionKey(preselectedFarm),
      defaultPackingAbbr: saved?.packingAbbr || (coDetected?.abbr && coDetected.abbr !== 'UNK' ? coDetected.abbr : defaults.packingAbbr),
      defaultPackingShort: saved?.packingShort || defaults.packingShort,
      defaultCoRegion: saved?.coRegion || defaults.coRegion,
    });
  });

  // 2. Unmatched / Uncertain Products (deduplicated by `packingSourceKey(matchingDescription)`)
  const productMap = new Map();
  excelList.forEach((excel, excelIndex) => {
    const sourceInvIdx = excel?.sourceInvoiceIdentity?.sourceInvoiceIndex ?? excel?.sourceInvoiceIndex ?? excelIndex;
    const invLabel = text(excel?.invoice || invoiceList[sourceInvIdx]?.invoice || `#${sourceInvIdx + 1}`);
    (excel?.products || []).forEach((row, rowIndex) => {
      const review = effectivePackingMatchReview(
        packingMatchReview(row, activeProducts, docCountry),
        receiptMatches?.get?.(`${sourceInvIdx}:${rowIndex}`),
      );
      if (!review.needsReview || review.status === 'ALLOCATION') return;
      const description = text(row?.matchingDescription || row?.sourceName || row?.description);
      const sourceKey = packingSourceKey(description);
      if (!description || !sourceKey) return;

      const existing = productMap.get(sourceKey);
      if (existing) {
        existing.occurrences += 1;
        existing.totalQty += Number(row?.qty ?? row?.stems ?? 0) || 0;
        if (invLabel && !existing.invoices.includes(invLabel)) existing.invoices.push(invLabel);
        return;
      }
      const ranked = rankProductSuggestions(description, activeProducts, { country: docCountry, limit: 6, minScore: 25 });
      const defaultHit = defaultInvoiceMatchSuggestion(description, activeProducts, docCountry);
      productMap.set(sourceKey, {
        description,
        sourceName: text(row?.sourceName || description),
        sourceKey,
        status: review.status,
        statusLabel: review.label || (review.status === 'SIMILAR' ? '유사 후보 확인' : '미매칭'),
        invoices: invLabel ? [invLabel] : [],
        occurrences: 1,
        boxes: numOrNull(row?.boxes ?? row?.pcs),
        totalQty: Number(row?.qty ?? row?.stems ?? 0) || 0,
        unitPrice: numOrNull(row?.unitPrice ?? row?.u_price ?? row?.price),
        stemLength: text(row?.stemLength || row?.stem_length),
        defaultProdKey: defaultHit?.product?.ProdKey ?? null,
        suggestions: ranked.items,
      });
    });
  });

  // 3. Box / Stem / Line-Total / Invoice-Total Mismatches
  const quantityIssues = [];
  const seenRowIssueKeys = new Set();

  invoiceList.forEach((inv, invoiceIndex) => {
    const invLabel = text(inv?.invoice || `#${invoiceIndex + 1}`);
    const supplier = text(inv?.supplier || inv?.farm || '공급농장');
    const linesKey = docCountry === 'NL' ? 'lines' : 'products';
    const lines = Array.isArray(inv?.[linesKey]) ? inv[linesKey] : [];

    lines.forEach((line, lineIndex) => {
      const rowIssues = [];
      try {
        rowIssues.push(...packingSourceValueIssues(inv, docCountry, lineIndex));
      } catch (err) {
        rowIssues.push(err?.message || String(err));
      }

      const pcs = numOrNull(line?.pcs);
      const steamBox = numOrNull(line?.steam_box);
      const totalStems = numOrNull(docCountry === 'NL' ? line?.stems : line?.total_stems);
      const uPrice = numOrNull(docCountry === 'NL' ? line?.price : line?.u_price);
      const tPrice = numOrNull(line?.t_price ?? line?.amount);

      if (['CO', 'EC', 'VN'].includes(docCountry) && totalStems !== null && uPrice !== null && tPrice !== null) {
        const computedLine = Math.round(totalStems * uPrice * 100) / 100;
        if (Math.abs(computedLine - tPrice) > 0.02) {
          rowIssues.push(`송이(${totalStems})×단가(${uPrice})=${computedLine.toFixed(2)} ≠ 행금액(${tPrice.toFixed(2)})`);
        }
      }

      if (!rowIssues.length) return;
      const issueKey = `row:${invoiceIndex}:${lineIndex}`;
      if (seenRowIssueKeys.has(issueKey)) return;
      seenRowIssueKeys.add(issueKey);

      quantityIssues.push({
        kind: 'ROW',
        id: issueKey,
        invoiceIndex,
        lineIndex,
        invoiceLabel: invLabel,
        supplier,
        description: text(line?.description || line?.source_description || `상품행 ${lineIndex + 1}`),
        messages: rowIssues,
        evidenceQuote: extractLineEvidenceQuote(line),
        fields: {
          pcs: pcs ?? '',
          steam_box: steamBox ?? '',
          total_stems: totalStems ?? '',
          u_price: uPrice ?? '',
          t_price: tPrice ?? '',
        },
        hasSteamBox: Object.prototype.hasOwnProperty.call(line || {}, 'steam_box') || docCountry === 'CO',
      });
    });

    const metaIssues = packingValidationIssues([inv], docCountry).filter(item => item.code !== 'SOURCE_ROW_INVALID');
    const mismatchObj = (Array.isArray(mismatches) ? mismatches : []).find(m => text(m?.invoice) === invLabel);
    if (metaIssues.length || mismatchObj) {
      const goodsSum = lines.reduce((sum, line) => {
        const val = numOrNull(line?.t_price ?? line?.amount);
        return val === null ? sum : Math.round((sum + val) * 100) / 100;
      }, 0);
      const freightVal = numOrNull(docCountry === 'CO' ? inv?.freight_total : inv?.freight) ?? 0;
      const printedTotal = numOrNull(inv?.invoice_total ?? inv?.total_value);
      quantityIssues.push({
        kind: 'INVOICE_TOTAL',
        id: `inv:${invoiceIndex}`,
        invoiceIndex,
        lineIndex: null,
        invoiceLabel: invLabel,
        supplier,
        description: '송장 합계 · 운송/부대비 대조',
        messages: [
          ...metaIssues.map(item => item.text),
          ...(mismatchObj ? [`행 합계(${Number(mismatchObj.computed).toFixed(2)}) ≠ 인보이스 총액(${Number(mismatchObj.expected).toFixed(2)})`] : []),
        ],
        evidenceQuote: text(inv?.metadata_evidence?.invoice_total?.quote || inv?.review_evidence?.freight_total?.quote || ''),
        fields: {
          goodsSum,
          freight: freightVal,
          invoice_total: printedTotal ?? '',
        },
      });
    }
  });

  const unmatchedFarms = [...farmMap.values()];
  const unmatchedProducts = [...productMap.values()];
  return {
    unmatchedFarms,
    unmatchedProducts,
    quantityIssues,
    totalCount: unmatchedFarms.length + unmatchedProducts.length + quantityIssues.length,
  };
}

/**
 * Apply operator-confirmed row/invoice quantity corrections onto sourceInvoices
 * using the canonical `applyPackingReview` validator (`requireConfirmation: false`).
 */
export function applyUploadQuantityEdits({
  sourceInvoices = [],
  result = {},
  country = '',
  rowEdits = {},
  invoiceEdits = {},
} = {}) {
  const docCountry = text(country).toUpperCase();
  const drafts = makePackingReviewRows(sourceInvoices, docCountry);
  let hasAnyChange = false;

  drafts.forEach((draft, invoiceIndex) => {
    draft.applyValues = true;
    const invEdit = invoiceEdits[`inv:${invoiceIndex}`];
    if (invEdit) {
      const reason = text(invEdit.reason) || '입고 매칭 알림창에서 원문 금액 대조 보정';
      if (invEdit.freight !== undefined && invEdit.freight !== '' && String(invEdit.freight) !== String(draft.values.freight)) {
        draft.values.freight = String(invEdit.freight);
        draft.reason = reason;
        hasAnyChange = true;
      }
      if (invEdit.invoice_total !== undefined && invEdit.invoice_total !== '' && draft.metadata) {
        if (String(invEdit.invoice_total) !== String(draft.metadata.values.invoice_total)) {
          draft.metadata.values.invoice_total = String(invEdit.invoice_total);
          draft.metadata.reasons.invoice_total = reason;
          draft.metadata.confirmed.invoice_total = true;
          hasAnyChange = true;
        }
      }
    }

    if (draft.sourceReview?.rows) {
      draft.sourceReview.rows.forEach((rowDraft, lineIndex) => {
        const edit = rowEdits[`row:${invoiceIndex}:${lineIndex}`];
        if (!edit) return;
        const reason = text(edit.reason) || '입고 매칭 알림창에서 원문 수량·단가 대조 보정';
        for (const field of ['pcs', 'steam_box', 'total_stems', 'stems', 'u_price', 'price', 't_price']) {
          if (edit[field] === undefined) continue;
          const targetField = docCountry === 'NL' && field === 'total_stems'
            ? 'stems'
            : docCountry === 'NL' && field === 'u_price'
              ? 'price'
              : field;
          if (!Object.prototype.hasOwnProperty.call(rowDraft.values, targetField) && targetField !== 'steam_box') continue;
          if (String(rowDraft.values[targetField] ?? '') !== String(edit[field])) {
            rowDraft.values[targetField] = edit[field];
            hasAnyChange = true;
          }
        }
        if (hasAnyChange) {
          rowDraft.reason = reason;
        }
      });
    }
  });

  if (!hasAnyChange) {
    return { changed: false, invoices: sourceInvoices, result };
  }
  const updatedInvoices = applyPackingReview(sourceInvoices, drafts, docCountry, new Date().toISOString(), { requireConfirmation: false });
  return {
    changed: true,
    invoices: updatedInvoices,
    result: { ...result, invoices: updatedInvoices },
  };
}
