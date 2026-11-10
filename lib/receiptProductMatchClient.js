import { needsInvoiceAllocation } from './invoiceProductAllocation.js';

export async function saveReceiptProductMatch(document, line, product, fetchFn = fetch) {
  const country = document.reviewedMetadata?.country;
  const description = line.sourceEvidence?.matchingDescription || line.originalName;
  if (line.sourceEvidence?.allocationSourceId || needsInvoiceAllocation(country, description)) return { documentOnly: true };
  const read = async response => {
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.error || '팀 공용 매칭을 저장하지 못했습니다. 품목 선택은 유지됩니다.');
    return data;
  };
  const current = await read(await fetchFn('/api/import/tools/product-matches', { cache: 'no-store' }));
  return read(await fetchFn('/api/import/tools/product-matches', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ country, description, prodKey: Number(product.ProdKey), expectedRevision: current.revision }) }));
}
