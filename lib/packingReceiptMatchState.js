import { packingInvoiceSourceIdentity } from './importPackingReceiptAdapter.js';

const clean = value => String(value ?? '').normalize('NFC').trim();
const linesOf = invoice => Array.isArray(invoice?.products) ? invoice.products : (invoice?.lines || []);
const description = line => clean(line?.description || line?.source_description || line?.name);
const original = line => clean(line?.source_description || line?.description || line?.name);
const validKey = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const sourceRow = value => validKey(value) ? Number(value) : null;

function sameIdentity(a, b) {
  return Boolean(a && b && JSON.stringify(a) === JSON.stringify(b));
}

function selectableProduct(products, country, key) {
  if (!validKey(key)) return null;
  const matches = (products || []).filter(product => Number(product.ProdKey) === Number(key)
    && product.country === country && product.selectable === true && clean(product.ProdName));
  return matches.length === 1 ? matches[0] : null;
}

// UI-only overlay. It never changes generated buffers, aliases, or receipt documents.
export function packingReceiptMatchState({ snapshot, file, excels, invoices, country, products }) {
  const empty = { valid: false, byRow: new Map(), documentTotal: 0, documentPending: 0, overlayComplete: false };
  if (!snapshot || !file || snapshot.file !== file || snapshot.excels !== excels
    || snapshot.invoices !== invoices || snapshot.country !== country
    || !/^[a-f0-9]{64}$/i.test(snapshot.sourceHash || '')
    || !Array.isArray(excels) || !Array.isArray(invoices) || excels.length !== invoices.length
    || !Array.isArray(snapshot.records)) return empty;

  const byRow = new Map();
  const seenInvoices = new Set();
  const seenDocumentInvoices = new Set();
  let documentTotal = 0;
  let documentPending = 0;
  let overlayComplete = true;
  for (const excel of excels) {
    const identity = excel?.sourceInvoiceIdentity;
    const invoiceIndex = Number(identity?.sourceInvoiceIndex);
    if (!Number.isSafeInteger(invoiceIndex) || invoiceIndex < 0 || invoiceIndex >= invoices.length
      || seenInvoices.has(invoiceIndex) || !sameIdentity(identity, packingInvoiceSourceIdentity(invoices[invoiceIndex], invoiceIndex))) return empty;
    seenInvoices.add(invoiceIndex);
    const records = snapshot.records.filter(item => item?.document?.rawMetadata?.sourceInvoiceIdentity?.sourceInvoiceIndex === invoiceIndex);
    if (records.length !== 1 || seenDocumentInvoices.has(invoiceIndex)) return empty;
    seenDocumentInvoices.add(invoiceIndex);
    const record = records[0];
    const document = record?.document;
    if (!document || document.sourceHash !== snapshot.sourceHash
      || !sameIdentity(document.rawMetadata?.sourceInvoiceIdentity, identity)) return empty;
    const sourceLines = linesOf(invoices[invoiceIndex]);
    if (!Array.isArray(document.lines) || document.lines.length !== sourceLines.length) return empty;
    const seenLines = new Set();
    const seenLineIds = new Set();
    const verifiedLines = [];
    for (const line of document.lines) {
      const sourceIndex = line?.sourceEvidence?.sourceLineIndex;
      const source = sourceLines[sourceIndex];
      if (!Number.isSafeInteger(sourceIndex) || sourceIndex < 0 || !source || seenLines.has(sourceIndex)
        || !clean(line.lineId) || seenLineIds.has(line.lineId) || Number(line.lineNo) !== sourceIndex + 1
        || line.sourceEvidence?.sourceInvoiceIndex !== invoiceIndex
        || line.sourceEvidence?.matchingDescription !== description(source)
        || line.originalName !== original(source)
        || (line.sourceEvidence?.sourceRow ?? null) !== sourceRow(source.source_row)) return empty;
      seenLines.add(sourceIndex);
      seenLineIds.add(line.lineId);
      const product = line.reviewed?.erpMatchConfirmed === true
        ? selectableProduct(products, country, line.prodKey) : null;
      documentTotal += 1;
      if (!product) documentPending += 1;
      verifiedLines.push({ sourceIndex, source, line, product });
    }
    const generated = Array.isArray(excel.products) ? excel.products : [];
    const duplicateDescriptions = new Set(sourceLines.map(source => JSON.stringify([description(source), original(source)]))).size !== sourceLines.length;
    const directRows = generated.length === sourceLines.length && verifiedLines.every(({ sourceIndex, source }) =>
      clean(generated[sourceIndex]?.matchingDescription || generated[sourceIndex]?.sourceName) === description(source)
      && clean(generated[sourceIndex]?.sourceName || generated[sourceIndex]?.matchingDescription) === original(source)
      && (generated[sourceIndex]?.source_row == null || sourceRow(generated[sourceIndex].source_row) === sourceRow(source.source_row))
      && (!duplicateDescriptions || (sourceRow(source.source_row) != null
        && sourceRow(generated[sourceIndex]?.source_row) === sourceRow(source.source_row))));
    if (!directRows) { overlayComplete = false; continue; }
    for (const { sourceIndex, line, product } of verifiedLines) {
      byRow.set(`${invoiceIndex}:${sourceIndex}`, { lineId: line.lineId,
        prodKey: product ? Number(product.ProdKey) : null, prodName: product?.ProdName || null });
    }
  }
  return { valid: true, byRow, documentTotal, documentPending, overlayComplete };
}

export function effectivePackingMatchReview(base, rowMatch) {
  if (!rowMatch) return base;
  if (!rowMatch.prodKey) return { status: 'UNMATCHED', needsReview: true, label: '문서 행 품목 미선택', prodKey: null };
  if (!base.needsReview && Number(base.prodKey) === rowMatch.prodKey) return base;
  return { status: 'DOCUMENT', needsReview: false, label: '문서 행 선택 · 팀 공용 저장 아님', prodKey: rowMatch.prodKey };
}
