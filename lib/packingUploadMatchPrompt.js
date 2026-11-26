import { detectCOFarm, packingSourceKey } from './importPacking.js';
import { rankedInvoiceFarmSources, resolveInvoiceHeader } from './invoiceReceiptAutoFill.js';
import {
  detectFlowerFamily,
  rankProductSuggestions,
  defaultInvoiceMatchSuggestion,
} from './invoiceMatchAssist.js';
import { packingMatchReview } from './packingMatchReview.js';
import { effectivePackingMatchReview } from './packingReceiptMatchState.js';
import { packingSourceValueIssues } from './importPackingSourceReview.js';
import { makePackingReviewRows, applyPackingReview } from './importPackingReview.js';
import { packingValidationIssues } from './packingValidationIssues.js';

const text = value => String(value ?? '').normalize('NFKC').trim();
const VALID_CO_REGIONS = new Set(['ANTIOQUIA', 'BOGOTA']);

const EVIDENCE_KOREAN_LABELS = [
  ['pcs', '원문 박스칸'],
  ['steam_box', '원문 입수칸'],
  ['total_bunch', '원문 단수칸'],
  ['bunch_st', '원문 단당송이'],
  ['total_stems', '원문 총송이'],
  ['stems', '원문 총송이'],
  ['u_price', '원문 단가'],
  ['price', '원문 단가'],
  ['t_price', '원문 금액'],
  ['amount', '원문 금액'],
];

const numOrNull = value => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replaceAll(',', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

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

function suggestNewFarmDisplayName(supplier) {
  const cleaned = text(supplier)
    .replace(/\bC\.?\s*I\.?\b/gi, ' ')
    .replace(/\bS\.?\s*A\.?\s*S\.?\b/gi, ' ')
    .replace(/\bS\.?\s*A\.?\b/gi, ' ')
    .replace(/\b(?:LLC|LTD|LIMITED|INC|CORP|CORPORATION)\b\.?/gi, ' ')
    .replace(/[,.;]+$/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const base = cleaned || text(supplier);
  if (!base) return '';
  if (base === base.toUpperCase() && /[A-Z]/.test(base)) {
    const lowerWords = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'of', 'the', 'and']);
    return base
      .toLowerCase()
      .split(' ')
      .map((word, idx) => (idx > 0 && lowerWords.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ')
      .slice(0, 100);
  }
  return base.slice(0, 100);
}

function resolveFarmWithSaved(document, farms = [], farmMatches = null) {
  const base = resolveInvoiceHeader(document, farms);
  if (base.farm || !farmMatches) return base;
  const supplier = text(document?.rawMetadata?.supplier || document?.reviewedMetadata?.farmName);
  const country = text(document?.country || document?.reviewedMetadata?.country).toUpperCase();
  const saved = findSavedFarmEntry(farmMatches, country, supplier);
  if (!saved) return base;
  if (saved.isNewFarm === true && text(saved.farmName)) {
    return {
      ...base,
      farm: {
        farmKey: null,
        farmName: text(saved.farmName),
        isNewFarm: true,
      },
    };
  }
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

export const NEW_FARM_OPTION_KEY = 'new';

export function farmChoiceOptionKey(farm) {
  if (!farm) return '';
  if (farm.isNewFarm === true) return NEW_FARM_OPTION_KEY;
  if (farm.FarmKey != null && Number(farm.FarmKey) > 0) return `farm:${Number(farm.FarmKey)}`;
  if (farm.WarehouseKey != null && Number(farm.WarehouseKey) > 0) return `wh:${Number(farm.WarehouseKey)}`;
  return '';
}

export function parseFarmChoiceOptionKey(optionKey) {
  const raw = text(optionKey);
  if (raw === NEW_FARM_OPTION_KEY) {
    return { isNewFarm: true, farmKey: null, farmSourceWarehouseKey: null };
  }
  if (raw.startsWith('farm:')) {
    const id = Number(raw.slice(5));
    return Number.isSafeInteger(id) && id > 0 ? { isNewFarm: false, farmKey: id, farmSourceWarehouseKey: null } : null;
  }
  if (raw.startsWith('wh:')) {
    const id = Number(raw.slice(3));
    return Number.isSafeInteger(id) && id > 0 ? { isNewFarm: false, farmKey: null, farmSourceWarehouseKey: id } : null;
  }
  return null;
}

export function extractLineEvidenceBadges(line) {
  const sources = [line?.source_cells, line?.review_evidence, line?.evidence].filter(Boolean);
  const badges = [];
  const seenLabels = new Set();
  for (const [field, koreanLabel] of EVIDENCE_KOREAN_LABELS) {
    if (seenLabels.has(koreanLabel)) continue;
    let quote = '';
    for (const src of sources) {
      const candidate = text(src?.[field]?.quote);
      if (candidate) {
        quote = candidate;
        break;
      }
    }
    if (quote) {
      seenLabels.add(koreanLabel);
      badges.push({ label: koreanLabel, quote });
    }
  }
  return badges;
}

export function sanitizeIssueMessageForOperator(message) {
  return String(message ?? '')
    .replace(/\s*\(tabular-nums\)/gi, '')
    .replace(/\btabular-nums\b/gi, '')
    .replace(/\bu_price\b/g, '단가')
    .replace(/\bt_price\b/g, '행금액')
    .replace(/\btotal_stems\b/g, '총 송이수')
    .replace(/\bsteam_box\b/g, '박스당 송이수')
    .replace(/\btotal_bunch\b/g, '총 단수')
    .replace(/\bbunch_st\b/g, '단당 송이수')
    .replace(/\bpcs\b/gi, '실물 박스')
    .replace(/원문 PCS 수량을 확인하세요\./g, '좌측 원본 PDF의 실물 박스 칸과 비교해 아래 추천 버튼으로 보정하세요.');
}

function detectInvoicePage(inv, line = null) {
  const candidates = [
    line?.source_page,
    line?.source_cells?.pcs?.page,
    line?.source_cells?.description?.page,
    line?.review_evidence?.pcs?.page,
    line?.review_evidence?.description?.page,
    line?.review_evidence?.total_stems?.page,
    line?.evidence?.pcs?.page,
    inv?.source_page,
    inv?.metadata_evidence?.invoice_total?.page,
    inv?.metadata_evidence?.date?.page,
    inv?.review_evidence?.gross_weight?.page,
    inv?.products?.[0]?.source_page,
    inv?.products?.[0]?.review_evidence?.pcs?.page,
    inv?.products?.[0]?.review_evidence?.description?.page,
  ];
  for (const c of candidates) {
    const n = Number(c);
    if (Number.isInteger(n) && n >= 1) return n;
  }
  return null;
}

/**
 * Compute plain-Korean mathematical diagnosis and one-click auto-backcalculation actions
 * so the operator never has to guess which number is wrong.
 */
export function analyzeRowQuantitySuggestion({ country = '', pcs, steam_box, total_stems, u_price, t_price } = {}) {
  const docCountry = text(country).toUpperCase();
  const pcsNum = numOrNull(pcs);
  const steamBoxNum = numOrNull(steam_box);
  const stemsNum = numOrNull(total_stems);
  const uPriceNum = numOrNull(u_price);
  const tPriceNum = numOrNull(t_price);

  if (docCountry === 'CO' && steamBoxNum !== null && steamBoxNum > 0 && stemsNum !== null && stemsNum > 0
    && (pcsNum === null || pcsNum <= 0 || Math.abs(pcsNum * steamBoxNum - stemsNum) > 0.02)) {
    const rawBoxes = stemsNum / steamBoxNum;
    const expectedBoxes = Math.abs(rawBoxes - Math.round(rawBoxes)) <= 1e-6 && Math.round(rawBoxes) > 0
      ? Math.round(rawBoxes)
      : null;
    const expectedStems = pcsNum !== null && pcsNum > 0 ? Math.round(pcsNum * steamBoxNum * 100) / 100 : null;
    const computedFromStems = uPriceNum !== null && uPriceNum > 0 ? Math.round(stemsNum * uPriceNum * 100) / 100 : null;
    const computedFromBoxes = expectedStems !== null && uPriceNum !== null && uPriceNum > 0
      ? Math.round(expectedStems * uPriceNum * 100) / 100
      : null;

    const amountMatchesStems = computedFromStems !== null && tPriceNum !== null && Math.abs(computedFromStems - tPriceNum) <= 0.05;
    const amountMatchesBoxes = computedFromBoxes !== null && tPriceNum !== null && Math.abs(computedFromBoxes - tPriceNum) <= 0.05;

    if (amountMatchesStems && expectedBoxes !== null) {
      return {
        diagnosis: `총송이(${stemsNum.toLocaleString('ko-KR')}) × 단가(${uPriceNum}) = ${tPriceNum.toLocaleString('ko-KR')}으로 원문 금액과 일치합니다 → 실물 박스 수는 ${stemsNum.toLocaleString('ko-KR')} ÷ ${steamBoxNum} = ${expectedBoxes}박스입니다.`,
        primaryAction: {
          label: `박스 수를 ${expectedBoxes}으로 맞춤 (${stemsNum.toLocaleString('ko-KR')} ÷ ${steamBoxNum})`,
          patch: { pcs: expectedBoxes },
          reason: `원문 총송이(${stemsNum})·금액(${tPriceNum}) 대조 ${expectedBoxes}박스 보정`,
        },
        secondaryAction: expectedStems !== null ? {
          label: `총 송이를 ${expectedStems.toLocaleString('ko-KR')}으로 맞춤 (${pcsNum} × ${steamBoxNum} · 금액 ${computedFromBoxes ?? tPriceNum})`,
          patch: {
            total_stems: expectedStems,
            ...(computedFromBoxes !== null ? { t_price: computedFromBoxes } : {}),
          },
          reason: `원문 ${pcsNum}박스 × ${steamBoxNum}송이 기준 총송이 보정`,
        } : null,
      };
    }

    if (amountMatchesBoxes && expectedStems !== null) {
      return {
        diagnosis: `박스(${pcsNum}) × 박스당 송이(${steamBoxNum}) × 단가(${uPriceNum}) = ${tPriceNum}으로 원문 금액과 일치합니다 → 총 송이 수는 ${expectedStems.toLocaleString('ko-KR')}송이입니다.`,
        primaryAction: {
          label: `총 송이를 ${expectedStems.toLocaleString('ko-KR')}으로 맞춤 (${pcsNum} × ${steamBoxNum})`,
          patch: { total_stems: expectedStems },
          reason: `원문 ${pcsNum}박스 × ${steamBoxNum}송이 = ${expectedStems}송이 대조 보정`,
        },
        secondaryAction: expectedBoxes !== null ? {
          label: `박스 수를 ${expectedBoxes}으로 맞춤 (${stemsNum.toLocaleString('ko-KR')} ÷ ${steamBoxNum})`,
          patch: { pcs: expectedBoxes },
          reason: `원문 ${expectedBoxes}박스 대조 보정`,
        } : null,
      };
    }

    return {
      diagnosis: '좌측 원본 PDF 표에서 실제 박스 수량과 총 송이수를 대조한 뒤 아래 버튼으로 한 번에 맞출 수 있습니다.',
      primaryAction: expectedBoxes !== null ? {
        label: `박스 수를 ${expectedBoxes}으로 맞춤 (${stemsNum.toLocaleString('ko-KR')} ÷ ${steamBoxNum})`,
        patch: { pcs: expectedBoxes },
        reason: `원문 ${expectedBoxes}박스 × ${steamBoxNum}송이 대조 보정`,
      } : null,
      secondaryAction: expectedStems !== null ? {
        label: `총 송이를 ${expectedStems.toLocaleString('ko-KR')}으로 맞춤 (${pcsNum} × ${steamBoxNum})`,
        patch: {
          total_stems: expectedStems,
          ...(computedFromBoxes !== null ? { t_price: computedFromBoxes } : {}),
        },
        reason: `원문 ${pcsNum}박스 × ${steamBoxNum}송이 대조 보정`,
      } : null,
    };
  }

  if (['CO', 'EC', 'VN'].includes(docCountry) && stemsNum !== null && uPriceNum !== null && tPriceNum !== null) {
    const computedLine = Math.round(stemsNum * uPriceNum * 100) / 100;
    if (Math.abs(computedLine - tPriceNum) > 0.02) {
      return {
        diagnosis: `총송이(${stemsNum.toLocaleString('ko-KR')}) × 단가(${uPriceNum}) 계산 금액은 ${computedLine.toFixed(2)}입니다. 좌측 원본 PDF의 금액·단가를 확인하세요.`,
        primaryAction: {
          label: `행금액을 ${computedLine.toFixed(2)}으로 맞춤 (${stemsNum.toLocaleString('ko-KR')} × ${uPriceNum})`,
          patch: { t_price: computedLine },
          reason: `원문 송이(${stemsNum})×단가(${uPriceNum}) 금액 대조 보정`,
        },
        secondaryAction: null,
      };
    }
  }

  return { diagnosis: null, primaryAction: null, secondaryAction: null };
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

  // 1. Unmatched Farms
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
    const page = detectInvoicePage(inv);

    farmMap.set(supplierKey, {
      id: `farm:${supplierKey}`,
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
        ? (saved.isNewFarm ? NEW_FARM_OPTION_KEY : saved.farmKey ? `farm:${saved.farmKey}` : saved.farmSourceWarehouseKey ? `wh:${saved.farmSourceWarehouseKey}` : '')
        : farmChoiceOptionKey(preselectedFarm),
      defaultNewFarmName: (saved?.isNewFarm && text(saved.farmName)) ? text(saved.farmName) : suggestNewFarmDisplayName(supplier),
      defaultPackingAbbr: saved?.packingAbbr || (coDetected?.abbr && coDetected.abbr !== 'UNK' ? coDetected.abbr : defaults.packingAbbr),
      defaultPackingShort: saved?.packingShort || defaults.packingShort,
      defaultCoRegion: saved?.coRegion || defaults.coRegion,
      pdfTarget: {
        page,
        invoiceNo: invNo,
        supplier,
        quotes: [supplier, invNo].filter(Boolean),
      },
    });
  });

  // 2. Unmatched / Uncertain Products (with flower-family & supplier-tag context)
  const productMap = new Map();
  excelList.forEach((excel, excelIndex) => {
    const sourceInvIdx = excel?.sourceInvoiceIdentity?.sourceInvoiceIndex ?? excel?.sourceInvoiceIndex ?? excelIndex;
    const sourceInv = invoiceList[sourceInvIdx] || {};
    const invLabel = text(excel?.invoice || sourceInv?.invoice || `#${sourceInvIdx + 1}`);
    const supplier = text(sourceInv?.supplier || sourceInv?.farm || '');
    const invoiceLinesContext = (sourceInv?.products || sourceInv?.lines || [])
      .map(l => text(l?.description || l?.source_description))
      .join(' ');

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
      const detectedFamily = detectFlowerFamily(description) || detectFlowerFamily(invoiceLinesContext);
      const ranked = rankProductSuggestions(description, activeProducts, {
        country: docCountry,
        supplier,
        limit: 6,
        minScore: 25,
      });
      const defaultHit = defaultInvoiceMatchSuggestion(description, activeProducts, docCountry);
      const sourceLine = (sourceInv?.products || sourceInv?.lines || [])[row?.sourceLineIndex ?? rowIndex] || row;
      const page = detectInvoicePage(sourceInv, sourceLine);

      productMap.set(sourceKey, {
        id: `prod:${sourceKey}`,
        description,
        sourceName: text(row?.sourceName || description),
        sourceKey,
        supplier,
        detectedFamily,
        status: review.status,
        statusLabel: review.label || (review.status === 'SIMILAR' ? '유사 후보 확인' : 'DB 미매칭'),
        invoices: invLabel ? [invLabel] : [],
        occurrences: 1,
        boxes: numOrNull(row?.boxes ?? row?.pcs),
        totalQty: Number(row?.qty ?? row?.stems ?? 0) || 0,
        unitPrice: numOrNull(row?.unitPrice ?? row?.u_price ?? row?.price),
        stemLength: text(row?.stemLength || row?.stem_length),
        defaultProdKey: defaultHit?.product?.ProdKey ?? null,
        suggestions: ranked.items,
        pdfTarget: {
          page,
          invoiceNo: invLabel,
          supplier,
          quotes: [
            text(row?.sourceName || description),
            description,
            invLabel,
          ].filter(Boolean),
        },
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
          rowIssues.push(`총송이(${totalStems}) × 단가(${uPrice}) = ${computedLine.toFixed(2)} ≠ 행금액(${tPrice.toFixed(2)})`);
        }
      }

      if (!rowIssues.length) return;
      const issueKey = `row:${invoiceIndex}:${lineIndex}`;
      if (seenRowIssueKeys.has(issueKey)) return;
      seenRowIssueKeys.add(issueKey);

      const evidenceBadges = extractLineEvidenceBadges(line);
      const page = detectInvoicePage(inv, line);
      const desc = text(line?.description || line?.source_description || `상품행 ${lineIndex + 1}`);

      quantityIssues.push({
        kind: 'ROW',
        id: issueKey,
        invoiceIndex,
        lineIndex,
        invoiceLabel: invLabel,
        supplier,
        description: desc,
        messages: rowIssues.map(sanitizeIssueMessageForOperator),
        evidenceBadges,
        evidenceQuote: evidenceBadges.map(b => `${b.label}: "${b.quote}"`).join(' · '),
        fields: {
          pcs: pcs ?? '',
          steam_box: steamBox ?? '',
          total_stems: totalStems ?? '',
          u_price: uPrice ?? '',
          t_price: tPrice ?? '',
        },
        hasSteamBox: Object.prototype.hasOwnProperty.call(line || {}, 'steam_box') || docCountry === 'CO',
        pdfTarget: {
          page,
          invoiceNo: invLabel,
          supplier,
          quotes: [
            text(line?.source_cells?.pcs?.quote || line?.review_evidence?.pcs?.quote),
            desc,
            invLabel,
          ].filter(Boolean),
          bbox: line?.source_cells?.pcs?.bbox || line?.review_evidence?.pcs?.bbox || null,
        },
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
      const totalQuote = text(inv?.metadata_evidence?.invoice_total?.quote || inv?.review_evidence?.freight_total?.quote || '');
      const page = detectInvoicePage(inv);

      quantityIssues.push({
        kind: 'INVOICE_TOTAL',
        id: `inv:${invoiceIndex}`,
        invoiceIndex,
        lineIndex: null,
        invoiceLabel: invLabel,
        supplier,
        description: '송장 합계 · 운송/부대비 대조',
        messages: [
          ...metaIssues.map(item => sanitizeIssueMessageForOperator(item.text)),
          ...(mismatchObj ? [`행 합계(${Number(mismatchObj.computed).toFixed(2)}) ≠ 송장 총액(${Number(mismatchObj.expected).toFixed(2)})`] : []),
        ],
        evidenceBadges: totalQuote ? [{ label: '원문 총액칸', quote: totalQuote }] : [],
        evidenceQuote: totalQuote ? `원문 총액칸: "${totalQuote}"` : '',
        fields: {
          goodsSum,
          freight: freightVal,
          invoice_total: printedTotal ?? '',
        },
        pdfTarget: {
          page,
          invoiceNo: invLabel,
          supplier,
          quotes: [totalQuote, invLabel].filter(Boolean),
          bbox: inv?.metadata_evidence?.invoice_total?.bbox || null,
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
      if (draft.metadata) {
        const hasTotalIssue = draft.metadata.issueFields?.includes('invoice_total')
          || (draft.metadata.issues || []).some(it => ['INVOICE_EXTRAS_UNAVAILABLE', 'AMOUNT_COMPONENTS_UNAVAILABLE', 'INVOICE_TOTAL_MISMATCH'].includes(it?.code));
        if (invEdit.invoice_total !== undefined && invEdit.invoice_total !== '') {
          if (String(invEdit.invoice_total) !== String(draft.metadata.values.invoice_total) || hasTotalIssue) {
            draft.metadata.values.invoice_total = String(invEdit.invoice_total);
            draft.metadata.reasons.invoice_total = reason;
            draft.metadata.confirmed.invoice_total = true;
            hasAnyChange = true;
          }
        }
      }
    }

    if (draft.sourceReview?.rows) {
      draft.sourceReview.rows.forEach((rowDraft, lineIndex) => {
        const edit = rowEdits[`row:${invoiceIndex}:${lineIndex}`];
        if (!edit) return;
        const reason = text(edit.reason) || '입고 매칭 알림창에서 원문 수량·단가 대조 보정';
        let rowChanged = false;
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
            rowChanged = true;
            hasAnyChange = true;
          }
        }
        if (rowChanged) {
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
