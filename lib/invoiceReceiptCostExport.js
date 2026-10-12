import JSZip from 'jszip';
import { createHash } from 'node:crypto';
import template from './invoiceCostTemplates/china-air-v1.json' with { type: 'json' };
import { INVOICE_COST_FORMULAS, previewInvoiceCost, readInvoiceCosts } from './invoiceReceiptCost.js';
import { getInvoiceDocument } from './invoiceReceiptDocuments.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/i;
const FORMULA = 'CN_AIR_WEIGHT_CBM_V1';
export const INVOICE_COST_EXPORT_PROFILES = Object.freeze({
  CN_AIR_ORIGINAL_V1: Object.freeze({ id: 'CN_AIR_ORIGINAL_V1', version: '1.0.0', formulaId: FORMULA, enabled: true,
    sourceHash: 'e1bb0315998c2f3550a0edab8353147612cd6c46d7247b287656eca1c3ee4233', sourceSheet: '27-2 CLOUD',
    assetHash: 'b0318944c4035c92515432a500be938ae388cb10c87b5531f32d8de3af869fac' }),
});
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
  if (revision?.formulaId !== FORMULA) fail('EXPORT_TEMPLATE_UNSUPPORTED', '현재 내보내기는 검증된 중국 항공 원가만 지원합니다.', 422);
  const formula = INVOICE_COST_FORMULAS[FORMULA];
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
      || ['goodsNative', 'freightNative', 'goodsKRW', 'freightKRW', 'tariffKRW', 'customsKRW', 'otherKRW']
        .some(key => !equalNumber(computed.componentAmounts[key], cost.componentAmounts?.[key]))) {
      fail('COST_EXPORT_AMOUNT_MISMATCH', '승인된 행별 원가와 입력 재검증 결과가 일치하지 않습니다.');
    }
  }
  if (!equalNumber(preview.totals.totalCostKRW, revision.totalCostKRW)) fail('COST_EXPORT_TOTAL_MISMATCH', '승인 원가 합계가 일치하지 않습니다.');
  return rows;
}

/** Single-sheet approved-value snapshot. No formulas, names, external links, or historical cell payloads. */
export async function createInvoiceCostWorkbook({ document, revision, snapshot }) {
  const profile = INVOICE_COST_EXPORT_PROFILES.CN_AIR_ORIGINAL_V1;
  const { assetHash, ...format } = template;
  if (template.schemaVersion !== 1 || template.profileId !== profile.id || template.profileVersion !== profile.version
    || template.sourceHash !== profile.sourceHash || template.sourceSheet !== profile.sourceSheet || assetHash !== profile.assetHash
    || createHash('sha256').update(JSON.stringify(format)).digest('hex') !== profile.assetHash) {
    fail('COST_EXPORT_TEMPLATE_INVALID', '검증된 출력 양식 지문과 일치하지 않습니다.', 503);
  }
  const rows = checkedRows(document, revision, snapshot);
  const values = new Map(); const put = (ref, value) => { if (value !== null && value !== undefined) values.set(ref, value); };
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
  const last = Math.max(33, 23 + rows.length);
  const sheetRows = [...template.rows];
  for (let r = 34; r <= last; r++) {
    const base = template.rows.find(row => /\br="24"/.test(row.attrs));
    sheetRows.push({ attrs: base.attrs.replace(/\br="24"/, `r="${r}"`), cells: base.cells.map(cell => ({ ...cell, ref: cell.ref.replace(/24$/, String(r)) })) });
  }
  const sheetData = sheetRows.map(row => `<row ${row.attrs}>${row.cells.map(cell => {
    const value = values.get(cell.ref), attrs = `r="${cell.ref}" s="${cell.style}"`;
    if (value === undefined) return `<c ${attrs}/>`;
    values.delete(cell.ref);
    return typeof value === 'number' ? `<c ${attrs}><v>${value}</v></c>` : `<c ${attrs} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
  }).join('')}</row>`).join('');
  if (values.size) fail('COST_EXPORT_TEMPLATE_INVALID', '템플릿의 필수 셀 서식이 없습니다.', 503);
  const merges = [...template.merges]; for (let r = 34; r <= last; r++) merges.push(`B${r}:D${r}`);
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="${ns}"><dimension ref="A1:BO${last}"/>${template.sheetViews}${template.sheetFormatPr}${template.cols}<sheetData>${sheetData}</sheetData><mergeCells count="${merges.length}">${merges.map(ref => `<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${template.print}</worksheet>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/></Types>`);
  zip.file('_rels/.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  const printArea = template.printArea?.replace(/\$([0-9]+)(?=$|:|,)/g, (match, n) => Number(n) >= 33 ? `$${last}` : match);
  zip.file('xl/workbook.xml', `<workbook xmlns="${ns}" xmlns:r="${relns}"><sheets><sheet name="승인 원가" sheetId="1" r:id="rId1"/></sheets>${printArea ? `<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">'승인 원가'!${xml(printArea)}</definedName></definedNames>` : ''}</workbook>`);
  zip.file('xl/_rels/workbook.xml.rels', `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${relns}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${relns}/styles" Target="styles.xml"/><Relationship Id="rId3" Type="${relns}/theme" Target="theme/theme1.xml"/></Relationships>`);
  zip.file('xl/worksheets/sheet1.xml', sheet); zip.file('xl/styles.xml', template.styles); zip.file('xl/theme/theme1.xml', template.theme);
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
