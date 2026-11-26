import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { INVOICE_COST_FORMULAS, previewInvoiceCost, restoredInvoiceCostInput } from '../../lib/invoiceReceiptCost';
import { acquireInvoiceCostWorkflowLock, classifyInvoiceCostPostResponse, invoiceCostApprovalInvalidationEvents, isInvoiceCostGenerationCurrent, runInvoiceCostSaveWorkflow, runInvoiceCostStageRunner, shouldShowInvoiceCostPreviewNotice, verifyInvoiceCostReadback } from '../../lib/invoiceReceiptCostWorkflow';
import styles from '../../styles/InvoiceReceiptCost.module.css';
import useCostStepGuide from './useCostStepGuide';
import { calculateVnOriginalCustoms, VN_CUSTOMS_SOURCE } from '../../lib/vnOriginalCostInputs.js';
import { readOnlyInvoiceCostValidation } from '../../lib/readOnlyInvoiceCostValidation.js';
import { invoiceCostDownloadFeedback } from '../../lib/invoiceCostDownloadFeedback.js';
import { downloadInvoiceCostExport, invoiceCostExportEligibility } from '../../lib/invoiceReceiptStageLogClient.js';
import { validateInvoiceCostReadback } from '../../lib/invoiceReceiptCostWorkflow';
import { AU_ORIGINAL_SOURCE, initialAuOriginalInputs, calculateAuOriginalCustoms } from '../../lib/auOriginalCostInputs.js';
import { nlInvoiceTariffRate } from '../../lib/nlInvoiceTariffReference.js';
import { nlInvoiceDraftTemplate } from '../../lib/nlInvoiceDraftDefaults.js';
import {isCloudInvoice,matchCloudCategory,cloudCustomsTotal,CLOUD_CUSTOMS_DEFAULTS} from '../../lib/chinaCloudCost.js';
import CloudCostCategories from './CloudCostCategories';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

const EMPTY_FORM = Object.freeze({
  formulaId: '',
  formulaVersion: '',
  formulaSourceHash: '',
  formulaSourceSheet: '',
  formulaSourceCells: '',
  formulaApplicabilityConfirmed: false,
  formulaEffectiveDate: '',
  nativeCurrency: '',
  exchangeRateKRW: '',
  exchangeRateType: '',
  exchangeRateDate: '',
  freightAmount: '',
  freightCurrency: '',
  customsTotalKRW: '',
  costSourceId: '',
  expenseBasis: 'CONFIRMED',
  estimateSource: '',
  allocationScope: '',
  allocationShareNumerator: '',
  allocationShareDenominator: '',
  expected95Quantity: '',
  costGroups: [],
  groupBoxBasis: 'RECEIPT_LINES',
  packingBoxTotal: '',
  lossTreatmentConfirmed: false,
  lineInputs: [],
});

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function tariffPercent(value) {
  return value === '' || value == null ? '' : Number((Number(value) * 100).toFixed(8));
}
function tariffFraction(value) {
  return value === '' || value == null ? '' : Number(value) / 100;
}
function manualFieldsNeeded(line, input, fields, formula) {
  if (Number(line.outQuantity) === 0 && line.outQuantity != null) return [];
  const unit = String(line.outUnit ?? '').trim().toUpperCase();
  const isStem = ['STEM', '송이', '스팀'].includes(unit);
  const isBunch = ['BUNCH', '단'].includes(unit);
  const isBox = ['BOX', '박스'].includes(unit);
  const basis = formula?.priceBasis;
  return fields.filter(key => {
    if (basis === 'BOX') {
      if (isBox && (key === 'stemsPerBunch' || key === 'bunchesPerBox')) return false;
      if (isBunch && key === 'stemsPerBunch') return false;
    } else if (basis === 'BUNCH') {
      if (isBunch && (key === 'stemsPerBunch' || key === 'bunchesPerBox')) return false;
      if (isBox && key === 'stemsPerBunch') return false;
      if (isStem && key === 'bunchesPerBox') return false;
    } else {
      if (key === 'stemsPerBunch' && isStem) return false;
      if (key === 'bunchesPerBox' && (isBunch || isStem)) return false;
    }
    const value = numberOrNull(input[key]);
    if (value === null || !Number.isFinite(Number(value))) return true;
    if (key === 'tariffRate') return value < 0 || value > 1;
    return key === 'stemsPerBunch' || key === 'bunchesPerBox' ? value <= 0 : value < 0;
  });
}

const LINE_FIELD_LABELS = Object.freeze({ tariffRate: '관세율', otherCostPerUnitKRW: '기타비/단위', stemsPerBunch: '단당 송이', bunchesPerBox: '박스당 단수', grossWeightKg: '실중량 kg', volumeWeightKg: 'CBM 환산중량 kg' });
const LEGACY_LINE_FIELDS = Object.freeze({
  CN_SEA_ACTUAL_V1: ['tariffRate', 'otherCostPerUnitKRW'],
  CN_AIR_WEIGHT_CBM_V1: ['tariffRate', 'otherCostPerUnitKRW', 'grossWeightKg', 'volumeWeightKg'],
  NL_AMOUNT_V1: ['tariffRate', 'stemsPerBunch'],
});
function formulaLineFields(formula) {
  return [...new Set(Array.isArray(formula?.lineInputFields) ? formula.lineInputFields : LEGACY_LINE_FIELDS[formula?.formulaId] || [])]
    .filter(key => typeof key === 'string' && /^[a-z][a-zA-Z0-9]*$/.test(key) && key !== 'lineId');
}
function allLineFields() {
  return [...new Set([...Object.keys(LINE_FIELD_LABELS), ...Object.values(INVOICE_COST_FORMULAS).flatMap(formulaLineFields)])];
}
const GROUP_FIELD_LABELS = Object.freeze({ quantity: '송이수 (STEM)', boxQuantity: '박스수', grossWeightKg: '실중량 kg', volumeWeightKg: '부피중량 kg' });
const GROUP_LABELS = Object.freeze({ ROSE: '장미', CARNATION: '카네이션', ALSTROMERIA: '알스트로', RUSCUS: '루스커스', HYDRANGEA: '수국', ANTHURIUM: '안스리움', OTHERS: '기타', LOOSE_BLOOMS: '루스블룸' });
const DERIVED_GROUP_LINE_FIELDS = ['grossWeightKg', 'volumeWeightKg', 'allocationShare'];
function groupLabel(groupId) { return GROUP_LABELS[groupId] || groupId; }
function visibleLineFields(formula) {
  return formulaLineFields(formula).filter(key => !['groupId','categoryCode'].includes(key) && !(formulaGroupIds(formula).length && DERIVED_GROUP_LINE_FIELDS.includes(key)));
}
function formulaGroupIds(formula) {
  return [...new Set(formula?.costGroupIds || formula?.groupIds || [])].filter(id => typeof id === 'string' && id.length > 0);
}
function formulaGroupFields(formula) {
  return (formula?.costGroupFields || Object.keys(GROUP_FIELD_LABELS)).filter(key => Object.hasOwn(GROUP_FIELD_LABELS, key));
}
function formulaGroups(formula, saved = []) {
  return formulaGroupIds(formula).map(groupId => ({ groupId, ...Object.fromEntries(Object.keys(GROUP_FIELD_LABELS).map(key => [key, saved.find(group => group.groupId === groupId)?.[key] ?? ''])) }));
}
function editedGroupForm(current, groupId, name, value) {
  return { ...current, formulaApplicabilityConfirmed: false, lossTreatmentConfirmed: false,
    costGroups: current.costGroups.map(group => group.groupId === groupId ? { ...group, [name]: value } : group) };
}
function editedForm(current, name, value) {
  return { ...current, [name]: value, formulaApplicabilityConfirmed: name === 'formulaApplicabilityConfirmed' ? value === true : false,
    lossTreatmentConfirmed: name === 'lossTreatmentConfirmed' ? value === true : name === 'formulaApplicabilityConfirmed' ? current.lossTreatmentConfirmed === true : false };
}
function switchedFormulaForm(current, formulaId) {
  const formula = INVOICE_COST_FORMULAS[formulaId];
  const fields = new Set(formulaLineFields(formula));
  return { ...current, formulaId, formulaApplicabilityConfirmed: false,
    groupBoxBasis: formula?.country === 'TH' ? current.groupBoxBasis ?? 'RECEIPT_LINES' : 'RECEIPT_LINES',
    packingBoxTotal: formula?.country === 'TH' ? current.packingBoxTotal ?? '' : '',
    lossTreatmentConfirmed: false, costGroups: formulaGroups(formula, current.formulaId === formulaId ? current.costGroups : []),
    formulaVersion: formula?.formulaVersion || '', formulaSourceHash: formula?.formulaSourceHash || '',
    formulaSourceSheet: formula?.formulaSourceSheet || '', formulaSourceCells: formula?.formulaSourceCells || '',
    lineInputs: current.lineInputs.map(line => ({ lineId: line.lineId,
      ...Object.fromEntries(allLineFields().map(key => [key, fields.has(key) ? line[key] ?? '' : ''])),
      groupId: fields.has('groupId') && formulaGroupIds(formula).includes(line.groupId) ? line.groupId : '' })),
  };
}
function formulaPriceBasis(formula) {
  return ({ BOX: '박스', BUNCH: '단', STEM: '송이', AMOUNT: '상품금액' })[formula?.priceBasis] || formula?.priceBasis || '공식 근거 확인 필요';
}

function committedReceiptLines(document) {
  if (Array.isArray(document?.receiptLines)) return document.receiptLines;
  const operation = (document?.operations || [])
    .filter(item => item.status === 'COMMITTED' && Number(item.documentRevision) === Number(document?.revision))
    .sort((left, right) => String(right.completedAt || '').localeCompare(String(left.completedAt || '')))[0];
  const byLine = new Map((operation?.result?.lineMappings || []).map(mapping => [String(mapping.lineId).toLowerCase(), mapping]));
  return (document?.lines || []).map(line => {
    const mapping = byLine.get(String(line.lineId).toLowerCase());
    const mapped = (key, fallback) => mapping && Object.prototype.hasOwnProperty.call(mapping, key) ? mapping[key] : fallback;
    return { ...line,
      outQuantity: mapped('outQuantity', null), outUnit: mapped('unit', null), wdetailKey: mapped('wdetailKey', null),
      boxQuantity: mapped('boxQuantity', line.boxQuantity), bunchQuantity: mapped('bunchQuantity', line.bunchQuantity),
      stemQuantity: mapped('stemQuantity', line.stemQuantity), unitPrice: mapped('unitPrice', line.unitPrice),
      lineAmount: mapped('lineAmount', line.lineAmount) };
  });
}

const PREVIEW_CO_COEFFICIENTS = Object.freeze({
  ROSE: Object.freeze({ gross: 8, volume: 10 }),
  CARNATION: Object.freeze({ gross: 11, volume: 9 }),
  ALSTROMERIA: Object.freeze({ gross: 9.7, volume: 7 }),
  RUSCUS: Object.freeze({ gross: 8, volume: 9.6 }),
  HYDRANGEA: Object.freeze({ gross: 5.5, volume: 6.7 }),
});

function previewSuggestCoGroup(flowerName, prodName, allowedIds = []) {
  const combined = `${flowerName || ''} ${prodName || ''}`.trim().toLowerCase();
  if (!combined) return '';
  let candidate = '';
  if (/수국|hydrangea/i.test(combined)) candidate = 'HYDRANGEA';
  else if (combined.includes('장미') || combined.includes('rose')) candidate = 'ROSE';
  else if (combined.includes('카네이션') || combined.includes('carnation')) candidate = 'CARNATION';
  else if (combined.includes('알스트로') || combined.includes('alstroemeria') || combined.includes('alstromeria') || combined.includes('alstro')) candidate = 'ALSTROMERIA';
  else if (combined.includes('루스커스') || combined.includes('ruscus')) candidate = 'RUSCUS';
  return candidate && (!allowedIds.length || allowedIds.includes(candidate)) ? candidate : '';
}

function previewSuggestThGroup(flowerName, prodName, allowedIds = []) {
  const combined = `${flowerName || ''} ${prodName || ''}`.trim();
  if (!combined) return '';
  let candidate = '';
  if (/anthurium|안스리움/i.test(combined)) candidate = 'ANTHURIUM';
  else if (/loose\s*bloom|루스\s*블룸|꽃송이/i.test(combined)) candidate = 'LOOSE_BLOOMS';
  else if (/\b(?:den|mok|aran|vanda|orchid|dendrobium|mokara|aranda|oncidium|julling|necklace|cymbidium|phalaenopsis|lotus|heliconia|ginger|monstera|pandanus|cordyline|philodendron|calathea|curcuma)\b|덴드로|모카라|아란다|반다|호접|난초|온시디움|연꽃/i.test(combined)) candidate = 'OTHERS';
  return candidate && (!allowedIds.length || allowedIds.includes(candidate)) ? candidate : '';
}

function derivePreviewLineStems(line, lineInput) {
  const explicit = numberOrNull(line?.stemQuantity);
  if (explicit !== null && explicit > 0) return explicit;
  const qty = numberOrNull(line?.outQuantity);
  if (!(qty > 0)) return 0;
  const unit = String(line?.outUnit ?? '').trim().toUpperCase();
  if (['STEM', '송이', '스팀'].includes(unit)) return qty;
  const spb = numberOrNull(lineInput?.stemsPerBunch ?? line?.stemsPerBunch);
  if (['BUNCH', '단'].includes(unit) && spb > 0) return qty * spb;
  const bpb = numberOrNull(lineInput?.bunchesPerBox);
  if (['BOX', '박스'].includes(unit) && spb > 0 && bpb > 0) return qty * spb * bpb;
  return 0;
}

function derivePreviewGroupState(formula, receiptLines, lineInputs, gwValue, cwValue) {
  const allowedIds = formulaGroupIds(formula);
  if (!allowedIds.length) return null;
  const isCO = formula?.country === 'CO';
  const isTH = formula?.country === 'TH';
  if (!isCO && !isTH) return null;
  const byLine = new Map((lineInputs || []).map(item => [String(item.lineId).toLowerCase(), item]));
  const totals = new Map(allowedIds.map(id => [id, { quantity: 0, boxQuantity: 0, activeCount: 0 }]));
  let totalReceiptBoxes = 0;
  let hasZeroBoxActiveLine = false;
  for (const line of receiptLines || []) {
    const qty = numberOrNull(line?.outQuantity);
    const amt = numberOrNull(line?.lineAmount);
    if (qty === 0 && (amt === 0 || amt === null)) continue;
    const setting = byLine.get(String(line?.lineId || '').toLowerCase());
    const groupId = String(setting?.groupId || '').trim().toUpperCase();
    const box = numberOrNull(line?.boxQuantity);
    if (box !== null && box > 0) totalReceiptBoxes = Math.round((totalReceiptBoxes + box) * 1e6) / 1e6;
    if (box === 0 || box === null) hasZeroBoxActiveLine = true;
    if (!totals.has(groupId)) continue;
    const bucket = totals.get(groupId);
    bucket.quantity = Math.round((bucket.quantity + derivePreviewLineStems(line, setting)) * 1e6) / 1e6;
    if (box !== null && box > 0) bucket.boxQuantity = Math.round((bucket.boxQuantity + box) * 1e6) / 1e6;
    bucket.activeCount += 1;
  }
  const activeIds = allowedIds.filter(id => totals.get(id).activeCount > 0 && totals.get(id).quantity > 0);
  const gw = numberOrNull(gwValue);
  const cw = numberOrNull(cwValue);
  const weightsByGroup = new Map();
  if (isCO && gw > 0 && cw >= gw && activeIds.length > 0 && activeIds.every(id => totals.get(id).boxQuantity > 0 && PREVIEW_CO_COEFFICIENTS[id])) {
    const grossDenom = activeIds.reduce((sum, id) => sum + totals.get(id).boxQuantity * PREVIEW_CO_COEFFICIENTS[id].gross, 0);
    const volDenom = activeIds.reduce((sum, id) => sum + totals.get(id).boxQuantity * PREVIEW_CO_COEFFICIENTS[id].volume, 0);
    if (grossDenom > 0 && volDenom > 0) {
      let accGross = 0, accVol = 0, allocatedGross = 0, allocatedVol = 0;
      activeIds.forEach((id, idx) => {
        accGross += totals.get(id).boxQuantity * PREVIEW_CO_COEFFICIENTS[id].gross;
        accVol += totals.get(id).boxQuantity * PREVIEW_CO_COEFFICIENTS[id].volume;
        const targetGross = idx === activeIds.length - 1 ? Math.round(gw * 1e6) / 1e6 : Math.round(gw * accGross / grossDenom * 1e6) / 1e6;
        const targetVol = idx === activeIds.length - 1 ? Math.round(cw * 1e6) / 1e6 : Math.round(cw * accVol / volDenom * 1e6) / 1e6;
        const gVal = Math.round((targetGross - allocatedGross) * 1e6) / 1e6;
        const vVal = Math.round((targetVol - allocatedVol) * 1e6) / 1e6;
        allocatedGross = Math.round((allocatedGross + gVal) * 1e6) / 1e6;
        allocatedVol = Math.round((allocatedVol + vVal) * 1e6) / 1e6;
        weightsByGroup.set(id, { grossWeightKg: gVal, volumeWeightKg: vVal });
      });
    }
  }
  const costGroups = allowedIds.map(groupId => {
    const t = totals.get(groupId);
    const w = weightsByGroup.get(groupId);
    const active = t.activeCount > 0 && t.quantity > 0;
    return {
      groupId,
      quantity: active ? t.quantity : '',
      boxQuantity: active && t.boxQuantity > 0 ? t.boxQuantity : '',
      grossWeightKg: w ? w.grossWeightKg : '',
      volumeWeightKg: w ? w.volumeWeightKg : '',
    };
  });
  const sharedPacking = isTH && hasZeroBoxActiveLine && totalReceiptBoxes > 0;
  return {
    costGroups,
    activeGroupIds: activeIds,
    ...(sharedPacking ? { groupBoxBasis: 'PACKING_GROUP', packingBoxTotal: totalReceiptBoxes } : {}),
  };
}

function previewReferenceCustoms(formula, gwValue, activeLineCount, activeGroupCount) {
  const gw = numberOrNull(gwValue);
  if (!(gw > 0)) return null;
  const round = n => Math.round(n * 1e6) / 1e6;
  const id = formula?.formulaId;
  if ((id === 'CO_GROUP_42_1_V1' || id === 'CO_GROUP_WEIGHT_VOLUME_V1') && activeGroupCount > 0) {
    return {
      customsTotalKRW: round(gw * 460 + 33000 + activeGroupCount * 10000 + 99000 + 40000),
      estimateSource: '콜롬비아 42-1 원본: GW×460 + 통관33,000 + 품종수×10,000 + 국내운송99,000 + 검역40,000',
    };
  }
  if (!(activeLineCount > 0)) return null;
  if (id === 'US_CNF_BOX_V1') {
    return {
      customsTotalKRW: round(gw * 460 + 33000 + activeLineCount * 10000 + 90000),
      estimateSource: '미국 40-1 원본 기준: GW×460 + 통관33,000 + 품목수×10,000 + 국내운송90,000 (추정)',
    };
  }
  if (id === 'NZ_CNF_STEM_V1') {
    return {
      customsTotalKRW: round(gw * 375 + 33000 + activeLineCount * 10000 + 90000),
      estimateSource: '뉴질랜드 원본 기준: GW×375 + 통관33,000 + 품목수×10,000 + 국내운송90,000 (추정)',
    };
  }
  if (id === 'EC_FOB_STEM_V1') {
    return {
      customsTotalKRW: round(gw * 460 + activeLineCount * 9000 + 36000 + 90000 + 20000),
      estimateSource: '에콰도르 40-2 원본 기준: GW×460 + 통관(품목수×9,000) + 검역36,000 + 국내운송90,000 + 참고검역20,000 (추정)',
    };
  }
  if (id === 'TH_GROUP_BOX_SHARE_V1') {
    return {
      customsTotalKRW: round(gw * 460 + 33000 + activeLineCount * 10000 + 99000),
      estimateSource: '태국 40차 원본 기본식(검역손실 별도): GW×460 + 통관33,000 + 품목수×10,000 + 국내운송99,000 (추정)',
    };
  }
  return null;
}

function initialForm(document, receiptLines) {
  const saved = document?.reviewedMetadata?.invoiceCostInput || document?.reviewedMetadata?.costInput || {};
  const freight = document?.reviewedMetadata?.costInputs?.freight;
  const docFee = document?.reviewedMetadata?.costInputs?.docFee;
  const isValidInvoiceCharge = item => item?.source === 'invoice'
    && /^[A-Z]{3}$/.test(String(item.currency || '').trim().toUpperCase())
    && item.amount !== null && item.amount !== undefined && item.amount !== ''
    && Number.isFinite(Number(item.amount)) && Number(item.amount) >= 0;
  const hasFreight = isValidInvoiceCharge(freight);
  const hasDocFee = isValidInvoiceCharge(docFee);
  const sameChargeCurrency = !hasFreight || !hasDocFee
    || String(freight.currency).trim().toUpperCase() === String(docFee.currency).trim().toUpperCase();
  const recognizedFreight = (hasFreight || hasDocFee) && sameChargeCurrency;
  const recognizedFreightCurrency = hasFreight
    ? String(freight.currency).trim().toUpperCase()
    : hasDocFee ? String(docFee.currency).trim().toUpperCase() : '';
  const recognizedFreightAmount = recognizedFreight
    ? Math.round(((hasFreight ? Number(freight.amount) : 0) + (hasDocFee ? Number(docFee.amount) : 0)) * 1e6) / 1e6
    : null;
  const lineCurrencies = new Set(receiptLines.map(line => String(line.currency || '').trim().toUpperCase()));
  const uniformNativeCurrency = lineCurrencies.size === 1 && /^[A-Z]{3}$/.test([...lineCurrencies][0])
    ? [...lineCurrencies][0] : '';
  const initialFormulaId = saved.formulaId || applicableFormulaId(document);
  const verifiedFormula = INVOICE_COST_FORMULAS[initialFormulaId];
  const isPreviewOnly = document?.costStatus === 'PREVIEW_ONLY';
  const marketRate = document?.reviewedMetadata?.audMarketRate || null;
  const savedLines = new Map((saved.lineInputs || []).map(line => [String(line.lineId).toLowerCase(), line]));
  const vn = verifiedFormula?.country==='VN' && isPreviewOnly
    ? calculateVnOriginalCustoms({gw:document.reviewedMetadata?.gw,cw:document.reviewedMetadata?.cw,
      itemCount:new Set(receiptLines.filter(l=>Number(l.prodKey)>0).map(l=>Number(l.prodKey))).size}) : null;
  const allowedGroups = formulaGroupIds(verifiedFormula);
  const lineInputs = receiptLines.map(line => {
    const savedLine = savedLines.get(String(line.lineId).toLowerCase());
    const explicitGroup = String(savedLine?.groupId ?? '');
    const suggestedGroup = !explicitGroup && isPreviewOnly
      ? (verifiedFormula?.country === 'CO'
        ? previewSuggestCoGroup(line.flowerName, line.originalName, allowedGroups)
        : verifiedFormula?.country === 'TH'
          ? previewSuggestThGroup(line.flowerName, line.originalName, allowedGroups)
          : '')
      : '';
    return {
      lineId: line.lineId,
      ...Object.fromEntries(allLineFields().map(key => [key, savedLine?.[key] ?? ''])),
      tariffRate: savedLine?.tariffRate
        ?? (verifiedFormula?.country === 'NL' ? (typeof line.tariffRate === 'number' ? line.tariffRate
          : nlInvoiceTariffRate(line.originalName, line.originName || line.countryName))
          : (isPreviewOnly && verifiedFormula?.country === 'CO' ? 0 : '')),
      otherCostPerUnitKRW: savedLine?.otherCostPerUnitKRW ?? '',
      stemsPerBunch: savedLine?.stemsPerBunch ?? '',
      grossWeightKg: savedLine?.grossWeightKg
        ?? (documentCountry(document) === 'CN' && documentTransport(document) === 'AIR'
          && line.sourceEvidence?.grossWeightKg !== null && line.sourceEvidence?.grossWeightKg !== undefined
          && line.sourceEvidence?.grossWeightKg !== '' && Number.isFinite(Number(line.sourceEvidence?.grossWeightKg))
          && Number(line.sourceEvidence.grossWeightKg) >= 0 ? Number(line.sourceEvidence.grossWeightKg) : ''),
      volumeWeightKg: savedLine?.volumeWeightKg ?? '',
      groupId: explicitGroup || suggestedGroup,
      categoryCode: Object.hasOwn(savedLine ?? {}, 'categoryCode')
        ? savedLine.categoryCode ?? '' : (verifiedFormula?.formulaId === 'CN_CLOUD_CBM_V1' ? matchCloudCategory(line.originalName) : null) ?? '',
      categoryOverride: savedLine?.categoryOverride ?? null,
    };
  });
  const hasSavedGroups = Array.isArray(saved.costGroups) && saved.costGroups.length > 0;
  const derivedGroupState = isPreviewOnly && !hasSavedGroups
    ? derivePreviewGroupState(verifiedFormula, receiptLines, lineInputs, document?.reviewedMetadata?.gw, document?.reviewedMetadata?.cw)
    : null;
  const activeLineCount = receiptLines.filter(line => {
    const q = numberOrNull(line?.outQuantity);
    return q === null ? true : q > 0;
  }).length;
  const refCustoms = isPreviewOnly && numberOrNull(saved.customsTotalKRW) === null && !vn
    ? previewReferenceCustoms(verifiedFormula, document?.reviewedMetadata?.gw, activeLineCount, derivedGroupState?.activeGroupIds?.length ?? 0)
    : null;
  const autoCnfZeroFreight = isPreviewOnly && verifiedFormula?.freightIncluded === true
    && numberOrNull(saved.freightAmount) === null && !recognizedFreight && numberOrNull(freight?.amount) === null;
  return {
    ...EMPTY_FORM,
    nativeCurrency: uniformNativeCurrency,
    ...(recognizedFreight ? {
      freightAmount: recognizedFreightAmount,
      freightCurrency: recognizedFreightCurrency,
    } : {}),
    ...saved,
    ...(verifiedFormula?.formulaId==='CN_CLOUD_CBM_V1'?{...CLOUD_CUSTOMS_DEFAULTS,...Object.fromEntries(Object.keys(CLOUD_CUSTOMS_DEFAULTS).filter(k=>saved[k]!=null).map(k=>[k,saved[k]])),cloudCustomsMode:saved.cloudCustomsMode??(saved.customsTotalKRW!=null?'TOTAL':'FORMULA'),expenseBasis:saved.expenseBasis??'ESTIMATED',estimateSource:saved.estimateSource??'46-2 CLOUD cbm 원본 기준값 · 실제 비용 확인 전 추정 · 국내운송비는 해당 자료의 195,000원이며 중량별 확정요율 아님'}:{}),
    ...(vn && vn.total!==null && numberOrNull(saved.customsTotalKRW)===null ? {customsTotalKRW:vn.total,expenseBasis:'ESTIMATED',estimateSource:VN_CUSTOMS_SOURCE} : {}),
    ...(refCustoms ? { customsTotalKRW: refCustoms.customsTotalKRW, expenseBasis: 'ESTIMATED', estimateSource: refCustoms.estimateSource } : {}),
    ...(autoCnfZeroFreight ? { freightAmount: 0, freightCurrency: String(saved.freightCurrency || uniformNativeCurrency).trim().toUpperCase() } : {}),
    ...(verifiedFormula?.country === 'AU' ? {
      exchangeRateKRW: saved.exchangeRateKRW ?? marketRate?.rate ?? '',
      exchangeRateType: saved.exchangeRateType ?? 'MARKET_SEARCH',
      exchangeRateDate: saved.exchangeRateDate ?? marketRate?.rateDate ?? '',
      exchangeRateSource: saved.exchangeRateSource ?? marketRate?.source ?? '',
      exchangeRateSourceUrl: saved.exchangeRateSourceUrl ?? marketRate?.sourceUrl ?? '',
      exchangeRateRequestedDate: saved.exchangeRateRequestedDate ?? marketRate?.requestedDate ?? document?.reviewedMetadata?.invoiceUploadDate ?? '',
      exchangeRateCarriedForward: saved.exchangeRateCarriedForward ?? marketRate?.carriedForward ?? false,
    } : {}),
    ...(verifiedFormula?.country === 'AU' ? { auOriginal: initialAuOriginalInputs(document, saved),
      auOriginalMode: document.costStatus === 'PREVIEW_ONLY' ? saved.auOriginalMode || (numberOrNull(saved.customsTotalKRW) === null ? 'FORMULA' : 'TOTAL') : 'TOTAL' } : {}),
    ...(verifiedFormula?.country === 'AU' && verifiedFormula?.freightIncluded === true ? {
      freightAmount: numberOrNull(saved.freightAmount) === null ? (numberOrNull(freight?.amount) === null ? 0 : freight.amount) : saved.freightAmount,
      freightCurrency: String(saved.freightCurrency || '').trim() || String(freight?.currency || uniformNativeCurrency).trim().toUpperCase(),
    } : {}),
    ...(verifiedFormula ? {
      formulaId: initialFormulaId,
      formulaVersion: verifiedFormula.formulaVersion,
      formulaSourceHash: verifiedFormula.formulaSourceHash,
      formulaSourceSheet: verifiedFormula.formulaSourceSheet,
      formulaSourceCells: verifiedFormula.formulaSourceCells,
    } : {}),
    ...(derivedGroupState?.groupBoxBasis && !saved.groupBoxBasis ? { groupBoxBasis: derivedGroupState.groupBoxBasis } : {}),
    ...(derivedGroupState?.packingBoxTotal !== undefined && numberOrNull(saved.packingBoxTotal) === null ? { packingBoxTotal: derivedGroupState.packingBoxTotal } : {}),
    formulaApplicabilityConfirmed: false,
    lossTreatmentConfirmed: false,
    costGroups: derivedGroupState ? derivedGroupState.costGroups : formulaGroups(verifiedFormula, saved.costGroups),
    lineInputs,
  };
}

function receiptStatusLabel(status) {
  return ({ DRAFT: '초안', REVIEW_REQUIRED: '검토 필요', PARTIAL: '일부 등록', COMMITTED: '입고 확정' })[status] || status || '—';
}

function documentCountry(document) {
  const value = String(document?.reviewedMetadata?.country || '').trim().toUpperCase();
  if (['CN', 'CHINA', '중국'].includes(value)) return 'CN';
  if (['NL', 'NETHERLANDS', 'HOLLAND', '네덜란드'].includes(value)) return 'NL';
  if (['US', 'USA', '미국'].includes(value)) return 'US';
  if (['VN', 'VIETNAM', '베트남'].includes(value)) return 'VN';
  if (['AU', 'AUSTRALIA', '호주'].includes(value)) return 'AU';
  if (['NZ', 'NEW ZEALAND', '뉴질랜드'].includes(value)) return 'NZ';
  if (['EC', 'ECUADOR', '에콰도르'].includes(value)) return 'EC';
  if (['CO', 'COLOMBIA', '콜롬비아'].includes(value)) return 'CO';
  if (['TH', 'THAILAND', '태국'].includes(value)) return 'TH';
  return value;
}

function documentTransport(document) {
  return String(document?.reviewedMetadata?.transportMode || '').trim().toUpperCase();
}

function currentCommittedWarehouseKey(document) {
  const revision = Number(document?.revision);
  const operation = (document?.operations || [])
    .filter(item => item.status === 'COMMITTED' && Number(item.documentRevision) === revision && Number(item.warehouseKey) > 0)
    .sort((left, right) => String(right.completedAt || '').localeCompare(String(left.completedAt || '')))[0];
  if (operation) return Number(operation.warehouseKey);
  return document?.receiptStatus === 'COMMITTED' && Number(document?.warehouseKey) > 0 ? Number(document.warehouseKey) : 0;
}

function applicableFormulaId(document) {
  const choices = applicableFormulas(document);
  if (choices.length === 1) return choices[0].formulaId;
  if (document?.costStatus === 'PREVIEW_ONLY' && documentCountry(document) === 'CO' && documentTransport(document) === 'AIR') {
    const preferred = choices.find(formula => formula.formulaId === 'CO_GROUP_42_1_V1');
    if (preferred) return preferred.formulaId;
  }
  return '';
}
function applicableFormulas(document) {
  const country = documentCountry(document), transport = documentTransport(document);
  return Object.values(INVOICE_COST_FORMULAS).filter(formula => formula.country === country && formula.transportMode === transport
    && (formula.formulaId==='CN_CLOUD_CBM_V1'?isCloudInvoice(document):!(country==='CN'&&transport==='AIR'&&isCloudInvoice(document)))
    && country && transport && formula.formulaId && formula.formulaSourceHash && formula.formulaVersion);
}

function pendingStorageKey(document) {
  return `nenova:invoice-cost-pending:${String(document?.documentId || '').toLowerCase()}:${Number(document?.revision)}`;
}

function readPending(document) {
  try {
    const raw = window.localStorage.getItem(pendingStorageKey(document));
    if (!raw) return null;
    const pending = JSON.parse(raw);
    if (!['post', 'verify'].includes(pending?.kind) || Number(pending?.request?.revision) !== Number(document?.revision)
      || !Number.isInteger(Number(pending?.warehouseKey)) || Number(pending.warehouseKey) <= 0) return null;
    if (pending.kind === 'verify' && !Array.isArray(pending.savedCostRevisionIds)) return null;
    return pending;
  } catch { return null; }
}

function writePending(document, value) {
  try {
    const key = pendingStorageKey(document);
    if (value) window.localStorage.setItem(key, JSON.stringify(value));
    else window.localStorage.removeItem(key);
  } catch { /* In-memory recovery remains available when browser storage is disabled. */ }
}

async function postInvoiceCostRequest(documentId, request) {
  let response;
  try {
    response = await fetch(`/api/import/receipts/${encodeURIComponent(documentId)}/cost-revisions`, {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request),
    });
  } catch (error) { error.outcomeUnknown = true; throw error; }
  if (response.status >= 500 || [408, 429].includes(response.status)) {
    const error = new Error(`원가 저장 응답이 불확실합니다 (HTTP ${response.status}).`);
    error.outcomeUnknown = true;
    throw error;
  }
  let data;
  try { data = await response.json(); }
  catch (error) {
    if (response.ok) error.outcomeUnknown = true;
    else error.message = '원가 저장 요청이 거부되었습니다. 응답 본문을 읽지 못했습니다.';
    throw error;
  }
  const classified = classifyInvoiceCostPostResponse(response.ok, data);
  if (classified?.outcomeUnknown) {
    const error = new Error(classified.error);
    error.outcomeUnknown = true;
    throw error;
  }
  return classified;
}

function payloadOf(form) {
  const auFormula = form.formulaId === 'AU_CNF_BUNCH_V1' && form.auOriginalMode === 'FORMULA';
  return {
    ...form,
    exchangeRateKRW: numberOrNull(form.exchangeRateKRW),
    freightAmount: numberOrNull(form.freightAmount),
    customsTotalKRW: auFormula ? calculateAuOriginalCustoms(form.auOriginal).total : numberOrNull(form.customsTotalKRW),
    ...(auFormula ? { expenseBasis: 'ESTIMATED', estimateSource: AU_ORIGINAL_SOURCE } : {}),
    packingBoxTotal: numberOrNull(form.packingBoxTotal),
    allocationShareNumerator: numberOrNull(form.allocationShareNumerator),
    allocationShareDenominator: numberOrNull(form.allocationShareDenominator),
    expected95Quantity: numberOrNull(form.expected95Quantity),
    lossTreatmentConfirmed: form.lossTreatmentConfirmed === true,
    costGroups: (form.costGroups || []).filter(group => Object.keys(GROUP_FIELD_LABELS).some(key => group[key] !== '' && group[key] !== null && group[key] !== undefined)).map(group => ({ groupId: String(group.groupId ?? ''),
      ...Object.fromEntries(Object.keys(GROUP_FIELD_LABELS).map(key => [key, numberOrNull(group[key])])) })),
    lineInputs: form.lineInputs.map(line => ({
      lineId: line.lineId,
      ...Object.fromEntries(allLineFields().map(key => [key, numberOrNull(line[key])])),
      tariffRate: numberOrNull(line.tariffRate),
      otherCostPerUnitKRW: numberOrNull(line.otherCostPerUnitKRW),
      stemsPerBunch: numberOrNull(line.stemsPerBunch),
      grossWeightKg: numberOrNull(line.grossWeightKg),
      volumeWeightKg: numberOrNull(line.volumeWeightKg),
      groupId: String(line.groupId ?? ''),
      ...(line.categoryOverride?{categoryOverride:line.categoryOverride}:{}),
      ...(formulaGroupIds(INVOICE_COST_FORMULAS[form.formulaId]).length ? Object.fromEntries(DERIVED_GROUP_LINE_FIELDS.map(key => [key, null])) : {}),
    })),
  };
}

function Field({ label, children, wide = false }) {
  return <label className={wide ? styles.wideField : styles.field}><span>{label}</span>{children}</label>;
}

function money(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value))
    ? `${Number(value).toLocaleString('ko-KR', { maximumFractionDigits: 0 })}원` : '—';
}

function unitLabel(value) {
  return ({ BUNCH: '단', STEM: '송이', BOX: '박스' })[value] || value || '';
}

export default function InvoiceReceiptCostReview({ document, onSaved, autoProcess = false, autoSaveRequested = false, onStageChange, nativePreview: nativeReceiptPreview = false, invoicePreview = false, onNativeAction, products = [], onEditAllocation, onInputDraftChange }) {
  const nativePreview = nativeReceiptPreview || invoicePreview; // Both calculation modes must never save an approval.
  const automaticSaveAttempts = useRef(new Set());
  const receiptLines = useMemo(() => committedReceiptLines(document), [document]);
  const identity = `${String(document?.documentId || '')}:${Number(document?.revision)}:${document?.sourceHash || ''}`;
  const identityRef = useRef(identity);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const workflowLocksRef = useRef(new Set());
  const pristineRef = useRef(true);
  const groupsManuallyEditedRef = useRef(false);
  const customsManuallyEditedRef = useRef(false);
  const [inputEdited, setInputEdited] = useState(false);
  const [manualLineFilter, setManualLineFilter] = useState(null);
  const isCurrent = (expectedIdentity = identity, expectedGeneration = generationRef.current) => isInvoiceCostGenerationCurrent({
    mounted: mountedRef.current, currentIdentity: identityRef.current, currentGeneration: generationRef.current,
    expectedIdentity, expectedGeneration,
  });
  const [formIdentity, setFormIdentity] = useState(identity);
  const [form, setForm] = useState(() => {
    const value = initialForm(document, receiptLines);
    const formulaId = value.formulaId || applicableFormulaId(document);
    const formula = INVOICE_COST_FORMULAS[formulaId];
    return formula ? { ...value, formulaId, formulaVersion: formula.formulaVersion, formulaSourceHash: formula.formulaSourceHash,
      formulaSourceSheet: formula.formulaSourceSheet, formulaSourceCells: formula.formulaSourceCells } : value;
  });
  const [exchangeRateStatus, setExchangeRateStatus] = useState('');
  const [exchangeRateRetry, setExchangeRateRetry] = useState(0);
  const [preview, setPreview] = useState(null);
  const externalBasis=JSON.stringify([document?.reviewedMetadata?.gw,document?.reviewedMetadata?.cw,document?.reviewedMetadata?.transportMode,document?.reviewedMetadata?.currency]);
  const externalBasisRef=useRef(externalBasis);
  useEffect(()=>{
    if(externalBasisRef.current===externalBasis)return;
    externalBasisRef.current=externalBasis;setPreview(null);setInputEdited(true);
    const nextGw=document?.reviewedMetadata?.gw;
    setForm(current=>({
      ...current,
      formulaApplicabilityConfirmed:false,
      cloudFinancialReviewConfirmed:false,
      ...(current.formulaId==='AU_CNF_BUNCH_V1'&&nextGw!=null&&nextGw!==''&&Number.isFinite(Number(nextGw))&&Number(nextGw)>0
        ?{auOriginal:{...current.auOriginal,gw:Number(nextGw)}}:{}),
    }));
  },[externalBasis]);
  useEffect(() => { onInputDraftChange?.({...payloadOf(form),formulaApplicabilityConfirmed:nativePreview||form.formulaApplicabilityConfirmed===true}, { edited: inputEdited }); }, [form, inputEdited, onInputDraftChange, nativePreview]);
  useEffect(() => {
    const template = nlInvoiceDraftTemplate(document, receiptLines, form);
    if (!template || (Number(form.customsTotalKRW) === template.total
      && JSON.stringify(form.nlTemplateCosts) === JSON.stringify(template.costs))) return;
    setForm(current => ({ ...current, customsTotalKRW:template.total,
      nlTemplateCosts:template.costs, expenseBasis:'ESTIMATED', estimateSource:template.estimateSource,
      formulaApplicabilityConfirmed:false }));
  }, [form, document, receiptLines]);
  useEffect(() => {
    if (!nativePreview || document?.costStatus !== 'PREVIEW_ONLY') return;
    const formula = INVOICE_COST_FORMULAS[form.formulaId];
    if (!formula) return;
    const derived = !groupsManuallyEditedRef.current
      ? derivePreviewGroupState(formula, receiptLines, form.lineInputs, document?.reviewedMetadata?.gw, document?.reviewedMetadata?.cw)
      : null;
    const activeLineCount = receiptLines.filter(line => {
      const q = numberOrNull(line?.outQuantity);
      return q === null ? true : q > 0;
    }).length;
    const activeGroupCount = derived?.activeGroupIds?.length
      ?? (form.costGroups || []).filter(g => numberOrNull(g.quantity) > 0).length;
    const refCustoms = !customsManuallyEditedRef.current && (numberOrNull(form.customsTotalKRW) === null || form.expenseBasis === 'ESTIMATED')
      ? previewReferenceCustoms(formula, document?.reviewedMetadata?.gw, activeLineCount, activeGroupCount)
      : null;
    const groupsChanged = derived && JSON.stringify(derived.costGroups) !== JSON.stringify(form.costGroups);
    const customsChanged = refCustoms && Number(form.customsTotalKRW) !== refCustoms.customsTotalKRW;
    if (!groupsChanged && !customsChanged) return;
    setForm(current => ({
      ...current,
      ...(groupsChanged ? {
        costGroups: derived.costGroups,
        ...(derived.groupBoxBasis ? { groupBoxBasis: derived.groupBoxBasis } : {}),
        ...(derived.packingBoxTotal !== undefined && numberOrNull(current.packingBoxTotal) === null ? { packingBoxTotal: derived.packingBoxTotal } : {}),
      } : {}),
      ...(customsChanged ? {
        customsTotalKRW: refCustoms.customsTotalKRW,
        expenseBasis: 'ESTIMATED',
        estimateSource: refCustoms.estimateSource,
      } : {}),
    }));
  }, [nativePreview, document?.costStatus, document?.reviewedMetadata?.gw, document?.reviewedMetadata?.cw, form.formulaId, form.lineInputs, receiptLines]);
  const [reason, setReason] = useState('');
  const [busyIdentity, setBusyIdentity] = useState('');
  const busy = busyIdentity === identity || workflowLocksRef.current.has(identity);
  const [notice, setNotice] = useState(null);
  const [verifiedExport, setVerifiedExport] = useState(null);
  const [exportBusy, setExportBusy] = useState(false);
  const exportLockRef = useRef(false);
  const exportInputGenerationRef = useRef(0);
  const [pending, setPending] = useState(null);
  const [pendingIdentity, setPendingIdentity] = useState('');
  const pendingRef = useRef(pending);
  const stageCallback = useRef(onStageChange);
  const stageStatuses = useRef({});
  const savedCallback = useRef(onSaved);
  stageCallback.current = onStageChange;
  savedCallback.current = onSaved;
  pendingRef.current = pending;

  useIsomorphicLayoutEffect(() => {
    mountedRef.current = true;
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      generationRef.current += 1;
    }
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
    };
  }, [identity]);

  useEffect(() => {
    if (!document || numberOrNull(form.exchangeRateKRW) !== null || document.costStatus === 'APPROVED') return;
    const currency = String(form.nativeCurrency || '').toUpperCase();
    if (!['USD','EUR','CNY','AUD','NZD','THB'].includes(currency)) return;
    const controller = new AbortController();
    setExchangeRateStatus(`${currency}/KRW 현재 시세 +15원 조회 중…`);
    fetch(`/api/import/receipts/live-exchange-rate?currency=${encodeURIComponent(currency)}`, {
      credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
    }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result?.success) throw new Error(result?.error || 'AUD 환율을 조회하지 못했습니다.');
      return result;
    }).then(result => {
      if (controller.signal.aborted) return;
      setForm(current => {
        if (numberOrNull(current.exchangeRateKRW) !== null || String(current.nativeCurrency).toUpperCase() !== currency) return current;
        pristineRef.current = false; setInputEdited(true); setPreview(null);
        return { ...current, exchangeRateKRW: result.rate, exchangeRateType: 'LIVE_MARKET_PLUS_15',
          exchangeRateDate: result.quoteAt.slice(0,10), exchangeRateSource: `${result.source} · 시세 ${result.marketRate} +15원`,
          exchangeRateSourceUrl: result.sourceUrl,
          exchangeRateRequestedDate: result.requestedAt.slice(0,10), exchangeRateQuoteAt: result.quoteAt, exchangeRateMarketRate: result.marketRate, exchangeRateAdjustmentKRW: 15 };
      });
      setExchangeRateStatus(`${result.source} · ${result.quoteAt} · 시세 ${result.marketRate} +15원 = ${result.rate}`);
    }).catch(error => {
      if (error.name !== 'AbortError') setExchangeRateStatus(`환율 자동 조회 실패: ${error.message}`);
    });
    return () => controller.abort();
  }, [identity, document?.costStatus, form.nativeCurrency, form.exchangeRateKRW, exchangeRateRetry]);

  function emitStage(id, status, message) {
    if (stageStatuses.current[id] === status) return;
    stageStatuses.current[id] = status;
    try { stageCallback.current?.({ documentId: String(document?.documentId || ''), revision: Number(document?.revision), sourceHash: document?.sourceHash, id, status, message, at: new Date().toISOString() }); }
    catch { /* Parent progress observers cannot block this document's local workflow. */ }
  }

  useEffect(() => {
    pristineRef.current = true;
    groupsManuallyEditedRef.current = false;
    customsManuallyEditedRef.current = false;
    setInputEdited(false);
    setFormIdentity(identity);
    const nextReceiptLines = committedReceiptLines(document);
    const nextForm = initialForm(document, nextReceiptLines);
    const formulaId = nextForm.formulaId || applicableFormulaId(document);
    const formula = INVOICE_COST_FORMULAS[formulaId];
    setForm(formula ? { ...nextForm, formulaId, formulaVersion: formula.formulaVersion, formulaSourceHash: formula.formulaSourceHash,
      formulaSourceSheet: formula.formulaSourceSheet, formulaSourceCells: formula.formulaSourceCells } : nextForm);
    setPreview(null);
    setReason('');
    setNotice(null);
    const stored = !nativePreview && typeof window !== 'undefined' ? readPending(document) : null;
    setPending(stored);
    setPendingIdentity(identity);
    setBusyIdentity('');
    stageStatuses.current = {};
    emitStage('cost', 'waiting', '실제 입고와 원가 입력을 확인하기 전입니다.');
    emitStage('costSave', 'waiting', '승인 사유와 사용자의 저장 확인을 기다립니다.');
    emitStage('costVerify', 'waiting', '원가 저장 후 별도 재조회를 기다립니다.');
  }, [identity]);

  useEffect(() => {
    setVerifiedExport(null);
    if (document?.costStatus !== 'APPROVED' || document?.receiptStatus !== 'COMMITTED') return;
    const abort = new AbortController(), expectedIdentity = identity, expectedGeneration = generationRef.current;
    const expectedInputGeneration = exportInputGenerationRef.current;
    const warehouseKey = currentCommittedWarehouseKey(document);
    if (!warehouseKey) return;
    (async () => {
      try {
        const response = await fetch(`/api/warehouse/invoice-costs?warehouseKey=${encodeURIComponent(warehouseKey)}`, { credentials: 'same-origin', cache: 'no-store', signal: abort.signal });
        const data = await response.json();
        const verified = validateInvoiceCostReadback(document, warehouseKey, data);
        if (!response.ok || !verified.ok) throw new Error(verified.message || '승인 원가 재조회 실패');
        if (!abort.signal.aborted && isCurrent(expectedIdentity, expectedGeneration) && exportInputGenerationRef.current === expectedInputGeneration) setVerifiedExport({ identity: expectedIdentity, actual: verified.actual });
      } catch (error) {
        if (!abort.signal.aborted && isCurrent(expectedIdentity, expectedGeneration)) setNotice({ type: 'error', text: '다운로드용 승인 원가를 확인하지 못했습니다. 승인 입력을 다시 불러오세요.' });
      }
    })();
    return () => abort.abort();
  }, [identity, document?.costStatus, document?.receiptStatus]);

  useEffect(() => {
    if (!document || !autoProcess || formIdentity !== identity || pendingIdentity !== identity || pending) return;
    const generation = generationRef.current;
    const documentIdentity = identity;
    let active = true;
    const current = () => active && isCurrent(documentIdentity, generation);
    runInvoiceCostStageRunner({
      document, calculate: () => previewInvoiceCost({ ...document, costInput: payloadOf(form) }, receiptLines),
      emit: event => { if (current()) emitStage(event.id, event.status, event.message); },
    }).then(result => {
      if (!current()) return;
      setPreview(result.preview || null);
      if (!shouldShowInvoiceCostPreviewNotice({ pending: pendingRef.current,
        saveStatus: stageStatuses.current.costSave, verifyStatus: stageStatuses.current.costVerify })) return;
      setNotice(result.preview?.status === 'APPROVED'
        ? { type: 'success', text: '실제 입고량 기준 원가가 계산되었습니다. 저장 전 합계와 행별 근거를 확인하세요.' }
        : { type: 'error', text: '입력 검토가 필요합니다. 누락값을 0으로 대신하지 않았습니다.' });
    });
    return () => { active = false; };
  }, [identity, formIdentity, form, receiptLines, autoProcess, pendingIdentity, pending]);

  useEffect(() => {
    if (!autoSaveRequested || !autoProcess || preview?.status !== 'APPROVED' || pending || busy
      || document?.costStatus === 'APPROVED' || formIdentity !== identity) return;
    const attempt = `${identity}:${JSON.stringify(payloadOf(form))}`;
    if (automaticSaveAttempts.current.has(attempt)) return;
    automaticSaveAttempts.current.add(attempt);
    save('담당자 입고등록·도착원가 생성 실행');
  }, [autoSaveRequested,autoProcess,preview,pending,busy,formIdentity,identity,form,document?.costStatus]);

  if (!document) return null;

  function update(name, value) {
    setNotice(null);
    pristineRef.current = false;
    if (name === 'customsTotalKRW' || name === 'expenseBasis') customsManuallyEditedRef.current = true;
    if (name === 'groupBoxBasis' || name === 'packingBoxTotal') groupsManuallyEditedRef.current = true;
    setInputEdited(true);
    invalidateApprovalStages();
    setForm(current => {
      const next = editedForm(current, name, value);
      if(document.reviewedMetadata?.cloudReference&&name!=='cloudFinancialReviewConfirmed')next.cloudFinancialReviewConfirmed=false;
      if (documentCountry(document) === 'AU' && ['exchangeRateKRW', 'exchangeRateDate'].includes(name)) {
        return { ...next, exchangeRateType: 'USER_INPUT', exchangeRateSource: '담당자 직접 입력', exchangeRateSourceUrl: '', exchangeRateCarriedForward: false };
      }
      return next;
    });
    setPreview(null);
  }

  function chooseFormula(formulaId) {
    setNotice(null);
    pristineRef.current = false;
    setInputEdited(true);
    invalidateApprovalStages();
    setForm(current => switchedFormulaForm(current, formulaId));
    setPreview(null);
  }

  function updateLine(lineId, name, value, displayValue) {
    setNotice(null);
    pristineRef.current = false;
    setInputEdited(true);
    invalidateApprovalStages();
    setForm(current => ({
      ...current,
      ...(typeof document !== 'undefined' && document?.reviewedMetadata?.cloudReference ? { cloudFinancialReviewConfirmed: false } : {}),
      formulaApplicabilityConfirmed: false,
      lossTreatmentConfirmed: false,
      lineInputs: current.lineInputs.map(line => line.lineId === lineId ? { ...line, [name]: value,
        ...(name === 'tariffRate' ? { tariffPercentText: displayValue } : {}) } : line),
    }));
    setPreview(null);
  }

  function updateGroup(groupId, name, value) {
    setNotice(null);
    pristineRef.current = false;
    if (typeof groupsManuallyEditedRef !== 'undefined' && groupsManuallyEditedRef) groupsManuallyEditedRef.current = true;
    setInputEdited(true);
    invalidateApprovalStages();
    setForm(current => editedGroupForm(current, groupId, name, value));
    setPreview(null);
  }

  function invalidateApprovalStages() {
    exportInputGenerationRef.current += 1;
    setVerifiedExport(null);
    for (const event of invoiceCostApprovalInvalidationEvents(document)) emitStage(event.id, event.status, event.message);
  }

  async function loadApprovedInput() {
    if (!pristineRef.current || pending || busy) return;
    const expectedIdentity = identity;
    const expectedGeneration = generationRef.current;
    const warehouseKey = currentCommittedWarehouseKey(document);
    if (!warehouseKey || !acquireInvoiceCostWorkflowLock(workflowLocksRef.current, expectedIdentity)) return;
    setBusyIdentity(expectedIdentity);
    try {
      const response = await fetch(`/api/warehouse/invoice-costs?warehouseKey=${encodeURIComponent(warehouseKey)}`, {
        credentials: 'same-origin', cache: 'no-store',
      });
      const data = await response.json();
      if (!isCurrent(expectedIdentity, expectedGeneration) || !pristineRef.current) return;
      if (!response.ok || !data.success || Number(data.costs?.warehouseKey) !== warehouseKey) throw new Error('승인 입력 조회가 실패했습니다.');
      const restored = restoredInvoiceCostInput(document, receiptLines, data.costs);
      if (!restored) throw new Error('현재 문서·revision·원본과 일치하는 승인 입력이 없거나 입고가 변경되었습니다.');
      const editable = Object.fromEntries(Object.entries(restored).map(([key, value]) => [key, value === null ? '' : value]));
      editable.lineInputs = restored.lineInputs.map(line => Object.fromEntries(Object.entries(line).map(([key, value]) => [key, value === null ? '' : value])));
      setForm(initialForm({ ...document, reviewedMetadata: { ...document.reviewedMetadata, invoiceCostInput: editable } }, receiptLines));
      pristineRef.current = false;
      setInputEdited(true);
      invalidateApprovalStages();
      setVerifiedExport({ identity: expectedIdentity, actual: data.costs.currentActual });
      setPreview(null);
      setNotice({ type: 'success', text: '승인 입력을 불러왔습니다. 현재 자료를 다시 검토하고 공식 적용 확인을 직접 체크하세요.' });
    } catch (error) {
      if (isCurrent(expectedIdentity, expectedGeneration)) setNotice({ type: 'error', text: error.message });
    } finally {
      workflowLocksRef.current.delete(expectedIdentity);
      if (mountedRef.current && identityRef.current === expectedIdentity) setBusyIdentity(value => value === expectedIdentity ? '' : value);
    }
  }

  async function runPreview() {
    const expectedIdentity = identity;
    const expectedGeneration = generationRef.current;
    if (nativePreview) {
      setBusyIdentity(identity);
      try {
        const data = await onNativeAction('preview', { ...payloadOf(form), formulaApplicabilityConfirmed: true });
        if (isCurrent(expectedIdentity, expectedGeneration)) {
          setPreview(data.preview);
          setNotice({ type: data.preview?.status === 'APPROVED' ? 'success' : 'error', text: data.preview?.status === 'APPROVED' ? '계산 완료. 운영 DB 저장 없이 엑셀을 다운로드할 수 있습니다.' : '아래 누락 항목을 입력하세요. 입고자료는 변경하지 않았습니다.' });
        }
      } catch (error) { if (isCurrent(expectedIdentity, expectedGeneration)) setNotice({ type: 'error', text: error.message }); }
      finally { if (isCurrent(expectedIdentity, expectedGeneration)) setBusyIdentity(''); }
      return;
    }
    const result = await runInvoiceCostStageRunner({
      document, calculate: () => previewInvoiceCost({ ...document, costInput: payloadOf(form) }, receiptLines),
      emit: event => { if (isCurrent(expectedIdentity, expectedGeneration)) emitStage(event.id, event.status, event.message); },
    });
    if (!isCurrent(expectedIdentity, expectedGeneration)) return;
    setPreview(result.preview || null);
    setNotice(result.preview?.status === 'APPROVED'
      ? { type: 'success', text: '실제 입고량 기준 원가가 계산되었습니다. 저장 전 합계와 행별 근거를 확인하세요.' }
      : { type: 'error', text: '입력 검토가 필요합니다. 누락값을 0으로 대신하지 않았습니다.' });
  }

  async function save(automaticReason) {
    if (nativePreview) return;
    const saveReason = typeof automaticReason === 'string' ? automaticReason : reason.trim();
    const expectedIdentity = identity;
    const expectedGeneration = generationRef.current;
    const capturedDocument = document;
    const locks = workflowLocksRef.current;
    if (preview?.status !== 'APPROVED' || !saveReason || pending) return;
    if (!acquireInvoiceCostWorkflowLock(locks, expectedIdentity)) return;
    const current = () => isCurrent(expectedIdentity, expectedGeneration);
    const warehouseKey = currentCommittedWarehouseKey(capturedDocument);
    if (!Number.isInteger(warehouseKey) || warehouseKey <= 0) {
      if (current()) setNotice({ type: 'error', text: '현재 revision의 입고 WarehouseKey를 확인할 수 없어 원가 저장을 시작하지 않았습니다.' });
      locks.delete(expectedIdentity);
      return;
    }
    const request = { revision: capturedDocument.revision, input: payloadOf(form), reason: saveReason };
    const nextPending = { kind: 'post', request, warehouseKey };
    if (current()) { setPending(nextPending); setBusyIdentity(expectedIdentity); setNotice(null); }
    writePending(capturedDocument, nextPending);
    try {
      const result = await runInvoiceCostStageRunner({
        document: capturedDocument, approvalRequested: true, reason: request.reason, request, warehouseKey,
        calculate: () => previewInvoiceCost({ ...capturedDocument, costInput: request.input }, receiptLines),
        emit: event => { if (current()) emitStage(event.id, event.status, event.message); },
        post: body => postInvoiceCostRequest(capturedDocument.documentId, body),
        readback: async key => {
          const response = await fetch(`/api/warehouse/invoice-costs?warehouseKey=${encodeURIComponent(key)}`, {
            credentials: 'same-origin', cache: 'no-store',
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || '원가 재조회 요청이 실패했습니다.');
          return data;
        },
        onPostSuccess: (data, savedCostRevisionIds) => {
          const verifying = { kind: 'verify', request, warehouseKey, savedCostRevisionIds };
          writePending(capturedDocument, verifying);
          if (current()) {
            setPending(verifying);
            if (data.cost?.idempotent) setNotice({ type: 'success', text: '같은 승인 요청이 저장된 응답입니다. 별도 재조회로 현재 적용 여부를 확인합니다.' });
          }
        },
        onSaved: cost => { if (current()) { setVerifiedExport({ identity: expectedIdentity, actual: cost }); savedCallback.current?.(cost); } },
      });
      if (result.ok) {
        writePending(capturedDocument, null);
        if (current()) { setPending(null); setNotice({ type: 'success', text: '승인 원가 저장과 현재 문서·revision 재조회를 모두 확인했습니다.' }); }
      } else if (result.saved === 'unknown') {
        if (current()) setNotice({ type: 'error', text: result.message });
      } else if (result.saved) {
        const verifying = { ...nextPending, kind: 'verify', savedCostRevisionIds: result.savedCostRevisionIds || [] };
        writePending(capturedDocument, verifying);
        if (current()) { setPending(verifying); setNotice({ type: 'error', text: result.message }); }
      } else {
        writePending(capturedDocument, null);
        if (current()) { setPending(null); setNotice({ type: 'error', text: result.message || '원가 저장은 시작되지 않았습니다.' }); }
      }
    } catch (error) {
      if (current()) setNotice({ type: 'error', text: error.message });
    } finally {
      locks.delete(expectedIdentity);
      if (mountedRef.current && identityRef.current === expectedIdentity) setBusyIdentity(value => value === expectedIdentity ? '' : value);
    }
  }

  async function retryPending() {
    const expectedIdentity = identity;
    const expectedGeneration = generationRef.current;
    const capturedDocument = document;
    const capturedPending = pending;
    const locks = workflowLocksRef.current;
    if (!capturedPending || !acquireInvoiceCostWorkflowLock(locks, expectedIdentity)) return;
    const current = () => isCurrent(expectedIdentity, expectedGeneration);
    if (current()) { setBusyIdentity(expectedIdentity); setNotice(null); }
    try {
      let result;
      if (capturedPending.kind === 'verify') {
        result = await verifyInvoiceCostReadback({
          document: capturedDocument, warehouseKey: capturedPending.warehouseKey,
          expectedCostRevisionIds: capturedPending.savedCostRevisionIds || [],
          emit: event => { if (current()) emitStage(event.id, event.status, event.message); },
          readback: async key => {
            const response = await fetch(`/api/warehouse/invoice-costs?warehouseKey=${encodeURIComponent(key)}`, { credentials: 'same-origin', cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || '원가 재조회 요청이 실패했습니다.');
            return data;
          },
          onSaved: cost => { if (current()) { setVerifiedExport({ identity: expectedIdentity, actual: cost }); savedCallback.current?.(cost); } },
        });
      } else {
        result = await runInvoiceCostSaveWorkflow({
          document: capturedDocument, request: capturedPending.request, warehouseKey: capturedPending.warehouseKey,
          emit: event => { if (current()) emitStage(event.id, event.status, event.message); },
          post: body => postInvoiceCostRequest(capturedDocument.documentId, body),
          readback: async key => {
            const response = await fetch(`/api/warehouse/invoice-costs?warehouseKey=${encodeURIComponent(key)}`, { credentials: 'same-origin', cache: 'no-store' });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || '원가 재조회 요청이 실패했습니다.');
            return data;
          },
          onPostSuccess: (data, savedCostRevisionIds) => {
            const verifying = { kind: 'verify', request: capturedPending.request, warehouseKey: capturedPending.warehouseKey, savedCostRevisionIds };
            writePending(capturedDocument, verifying);
            if (current()) setPending(verifying);
          },
          onSaved: cost => { if (current()) { setVerifiedExport({ identity: expectedIdentity, actual: cost }); savedCallback.current?.(cost); } },
        });
      }
      if (result.ok) {
        writePending(capturedDocument, null);
        if (current()) { setPending(null); setNotice({ type: 'success', text: '현재 문서·revision의 승인 실제 원가를 재조회했습니다.' }); }
      } else {
        // A rejection of this recovery attempt (including expired login) does
        // not prove that the original, response-lost POST never committed.
        if (current()) setNotice({ type: 'error', text: `${result.message || '같은 원가 저장 요청을 확인하지 못했습니다.'} 최초 요청의 결과가 확인되지 않아 기존 요청을 보존했습니다.` });
      }
    } catch (error) { if (current()) setNotice({ type: 'error', text: error.message }); }
    finally {
      locks.delete(expectedIdentity);
      if (mountedRef.current && identityRef.current === expectedIdentity) setBusyIdentity(value => value === expectedIdentity ? '' : value);
    }
  }

  const lineResult = new Map((preview?.lines || []).map(line => [line.lineId, line]));
  const country = documentCountry(document);
  const allowedFormulas = applicableFormulas(document);
  const allowedFormulaIds = allowedFormulas.map(formula => formula.formulaId);
  const selectedFormula = INVOICE_COST_FORMULAS[form.formulaId];
  const isChinaAir = form.formulaId === 'CN_AIR_WEIGHT_CBM_V1';
  const lineFields = visibleLineFields(selectedFormula);
  const neededByLine = new Map(receiptLines.map(line => [line.lineId, manualFieldsNeeded(line, form.lineInputs.find(item => item.lineId === line.lineId) || {}, lineFields, selectedFormula)]));
  const manualLineIds = receiptLines.filter(line => neededByLine.get(line.lineId).length > 0).map(line => line.lineId);
  const groupIds = formulaGroupIds(selectedFormula);
  const groupFields = formulaGroupFields(selectedFormula);
  const reviewOnly = allowedFormulaIds.length === 0 || (form.formulaId && (!selectedFormula || !allowedFormulaIds.includes(form.formulaId)));
  const exportActual = verifiedExport?.identity === identity ? verifiedExport.actual : null;
  const exportEligibility = invoiceCostExportEligibility(document, exportActual);
  // Read-only calculation is not approval. Validate every current input locally,
  // then let the existing download endpoint revalidate the source and calculation.
  // No redundant consent checkbox or preview click is needed to download a file.
  const readOnlyValidation = nativePreview ? readOnlyInvoiceCostValidation(document,receiptLines,payloadOf(form)) : null;
  const downloadInput = readOnlyValidation?.input || payloadOf(form);
  const currentReadOnlyPreview = readOnlyValidation?.preview;
  const downloadFeedback = invoiceCostDownloadFeedback({busy,preview:nativePreview?currentReadOnlyPreview:preview,notice,form:nativePreview?{...form,formulaApplicabilityConfirmed:true}:form,reviewOnly,manualLineCount:manualLineIds.length,inputEdited});
  const guideRoot = useCostStepGuide(JSON.stringify(form) + String(busy) + String(preview?.status), nativePreview && !downloadFeedback.disabled);
  async function downloadCost() {
    if (busy || pending || exportLockRef.current || !exportEligibility.allowed) return;
    const expectedIdentity = identity, expectedGeneration = generationRef.current;
    const expectedInputGeneration = exportInputGenerationRef.current;
    exportLockRef.current = true; setExportBusy(true);
    try { await downloadInvoiceCostExport(exportActual, { isCurrent: () => isCurrent(expectedIdentity, expectedGeneration) && exportInputGenerationRef.current === expectedInputGeneration }); }
    catch (error) { if (isCurrent(expectedIdentity, expectedGeneration)) {
      if (error.httpStatus === 409) setVerifiedExport(null);
      setNotice({ type: 'error', text: error.message });
    } }
    finally { exportLockRef.current = false; if (isCurrent(expectedIdentity, expectedGeneration)) setExportBusy(false); }
  }

  return <section ref={guideRoot} className={styles.root} aria-label="인보이스 도착원가 검토">
    <p role="status">{nativePreview?'확인할 이슈만 수정하세요. 값이 유효하면 바로 엑셀을 다운로드할 수 있습니다.':'강조된 입력칸을 확인하세요. 입력 후 미리보기·다운로드 순서로 안내합니다.'}</p>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>검증된 원가 계산</span><h3>{invoicePreview ? '인보이스 수량 도착원가' : '실제 입고량 도착원가'}</h3>
        <p>검증된 공식만 계산합니다. 적용 확인은 이 문서에 대한 수동 검토이며 공식의 보편적 유효성을 뜻하지 않습니다. 95% 적재 예상값은 비교 전용입니다.</p></div>
      <div className={styles.status}><span>{invoicePreview ? '인보이스' : nativePreview ? '입고 번호' : '문서 버전'}</span><strong>{invoicePreview ? document.invoiceNo : nativePreview ? document.warehouseKey : document.revision ?? '—'}</strong><span>자료 기준</span><strong>{invoicePreview ? '업로드 원문 · 입고 미반영' : nativePreview ? '기존 입고 조회' : receiptStatusLabel(document.receiptStatus)}</strong></div>
    </header>

    {exportActual && <div className={`${styles.actions} ${styles.savedActions}`} aria-label="승인 원가 양식 다운로드">
      <div><strong>저장된 승인 원가</strong><p>승인·재조회 완료 · 다운로드는 선택 사항입니다.</p></div>
      {exportEligibility.allowed ? <button type="button" onClick={downloadCost} disabled={busy || Boolean(pending) || exportBusy}>{exportBusy ? '양식 준비 중…' : '도착원가 양식 다운로드'}</button>
        : <p role="status">{exportEligibility.message}</p>}
    </div>}
    {reviewOnly && <p className={styles.reviewOnly} role="status">{country} / {documentTransport(document) || '운송 미확인'} 조합에는 검증된 원가 공식이 없습니다. 입고 성공은 보존되며 원가는 계산·저장되지 않습니다.</p>}
    {!nativePreview && <div className={`${styles.actions} ${styles.savedActions}`}>
      <button type="button" onClick={loadApprovedInput} disabled={busy || Boolean(pending) || inputEdited || formIdentity !== identity || !currentCommittedWarehouseKey(document)}>승인 입력 불러오기</button>
      <p>현재 버전의 승인 입력을 불러옵니다. 편집값은 덮어쓰지 않으며 적용 확인은 다시 필요합니다.</p>
    </div>}
    <h4>자동으로 찾지 못한 값 · 직접 입력</h4>
    <p>{invoicePreview ? '업로드한 인보이스의 매칭 품목·수량·금액으로 계산합니다. 부족한 비용만 입력하세요. 기존 입고 금액과 별개인 미승인 계산본입니다.' : nativePreview ? '품목·수량·매입금액은 기존 입고를 그대로 사용합니다. 부족한 비용만 입력하세요. 이 화면에서는 원장·승인 원가를 저장하지 않습니다.' : '품목은 위 입고 문서의 전산 품목 검색에서 직접 지정하세요. 환율·통관비·관세율은 직접 입력할 수 있습니다.'} 관세율은 25%이면 25, 확인된 면세만 0을 입력하세요.</p>
    {!nativePreview && <p>원가 승인 저장을 누르면 직접 입력한 값과 사유가 서버에 저장됩니다. 다시 열었을 때 ‘승인 입력 불러오기’로 복원할 수 있습니다. 저장 전 편집값은 아직 서버에 반영되지 않습니다.</p>}
    {notice && <p className={notice.type === 'error' ? styles.error : styles.success} role={notice.type === 'error' ? 'alert' : 'status'}>{notice.text}</p>}

    {!nativePreview && <ol className={styles.workflow} aria-label="원가 처리 단계">
      <li><strong>원가 계산</strong><span>{autoProcess ? '자동 계산' : '수동 미리보기'}</span></li>
      <li><strong>승인 저장</strong><span>사유·명시 버튼 필요</span></li>
      <li><strong>원가 재조회</strong><span>저장 후 별도 확인</span></li>
    </ol>}

    <fieldset className={styles.editor} disabled={Boolean(pending) || busy}>
    <div className={styles.formGrid}>
      <Field label="검증 공식"><select value={form.formulaId} onChange={event => chooseFormula(event.target.value)} disabled={allowedFormulas.length === 0}>
        <option value="">공식을 선택하세요</option>
        {form.formulaId && (!selectedFormula || !allowedFormulaIds.includes(form.formulaId)) && <option value={form.formulaId}>적용 범위 밖 공식 · 검토 전용</option>}
        {allowedFormulas.map(formula => <option key={formula.formulaId} value={formula.formulaId}>{formula.label}</option>)}
      </select></Field>
      {!nativePreview && <><Field label="매입 통화"><input maxLength={3} value={form.nativeCurrency} onChange={event => update('nativeCurrency', event.target.value.toUpperCase())} placeholder="CNY / EUR 등" /></Field>
      <Field label="운임 통화"><input maxLength={3} value={form.freightCurrency} onChange={event => update('freightCurrency', event.target.value.toUpperCase())} placeholder="명시 입력" /></Field></>}
      <Field label="환율 (원/통화)"><input aria-required="true" aria-invalid={!Number.isFinite(Number(form.exchangeRateKRW)) || Number(form.exchangeRateKRW) <= 0} type="number" step="0.000001" value={form.exchangeRateKRW} onChange={event => update('exchangeRateKRW', event.target.value)} /></Field>
      {<div role="status" style={{ gridColumn: '1 / -1', fontSize: 13, color: '#475569', marginTop: -6, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        {form.exchangeRateKRW ? <>
          <span>환율 기준일 {form.exchangeRateDate || '기준일 미확인'} · {form.exchangeRateSource || '담당자 입력 또는 저장값'}{form.exchangeRateQuoteAt ? ` · 시세 시각 ${form.exchangeRateQuoteAt}` : ''}
          {form.exchangeRateSourceUrl && <> · <a href={form.exchangeRateSourceUrl} target="_blank" rel="noreferrer">출처</a></>}</span>
        </> : <>
          <span>{exchangeRateStatus || '현재 시장 환율에 15원을 더한 기본값을 조회합니다.'}</span>
          <button type="button" onClick={() => setExchangeRateRetry(value => value + 1)}>환율 다시 조회</button>
        </>}
      </div>}
      {!nativePreview && <><Field label="환율 종류"><input value={form.exchangeRateType} onChange={event => update('exchangeRateType', event.target.value)} placeholder="매입/신고 등" /></Field>
      <Field label="환율 기준일"><input type="date" value={form.exchangeRateDate} onInput={event => update('exchangeRateDate', event.currentTarget.value)} onChange={event => update('exchangeRateDate', event.target.value)} /></Field></>}
      <Field label="운임 원금"><input type="number" step="0.000001" min="0" value={form.freightAmount} onChange={event => update('freightAmount', event.target.value)} /></Field>
      {nativePreview && form.formulaId === 'AU_CNF_BUNCH_V1' && <Field label="호주 통관비 계산 방식"><select value={form.auOriginalMode || 'TOTAL'} onChange={event => update('auOriginalMode', event.target.value)}><option value="FORMULA">원본 수식 · 기본값 적용</option><option value="TOTAL">확인한 합계 직접 입력</option></select></Field>}
      {(!nativePreview || form.formulaId !== 'CN_SEA_ACTUAL_V1') && <Field label="통관비 합계 (KRW)"><input type="number" step="0.000001" min="0" readOnly={(form.formulaId === 'AU_CNF_BUNCH_V1' && form.auOriginalMode === 'FORMULA')||(form.formulaId==='CN_CLOUD_CBM_V1'&&form.cloudCustomsMode==='FORMULA')} value={form.formulaId==='CN_CLOUD_CBM_V1'&&form.cloudCustomsMode==='FORMULA'?cloudCustomsTotal(document,receiptLines,payloadOf(form))??'':form.formulaId === 'AU_CNF_BUNCH_V1' && form.auOriginalMode === 'FORMULA' ? calculateAuOriginalCustoms(form.auOriginal).total ?? '' : form.customsTotalKRW} onChange={event => update('customsTotalKRW', event.target.value)} placeholder="공식 기준 확인 · 누락은 0이 아님" /></Field>}
      {!nativePreview && <Field label="비용 원천 식별값" wide><input value={form.costSourceId} onChange={event => update('costSourceId', event.target.value)} placeholder="공급자 + 전표번호 + 비용항목 + 통화" /></Field>}
      <Field label="통관비 기준"><select disabled={form.formulaId === 'AU_CNF_BUNCH_V1' && form.auOriginalMode === 'FORMULA'} value={form.formulaId === 'AU_CNF_BUNCH_V1' && form.auOriginalMode === 'FORMULA' ? 'ESTIMATED' : form.expenseBasis || 'CONFIRMED'} onChange={event => update('expenseBasis', event.target.value)}><option value="CONFIRMED">확인된 비용</option><option value="ESTIMATED">이전 자료로 추정한 비용</option></select></Field>
      {form.expenseBasis === 'ESTIMATED' && <Field label="추정 근거 (실제 청구액 아님)" wide><input value={form.estimateSource || ''} onChange={event => update('estimateSource', event.target.value)} placeholder="원본 파일 · 기준 차수 · 금액과 계산식" /></Field>}
      {!nativePreview && <><Field label="비용 배분 범위"><select value={form.allocationScope} onChange={event => update('allocationScope', event.target.value)}><option value="">범위를 선택하세요</option><option value="SINGLE_INVOICE">이 인보이스에만 배분</option><option value="SHARED">여러 인보이스 공동 비용 · 저장 불가</option></select></Field>
      <Field label="이 문서 배분 몫"><span className={styles.share}><input aria-label="배분 분자" type="number" step="0.000001" min="0" value={form.allocationShareNumerator} onChange={event => update('allocationShareNumerator', event.target.value)} /><b>/</b><input aria-label="배분 분모" type="number" step="0.000001" min="0.000001" value={form.allocationShareDenominator} onChange={event => update('allocationShareDenominator', event.target.value)} /></span></Field></>}
      {form.formulaId === 'CN_SEA_ACTUAL_V1' && <Field label="95% 예상수량 (비교 전용)"><input type="number" step="0.000001" min="0" value={form.expected95Quantity} onChange={event => update('expected95Quantity', event.target.value)} /></Field>}
      {!nativePreview && <Field label={`공식 적용일 (입고일 ${document.reviewedMetadata?.inputDate || '미확인'})`}><input type="date" value={form.formulaEffectiveDate} onInput={event => update('formulaEffectiveDate', event.currentTarget.value)} onChange={event => update('formulaEffectiveDate', event.target.value)} /></Field>}
    </div>

    {nativePreview && form.formulaId === 'AU_CNF_BUNCH_V1' && <details open={form.auOriginalMode === 'FORMULA'}>
      <summary>호주 원본 양식 기본값 · 수정 가능</summary>
      <p>{AU_ORIGINAL_SOURCE}. 현재 청구 확정값이 아닌 원본 가정값입니다. 운임은 CNF에 포함되어 중복 가산하지 않습니다. CW는 요구하지 않습니다.</p>
      <div className={styles.formGrid}>
        {Object.entries({gw:'호주 GW (kg)',itemCount:'검역 품목수',baeksangRateKRW:'백상 요율 (원/kg)',clearanceFeeKRW:'통관 수수료 (원)',inspectionRateKRW:'검역 요율 (원/품목)',domesticTransportKRW:'국내 운송비 (원)'}).map(([key,label])=>
          <Field key={key} label={label}><input aria-invalid={form.auOriginalMode === 'FORMULA' && calculateAuOriginalCustoms(form.auOriginal).missing.includes(key)} type="number" min="0" step={key==='itemCount'?'1':'any'} value={form.auOriginal?.[key] ?? ''} onChange={event=>update('auOriginal',{...form.auOriginal,[key]:event.target.value})} placeholder="미확인 · 직접 입력"/></Field>)}
      </div>
      {form.auOriginalMode === 'FORMULA' && calculateAuOriginalCustoms(form.auOriginal).total === null && <p role="status">원본 통관비 수식에 필요한 값이 없습니다. GW 등 빈 입력칸을 확인하거나, 확인한 통관비 합계를 직접 입력하세요. 미기재 값은 0으로 처리하지 않습니다.</p>}
      <p>다운로드 시 원본 양식 계산 시트가 열립니다. 현재 판매가는 엑셀 O열에 선택 입력하고, 우측 38-1 참고판매가와 구분하세요.</p>
    </details>}

    {nativePreview && <div className={styles.formGrid}>
      <Field label="전체 품목 관세율 (%)"><input type="number" min="0" max="100" step="any" placeholder="동일 관세율일 때 일괄 입력" onChange={event => {
        const percentText = event.target.value, value = tariffFraction(percentText); pristineRef.current = false; setInputEdited(true); setPreview(null);
        setForm(current => ({ ...current, formulaApplicabilityConfirmed: false,
          lineInputs: current.lineInputs.map(line => ({ ...line, tariffRate: value, tariffPercentText: percentText })) }));
      }} /></Field>
      {form.formulaId === 'CN_SEA_ACTUAL_V1' && <Field label="전체 품목 통관·기타비 (원/입고단위)"><input type="number" min="0" step="any" placeholder="동일 단위·비용일 때만 입력" onChange={event => {
        const value = event.target.value; pristineRef.current = false; setInputEdited(true); setPreview(null);
        setForm(current => ({ ...current, formulaApplicabilityConfirmed: false,
          lineInputs: current.lineInputs.map(line => ({ ...line, otherCostPerUnitKRW: value })) }));
      }} /></Field>}
    </div>}

    <p role="status">원문 가격 기준: {formulaPriceBasis(selectedFormula)} · 실제 원가 단위는 각 행의 ERP 단위입니다. 환산계수는 원문 근거로 직접 입력하세요.
      공식 전환 시 새 공식에서 사용하지 않는 행 입력은 비우며, 적용 확인을 다시 해야 합니다.</p>
    {selectedFormula?.freightIncluded === true && <p role="alert" className={styles.reviewOnly}>{selectedFormula.country === 'AU'
      ? '호주 CNF 단가는 운임 포함입니다. 별도 운임이 없는 새 입력은 0으로 준비합니다. CW는 이 계산에 필요하지 않습니다.'
      : 'CNF 가격에 운임이 포함되어 있습니다. 중복 가산을 막기 위해 별도 운임 원금에 0을 직접 입력하고 운임 통화도 확인하세요.'}
      기존 운임을 자동으로 0으로 바꾸지 않습니다. 다른 청구 비용은 해당 공식의 입력 근거를 확인하세요.</p>}
    <p role="status">현재 문서 GW: {document.reviewedMetadata?.gw ?? '미확인'} kg · CW: {document.reviewedMetadata?.cw ?? '미확인'} kg.
      {nativePreview && form.formulaId === 'AU_CNF_BUNCH_V1' ? ` 원가 계산용 GW: ${form.auOriginal?.gw === '' || form.auOriginal?.gw == null ? '미확인' : form.auOriginal.gw} kg. 위 호주 기본값에서 수정하며 원본 입고 중량은 변경하지 않습니다.` : ' 중량 입력·확인은 문서 메타데이터 검토에서 수행하세요.'} 운임·환율·통관비와 단위 환산은 현재 자료로 직접 확인하며 누락값을 0으로 대신하지 않습니다.</p>
    {isChinaAir && <p role="status">
      GW/CW가 없거나 잘못되면 문서 메타데이터 검토에서 수정하세요. GW≈CW(0.01kg)는 실중량, CW&gt;GW는 CBM 환산중량으로 운임을 배분하며 통관비는 항상 실중량으로 배분합니다.
      행별 CBM 환산중량은 kg입니다. 원시 m³나 임의 환산계수를 입력하지 마세요. 인식 GW는 미확정 힌트이며 현재 자료와 대조해야 합니다.</p>}
    {groupIds.length > 0 && <>
      <h4>포장 그룹 수동 확인</h4>
      {country === 'TH' && <>
        <label>박스 배분 기준 <select aria-label="박스 배분 기준" value={form.groupBoxBasis ?? 'RECEIPT_LINES'} onChange={event => update('groupBoxBasis', event.target.value)}>
          <option value="RECEIPT_LINES">입고 품목별 박스 합계</option>
          <option value="PACKING_GROUP">패킹 그룹별 박스 (기존 입고 보존)</option>
        </select></label>
        {form.groupBoxBasis === 'PACKING_GROUP' && <label>패킹 전체 박스수 <input aria-label="패킹 전체 박스수" type="number" min="0" step="0.000001" value={form.packingBoxTotal ?? ''} onChange={event => update('packingBoxTotal', event.target.value)} /></label>}
        <p>여러 품목이 한 박스를 공유하면 패킹 그룹별 박스를 선택하세요. 그룹 박스 비율 × 그룹 안의 송이 비율로 운임·통관비를 나눕니다. 기존 입고 박스수는 바꾸지 않습니다. 상품 단가는 인보이스 값을 사용합니다.</p>
      </>}
      <p>송이수·박스수·중량은 원문 근거로 직접 입력하세요. 품목명으로 그룹을 추정하거나 자동 선택하지 않습니다. 사용하지 않는 그룹은 비워 두세요.</p>
      {country === 'CO' && <p role="status">그룹 실중량 합계는 문서 GW, 그룹 부피중량 합계는 문서 CW와 각각 일치해야 합니다 (0.01 kg). 합계가 다르면 계산 승인할 수 없습니다.</p>}
      {country === 'CO' && <p role="status">CO 운임은 문서 GW와 CW가 정확히 같을 때 실중량, CW가 더 클 때 부피중량으로 배분합니다. 중국 항공의 근사 일치 분기와 다릅니다. 통관비는 실중량 기준입니다.</p>}
      <p>행별 실중량·CBM 환산중량·배분비율은 별도 필수 입력이 아닙니다. 그룹 내 실제 송이수 비율로 계산하므로 입력 칸을 숨기고 기존 선택적 행 배분값 대신 그룹 계산값을 사용합니다.</p>
      {country === 'TH' && selectedFormula?.sourceCaveat && <p role="note">원본 첫 행의 단 환산 셀 P15는 손상되어 그대로 사용하지 않습니다. 검증된 N15 송이당 원가와 정상인 후속 행의 단 환산 근거로 정정 계산합니다. 검역 손실·소독비는 직접 확인한 현재 통관비 합계에 포함해야 합니다.</p>}
      <div className={styles.tableRegion} role="region" aria-label="포장 그룹 원가 입력" tabIndex={0}>
        <table className={styles.table}><thead><tr><th>고정 그룹</th>{groupFields.map(key => <th key={key}>{GROUP_FIELD_LABELS[key]}</th>)}</tr></thead>
          <tbody>{groupIds.map(groupId => {
            const group = form.costGroups?.find(item => item.groupId === groupId) || {};
            return <tr key={groupId}><th scope="row">{groupLabel(groupId)}</th>{groupFields.map(key => <td key={key}><input aria-label={`${groupLabel(groupId)} ${GROUP_FIELD_LABELS[key]}`} type="number" min="0" step="0.000001" value={group[key] ?? ''} onChange={event => updateGroup(groupId, key, event.target.value)} /></td>)}</tr>;
          })}</tbody></table>
      </div>
      {country === 'TH' && <label className={styles.confirmation}><input type="checkbox" checked={form.lossTreatmentConfirmed === true} onChange={event => update('lossTreatmentConfirmed', event.target.checked)} />
        <span>검역 손실·소독비를 확인하고 현재 통관비 합계에 포함했습니다 (없으면 0 확인)</span></label>}
    </>}
    {!nativePreview && <label className={styles.confirmation}><input data-cost-confirm type="checkbox" checked={form.formulaApplicabilityConfirmed === true}
      onChange={event => update('formulaApplicabilityConfirmed', event.target.checked)} />
      <span>이 입고일·운송·품목에 해당 원본 계산식 적용을 확인했습니다{isChinaAir ? ' · 현재 GW/CW와 행별 실중량·CBM 환산중량을 직접 검토했습니다' : ''}</span></label>}

    <details className={styles.evidence}>
      <summary>검증된 계산 근거 보기</summary>
      <dl><div><dt>공식 버전</dt><dd>{form.formulaVersion || '공식 선택 필요'}</dd></div>
        <div><dt>원본 시트</dt><dd>{form.formulaSourceSheet || '공식 선택 필요'}</dd></div>
        <div><dt>검증 셀</dt><dd>{form.formulaSourceCells || '공식 선택 필요'}</dd></div>
        <div><dt>원본 SHA-256</dt><dd><code>{form.formulaSourceHash || '공식 선택 필요'}</code></dd></div></dl>
    </details>

    <div className={styles.savedActions}>
      <button type="button" onClick={() => setManualLineFilter({ identity, ids: manualLineIds })}>직접 입력 필요 {manualLineIds.length}행 보기</button>
      <button type="button" onClick={() => setManualLineFilter(null)}>전체 {receiptLines.length}행 보기</button>
      <span>입력 중에는 행이 사라지지 않습니다. 입력 완료 후 미리보기로 전체 값을 검증하세요.</span>
    </div>
    <div className={styles.tableRegion} role="region" aria-label="행별 원가 입력과 결과" tabIndex={0}>
      <table className={styles.table}><thead><tr><th>행</th><th>원문 품목</th><th>실제량</th><th>원문 금액/통화</th>{groupIds.length > 0 && <th>포장 그룹</th>}{lineFields.map(key => <th key={key}>{LINE_FIELD_LABELS[key] || key}</th>)}<th>실제 원가</th></tr></thead>
        <tbody>{receiptLines.map((line, index) => {
          if (manualLineFilter?.identity === identity && !manualLineFilter.ids.includes(line.lineId)) return null;
          const lineInput = form.lineInputs.find(item => item.lineId === line.lineId) || {};
          const result = lineResult.get(String(line.lineId).toLowerCase());
          const matchedProduct = products.find(product => Number(product.ProdKey) === Number(line.prodKey));
          return <tr key={line.lineId || index}><td>{line.lineNo ?? index + 1}</td><td className={styles.productCell}><strong>{line.originalName || '품목명 없음'}</strong><small>{line.lengthText || ''}{line.prodKey ? `${line.lengthText ? ' · ' : ''}전산 품목 ${line.prodKey}` : ''}</small>
            {matchedProduct && <small>매칭: {matchedProduct.ProdName}{matchedProduct.DisplayName && matchedProduct.DisplayName !== matchedProduct.ProdName ? ` · ${matchedProduct.DisplayName}` : ''}</small>}
            {onEditAllocation && line.sourceEvidence?.allocationSourceId && <button type="button" disabled={busy || exportBusy} onClick={onEditAllocation} aria-label={`${line.lineNo ?? index + 1}행 Woolly bush 품목 변경`}>품목 선택·변경</button>}
          </td><td>{line.outQuantity ?? '—'} {line.outUnit || ''}</td><td>{line.lineAmount ?? '—'} {line.currency || '통화 없음'}</td>
            {groupIds.length > 0 && <td><select aria-label={`${index + 1}행 포장 그룹`} value={lineInput.groupId ?? ''} onChange={event => updateLine(line.lineId, 'groupId', event.target.value)}><option value="">그룹을 선택하세요</option>{groupIds.map(groupId => <option key={groupId} value={groupId}>{groupLabel(groupId)}</option>)}</select></td>}
            {lineFields.map(key => <td key={key}><input aria-label={`${index + 1}행 ${LINE_FIELD_LABELS[key] || key}`} type="number" min="0" max={key === 'tariffRate' ? '100' : undefined} step="0.000001" placeholder="직접 입력" aria-invalid={neededByLine.get(line.lineId).includes(key)} value={key === 'tariffRate' ? lineInput.tariffPercentText ?? tariffPercent(lineInput[key]) : lineInput[key] ?? ''} onChange={event => updateLine(line.lineId, key, key === 'tariffRate' ? tariffFraction(event.target.value) : event.target.value, event.target.value)} />
              {key === 'tariffRate' && <small>% · 25 입력 = 25%</small>}
              {key === 'tariffRate' && document?.reviewedMetadata?.tariffDefaults?.[line.lineId] && <small className={styles.muted}>기본값 근거: {document.reviewedMetadata.tariffDefaults[line.lineId].label} · 직접 수정 가능</small>}
              {neededByLine.get(line.lineId).includes(key) && <small className={styles.issue}>직접 입력 필요</small>}
              {key === 'grossWeightKg' && line.sourceEvidence?.grossWeightKg !== undefined && <small>인식 힌트: {line.sourceEvidence.grossWeightKg} kg · 직접 검토 필요</small>}</td>)}
            <td>{result ? result.quantity === 0
              ? <><strong>취소행</strong><small>단위원가 미산정 · 합계 {money(result.totalCostKRW)}</small></>
              : <><strong>{money(result.costPerUnitKRW)}</strong><small>{unitLabel(result.unit)} · 합계 {money(result.totalCostKRW)}</small></> : '—'}</td></tr>;
        })}</tbody></table>
    </div>

    {form.formulaId==='CN_CLOUD_CBM_V1'&&<>
      {document.reviewedMetadata?.cloudReference&&<section className={styles.evidence} aria-label="원가표 출처와 확인 필요 항목">
        <h4>원가표 출처 · 운영 입고 단가 유지</h4>
        <p>{document.reviewedMetadata.cloudReference.source.fileName} · {document.reviewedMetadata.cloudReference.source.sheet} · GW C8 / CW F8. 계산 부피 E8은 청구중량으로 사용하지 않습니다. 운영 단가와 원가표 차이는 원장 보정 없이 비교합니다.</p>
        <label>검역 분류수 · 원문 C9 참고<input aria-label="CLOUD 검역 분류수" type="text" inputMode="numeric" value={form.cloudQuarantineCategoryCount??''} onChange={e=>update('cloudQuarantineCategoryCount',e.target.value)}/></label>
        <label><input type="checkbox" aria-label="CLOUD 재무 예외 확인" checked={form.cloudFinancialReviewConfirmed===true} onChange={e=>update('cloudFinancialReviewConfirmed',e.target.checked)}/>운영 단가·통화, 호접 허가증 입력값과 검역 분류수의 적용 근거를 확인했습니다.</label>
        {!form.cloudFinancialReviewConfirmed&&<p role="alert">허가증 미반영·검역18 등은 미확인입니다. 자동으로 0원·300CNY 또는 확정비용으로 처리하지 않습니다.</p>}
      </section>}
      <details className={styles.evidence}><summary>CLOUD 원본 통관비·허가증 기준 보기/수정</summary>
        <p>원본 기준값으로 추정합니다. 국내운송비 195,000원은 해당 자료의 값이며 모든 중량의 고정요금이 아닙니다. 실제 견적이 다르면 수정하세요.</p>
        <div className={styles.formGrid}>
          <Field label="통관비 계산"><select value={form.cloudCustomsMode} onChange={e=>update('cloudCustomsMode',e.target.value)}><option value="FORMULA">원본 수식 자동 계산</option><option value="TOTAL">확인된 합계 직접 지정</option></select></Field>
          {Object.entries({cloudWarehousePerKg:'백상 원/kg',cloudBrokerage:'통관 수수료 원',cloudQuarantinePerCategory:'검역 원/품종',cloudDomesticTransport:'국내운송비 원',cloudMiscellaneous:'기타비 원',cloudDisinfection:'소독비 원',cloudOrchidPermitNative:'호접 허가증 CNY'}).map(([key,label])=><Field key={key} label={label}><input type="number" min="0" step="any" value={form[key]??''} onChange={e=>update(key,e.target.value)}/></Field>)}
        </div><p>자동 계산 통관비: {money(cloudCustomsTotal(document,receiptLines,payloadOf(form)))}</p>
      </details>
      <CloudCostCategories lines={receiptLines} inputs={form.lineInputs} onChange={updateLine} disabled={busy}
        scope={currentCommittedWarehouseKey(document)?{orderYear:document.orderYear,orderWeek:document.orderWeek,warehouseKeys:[currentCommittedWarehouseKey(document)]}:undefined}/>
    </>}
    <div className={styles.actions}>
      <button data-cost-preview type="button" onClick={runPreview} disabled={busy}>입력값으로 미리보기</button>
      {nativePreview ? <button data-cost-download type="button" className={styles.primary} disabled={downloadFeedback.disabled} title={downloadFeedback.reason || '미승인 계산본을 다운로드합니다.'} aria-describedby={downloadFeedback.disabled ? 'cost-download-reason' : undefined} onClick={async () => {
        const expectedIdentity = identity, generation = generationRef.current;
        setBusyIdentity(identity);
        try { await onNativeAction('download', downloadInput); if(isCurrent(expectedIdentity,generation))setNotice({type:'success',text:'미승인 계산본 엑셀 다운로드를 시작했습니다. 입고·승인 원가는 변경하지 않았습니다.'}); }
        catch (error) { if (isCurrent(expectedIdentity, generation)) setNotice({ type: 'error', text: error.message }); }
        finally { if (isCurrent(expectedIdentity, generation)) setBusyIdentity(''); }
      }}><span>도착원가 엑셀 다운로드 · 미승인 계산본</span>{downloadFeedback.disabled && <small className={styles.downloadReason}>{downloadFeedback.reason.length > 180 ? `${downloadFeedback.reason.slice(0,180)}… (아래 상세 사유 확인)` : downloadFeedback.reason}</small>}</button> : <>
        <label><span>승인 사유</span><input value={reason} onChange={event => { pristineRef.current = false; setInputEdited(true); setReason(event.target.value); update('formulaApplicabilityConfirmed', false); }} placeholder="검토 근거를 입력하세요" /></label>
        <button type="button" className={styles.primary} onClick={save} disabled={busy || Boolean(pending) || preview?.status !== 'APPROVED' || !reason.trim()}>{busy ? '저장 중…' : '원가 승인 저장'}</button>
      </>}
    </div>
    {nativePreview && downloadFeedback.disabled && <p id="cost-download-reason" className={styles.downloadHelp} role="status">다운로드 대기: {downloadFeedback.reason}</p>}
    </fieldset>

    {pending && <div className={styles.pending} role="alert">
      <strong>{pending.kind === 'verify' ? '저장은 됐지만 원가 재조회가 확인되지 않았습니다.' : '원가 저장 결과를 확인해야 합니다.'}</strong>
      <span>{pending.kind === 'verify' ? 'ERP 입고 등록은 다시 실행하지 않습니다. 아래 동작은 읽기 전용 원가 재조회뿐입니다.' : '입력 폼이 잠겼습니다. 저장 결과가 불명확하면 동일한 요청 내용만 안전하게 재시도합니다.'}</span>
      <button type="button" onClick={retryPending} disabled={busy}>{pending.kind === 'verify' ? '원가 재조회만 재시도' : '동일한 원가 요청 재시도'}</button>
    </div>}

    {preview && <section className={styles.result} aria-live="polite">
      <header><strong>{preview.status === 'APPROVED' ? nativePreview ? '계산 완료 · 미승인' : '계산 승인 가능' : '검토 필요'}</strong><span>{invoicePreview ? '인보이스 수량' : '실제 입고량'} 기준 합계 {money(preview.totals?.totalCostKRW)}</span></header>
      {preview.issues.length > 0 && <ul>{preview.issues.map((item, index) => <li key={`${item.code}-${item.lineId || index}`} className={item.severity === 'warning' ? styles.warning : styles.issue}>{item.message}</li>)}</ul>}
      {preview.expected95 && <div className={styles.comparison}><strong>95% 예상 비교</strong><span>{preview.expected95.quantity} {preview.expected95.unit} 기준</span><span>실제 원가를 대체하지 않음</span></div>}
      <p>{preview.note}</p>
    </section>}
  </section>;
}
