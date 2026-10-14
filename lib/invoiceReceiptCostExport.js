import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import airTemplate from './invoiceCostTemplates/china-air-v1.json' with { type: 'json' };
import nlTemplate from './invoiceCostTemplates/netherlands-v1.json' with { type: 'json' };
import seaTemplate from './invoiceCostTemplates/china-sea-v1.json' with { type: 'json' };
import usTemplate from './invoiceCostTemplates/us-v1.json' with { type: 'json' };
import vnTemplate from './invoiceCostTemplates/vietnam-v1.json' with { type: 'json' };
import auTemplate from './invoiceCostTemplates/australia-v1.json' with { type: 'json' };
import nzTemplate from './invoiceCostTemplates/new-zealand-v1.json' with { type: 'json' };
import ecTemplate from './invoiceCostTemplates/ecuador-v1.json' with { type: 'json' };
import coTemplate from './invoiceCostTemplates/colombia-v1.json' with { type: 'json' };
import thTemplate from './invoiceCostTemplates/thailand-v1.json' with { type: 'json' };
import { invoiceCostExportProfile } from './invoiceCostExportProfiles.js';
export { INVOICE_COST_EXPORT_PROFILES } from './invoiceCostExportProfiles.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost, readInvoiceCosts } from './invoiceReceiptCost.js';
import { getInvoiceDocument } from './invoiceReceiptDocuments.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const FORMULA = 'CN_AIR_WEIGHT_CBM_V1';
const templates = { CN_AIR_ORIGINAL_V1: airTemplate, NL_ORIGINAL_V1: nlTemplate, CN_SEA_ORIGINAL_V1: seaTemplate,
  US_ORIGINAL_V1: usTemplate, VN_ORIGINAL_V1: vnTemplate, AU_ORIGINAL_V1: auTemplate, NZ_ORIGINAL_V1: nzTemplate, EC_ORIGINAL_V1: ecTemplate,
  CO_ORIGINAL_V1: coTemplate, TH_ORIGINAL_V1: thTemplate };
export class InvoiceCostExportError extends Error {
  constructor(code, message, statusCode = 409) { super(message); this.code = code; this.statusCode = statusCode; }
}
const fail = (code, message, status) => { throw new InvoiceCostExportError(code, message, status); };
const equalNumber = (a, b) => typeof a === 'number' && Number.isFinite(a) && typeof b === 'number' && Number.isFinite(b) && Math.abs(a - b) <= 0.00001;
// Writer mappings retain Product.OutUnit; cost revisions store canonical unit labels.
// These are aliases only: quantities and prices are never converted.
const canonicalReceiptUnit = value => {
  const unit = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (['BUNCH', 'BUNCHES', '단'].includes(unit)) return 'BUNCH';
  if (['STEM', 'STEMS', '송이'].includes(unit)) return 'STEM';
  if (['BOX', 'BOXES', '박스'].includes(unit)) return 'BOX';
  return null;
};
const xml = value => String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const relns = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

function checkedRows(document, revision, snapshot) {
  if (!invoiceCostExportProfile(revision?.formulaId)) fail('EXPORT_TEMPLATE_UNSUPPORTED', '검증된 출력 양식이 없는 원가 공식입니다.', 422);
  const formula = INVOICE_COST_FORMULAS[revision.formulaId];
  if (!document || !revision || !snapshot || snapshot.schemaVersion !== 1 || snapshot.basis !== 'ACTUAL'
    || revision.status !== 'APPROVED' || revision.storedStatus !== 'APPROVED' || revision.basis !== 'ACTUAL' || revision.liveReceiptStatus !== 'MATCH'
    || document.costStatus !== 'APPROVED' || document.receiptStatus !== 'COMMITTED'
    || document.documentId !== revision.documentId || document.revision !== revision.documentRevision
    || !HASH.test(document.sourceHash || '') || snapshot.invoiceSourceHash !== document.sourceHash
    || revision.formulaVersion !== formula.formulaVersion || revision.formulaSourceHash !== formula.formulaSourceHash
    || snapshot.formula?.id !== formula.formulaId || snapshot.formula?.version !== formula.formulaVersion
    || snapshot.formula?.sourceHash !== formula.formulaSourceHash || snapshot.formula?.sheet !== formula.formulaSourceSheet
    || snapshot.formula?.cells !== formula.formulaSourceCells || snapshot.formula?.applicabilityConfirmed !== true
    || !HASH.test(snapshot.receiptDigest || '') || !HASH.test(snapshot.saveFingerprint || '')) {
    fail('COST_EXPORT_SOURCE_MISMATCH', '현재 승인 문서·공식·원본 스냅샷이 일치하지 않습니다.');
  }
  const operation = document.operations?.find(op => op.operationId === revision.operationId && op.status === 'COMMITTED'
    && op.documentRevision === document.revision && op.warehouseKey === revision.warehouseKey);
  if (!operation || operation.result?.receiptDigest !== snapshot.receiptDigest
    || snapshot.receiptSnapshot?.warehouseKey !== revision.warehouseKey) fail('COST_EXPORT_OPERATION_MISMATCH', '현재 확정 입고 작업과 승인 원가가 일치하지 않습니다.');
  const details = snapshot.receiptSnapshot?.details;
  const mappings = operation.result?.lineMappings;
  if (!Array.isArray(document.lines) || !Array.isArray(revision.lines) || !Array.isArray(details)
    || revision.lines.length < 1 || revision.lines.length > 1000 || document.lines.length !== revision.lines.length
    || details.length !== revision.lines.length || !Array.isArray(mappings) || mappings.length !== revision.lines.length) fail('COST_EXPORT_LINES_REQUIRED', '승인 원가의 모든 원문·입고 상세 근거가 필요합니다.');
  const byDoc = new Map(document.lines.map(line => [line.lineId, line]));
  const byDetail = new Map(details.map(line => [line.lineId, line]));
  const byMapping = new Map(mappings.map(line => [line.lineId, line]));
  const seen = new Set();
  const rows = revision.lines.map(cost => {
    const source = byDoc.get(cost.lineId); const detail = byDetail.get(cost.lineId); const mapping = byMapping.get(cost.lineId);
    if (seen.has(cost.lineId) || !source || !detail || !source.originalName || cost.prodKey !== source.prodKey
      || detail.prodKey !== cost.prodKey || detail.wdetailKey !== cost.wdetailKey
      || !equalNumber(detail.outQuantity, cost.quantity) || !['BUNCH', 'STEM', 'BOX'].includes(cost.unit)
      || !equalNumber(detail.lineAmount, source.lineAmount) || !equalNumber(detail.unitPrice, source.unitPrice)
      || !mapping || canonicalReceiptUnit(mapping.unit) !== cost.unit || mapping.wdetailKey !== cost.wdetailKey || mapping.prodKey !== cost.prodKey
      || !equalNumber(mapping.outQuantity, cost.quantity)) {
      fail('COST_EXPORT_LINE_MISMATCH', '원문 행·입고 상세·승인 단위의 연결이 일치하지 않습니다.');
    }
    seen.add(cost.lineId);
    return { source, detail, cost };
  }).sort((a, b) => a.source.lineNo - b.source.lineNo);
  const preview = previewInvoiceCost({ ...document, costInput: snapshot.input }, rows.map(({ source, detail, cost }) => ({
    ...source, ...detail, outQuantity: cost.quantity, outUnit: cost.unit,
  })));
  if (preview.status !== 'APPROVED') fail('COST_EXPORT_INPUT_INVALID', '현재 문서에서 승인 입력의 계산 근거를 재검증하지 못했습니다.');
  for (const { cost } of rows) {
    const computed = preview.lines.find(line => line.lineId === cost.lineId);
    if (!computed || !equalNumber(computed.totalCostKRW, cost.totalCostKRW)
      || (cost.quantity === 0 ? cost.costPerUnitKRW !== null : !equalNumber(computed.costPerUnitKRW, cost.costPerUnitKRW))
      || !cost.componentAmounts || Object.keys(computed.componentAmounts).length !== Object.keys(cost.componentAmounts).length
      || Object.entries(computed.componentAmounts).some(([key, value]) => typeof value === 'number'
        ? !equalNumber(value, cost.componentAmounts[key]) : value !== cost.componentAmounts[key])) {
      fail('COST_EXPORT_AMOUNT_MISMATCH', '승인된 행별 원가와 입력 재검증 결과가 일치하지 않습니다.');
    }
  }
  if (!equalNumber(preview.totals.totalCostKRW, revision.totalCostKRW)) fail('COST_EXPORT_TOTAL_MISMATCH', '승인 원가 합계가 일치하지 않습니다.');
  return rows;
}

function putGroupedProfileValues({ document, revision, snapshot, rows, profile, put }) {
  const th = profile.id === 'TH_ORIGINAL_V1', currency = snapshot.input.nativeCurrency;
  const inputs = new Map(snapshot.input.lineInputs.map(line => [line.lineId, line]));
  const sum = key => rows.reduce((s, row) => s + row.cost.componentAmounts[key], 0);
  put('B1', th ? '원본 첫행 단 원가 오류 교정 · 승인값 스냅샷' : 'CO 승인값 스냅샷 · 그룹별 배분');
  put('B5', '차수'); put('C5', `${document.orderYear}/${document.orderWeek}`);
  put('B7', '환율'); put('C7', snapshot.input.exchangeRateKRW);
  put('B8', 'GW kg'); put('C8', document.reviewedMetadata.gw); put('D8', 'CW kg'); put('E8', document.reviewedMetadata.cw);
  put('B10', '승인합계 KRW'); put('C10', revision.totalCostKRW);
  put('B11', `운임 ${currency}`); put('C11', sum('freightNative'));
  put(th ? 'M10' : 'O10', '통관총액'); put(th ? 'N10' : 'P10', sum('customsKRW'));
  const headers = th
    ? { C: '원문 품목', F: '송이수', G: `FOB ${currency}`, H: '배분비', I: `CNF ${currency}`, J: `CNF합 ${currency}`,
      K: 'CNF KRW', L: '관세/송이', M: '통관/송이', N: '원가/송이', O: '송이/단위', P: '원가/단위', Q: '총 원가', R: 'ERP 단위', S: '실제수량', T: '그룹' }
    : { B: '원문 품목', E: '송이수', F: `FOB ${currency}`, G: `운임 ${currency}`, H: `CNF ${currency}`, I: `CNF합 ${currency}`,
      J: 'CNF KRW', K: '관세/송이', L: '통관/송이', M: '원가/송이', N: '송이/단위', O: '원가/단위', P: '총 원가', Q: 'ERP 단위', R: '실제수량', S: '그룹' };
  for (const [col, label] of Object.entries(headers)) put(`${col}${profile.headerRow}`, label);
  rows.forEach(({ source, cost }, i) => {
    const r = profile.detailStartRow + i, c = cost.componentAmounts, settings = inputs.get(cost.lineId);
    const factor = cost.unit === 'STEM' ? 1 : cost.unit === 'BUNCH' ? settings.stemsPerBunch : settings.stemsPerBunch * settings.bunchesPerBox;
    const stems = cost.quantity === 0 ? 0 : cost.quantity * factor;
    put(`${th ? 'C' : 'B'}${r}`, source.originalName); put(`${th ? 'F' : 'E'}${r}`, stems);
    put(`${th ? 'G' : 'F'}${r}`, source.unitPrice);
    put(`${th ? 'J' : 'I'}${r}`, c.goodsNative + c.freightNative);
    put(`${th ? 'P' : 'O'}${r}`, cost.costPerUnitKRW); put(`${th ? 'Q' : 'P'}${r}`, cost.totalCostKRW);
    put(`${th ? 'R' : 'Q'}${r}`, cost.unit); put(`${th ? 'S' : 'R'}${r}`, cost.quantity);
    if (stems > 0) {
      put(`${th ? 'T' : 'S'}${r}`, settings.groupId);
      if (th) {
        const group = snapshot.input.costGroups.find(group => group.groupId === settings.groupId);
        const boxes = snapshot.input.costGroups.reduce((s, group) => s + Number(group.boxQuantity), 0);
        put(`H${r}`, group.boxQuantity / boxes * stems / group.quantity);
      } else put(`G${r}`, c.freightNative / stems);
      put(`${th ? 'I' : 'H'}${r}`, (c.goodsNative + c.freightNative) / stems);
      put(`${th ? 'K' : 'J'}${r}`, (c.goodsKRW + c.freightKRW) / stems);
      put(`${th ? 'L' : 'K'}${r}`, c.tariffKRW / stems); put(`${th ? 'M' : 'L'}${r}`, c.customsKRW / stems);
      put(`${th ? 'N' : 'M'}${r}`, cost.totalCostKRW / stems); put(`${th ? 'O' : 'N'}${r}`, factor);
    }
  });
}

function putAdditionalProfileValues({ document, revision, snapshot, rows, profile, put }) {
  const us = profile.formulaId === 'US_CNF_BOX_V1', ec = profile.formulaId === 'EC_FOB_STEM_V1';
  const settings = new Map(snapshot.input.lineInputs.map(line => [line.lineId, line]));
  const factorFor = cost => {
    if (cost.unit === profile.priceBasis) return 1;
    const input = settings.get(cost.lineId);
    if (profile.priceBasis === 'BOX') return cost.unit === 'BUNCH' ? 1 / input.bunchesPerBox : 1 / (input.bunchesPerBox * input.stemsPerBunch);
    if (profile.priceBasis === 'STEM') return cost.unit === 'BUNCH' ? input.stemsPerBunch : input.stemsPerBunch * input.bunchesPerBox;
    return cost.unit === 'BOX' ? input.bunchesPerBox : 1 / input.stemsPerBunch;
  };
  const currency = snapshot.input.nativeCurrency, basis = profile.priceBasis;
  const unitLabel = { BUNCH: '단', STEM: '송이', BOX: '박스' }[basis];
  const basisQuantities = rows.map(({ cost }) => cost.quantity === 0 ? 0 : cost.quantity * factorFor(cost));
  const totalBasis = basisQuantities.reduce((a, b) => a + b, 0);
  const sum = key => rows.reduce((s, row) => s + row.cost.componentAmounts[key], 0);
  if (ec) {
    put('B5', '승인값 스냅샷'); put('C5', `${document.orderYear}/${document.orderWeek}`);
    put('B6', `상품합계 ${currency}`); put('C6', sum('goodsNative'));
    put('B7', '환율'); put('C7', snapshot.input.exchangeRateKRW);
    put('B10', '승인합계 KRW'); put('C10', revision.totalCostKRW);
    put('B11', `운임 ${currency}`); put('C11', sum('freightNative'));
    put('O10', '통관총액 KRW'); put('P10', sum('customsKRW'));
  } else {
    put('B1', `${profile.id.split('_')[0]} 승인값 스냅샷 · CNF 운임포함 · 실제 ERP 단위`);
    put('B5', `CNF 합계 ${currency}`); put(us || profile.id === 'NZ_ORIGINAL_V1' ? 'C5' : 'D5', sum('cnfNative'));
    put('B6', '환율'); put(us || profile.id === 'NZ_ORIGINAL_V1' ? 'C6' : 'D6', snapshot.input.exchangeRateKRW);
    put('B9', `${unitLabel} 총수량`); put(us || profile.id === 'NZ_ORIGINAL_V1' ? 'C9' : 'D9', totalBasis);
    put(us ? 'L9' : 'M9', '통관총액 KRW'); put(us ? 'M9' : 'N9', sum('customsKRW'));
  }
  const headings = us
    ? { B: '원문 품목', D: '박스수', E: `CNF ${currency}`, F: `합계 ${currency}`, G: 'CNF KRW',
      H: '관세/박스', I: '통관/박스', J: '원가/박스', K: '박스/단위', L: '원가/단위', M: '총 원가', N: 'ERP 단위', O: '실제수량' }
    : ec ? { B: '원문 품목', E: '송이수', F: `FOB ${currency}`, G: '수량비', H: `CNF ${currency}`,
      I: `합계 ${currency}`, J: 'CNF KRW', K: '관세/송이', L: '통관/송이', M: '원가/송이',
      N: '송이/단위', O: '원가/단위', P: '총 원가', Q: 'ERP 단위', R: '실제수량' }
      : { B: '원문 품목', E: `${unitLabel} 수량`, F: `CNF ${currency}`, G: `합계 ${currency}`, H: 'CNF KRW',
        I: `관세/${unitLabel}`, J: `통관/${unitLabel}`, K: `원가/${unitLabel}`, L: `${unitLabel}/단위`,
        M: '원가/단위', N: '총 원가', O: 'ERP 단위', P: '실제수량' };
  for (const [col, label] of Object.entries(headings)) put(`${col}${profile.headerRow}`, label);
  rows.forEach(({ source, cost }, i) => {
    const r = profile.detailStartRow + i, c = cost.componentAmounts, q = basisQuantities[i];
    put(`B${r}`, source.originalName); put(`${us ? 'D' : 'E'}${r}`, q); put(`${us ? 'E' : 'F'}${r}`, source.unitPrice);
    put(`${us ? 'L' : ec ? 'O' : 'M'}${r}`, cost.costPerUnitKRW);
    put(`${us ? 'M' : ec ? 'P' : 'N'}${r}`, cost.totalCostKRW);
    put(`${us ? 'N' : ec ? 'Q' : 'O'}${r}`, cost.unit);
    put(`${us ? 'O' : ec ? 'R' : 'P'}${r}`, cost.quantity);
    const native = ec ? c.goodsNative + c.freightNative : c.cnfNative;
    const krw = ec ? c.goodsKRW + c.freightKRW : c.cnfKRW;
    put(`${us ? 'F' : ec ? 'I' : 'G'}${r}`, native);
    if (q > 0) {
      if (ec) { put(`G${r}`, q / totalBasis); put(`H${r}`, native / q); }
      put(`${us ? 'G' : ec ? 'J' : 'H'}${r}`, krw / q);
      put(`${us ? 'H' : ec ? 'K' : 'I'}${r}`, c.tariffKRW / q);
      put(`${us ? 'I' : ec ? 'L' : 'J'}${r}`, c.customsKRW / q);
      put(`${us ? 'J' : ec ? 'M' : 'K'}${r}`, cost.totalCostKRW / q);
      put(`${us ? 'K' : ec ? 'N' : 'L'}${r}`, q / cost.quantity);
    }
  });
}

function putProfileValues({ document, revision, snapshot, rows, profile, put }) {
  if (profile.grouped) return putGroupedProfileValues({ document, revision, snapshot, rows, profile, put });
  if (profile.priceBasis) return putAdditionalProfileValues({ document, revision, snapshot, rows, profile, put });
  const nl = revision.formulaId === 'NL_AMOUNT_V1';
  const sum = key => rows.reduce((total, row) => total + row.cost.componentAmounts[key], 0);
  put('B5', '차수'); put('C5', `${document.orderYear}/${document.orderWeek}`);
  put('B7', '환율'); put('C7', snapshot.input.exchangeRateKRW);
  put('B10', '승인합계 KRW'); put('C10', revision.totalCostKRW);
  put('B11', `운임 ${snapshot.input.nativeCurrency}`); put('C11', sum('freightNative'));
  if (nl) {
    put('B1', 'NL 승인값 스냅샷 · 실제 ERP 단위 · 재계산 수식 없음');
    put('B6', '상품합계 EUR'); put('C6', rows.reduce((s, row) => s + row.source.lineAmount, 0));
    put('P10', '통관총액 KRW'); put('Q10', sum('customsKRW'));
  } else {
    put('O5', '승인값 스냅샷'); put('B19', '실제 ERP 단위 기준 · 95% 예상값 미사용');
  }
  const headings = nl
    ? { B: '원문 품목', E: '송이수', F: '상품/송이 EUR', G: '금액 배분비', H: 'CNF/송이 EUR', I: 'CNF 합계 EUR',
      J: 'CNF/송이 KRW', K: '관세/송이 KRW', L: '통관/송이 KRW', M: '원가/송이', N: '송이/단위',
      O: '원가/단위', P: '부가세포함', R: 'ERP 단위', S: '실제수량', T: '총 원가' }
    : { B: '원문 품목', E: '실제수량', F: '상품/단위 CNY', H: '운임/단위 CNY', I: 'CNF/단위 CNY', J: 'CNF 합계 CNY',
      K: 'CNF/단위 KRW', L: '관세/단위 KRW', M: '기타/단위 KRW', N: '도착원가/ERP단위', O: 'ERP 단위', P: '총 도착원가' };
  for (const [col, label] of Object.entries(headings)) put(`${col}${profile.detailStartRow - 1}`, label);
  rows.forEach(({ source, detail, cost }, i) => {
    const r = profile.detailStartRow + i, c = cost.componentAmounts, q = cost.quantity;
    put(`B${r}`, source.originalName);
    if (nl) {
      put(`E${r}`, detail.stemQuantity); put(`F${r}`, source.unitPrice);
      put(`O${r}`, cost.costPerUnitKRW); put(`R${r}`, cost.unit); put(`S${r}`, q); put(`T${r}`, cost.totalCostKRW);
      if (q > 0) {
        const stems = detail.stemQuantity;
        put(`G${r}`, c.amountShare); put(`H${r}`, (source.lineAmount + c.freightNative) / stems);
        put(`I${r}`, source.lineAmount + c.freightNative);
        put(`J${r}`, (c.goodsKRW + c.freightKRW) / stems); put(`K${r}`, c.tariffKRW / stems);
        put(`L${r}`, c.customsKRW / stems); put(`M${r}`, c.arrivalPerStemKRW);
        put(`N${r}`, stems / q); put(`P${r}`, c.vatIncludedCostPerUnitKRW);
      }
    } else {
      put(`E${r}`, q); put(`J${r}`, c.goodsNative + c.freightNative);
      put(`N${r}`, cost.costPerUnitKRW); put(`O${r}`, cost.unit); put(`P${r}`, cost.totalCostKRW);
      if (q > 0) for (const [col, value] of Object.entries({ F: c.goodsNative, H: c.freightNative, I: c.goodsNative + c.freightNative,
        K: c.goodsKRW + c.freightKRW, L: c.tariffKRW, M: c.otherKRW })) put(`${col}${r}`, value / q);
    }
  });
}

/** Single-sheet approved-value snapshot. No formulas, names, external links, or historical cell payloads. */
export async function createInvoiceCostWorkbook({ document, revision, snapshot }) {
  const profile = invoiceCostExportProfile(revision?.formulaId);
  if (!profile) fail('EXPORT_TEMPLATE_UNSUPPORTED', '검증된 출력 양식이 없는 원가 공식입니다.', 422);
  const template = templates[profile.id];
  const { assetHash, ...format } = template;
  if (template.schemaVersion !== 1 || template.profileId !== profile.id || template.profileVersion !== profile.version
    || template.sourceHash !== profile.sourceHash || template.sourceSheet !== profile.sourceSheet || assetHash !== profile.assetHash
    || createHash('sha256').update(JSON.stringify(format)).digest('hex') !== profile.assetHash) {
    fail('COST_EXPORT_TEMPLATE_INVALID', '검증된 출력 양식 지문과 일치하지 않습니다.', 503);
  }
  const rows = checkedRows(document, revision, snapshot);
  const values = new Map(); const put = (ref, value) => { if (value !== null && value !== undefined) values.set(ref, value); };
  if (revision.formulaId === FORMULA) {
  put('J2', 'CHINA'); put('K2', document.orderWeek); put('L2', document.reviewedMetadata?.farmName || document.invoiceNo);
  put('B5', '차수'); put('C5', `${document.orderYear}/${document.orderWeek}`);
  put('B7', '환율'); put('C7', snapshot.input.exchangeRateKRW);
  put('B8', 'GW kg'); put('C8', document.reviewedMetadata.gw); put('D8', 'CW kg'); put('E8', document.reviewedMetadata.cw);
  put('B9', '원가 행수'); put('C9', rows.length); put('B10', '승인합계 KRW'); put('C10', revision.totalCostKRW);
  put('B11', '운임 CNY'); put('C11', rows.reduce((s, r) => s + r.cost.componentAmounts.freightNative, 0));
  put('J5', '승인 입력·합계'); put('O5', '승인값 스냅샷 · 재계산 수식 없음');
  put('J6', '항목'); put('K6', '승인값');
  put('J7', '기타비 KRW'); put('K7', rows.reduce((s, r) => s + r.cost.componentAmounts.otherKRW, 0));
  put('J8', '관세 KRW'); put('K8', rows.reduce((s, r) => s + r.cost.componentAmounts.tariffKRW, 0));
  put('J9', '문서 버전'); put('K9', String(document.revision)); put('J10', '원가 버전'); put('K10', String(revision.revisionNo));
  put('J11', '적용일'); put('K11', snapshot.input.formulaEffectiveDate); put('J12', '환율 기준일'); put('K12', snapshot.input.exchangeRateDate);
  put('J13', '환율 종류'); put('K13', snapshot.input.exchangeRateType); put('O10', '통관총액 KRW'); put('P10', snapshot.input.customsTotalKRW);
  put('B20', `문서 ${document.documentId} · 승인 ${revision.costRevisionId}`);
  put('B21', '실제 ERP 단위 기준 · 단/송이 임의 환산 없음');
  const headings = { B: '원문 품목', E: '실제수량', F: '상품/단위 CNY', G: '운임/단위 CNY', H: 'CNF/단위 CNY', I: 'CNF 합계 CNY',
    J: 'CNF/단위 KRW', K: '관세/단위 KRW', L: '통관/단위 KRW', M: '도착원가(단위)', N: 'ERP 단위', O: '총 도착원가', P: '기타/단위 KRW' };
  for (const [col, label] of Object.entries(headings)) put(`${col}23`, label);
  rows.forEach(({ source, cost }, i) => {
    const r = 24 + i, c = cost.componentAmounts, q = cost.quantity;
    put(`B${r}`, source.originalName); put(`E${r}`, q); put(`N${r}`, cost.unit);
    put(`I${r}`, c.goodsNative + c.freightNative); put(`M${r}`, cost.costPerUnitKRW); put(`O${r}`, cost.totalCostKRW);
    if (q > 0) for (const [col, amount] of Object.entries({ F: c.goodsNative, G: c.freightNative, H: c.goodsNative + c.freightNative,
      J: c.goodsKRW + c.freightKRW, K: c.tariffKRW, L: c.customsKRW, P: c.otherKRW })) put(`${col}${r}`, amount / q);
  });
  } else {
    putProfileValues({ document, revision, snapshot, rows, profile, put });
  }
  const last = Math.max(profile.lastDetailRow, profile.detailStartRow - 1 + rows.length);
  const rowNumber = row => Number(row.attrs.match(/\br="(\d+)"/)[1]);
  const byRow = new Map(template.rows.map(row => [rowNumber(row), { ...row, cells: [...row.cells] }]));
  const base = byRow.get(profile.detailPrototypeRow ?? profile.detailStartRow);
  for (let r = profile.detailStartRow; r <= last; r++) {
    let row = byRow.get(r);
    if (!row) { row = { attrs: base.attrs.replace(/\br="\d+"/, `r="${r}"`),
      cells: base.cells.map(cell => ({ ...cell, ref: cell.ref.replace(/\d+$/, String(r)) })) }; byRow.set(r, row); }
    // Sparse blank source rows have no explicit cells; use the verified detail prototype
    // only for missing output cells, never replace any existing source style or height.
    for (const cell of base.cells) {
      const ref = cell.ref.replace(/\d+$/, String(r));
      if (values.has(ref) && !row.cells.some(existing => existing.ref === ref)) row.cells.push({ ...cell, ref });
    }
    row.cells.sort((a, b) => a.ref.replace(/\d+$/, '').length - b.ref.replace(/\d+$/, '').length || a.ref.localeCompare(b.ref));
  }
  const sheetRows = [...byRow.values()].sort((a, b) => rowNumber(a) - rowNumber(b));
  const xfsBlock = template.styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  const originalXfs = [...xfsBlock[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match => match[0]);
  const appendedXfs = [], numberStyles = new Map();
  const moneyStyle = style => {
    if (numberStyles.has(style)) return numberStyles.get(style);
    // Add a format-only clone: preserve font, fill, border, alignment, protection.
    let xf = originalXfs[Number(style)].replace(/\bnumFmtId="\d+"/, 'numFmtId="4"');
    xf = /\bapplyNumberFormat=/.test(xf) ? xf.replace(/\bapplyNumberFormat="[^"]*"/, 'applyNumberFormat="1"') : xf.replace('<xf ', '<xf applyNumberFormat="1" ');
    const index = String(originalXfs.length + appendedXfs.length); appendedXfs.push(xf); numberStyles.set(style, index); return index;
  };
  const moneyCols = profile.id === 'US_ORIGINAL_V1' ? ['E', 'F', 'G', 'H', 'I', 'J', 'L', 'M']
    : profile.id === 'EC_ORIGINAL_V1' ? ['F', 'H', 'I', 'J', 'K', 'L', 'M', 'O', 'P']
      : profile.priceBasis ? ['F', 'G', 'H', 'I', 'J', 'K', 'M', 'N'] : [];
  const moneyRefs = profile.id === 'US_ORIGINAL_V1' ? ['C5', 'M9'] : profile.id === 'EC_ORIGINAL_V1' ? ['C6', 'C10', 'C11', 'P10']
    : profile.priceBasis ? [profile.id === 'NZ_ORIGINAL_V1' ? 'C5' : 'D5', 'N9'] : [];
  const sheetData = sheetRows.map(row => `<row ${row.attrs}>${row.cells.map(cell => {
    const value = values.get(cell.ref);
    const quantityCols = profile.formulaId === 'NL_AMOUNT_V1' ? ['S', 'E']
      : profile.formulaId === 'US_CNF_BOX_V1' ? ['O', 'D']
        : profile.formulaId === 'EC_FOB_STEM_V1' || profile.id === 'CO_ORIGINAL_V1' ? ['R', 'E']
          : profile.id === 'TH_ORIGINAL_V1' ? ['S', 'F'] : profile.priceBasis ? ['P', 'E'] : null;
    const col = cell.ref.replace(/\d+$/, ''), r = Number(cell.ref.match(/\d+$/)[0]);
    const quantityStyle = quantityCols && col === quantityCols[0] && r >= profile.detailStartRow
      ? row.cells.find(c => c.ref === `${quantityCols[1]}${r}`)?.style : null;
    const correctedFirstCostStyle = profile.id === 'TH_ORIGINAL_V1' && cell.ref === 'P15'
      ? template.rows.find(row => rowNumber(row) === 16).cells.find(cell => cell.ref === 'P16').style : null;
    let style = correctedFirstCostStyle ?? quantityStyle ?? cell.style;
    if (typeof value === 'number' && (moneyRefs.includes(cell.ref) || r >= profile.detailStartRow && moneyCols.includes(col))) style = moneyStyle(style);
    const attrs = `r="${cell.ref}" s="${style}"`;
    if (value === undefined) return `<c ${attrs}/>`;
    values.delete(cell.ref);
    return typeof value === 'number' ? `<c ${attrs}><v>${value}</v></c>` : `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  if (values.size) fail('COST_EXPORT_TEMPLATE_INVALID', '템플릿의 필수 셀 서식이 없습니다.', 503);
  const merges = [...template.merges];
  if (profile.detailMerge !== null) for (let r = profile.detailStartRow; r <= last; r++) {
    const [left, right] = (profile.detailMerge || 'B:D').split(':');
    const ref = `${left}${r}:${right}${r}`;
    if (!merges.includes(ref)) merges.push(ref);
  }
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="A1:BO${last}"/>${template.sheetViews}${template.sheetFormatPr}${template.cols}<sheetData>${sheetData}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${template.print}</worksheet>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const printArea = template.printArea?.replace(/\$([0-9]+)(?=$|:|,)/g, (match, n) => Number(n) >= profile.lastDetailRow ? `$${last}` : match);
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${relns}"><sheets><sheet name="승인 원가" sheetId="1" r:id="rId1"/></sheets>${printArea ? `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'승인 원가'!${xml(printArea)}</definedName></definedNames>` : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relns}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${relns}/theme" Target="theme/theme1.xml"/></Relationships>`);
  const styles = appendedXfs.length ? template.styles.replace(xfsBlock[0], `<cellXfs${xfsBlock[1].replace(/count="\d+"/, `count="${originalXfs.length + appendedXfs.length}"`)}>${xfsBlock[2]}${appendedXfs.join('')}</cellXfs>`) : template.styles;
  zip.file('xl/worksheets/sheet1.xml', sheet); zip.file('xl/styles.xml', styles); zip.file('xl/theme/theme1.xml', template.theme);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function exportCurrentInvoiceCost({ queryFn, types, documentId, warehouseKey, costRevisionId,
  readCosts = readInvoiceCosts, readDocument = getInvoiceDocument, generate = createInvoiceCostWorkbook }) {
  if (typeof documentId !== 'string' || !UUID.test(documentId) || typeof costRevisionId !== 'string' || !UUID.test(costRevisionId)
    || typeof warehouseKey !== 'string' || !/^[1-9]\d*$/.test(warehouseKey) || !Number.isSafeInteger(Number(warehouseKey))) {
    fail('COST_EXPORT_REQUEST_INVALID', '문서·입고·승인 원가 식별값을 확인하세요.', 400);
  }
  const id = documentId.toLowerCase(), costId = costRevisionId.toLowerCase(), key = Number(warehouseKey);
  async function load() {
    const document = await readDocument({ queryFn, types, documentId: id });
    const costs = await readCosts({ queryFn, types, warehouseKey: key });
    const revision = costs.currentActual;
    if (!document || costs.status !== 'APPROVED' || costs.documentCostStatus !== 'APPROVED'
      || costs.documentId !== id || costs.documentRevision !== document.revision || costs.warehouseKey !== key
      || !revision || revision.costRevisionId !== costId || revision.documentId !== id || revision.warehouseKey !== key
      || revision.operationId !== costs.operationId) fail('COST_EXPORT_NOT_CURRENT', '현재 승인된 실제 원가만 내보낼 수 있습니다.');
    const type = name => typeof types[name] === 'function' ? types[name]() : types[name];
    const params = { documentId: { type: type('UniqueIdentifier'), value: id }, costRevisionId: { type: type('UniqueIdentifier'), value: costId },
      documentRevision: { type: type('Int'), value: document.revision }, operationId: { type: type('UniqueIdentifier'), value: revision.operationId }, warehouseKey: { type: type('Int'), value: key } };
    const result = await queryFn(`/* invoice-cost:export-private-snapshot */ SELECT InputSnapshotJson
      FROM dbo.WebInvoiceCostRevision WHERE CostRevisionId=@costRevisionId AND DocumentId=@documentId
      AND DocumentRevision=@documentRevision AND OperationId=@operationId AND WarehouseKey=@warehouseKey
      AND Basis=N'ACTUAL' AND Status=N'APPROVED'`, params);
    if (result.recordset?.length !== 1) fail('COST_EXPORT_SNAPSHOT_REQUIRED', '승인 원가의 서버 스냅샷을 확인할 수 없습니다.');
    const raw = result.recordset[0].InputSnapshotJson;
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > 256 * 1024) fail('COST_EXPORT_SNAPSHOT_INVALID', '승인 스냅샷이 올바르지 않습니다.');
    let snapshot; try { snapshot = JSON.parse(raw); } catch { fail('COST_EXPORT_SNAPSHOT_INVALID', '승인 스냅샷을 읽지 못했습니다.'); }
    checkedRows(document, revision, snapshot);
    const operation = document.operations.find(op => op.operationId === revision.operationId);
    const businessDocument = { documentId: document.documentId, revision: document.revision, sourceHash: document.sourceHash,
      orderYear: document.orderYear, orderWeek: document.orderWeek, invoiceNo: document.invoiceNo, invoiceYear: document.invoiceYear,
      receiptStatus: document.receiptStatus, costStatus: document.costStatus, reviewedMetadata: document.reviewedMetadata,
      lines: document.lines.map(({ lineId, lineNo, originalName, lengthText, prodKey, boxQuantity, bunchQuantity, stemQuantity, priceUnit, unitPrice, currency, lineAmount }) =>
        ({ lineId, lineNo, originalName, lengthText, prodKey, boxQuantity, bunchQuantity, stemQuantity, priceUnit, unitPrice, currency, lineAmount })),
      operation: { operationId: operation.operationId, documentRevision: operation.documentRevision, warehouseKey: operation.warehouseKey,
        status: operation.status, result: operation.result } };
    return { document, revision, snapshot, fingerprint: createHash('sha256').update(JSON.stringify({ document: businessDocument, revision, raw })).digest('hex') };
  }
  const before = await load();
  const buffer = await generate(before);
  const after = await load();
  if (before.fingerprint !== after.fingerprint) fail('COST_EXPORT_CHANGED', '내보내기 중 승인 원가나 입고가 변경되었습니다. 다시 조회하세요.');
  const year = String(before.document.orderYear), week = String(before.document.orderWeek);
  if (!/^\d{4}$/.test(year) || !/^\d{2}-\d{2}$/.test(week)) fail('COST_EXPORT_SCOPE_INVALID', '입고 연도·차수를 확인하세요.');
  return { buffer, filename: `invoice-cost-${year}-${week}-r${before.document.revision}-${id.slice(0, 8)}.xlsx` };
}
