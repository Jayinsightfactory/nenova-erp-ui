import JSZip from 'jszip';
import {applyCostSalesDefaults,formatCostSalesProjection} from './invoiceCostSalesDefaults.js';
import {costSellingInputCue,costRequiredSourceCue,appendCostInputDifferentialStyle} from './invoiceCostCellPresentation.js';
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
import co42Template from './invoiceCostTemplates/colombia-42-1-v1.json' with { type: 'json' };
import thTemplate from './invoiceCostTemplates/thailand-v1.json' with { type: 'json' };
import { invoiceCostExportProfile } from './invoiceCostExportProfiles.js';
export { INVOICE_COST_EXPORT_PROFILES } from './invoiceCostExportProfiles.js';
import { INVOICE_COST_FORMULAS, previewInvoiceCost, readInvoiceCosts } from './invoiceReceiptCost.js';
import { getInvoiceDocument } from './invoiceReceiptDocuments.js';
import { invoiceCostFormulaComparison } from './invoiceCostFormulaComparison.js';
import { originalColombiaCostSheet } from './invoiceCostOriginalColombia.js';
import { originalAustraliaCostSheet } from './invoiceCostOriginalAustralia.js';
import { originalRestoredCostSheet } from './invoiceCostOriginalRestoration.js';
import {nlComparisonForExport,markNlCustomerRows} from './nlCostCustomerComparison.js';
import {createCloudCostWorkbook} from './chinaCloudCostWorkbook.js';
import {weekSheetName} from './costMasterStore.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const templates = { CN_AIR_ORIGINAL_V1: airTemplate, NL_ORIGINAL_V1: nlTemplate, CN_SEA_ORIGINAL_V1: seaTemplate,
  US_ORIGINAL_V1: usTemplate, VN_ORIGINAL_V1: vnTemplate, AU_ORIGINAL_V1: auTemplate, NZ_ORIGINAL_V1: nzTemplate, EC_ORIGINAL_V1: ecTemplate,
  CO_ORIGINAL_V1: coTemplate, CO_42_1_ORIGINAL_V1: co42Template, TH_ORIGINAL_V1: thTemplate };
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
  const existingLink = operation.action === 'LINK_EXISTING_COST' && ['EXISTING_NL', 'EXISTING_CN', 'EXISTING_TH'].includes(snapshot.receiptSnapshot?.linkMode);
  if (!Array.isArray(document.lines) || !Array.isArray(revision.lines) || !Array.isArray(details)
    || revision.lines.length < 1 || revision.lines.length > 1000 || document.lines.length !== revision.lines.length
    || (!existingLink && details.length !== revision.lines.length) || !Array.isArray(mappings) || mappings.length !== revision.lines.length) fail('COST_EXPORT_LINES_REQUIRED', '승인 원가의 모든 원문·입고 상세 근거가 필요합니다.');
  const byDoc = new Map(document.lines.map(line => [line.lineId, line]));
  const byDetail = new Map((existingLink ? mappings : details).map(line => [line.lineId, line]));
  const byMapping = new Map(mappings.map(line => [line.lineId, line]));
  if (existingLink) {
    const quantityField = ['EXISTING_CN', 'EXISTING_TH'].includes(snapshot.receiptSnapshot.linkMode) ? 'bunchQuantity' : 'stemQuantity';
    const excluded = new Set(snapshot.receiptSnapshot.excludedDetailKeys || []);
    const grouped = new Map();
    for (const mapping of mappings) {
      const total = grouped.get(mapping.wdetailKey) || { quantity: 0, amount: 0 };
      total.quantity += mapping[quantityField]; total.amount += mapping.lineAmount;
      grouped.set(mapping.wdetailKey, total);
      const native = details.find(detail => detail.wdetailKey === mapping.wdetailKey);
      if (!native || native.prodKey !== mapping.prodKey || !equalNumber(native.unitPrice, mapping.unitPrice)) fail('COST_EXPORT_LINE_MISMATCH', '기존 입고와 원문 품목·단가가 다릅니다.');
    }
    for (const native of details) {
      const total = grouped.get(native.wdetailKey);
      if (excluded.has(native.wdetailKey) ? Boolean(total) : !total
        || !equalNumber(total.quantity, native[quantityField]) || !equalNumber(total.amount, native.lineAmount)) fail('COST_EXPORT_LINE_MISMATCH', '기존 입고와 원문 합계가 다릅니다.');
    }
  }
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
  })), {historicalApprovedFormula:true});
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

/** Single week original-format cost sheet export. */
export async function createInvoiceCostWorkbook({ document, revision, snapshot,nlComparison }) {
  return renderInvoiceCostWorkbook({ document, revision, snapshot,nlComparison, rows: checkedRows(document, revision, snapshot) });
}

/** Separate read-only calculation export. Never creates an approval or commit. */
export async function createNativeCostWorkbook({ document, input,nlComparison }) {
  if (document?.receiptStatus !== 'NATIVE_READONLY' || document?.costStatus !== 'PREVIEW_ONLY')
    fail('NATIVE_COST_SOURCE_REQUIRED', '기존 입고 조회 자료가 필요합니다.');
  return createPreviewCostWorkbook({document,input,nlComparison});
}

export async function createInvoicePreviewCostWorkbook({document,input,nlComparison}) {
  if(document?.receiptStatus!=='INVOICE_PREVIEW'||document?.costStatus!=='PREVIEW_ONLY')
    fail('INVOICE_PREVIEW_REQUIRED','검증된 인보이스 계산 자료가 필요합니다.');
  return createPreviewCostWorkbook({document,input,nlComparison});
}

// Server-verified shared AWB calculation only; not a persisted approval revision.
export async function createSharedAwbCostWorkbook({ document, input, result }) {
  if (result?.status !== 'CALCULATED' || result.allocationScope !== 'SHARED_AWB'
    || document?.receiptStatus !== 'SHARED_AWB_PREVIEW')
    fail('SHARED_AWB_PREVIEW_REQUIRED', '전체 공동 AWB 입고를 검증한 계산 결과가 필요합니다.');
  const byLine = new Map(document.receiptLines.map(line => [line.lineId, line]));
  const rows = result.lines.map(cost => {
    const source = byLine.get(cost.lineId);
    if (!source) fail('SHARED_AWB_LINE_MISSING', '공동 AWB 입고 행이 누락되었습니다.');
    return { source: { ...source, farmName: cost.farmName, originalName: `${cost.farmName} · ${source.originalName}` }, detail: source, cost };
  });
  const revision = { formulaId: 'CO_GROUP_42_1_V1', status: 'PREVIEW_ONLY', revisionNo: '미저장',
    costRevisionId: '공동 AWB 미승인 계산본', totalCostKRW: result.lines.reduce((sum,line) => sum + line.totalCostKRW,0) };
  return renderInvoiceCostWorkbook({ document, revision, snapshot: { input }, rows, previewOnly: true });
}

async function createPreviewCostWorkbook({document,input,nlComparison}) {
  const preview = previewInvoiceCost({ ...document, costInput: input }, document.receiptLines);
  if (preview.status !== 'APPROVED') fail('NATIVE_COST_INPUT_REQUIRED', preview.issues.map(item => item.message).join('\n'), 422);
  const revision = { ...preview, status: 'PREVIEW_ONLY', totalCostKRW: preview.totals.totalCostKRW,
    revisionNo: '미저장', costRevisionId: '미승인 계산본' };
  const byLine = new Map(document.receiptLines.map(line => [line.lineId, line]));
  const rows = preview.lines.map(cost => ({ source: byLine.get(cost.lineId), detail: byLine.get(cost.lineId), cost }));
  return renderInvoiceCostWorkbook({ document, revision, snapshot: { input }, rows,nlComparison, previewOnly: true });
}

async function renderInvoiceCostWorkbook({ document, revision, snapshot, rows,nlComparison, previewOnly = false }) {
  if(revision?.formulaId==='CN_CLOUD_CBM_V1')return createCloudCostWorkbook({document,revision,snapshot,rows,previewOnly});
  const profile = invoiceCostExportProfile(revision?.formulaId);
  if (!profile) fail('EXPORT_TEMPLATE_UNSUPPORTED', '검증된 출력 양식이 없는 원가 공식입니다.', 422);
  const template = templates[profile.id];
  const { assetHash, ...format } = template;
  if (template.schemaVersion !== 1 || template.profileId !== profile.id || template.profileVersion !== profile.version
    || template.sourceHash !== profile.sourceHash || template.sourceSheet !== profile.sourceSheet || assetHash !== profile.assetHash
    || createHash('sha256').update(JSON.stringify(format)).digest('hex') !== profile.assetHash) {
    fail('COST_EXPORT_TEMPLATE_INVALID', '검증된 출력 양식 지문과 일치하지 않습니다.', 503);
  }
  if (!/^\d{4}$/.test(String(document?.orderYear || '')) || !/^\d{2}-\d{2}$/.test(String(document?.orderWeek || ''))) {
    fail('COST_EXPORT_SCOPE_INVALID', '원가 시트의 연도·차수가 올바르지 않습니다.');
  }
  const sheetName = weekSheetName(document.orderWeek);
  const chinaSea = profile.id === 'CN_SEA_ORIGINAL_V1';
  const last = Math.max(chinaSea ? profile.detailStartRow : profile.lastDetailRow, profile.detailStartRow - 1 + rows.length);
  const xfsBlock = template.styles.match(/<cellXfs\b([^>]*)>([\s\S]*?)<\/cellXfs>/);
  const originalXfs = [...xfsBlock[2].matchAll(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)].map(match => match[0]);
  const appendedXfs = [], numberStyles = new Map();
  const moneyStyle = (style, formatId = 4) => {
    const key = `${style}:${formatId}`;
    if (numberStyles.has(key)) return numberStyles.get(key);
    // Add a format-only clone: preserve font, fill, border, alignment, protection.
    let xf = originalXfs[Number(style)];
    xf = /\bnumFmtId=/.test(xf) ? xf.replace(/\bnumFmtId="\d+"/, `numFmtId="${formatId}"`) : xf.replace('<xf ', `<xf numFmtId="${formatId}" `);
    xf = /\bapplyNumberFormat=/.test(xf) ? xf.replace(/\bapplyNumberFormat="[^"]*"/, 'applyNumberFormat="1"') : xf.replace('<xf ', '<xf applyNumberFormat="1" ');
    const index = String(originalXfs.length + appendedXfs.length); appendedXfs.push(xf); numberStyles.set(key, index); return index;
  };
  const comparison = invoiceCostFormulaComparison({ document, revision, snapshot, rows, profile });
  for (const [, cell] of comparison.cells) {
    if (typeof cell.value === 'number' && !Number.isFinite(cell.value)) fail('COST_EXPORT_FORMULA_INPUT_INVALID', '원본 수식 비교 입력을 확인하세요.');
  }
  const restoredOriginal = originalRestoredCostSheet({ document, revision, snapshot, rows, template, profile, comparison, numberStyle: moneyStyle, previewOnly });
  const originalSheet = profile.id === 'AU_ORIGINAL_V1' ? originalAustraliaCostSheet : originalColombiaCostSheet;
  let singleSheetXml = restoredOriginal?.xml ?? originalSheet({ document, revision, snapshot, rows, template, previewOnly });
  if (nlComparison && profile.id === 'NL_ORIGINAL_V1') {
    if (nlComparison.orderYear !== document.orderYear || nlComparison.orderWeek !== document.orderWeek) {
      fail('COST_EXPORT_SCOPE_INVALID', '주광 비교 차수가 원가와 다릅니다.');
    }
    if (nlComparison.status !== 'SOURCE_REQUIRED') {
      const byProd = new Map(), settings = new Map(snapshot.input.lineInputs.map(l => [l.lineId, l]));
      rows.forEach(({ source, cost }) => {
        const s = settings.get(cost.lineId);
        const q = cost.quantity === 0 ? 0 : cost.quantity * (cost.unit === 'STEM' ? 1 : cost.unit === 'BUNCH' ? s.stemsPerBunch : s.stemsPerBunch * s.bunchesPerBox);
        byProd.set(source.prodKey, (byProd.get(source.prodKey) || 0) + q);
      });
      for (const p of nlComparison.rows) {
        const q = byProd.get(p.prodKey) || 0;
        if ((nlComparison.warehouseKey !== null || nlComparison.basis === 'INVOICE') && Math.abs(q - p.current) > 0.00001) {
          throw Object.assign(new Error('주광 비교 입고수량과 원가의 송이수량이 다릅니다. 다시 조회하세요.'), { statusCode: 422 });
        }
      }
    }
    singleSheetXml = markNlCustomerRows(singleSheetXml, rows, nlComparison);
  }
  if (previewOnly) {
    singleSheetXml = singleSheetXml.replace(/승인/g, '계산').replace(/미계산/g, '미승인').replace(/저장된/g, '조회 기반').replace(/기존 저장/g, '계산 결과');
  }
  const styles = appendedXfs.length
    ? template.styles.replace(xfsBlock[0], `<cellXfs${xfsBlock[1].replace(/count="\d+"/, `count="${originalXfs.length + appendedXfs.length}"`)}>${xfsBlock[2]}${appendedXfs.join('')}</cellXfs>`)
    : template.styles;
  // AU template contained 8pt/9pt mixed fonts. Preserve layout and numeric formats,
  // but make the downloaded workbook consistently readable at normal zoom.
  const readableStyles = profile.id === 'AU_ORIGINAL_V1' ? styles.replace(/<fonts\b[\s\S]*?<\/fonts>/, fonts => fonts
    .replace(/<sz val="(?:8|9)"\s*\/>/g, '<sz val="11"/>')
    .replace(/<name val="Calibri"\s*\/>/g, '<name val="맑은 고딕"/>')) : styles;
  const cue = appendCostInputDifferentialStyle(readableStyles);
  singleSheetXml = costRequiredSourceCue({ sheet: singleSheetXml, profile, count: rows.length, dxfId: cue.id });
  const sales = formatCostSalesProjection({
    sheet: applyCostSalesDefaults({ sheet: singleSheetXml, profile, rows }),
    styles: cue.styles,
    profile,
    count: rows.length,
  });
  singleSheetXml = costSellingInputCue({ sheet: sales.sheet, profile, count: rows.length, dxfId: cue.id });
  const printArea = chinaSea ? `$B$1:$P$${last}` : template.printArea?.replace(/\$([0-9]+)(?=$|:|,)/g, (match, n) => Number(n) >= profile.lastDetailRow ? `$${last}` : match);
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${relns}"><bookViews><workbookView activeTab="0"/></bookViews><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets>${printArea ? `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'${sheetName}'!${xml(printArea)}</definedName></definedNames>` : ''}<calcPr calcMode="auto" fullCalcOnLoad="1"/></workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relns}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${relns}/theme" Target="theme/theme1.xml"/></Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', singleSheetXml);
  zip.file('xl/styles.xml', sales.styles);
  zip.file('xl/theme/theme1.xml', template.theme);
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
  before.nlComparison=await nlComparisonForExport({...before,queryFn,types,warehouseKey:key});
  const buffer = await generate(before);
  const after = await load();
  if (before.fingerprint !== after.fingerprint) fail('COST_EXPORT_CHANGED', '내보내기 중 승인 원가나 입고가 변경되었습니다. 다시 조회하세요.');
  if(before.nlComparison){const latest=await nlComparisonForExport({...after,queryFn,types,warehouseKey:key});
    if(latest.digest!==before.nlComparison.digest)fail('COST_EXPORT_CHANGED','내보내기 중 주광 주문·입고가 변경되었습니다. 다시 조회하세요.');}
  const year = String(before.document.orderYear), week = String(before.document.orderWeek);
  if (!/^\d{4}$/.test(year) || !/^\d{2}-\d{2}$/.test(week)) fail('COST_EXPORT_SCOPE_INVALID', '입고 연도·차수를 확인하세요.');
  return { buffer, historyContext:{document:before.document,snapshot:before.snapshot}, filename: `invoice-cost-${year}-${week}-r${before.document.revision}-${id.slice(0, 8)}.xlsx` };
}
