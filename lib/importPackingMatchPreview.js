import { makeProductResolver, resolveProductNL, packingSourceKey } from './importPacking.js';
import { packingErpAliases, packingErpCatalog } from './importPackingErpMatches.js';
import { packingMatchReview } from './packingMatchReview.js';
import { getPackingSourceReviewRequirement } from './importPackingSourceReview.js';
import { packingInvoiceSourceIdentity } from './importPackingReceiptAdapter.js';

const numeric = value => value === null || value === undefined || value === ''
  ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;
const firstValue = (...values) => values.find(value => value !== null && value !== undefined && value !== '');

function previewQuantity(product, country) {
  if (country === 'CN') return numeric(firstValue(product.total_bunch, product.total_stems, product.stems));
  return numeric(firstValue(product.total_stems, product.stems));
}

function sourceRequirement(invoice, country, lineIndex) {
  if (invoice?.pdfReviewRequired !== true || !invoice?.pdfSourceHash) return { required: false, reasons: [] };
  try {
    return getPackingSourceReviewRequirement(invoice, country, lineIndex);
  } catch (error) {
    return { required: true, reasons: ['SOURCE_REVIEW_UNAVAILABLE'], message: error?.message || String(error) };
  }
}

/** Build display-only rows with the same resolver and shared mappings as final generators. */
export function buildPackingMatchPreview({ invoices, country, aliases = {}, erpMatches }) {
  if (!Array.isArray(invoices) || !invoices.length) return [];
  const products = Array.isArray(erpMatches?.products) ? erpMatches.products : [];
  const catalog = packingErpCatalog(products);
  const effectiveAliases = packingErpAliases(country, aliases, erpMatches?.value, products);

  return invoices.map((invoice, invoiceIndex) => {
    const pending = [];
    const noMatches = [];
    const resolve = makeProductResolver(country, catalog, effectiveAliases, {
      farm: invoice.supplier || '', farmAbbr: '', invoice: invoice.invoice || '', pending, noMatches,
    });
    const sourceLines = country === 'NL' ? invoice?.lines : invoice?.products;
    const rows = (Array.isArray(sourceLines) ? sourceLines : []).map((source, lineIndex) => {
      const raw = source && typeof source === 'object' ? source : {};
      const sourceName = String(raw.source_description || raw.description || '').trim();
      let resolved, matchingDescription;
      if (country === 'NL') {
        matchingDescription = String(raw.description || sourceName).trim();
        resolved = resolveProductNL(matchingDescription, catalog.byCountry.NL || [], effectiveAliases);
      } else {
        resolved = resolve(raw, lineIndex);
        matchingDescription = String(resolved.description || raw.description || raw.source_description || '').trim();
      }
      const matchedName = String(resolved.matchedName || matchingDescription || sourceName).trim();
      const saved = (erpMatches?.value?.entries || []).find(entry => entry.country === country
        && entry.sourceKey === packingSourceKey(matchingDescription) && entry.prodName === matchedName);
      const target = saved && products.find(product => product.country === country
        && product.ProdKey === saved.prodKey && product.ProdName === saved.prodName && product.selectable);
      const row = {
        ...raw,
        name: matchedName,
        matchedName,
        sourceName,
        matchingDescription,
        unmatched: resolved.unmatched === true,
        viaAlias: resolved.viaAlias === true,
        boxes: numeric(firstValue(raw.pcs, raw.boxes)),
        qty: previewQuantity(raw, country),
        stems: numeric(firstValue(raw.total_stems, raw.stems)),
        unitPrice: numeric(firstValue(raw.u_price, raw.price, raw.unit_price)),
        lineAmount: numeric(firstValue(raw.t_price, raw.amount, raw.line_amount)),
        stemLength: String(firstValue(raw.stem_length, raw.stemLength, raw.length?.raw, raw.length, '') || ''),
        source_row: Number.isInteger(raw.source_row) ? raw.source_row : lineIndex + 1,
        sourceInvoiceIndex: invoiceIndex,
        sourceLineIndex: lineIndex,
        sourceReview: sourceRequirement(invoice, country, lineIndex),
      };
      if (target && row.viaAlias) row.erpMatch = { type: 'MANUAL', confirmed: true,
        prodKey: target.ProdKey, sourceDescription: matchingDescription, matchedName };
      row.matchReview = packingMatchReview(row, products, country);
      return row;
    });
    return {
      name: `match-preview-${invoiceIndex}-${String(invoice.invoice || 'invoice')}`,
      label: `${invoice.supplier || '인보이스'} · ${invoice.invoice || '번호 미확인'}`,
      invoice: invoice.invoice || '',
      sourceInvoiceIndex: invoiceIndex,
      sourceInvoiceIdentity: packingInvoiceSourceIdentity(invoice, invoiceIndex),
      products: rows,
      grossWeight: numeric(firstValue(invoice.packingReview?.values?.gw, invoice.gross_weight)),
      chargeableWeight: numeric(firstValue(invoice.packingReview?.values?.cw, invoice.vol_weight)),
      pending,
      noMatches,
      previewOnly: true,
    };
  });
}

export { previewQuantity };
