import { nlCompanyTemplateCost } from './nlCompanyTemplateCost.js';

const finite = value => value === '' || value == null || typeof value === 'boolean' ? null
  : Number.isFinite(Number(value)) ? Number(value) : null;

// Original invoice draft only. Does not touch an approved cost or an operator's
// manually entered customs total. The returned object is a calculation proposal.
export function nlInvoiceDraftTemplate(document, receiptLines, form) {
  if (form?.formulaId !== 'NL_AMOUNT_V1' || document?.costStatus === 'APPROVED') return null;
  const prior = form.nlTemplateCosts;
  const priorTotal = prior && prior.bakSang + prior.handling + prior.quarantine + prior.domestic + prior.extra - prior.deduct;
  if ((finite(form.customsTotalKRW) !== null && !prior)
    || (prior && Math.abs(Number(form.customsTotalKRW) - priorTotal) > .000001)) return null;
  const byId = new Map((document.lines || []).map(line => [line.lineId, line]));
  const inputs = new Map((form.lineInputs || []).map(line => [line.lineId, line]));
  const lines = (receiptLines || []).map(line => {
    const original = byId.get(line.lineId) || line;
    return { lineId:line.lineId, originalName:original.originalName,
      flowerName:line.flowerName || original.flowerName,
      lineAmount:finite(original.lineAmount), unitPrice:finite(original.unitPrice),
      stemQuantity:finite(line.stemQuantity), effectiveTariffRate:finite(inputs.get(line.lineId)?.tariffRate) };
  });
  const proposal = nlCompanyTemplateCost(lines, { gw:finite(document.reviewedMetadata?.gw),
    freight:finite(form.freightAmount), exchangeRate:finite(form.exchangeRateKRW) });
  return proposal.ready ? proposal : null;
}
